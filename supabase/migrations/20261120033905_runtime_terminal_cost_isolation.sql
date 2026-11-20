begin;

alter table app_private.currency_report_terminal_cost_escrows add column request_hash text;

create or replace function public.currency_report_recovery_policy() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('version',version,'enabled',enabled,'revision',revision,'maxRetries',1,
   'terminalCostIsolation',enabled) from app_private.currency_report_recovery_policy;
$$;

-- Evidence of a finished call is separate from eligibility to retry it.
create function app_private.runtime_terminal_cost_evidence(j app_private.currency_report_runtime_jobs) returns text
language sql stable security invoker set search_path='' as $$
 select case
  when j.response->'providerError'->>'code'='429' then 'rate_limit'
  when j.received_at is not null and j.request_hash ~ '^[a-f0-9]{64}$'
   and j.response_id ~ '^gen-[A-Za-z0-9-]{1,200}$'
   and j.response->>'responseId'=j.response_id and j.checkpoint->>'responseId'=j.response_id
   and j.response->>'httpStatus'='200'
   and j.response->'errors'='["provider_stream_error"]'::jsonb
   and j.response->'providerError'->>'code'='502'
   and j.response->'providerError'->'metadata'->>'error_type'='provider_unavailable'
   and j.response->>'finishReason' is null and j.response->>'done'='false'
   and j.context ? 'operatingBatchKey' and j.context ? 'operatingCaseKey'
   then 'provider_capacity'
 end
 where j.state='received' and j.response->>'valid'='false'
   and j.response->>'partialText'='' and j.response->>'usage' is null
   and j.reserved_nano between 1 and 250000000;
$$;

create or replace function app_private.runtime_cost_escrowed(p_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from app_private.currency_report_runtime_jobs j
 join app_private.currency_report_terminal_cost_escrows e on e.job_id=j.id
 where j.id=p_id and j.cost_state='unknown' and j.actual_nano is null
 and e.reserved_nano=j.reserved_nano and e.response_id=j.response_id and e.response_hash=md5(j.response::text)
 and (app_private.runtime_terminal_cost_evidence(j)='rate_limit'
   or app_private.runtime_terminal_cost_evidence(j)='provider_capacity' and e.request_hash=j.request_hash));
$$;

-- Serialize receipt storage with admission and monthly budget checks. Only
-- the dispatch owner can isolate a response while its envelope is running.
create function public.receive_currency_report_runtime_accounted(
 p_id uuid,p_response jsonb,p_actual_nano bigint,p_owner uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j app_private.currency_report_runtime_jobs;
begin
 perform 1 from app_private.currency_report_runtime_control where singleton for update;
 perform public.receive_currency_report_runtime(p_id,p_response,p_actual_nano);
 select * into j from app_private.currency_report_runtime_jobs where id=p_id;
 if j.actual_nano>j.reserved_nano then
  return jsonb_build_object('status','cost_exceeded','scope','global');
 end if;
 if j.context->>'operatingOwner'=p_owner::text
    and app_private.runtime_terminal_cost_evidence(j)='provider_capacity' then
  return public.decide_currency_report_recovery(p_id,p_owner);
 end if;
 return null;
end;$$;

revoke all on function app_private.runtime_terminal_cost_evidence(app_private.currency_report_runtime_jobs),
 public.receive_currency_report_runtime_accounted(uuid,jsonb,bigint,uuid) from public,anon,authenticated;
grant execute on function app_private.runtime_terminal_cost_evidence(app_private.currency_report_runtime_jobs),
 public.receive_currency_report_runtime_accounted(uuid,jsonb,bigint,uuid) to service_role;

create or replace function public.decide_currency_report_recovery(p_id uuid,p_execution uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j app_private.currency_report_runtime_jobs; p app_private.currency_report_recovery_policy;
 s text; scope text='global'; route jsonb; evidence text; previous app_private.currency_report_recovery_decisions;
begin
 perform 1 from app_private.currency_report_runtime_control where singleton for update;
 select * into p from app_private.currency_report_recovery_policy where singleton;
 select * into j from app_private.currency_report_runtime_jobs where id=p_id for update;
 if j.id is null or p_execution is null then raise exception 'existing recovery job and execution required';end if;
 if not p.enabled then
  return jsonb_build_object('diagnosticOnly',true,'scope',case when j.actual_nano>j.reserved_nano or j.state in('reserved','calling') or j.cost_state='unknown' and not app_private.runtime_cost_escrowed(j.id) then 'global' else 'job' end,
   'status',case when j.actual_nano>j.reserved_nano then 'cost_exceeded' when j.cost_state='unknown' then 'cost_still_unconfirmed' when j.response->>'valid'='true' then 'expense_reconciled_valid_response' else 'response_failed_no_automatic_retry' end,
   'lookupReason',(select reason from app_private.currency_report_recovery_lookups where job_id=p_id order by checked_at desc limit 1));
 end if;
 evidence:=app_private.runtime_terminal_cost_evidence(j);
 select * into previous from app_private.currency_report_recovery_decisions where job_id=p_id;
 if j.actual_nano>j.reserved_nano then s:='cost_exceeded';
 elsif j.state in('reserved','calling') then s:='execution_uncertain';
 elsif exists(select 1 from app_private.currency_report_operating_batches where batch_key=j.context->>'operatingBatchKey' and state='running' and lease_until>clock_timestamp()
    and not (evidence is not distinct from 'provider_capacity' and owner_id=p_execution
      and j.context->>'operatingOwner' is not distinct from p_execution::text)) then s:='execution_active';
 elsif exists(select 1 from app_private.currency_report_recovery_lookups where job_id=p_id and reason in('authentication_error','permission_error','identity_mismatch')
  and checked_at=(select max(checked_at) from app_private.currency_report_recovery_lookups where job_id=p_id)) then s:='cost_lookup_security_hold';
 elsif evidence='provider_capacity' and j.cost_state in('unknown','confirmed') then
  route:=app_private.runtime_recovery_route(j);
  if nullif(route->>'model','') is null or nullif(route->>'provider','') is null then s:='recovery_route_missing';
  else
   if j.cost_state='unknown' then
    insert into app_private.currency_report_terminal_cost_escrows
      (job_id,response_id,response_hash,reserved_nano,authorization_reference,request_hash)
    values(j.id,j.response_id,md5(j.response::text),j.reserved_nano,p.authorization_reference,j.request_hash)
    on conflict(job_id) do nothing;
    if not app_private.runtime_cost_escrowed(j.id) then raise exception 'full reservation proof mismatch';end if;
   end if;
   s:=case when j.cost_state='unknown' then 'cost_fully_reserved_unconfirmed' else 'response_failed_no_automatic_retry' end;
   scope:='job';
   -- An old receipt can be isolated without reopening a cooldown.
   if j.received_at+interval '15 minutes'>clock_timestamp()
      and previous.status is distinct from 'cost_fully_reserved_unconfirmed'
      and previous.status is distinct from 'response_failed_no_automatic_retry' then
    insert into app_private.currency_report_recovery_routes(model,provider,blocked_until)
    values(route->>'model',route->>'provider',j.received_at+interval '15 minutes')
    on conflict(model,provider) do update set blocked_until=greatest(currency_report_recovery_routes.blocked_until,excluded.blocked_until),probe_id=null;
   end if;
  end if;
 elsif app_private.runtime_cost_escrowed(j.id) and previous.job_id is null then s:='cost_fully_reserved_unconfirmed';scope:='job';
 elsif app_private.runtime_terminal_rejection(j) and j.cost_state in('unknown','confirmed') then
  route:=app_private.runtime_recovery_route(j);
  if nullif(route->>'model','') is null or nullif(route->>'provider','') is null then s:='recovery_route_missing';
  else
   if j.cost_state='unknown' then
    insert into app_private.currency_report_terminal_cost_escrows(job_id,response_id,response_hash,reserved_nano,authorization_reference)
    values(j.id,j.response_id,md5(j.response::text),j.reserved_nano,p.authorization_reference) on conflict(job_id) do nothing;
    if not app_private.runtime_cost_escrowed(j.id) then raise exception 'full reservation proof mismatch';end if;
   end if;
   s:=case when exists(select 1 from app_private.currency_report_runtime_jobs n where n.context->>'retryRoot'=j.task_key and n.response->>'valid'='true' and n.cost_state='confirmed') then 'recovery_retry_completed'
    when coalesce((j.context->>'retryAttempt')::integer,0)>=1 or exists(select 1 from app_private.currency_report_runtime_jobs n where n.context->>'retryRoot'=j.task_key and app_private.runtime_terminal_rejection(n)) then 'recovery_retry_exhausted' else 'recovery_retry_wait' end;scope:='job';
   if previous.job_id is null then
    insert into app_private.currency_report_recovery_routes(model,provider,blocked_until)
    values(route->>'model',route->>'provider',greatest(coalesce(j.received_at,clock_timestamp())+
      case when s='recovery_retry_exhausted' then interval '24 hours' else interval '15 minutes' end,
      coalesce((j.response->>'retryAfterAt')::timestamptz,'-infinity'::timestamptz)))
    on conflict(model,provider) do update set blocked_until=greatest(currency_report_recovery_routes.blocked_until,excluded.blocked_until),probe_id=null;
   end if;
  end if;
 elsif j.cost_state='confirmed' then s:=case when j.response->>'valid'='true' then 'expense_reconciled_valid_response' else 'response_failed_no_automatic_retry' end;scope:='job';
  if j.response->>'valid'='true' then delete from app_private.currency_report_recovery_routes where probe_id=j.id;end if;
 elsif app_private.runtime_cost_escrowed(j.id) then s:='cost_fully_reserved_unconfirmed';scope:='job';
 else s:='cost_still_unconfirmed';end if;
 insert into app_private.currency_report_recovery_events(job_id,event_hash,policy_revision,execution_id,status,scope,response_hash,reserved_nano,actual_nano)
 values(j.id,md5(jsonb_build_array(p.revision,s,scope,j.cost_state,j.actual_nano)::text),p.revision,p_execution,s,scope,md5(coalesce(j.response::text,'null')),j.reserved_nano,j.actual_nano)
 on conflict(job_id,event_hash) do nothing;
 insert into app_private.currency_report_recovery_decisions(job_id,policy_revision,execution_id,response_hash,status,scope)
 values(j.id,p.revision,p_execution,md5(coalesce(j.response::text,'null')),s,scope)
 on conflict(job_id) do update set policy_revision=excluded.policy_revision,
  execution_id=case when currency_report_recovery_decisions.status=excluded.status and currency_report_recovery_decisions.scope=excluded.scope then currency_report_recovery_decisions.execution_id else excluded.execution_id end,
  response_hash=excluded.response_hash,status=excluded.status,scope=excluded.scope,
  decided_at=case when currency_report_recovery_decisions.status=excluded.status and currency_report_recovery_decisions.scope=excluded.scope
    then currency_report_recovery_decisions.decided_at else clock_timestamp() end;
 return jsonb_build_object('status',s,'scope',scope,'reservedNano',case when j.cost_state='unknown' then j.reserved_nano else 0 end,
  'costConfirmed',j.cost_state='confirmed','nextLookupAt',(select checked_at+case
   (select count(*) from app_private.currency_report_recovery_lookups where job_id=p_id) when 1 then interval '5 minutes' when 2 then interval '30 minutes' when 3 then interval '6 hours' else interval '24 hours' end
   from app_private.currency_report_recovery_lookups where job_id=p_id order by checked_at desc limit 1));
end;$$;

create or replace function public.record_currency_report_recovery_lookup(p_id uuid,p_execution uuid,p_diagnostic jsonb,p_receipt jsonb default null) returns void
language plpgsql security invoker set search_path='' as $$
declare j app_private.currency_report_runtime_jobs;
begin
 perform 1 from app_private.currency_report_runtime_control where singleton for update;
 select * into j from app_private.currency_report_runtime_jobs where id=p_id for update;
 if j.id is null or p_execution is null
 or p_diagnostic->>'version' is distinct from 'generation-cost-lookup/1'
 or p_diagnostic->>'reason' not in('confirmed','record_not_found','authentication_error','permission_error','lookup_rate_limited','provider_error','http_error','timeout','network_error','invalid_json','identity_mismatch','completion_not_confirmed','cost_missing','lookup_error')
 or exists(select 1 from jsonb_object_keys(p_diagnostic) k where k not in('version','reason','httpStatus'))
 or octet_length(p_diagnostic::text)>512 then raise exception 'bounded recovery diagnostic required';end if;
 if p_receipt is not null then
  if p_diagnostic->>'reason' is distinct from 'confirmed'
   or p_receipt->>'source' is distinct from 'generation.total_cost'
   or j.response_id is null or p_receipt->>'responseId' is distinct from j.response_id
   or p_receipt->>'costNano' is null then raise exception 'matching confirmed lookup required';end if;
  if j.cost_state='confirmed' and j.actual_nano is distinct from (p_receipt->>'costNano')::bigint then
   raise exception 'conflicting expense receipt';end if;
 end if;
 if exists(select 1 from app_private.currency_report_recovery_lookups where job_id=p_id and execution_id=p_execution) then return;end if;
 if p_receipt is not null then
  if j.cost_state='unknown' then
   perform public.reconcile_currency_report_runtime_cost(p_id,p_receipt->>'responseId',(p_receipt->>'costNano')::bigint,p_receipt);
  end if;
 end if;
 insert into app_private.currency_report_recovery_lookups(job_id,execution_id,reason,http_status)
  values(p_id,p_execution,p_diagnostic->>'reason',(p_diagnostic->>'httpStatus')::integer);
end;$$;

create or replace function public.reconcile_currency_report_runtime_cost(p_id uuid,p_response_id text,p_actual_nano bigint,p_receipt jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare j app_private.currency_report_runtime_jobs;
begin
 perform 1 from app_private.currency_report_runtime_control where singleton for update;
 select * into j from app_private.currency_report_runtime_jobs where id=p_id for update;
 if j.id is null or j.state not in ('calling','received') or j.cost_state<>'unknown' or j.cost_receipt is not null
  or j.response_id is null or j.response_id is distinct from p_response_id or p_actual_nano is null or p_actual_nano<0
  or p_receipt->>'source' is distinct from 'generation.total_cost' or p_receipt->>'responseId' is distinct from p_response_id
  or p_receipt->>'costNano' is distinct from p_actual_nano::text or octet_length(p_receipt::text)>2048 then
  raise exception 'verified unresolved generation cost required' using errcode='55000'; end if;
 update app_private.currency_report_runtime_jobs set cost_state='confirmed',actual_nano=p_actual_nano,cost_receipt=p_receipt,
  state=case when state='calling' then 'held' else state end where id=p_id;
end;
$$;

-- A late receipt can arrive between reserve and begin. Recheck shared
-- protection under the same lock before authorizing a POST.
create or replace function public.begin_currency_report_runtime(p_id uuid,p_request_hash text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare c app_private.currency_report_runtime_control; j app_private.currency_report_runtime_jobs;
begin
 select * into c from app_private.currency_report_runtime_control where singleton for update;
 select * into j from app_private.currency_report_runtime_jobs where id=p_id for update;
 if j.id is null or j.state<>'reserved' or j.request_hash is distinct from p_request_hash then return false; end if;
 if not c.enabled or c.revision<>j.control_revision or j.stage='reviewer' and not c.review_enabled then
   update app_private.currency_report_runtime_jobs set state='cancelled',cost_state='confirmed',actual_nano=0 where id=p_id;
   return false;
 end if;
 if exists(select 1 from app_private.currency_report_runtime_jobs x where x.id<>p_id
    and ((x.cost_state='unknown' and not app_private.runtime_cost_escrowed(x.id))
      or x.state in('reserved','calling') or x.actual_nano>x.reserved_nano))
   or exists(select 1 from app_private.currency_report_recovery_decisions where scope='global') then
  return false;
 end if;
 update app_private.currency_report_runtime_jobs set state='calling',cost_state='unknown',started_at=clock_timestamp() where id=p_id;
 return true;
end;$$;

notify pgrst,'reload schema';

commit;
