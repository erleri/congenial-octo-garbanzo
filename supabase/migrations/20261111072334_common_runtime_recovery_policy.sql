begin;
-- Additive, disabled by default. The old explicitly paused trial escrow stays
-- intact. Worker decisions require a separately authorized recurring policy.
create table app_private.currency_report_recovery_policy (
 singleton boolean primary key default true check(singleton), revision bigint not null default 1,
 enabled boolean not null default false, authorization_reference text,
 version text not null default 'runtime-recovery/1' check(version='runtime-recovery/1')
);
insert into app_private.currency_report_recovery_policy(singleton) values(true);
create table app_private.currency_report_recovery_lookups (
 job_id uuid not null references app_private.currency_report_runtime_jobs(id), execution_id uuid not null,
 checked_at timestamptz not null default clock_timestamp(), reason text not null,
 http_status integer, primary key(job_id,execution_id)
);
create table app_private.currency_report_recovery_decisions (
 job_id uuid primary key references app_private.currency_report_runtime_jobs(id),
 policy_revision bigint not null, execution_id uuid not null, response_hash text not null,
 status text not null, scope text not null check(scope in('job','global')),
 decided_at timestamptz not null default clock_timestamp()
);
create table app_private.currency_report_recovery_routes (
 model text not null, provider text not null, blocked_until timestamptz not null,
 probe_id uuid references app_private.currency_report_runtime_jobs(id),
 primary key(model,provider)
);
create table app_private.currency_report_recovery_events (
 job_id uuid not null references app_private.currency_report_runtime_jobs(id), event_hash text not null,
 policy_revision bigint not null, execution_id uuid not null, status text not null, scope text not null,
 response_hash text not null, reserved_nano bigint not null, actual_nano bigint,
 recorded_at timestamptz not null default clock_timestamp(), primary key(job_id,event_hash)
);
create index currency_recovery_lookup_latest on app_private.currency_report_recovery_lookups(job_id,checked_at desc);
create index currency_recovery_global on app_private.currency_report_recovery_decisions(job_id) where scope='global';
create index currency_runtime_retry_root on app_private.currency_report_runtime_jobs((context->>'retryRoot')) where context ? 'retryRoot';
alter table app_private.currency_report_recovery_policy enable row level security;
alter table app_private.currency_report_recovery_lookups enable row level security;
alter table app_private.currency_report_recovery_decisions enable row level security;
alter table app_private.currency_report_recovery_routes enable row level security;
alter table app_private.currency_report_recovery_events enable row level security;
revoke all on app_private.currency_report_recovery_events from public,anon,authenticated;
grant select,insert on app_private.currency_report_recovery_events to service_role;
revoke all on app_private.currency_report_recovery_policy,app_private.currency_report_recovery_lookups,
 app_private.currency_report_recovery_decisions,app_private.currency_report_recovery_routes from public,anon,authenticated;
grant select,insert,update on app_private.currency_report_recovery_policy,app_private.currency_report_recovery_lookups,
 app_private.currency_report_recovery_decisions,app_private.currency_report_recovery_routes to service_role;

create function public.currency_report_recovery_policy() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('version',version,'enabled',enabled,'revision',revision,'maxRetries',1) from app_private.currency_report_recovery_policy;
$$;
create function public.configure_currency_report_recovery_policy(p_enabled boolean,p_revision bigint,p_authorization text) returns bigint
language plpgsql security invoker set search_path='' as $$
declare r bigint;
begin
 perform 1 from app_private.currency_report_runtime_control where singleton for update;
 if exists(select 1 from app_private.currency_report_runtime_control where enabled or review_enabled)
  or exists(select 1 from app_private.currency_report_runtime_jobs where state in('reserved','calling'))
  or p_authorization is null or p_authorization !~ '^[A-Za-z0-9:_-]{1,180}$' then
  raise exception 'paused authorized recovery configuration required';end if;
 update app_private.currency_report_recovery_policy set enabled=p_enabled,revision=revision+1,
  authorization_reference=p_authorization where revision=p_revision returning revision into r;
 if r is null then raise exception 'recovery revision changed';end if;
 return r;
end;$$;
create function app_private.runtime_terminal_rejection(j app_private.currency_report_runtime_jobs) returns boolean
language sql stable security invoker set search_path='' as $$
 select j.state='received' and j.response_id ~ '^gen-[A-Za-z0-9-]{1,200}$'
  and j.response->>'valid'='false' and j.response->>'partialText'=''
  and j.response->'providerError'->>'code'='429'
  and (j.response->'errors' @> '["provider_stream_error"]'::jsonb or j.response->>'httpStatus'='429' and j.response->'errors' @> '["http_429"]'::jsonb)
  and (j.response->'usage' is null or j.response->'usage'='null'::jsonb)
  and j.reserved_nano between 1 and 250000000;
$$;
create function app_private.runtime_recovery_route(j app_private.currency_report_runtime_jobs) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('model',coalesce(j.context->>'model',j.context->'request'->>'model',case when j.context->>'writer' in('sol','sol-us') then 'openai/gpt-6.1-sol' end),
  'provider',coalesce(j.context->>'provider',j.context->'request'->'provider'->'only'->>0,case j.context->>'writer' when 'sol' then 'azure' when 'sol-us' then 'azure/us' end));
$$;
-- All unresolved jobs are counted by the existing SQL spending gates. Keyset
-- pagination is for inspection, never permission to ignore another page.
create function public.currency_report_recovery_candidates(p_after uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 with page as (
 select j.*,l.checked_at,l.reason,
  (select count(*) from app_private.currency_report_recovery_lookups where job_id=j.id) as lookup_count
 from app_private.currency_report_runtime_jobs j
 left join lateral (select checked_at,reason from app_private.currency_report_recovery_lookups where job_id=j.id order by checked_at desc limit 1) l on true
 where (p_after is null or j.id>p_after) and j.context ? 'operatingBatchKey'
 and (j.cost_state='unknown' or j.state='reserved' or j.actual_nano>j.reserved_nano or app_private.runtime_terminal_rejection(j)
  or exists(select 1 from app_private.currency_report_recovery_decisions d where d.job_id=j.id and d.scope='global'))
 order by j.id limit 100
 ), rows as(select jsonb_build_object('id',id,'currency',currency,'state',state,'cost_state',cost_state,'response_id',response_id,
 'reserved_nano',reserved_nano,'actual_nano',actual_nano,'checkedAt',checked_at,'escrowed',app_private.runtime_cost_escrowed(id),
 'scope',(select d.scope from app_private.currency_report_recovery_decisions d where d.job_id=page.id),
 'recoveryStatus',(select d.status from app_private.currency_report_recovery_decisions d where d.job_id=page.id),
 'lookupDue',checked_at is null or checked_at+case lookup_count when 1 then interval '5 minutes' when 2 then interval '30 minutes' when 3 then interval '6 hours' else interval '24 hours' end<=clock_timestamp()) r,id from page)
 select jsonb_build_object('items',coalesce(jsonb_agg(r order by id),'[]'::jsonb),'nextCursor',case when count(*)=100 then (array_agg(id order by id desc))[1] end) from rows;
$$;
create function public.record_currency_report_recovery_lookup(p_id uuid,p_execution uuid,p_diagnostic jsonb,p_receipt jsonb default null) returns void
language plpgsql security invoker set search_path='' as $$
declare j app_private.currency_report_runtime_jobs;
begin
 select * into j from app_private.currency_report_runtime_jobs where id=p_id for update;
 if j.id is null or p_execution is null or not exists(select 1 from app_private.currency_report_recovery_policy where enabled)
 or p_diagnostic->>'version' is distinct from 'generation-cost-lookup/1'
 or p_diagnostic->>'reason' not in('confirmed','record_not_found','authentication_error','permission_error','lookup_rate_limited','provider_error','http_error','timeout','network_error','invalid_json','identity_mismatch','completion_not_confirmed','cost_missing','lookup_error')
 or exists(select 1 from jsonb_object_keys(p_diagnostic) k where k not in('version','reason','httpStatus'))
 or octet_length(p_diagnostic::text)>512 then raise exception 'bounded recovery diagnostic required';end if;
 if exists(select 1 from app_private.currency_report_recovery_lookups where job_id=p_id and execution_id=p_execution) then return;end if;
 if p_receipt is not null then
  if p_diagnostic->>'reason'<>'confirmed' then raise exception 'confirmed lookup required';end if;
  if j.cost_state='unknown' then
   perform public.reconcile_currency_report_runtime_cost(p_id,p_receipt->>'responseId',(p_receipt->>'costNano')::bigint,p_receipt);
  elsif j.actual_nano is distinct from (p_receipt->>'costNano')::bigint then raise exception 'conflicting expense receipt';end if;
 end if;
 insert into app_private.currency_report_recovery_lookups(job_id,execution_id,reason,http_status)
  values(p_id,p_execution,p_diagnostic->>'reason',(p_diagnostic->>'httpStatus')::integer);
end;$$;
create function public.decide_currency_report_recovery(p_id uuid,p_execution uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j app_private.currency_report_runtime_jobs; p app_private.currency_report_recovery_policy;
 s text; scope text='global'; route jsonb; previous app_private.currency_report_recovery_decisions;
begin
 perform 1 from app_private.currency_report_runtime_control where singleton for update;
 select * into p from app_private.currency_report_recovery_policy where singleton;
 select * into j from app_private.currency_report_runtime_jobs where id=p_id for update;
 if not p.enabled or j.id is null or p_execution is null then raise exception 'enabled recovery and existing job required';end if;
 select * into previous from app_private.currency_report_recovery_decisions where job_id=p_id;
 if j.actual_nano>j.reserved_nano then s:='cost_exceeded';
 elsif j.state in('reserved','calling') then s:='execution_uncertain';
 elsif exists(select 1 from app_private.currency_report_operating_batches where batch_key=j.context->>'operatingBatchKey' and state='running' and lease_until>clock_timestamp()) then s:='execution_active';
 elsif exists(select 1 from app_private.currency_report_recovery_lookups where job_id=p_id and reason in('authentication_error','permission_error','identity_mismatch')
  and checked_at=(select max(checked_at) from app_private.currency_report_recovery_lookups where job_id=p_id)) then s:='cost_lookup_security_hold';
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
create function public.currency_report_recovery_attempt(p_task_key text,p_request_hash text,p_execution uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p app_private.currency_report_recovery_policy;j app_private.currency_report_runtime_jobs;d app_private.currency_report_recovery_decisions;why text;
begin
 select * into p from app_private.currency_report_recovery_policy where singleton;
 if not p.enabled then return jsonb_build_object('enabled',false);end if;
 select * into j from app_private.currency_report_runtime_jobs where task_key=p_task_key;
 if j.id is null or not app_private.runtime_terminal_rejection(j) then return jsonb_build_object('enabled',true,'allowed',false,'executionId',p_execution);end if;
 select * into d from app_private.currency_report_recovery_decisions where job_id=j.id;
 why:=case when p_execution is null then 'recovery_execution_required'
  when j.request_hash<>p_request_hash then 'recovery_request_changed'
  when exists(select 1 from app_private.currency_report_runtime_jobs where context->>'retryRoot'=p_task_key and coalesce((context->>'retryAttempt')::integer,0)>=1
   and not(state='cancelled' and actual_nano=0 and checkpoint->>'phase'='unsent_released_never_dispatched')) then 'recovery_retry_exhausted'
  when coalesce((j.context->>'retryAttempt')::integer,0)>0 then 'recovery_retry_exhausted'
  when d.job_id is null or d.scope<>'job' then 'recovery_accounting_hold'
  when coalesce(j.context->>'recoveryExecutionId',j.context->>'operatingOwner')=p_execution::text then 'recovery_next_execution_wait'
  when j.cost_state<>'confirmed' and not app_private.runtime_cost_escrowed(j.id) then 'recovery_accounting_hold'
  when exists(select 1 from app_private.currency_report_recovery_routes r where
   r.model=app_private.runtime_recovery_route(j)->>'model' and r.provider=app_private.runtime_recovery_route(j)->>'provider' and r.blocked_until>clock_timestamp()) then 'recovery_route_wait'
 end;
 return jsonb_build_object('enabled',true,'allowed',why is null,'reason',why,'revision',p.revision);
end;$$;

-- Keep trial compatibility while putting an authoritative ceiling on the
-- recurring retry. A new execution ID cannot manufacture another paid attempt.
create function app_private.enforce_recurring_runtime_retry() returns trigger
language plpgsql security invoker set search_path='' as $$
declare p app_private.currency_report_recovery_policy;a jsonb;
begin
 select * into p from app_private.currency_report_recovery_policy where singleton;
 if not p.enabled or not new.context ? 'retryOf' then return new;end if;
 a:=public.currency_report_recovery_attempt(new.context->>'retryRoot',new.request_hash,(new.context->>'recoveryExecutionId')::uuid);
 if new.context->>'retryAttempt'<>'1' or not coalesce((a->>'allowed')::boolean,false)
  or exists(select 1 from app_private.currency_report_runtime_jobs where context->>'retryRoot'=new.context->>'retryRoot')
  or (new.context->>'recoveryRevision')::bigint is distinct from p.revision then raise exception 'one funded next-execution retry required';end if;
 return new;
end;$$;
create trigger currency_recurring_retry before insert on app_private.currency_report_runtime_jobs for each row execute function app_private.enforce_recurring_runtime_retry();
create function app_private.runtime_recovery_route_after_response() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r jsonb;
begin
 if not exists(select 1 from app_private.currency_report_recovery_policy where enabled) or old.state<>'calling' or new.state<>'received' then return new;end if;
 r:=app_private.runtime_recovery_route(new);
 if r->>'model' is null or r->>'provider' is null then return new;end if;
 if app_private.runtime_terminal_rejection(new) then
  insert into app_private.currency_report_recovery_routes(model,provider,blocked_until)
  values(r->>'model',r->>'provider',greatest(clock_timestamp()+case when coalesce((new.context->>'retryAttempt')::integer,0)>=1 then interval '24 hours' else interval '15 minutes' end,
   coalesce((new.response->>'retryAfterAt')::timestamptz,'-infinity'::timestamptz)))
  on conflict(model,provider) do update set blocked_until=greatest(currency_report_recovery_routes.blocked_until,excluded.blocked_until),probe_id=null;
 elsif new.response->>'valid'='true' and new.cost_state='confirmed' and new.actual_nano<=new.reserved_nano then
  delete from app_private.currency_report_recovery_routes where model=r->>'model' and provider=r->>'provider' and probe_id=new.id;
 end if;
 return new;
end;$$;
create trigger runtime_recovery_route_received after update of state on app_private.currency_report_runtime_jobs for each row execute function app_private.runtime_recovery_route_after_response();

-- Route probe admission remains behind the original budget and immutable
-- request reservation functions. Never extend an Actions timeout for backoff.
alter function public.reserve_currency_report_runtime(text,text,date,text,text,jsonb,bigint,bigint,uuid) rename to reserve_currency_report_runtime_before_recovery;
create function public.reserve_currency_report_runtime(p_task_key text,p_currency text,p_date date,p_stage text,p_request_hash text,p_context jsonb,p_reserved_nano bigint,p_revision bigint,p_parent_id uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r jsonb;v_model text;v_provider text;gate app_private.currency_report_recovery_routes;
begin
 perform 1 from app_private.currency_report_runtime_control where singleton for update;
 v_model:=coalesce(p_context->>'model',p_context->'request'->>'model',case when p_context->>'writer' in('sol','sol-us') then 'openai/gpt-6.1-sol' end);
 v_provider:=coalesce(p_context->>'provider',p_context->'request'->'provider'->'only'->>0,case p_context->>'writer' when 'sol' then 'azure' when 'sol-us' then 'azure/us' end);
 if exists(select 1 from app_private.currency_report_recovery_policy where enabled) then
  if exists(select 1 from app_private.currency_report_recovery_decisions where scope='global') then return jsonb_build_object('reserved',false,'reason','recovery_accounting_hold');end if;
  select * into gate from app_private.currency_report_recovery_routes where model=v_model and provider=v_provider for update;
  if gate.model is not null and (gate.blocked_until>clock_timestamp() or gate.probe_id is not null
    and exists(select 1 from app_private.currency_report_runtime_jobs where id=gate.probe_id and state in('reserved','calling'))) then
   return jsonb_build_object('reserved',false,'reason','recovery_route_wait');end if;
 end if;
 r:=public.reserve_currency_report_runtime_before_recovery(p_task_key,p_currency,p_date,p_stage,p_request_hash,p_context,p_reserved_nano,p_revision,p_parent_id);
 if r->>'reserved'='true' and gate.model is not null then
  update app_private.currency_report_recovery_routes set probe_id=(r->>'id')::uuid where model=v_model and provider=v_provider;
 end if;
 return r;
end;$$;
-- Requeue exact cost/output holds only after an audited terminal decision.
-- Current source/date/price eligibility is still rechecked by the coordinator.
create function public.recover_currency_report_terminal_cases(p_execution uuid) returns integer
language plpgsql security invoker set search_path='' as $$
declare c app_private.currency_report_operating_cases;n integer=0;
begin
 perform 1 from app_private.currency_report_runtime_control where singleton for update;
 if not exists(select 1 from app_private.currency_report_recovery_policy where enabled)
  or exists(select 1 from app_private.currency_report_runtime_control where not enabled or not review_enabled)
  or exists(select 1 from app_private.currency_report_runtime_jobs where (cost_state='unknown' and not app_private.runtime_cost_escrowed(id)) or state in('reserved','calling') or actual_nano>reserved_nano) then return 0;end if;
 for c in select * from app_private.currency_report_operating_cases where state='held' and run_id is null
  and result->>'status' in('source_cost_unresolved','cost_unresolved','output_hold','source_response_or_cost_hold','country_execution_hold','writing_input_hold') for update skip locked loop
  if exists(select 1 from app_private.currency_report_runtime_jobs j join app_private.currency_report_recovery_decisions d on d.job_id=j.id
   where j.context->>'operatingCaseKey'=c.case_key and d.status='recovery_retry_wait' and d.scope='job'
    and coalesce(j.context->>'recoveryExecutionId',j.context->>'operatingOwner','')<>p_execution::text)
   and not exists(select 1 from app_private.currency_report_technical_recoveries where case_key=c.case_key and repair_version='terminal-recovery/1') then
   insert into app_private.currency_report_technical_recoveries values(c.case_key,'terminal-recovery/1',c.state,c.result,
    (select state from app_private.currency_report_operating_batches where batch_key=c.batch_key),clock_timestamp());
   update app_private.currency_report_operating_cases set state='paused',updated_at=clock_timestamp() where case_key=c.case_key;
   update app_private.currency_report_operating_batches set state='paused',updated_at=clock_timestamp() where batch_key=c.batch_key;
   n:=n+1;
  end if;
 end loop;
 return n;
end;$$;
-- Admin-safe projection: no request/response/body, keys or raw source data.
create function public.currency_report_recovery_summary() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not app_private.is_business_plan_admin() then raise exception 'active admin required' using errcode='42501';end if;
 return jsonb_build_object('policy',(select jsonb_build_object('enabled',enabled,'revision',revision) from app_private.currency_report_recovery_policy),
 'globalBlocked',exists(select 1 from app_private.currency_report_runtime_jobs where (cost_state='unknown' and not app_private.runtime_cost_escrowed(id)) or state in('reserved','calling') or actual_nano>reserved_nano)
  or exists(select 1 from app_private.currency_report_recovery_decisions where scope='global'),
 'totalItems',(select count(*) from app_private.currency_report_recovery_decisions),
 'items',coalesce((select jsonb_agg(x) from (select j.id,j.currency,j.base_date,d.status,d.scope,
  case when j.cost_state='unknown' then j.reserved_nano/1e9 else 0 end as "reservedUsd",j.cost_state as "costState",
  greatest(coalesce((j.context->>'retryAttempt')::integer,0),(select count(*)::integer from app_private.currency_report_runtime_jobs n where n.context->>'retryRoot'=j.task_key)) as attempt,
  l.reason as "lookupReason",l.checked_at as "checkedAt",
  l.checked_at+case (select count(*) from app_private.currency_report_recovery_lookups where job_id=j.id) when 1 then interval '5 minutes' when 2 then interval '30 minutes' when 3 then interval '6 hours' else interval '24 hours' end as "nextLookupAt",
  (select blocked_until from app_private.currency_report_recovery_routes where model=app_private.runtime_recovery_route(j)->>'model' and provider=app_private.runtime_recovery_route(j)->>'provider') as "routeBlockedUntil"
 from app_private.currency_report_recovery_decisions d join app_private.currency_report_runtime_jobs j on j.id=d.job_id
 left join lateral(select reason,checked_at from app_private.currency_report_recovery_lookups where job_id=j.id order by checked_at desc limit 1) l on true
 order by d.decided_at desc limit 100) x),'[]'::jsonb));
end;$$;
-- No new grants to the public request/response archive.
revoke all on function public.currency_report_recovery_policy(),public.configure_currency_report_recovery_policy(boolean,bigint,text),
 public.currency_report_recovery_candidates(uuid),public.record_currency_report_recovery_lookup(uuid,uuid,jsonb,jsonb),public.decide_currency_report_recovery(uuid,uuid),
 public.currency_report_recovery_attempt(text,text,uuid),public.recover_currency_report_terminal_cases(uuid),
 public.reserve_currency_report_runtime(text,text,date,text,text,jsonb,bigint,bigint,uuid),public.reserve_currency_report_runtime_before_recovery(text,text,date,text,text,jsonb,bigint,bigint,uuid) from public,anon,authenticated;
grant execute on function public.currency_report_recovery_policy(),public.configure_currency_report_recovery_policy(boolean,bigint,text),
 public.currency_report_recovery_candidates(uuid),public.record_currency_report_recovery_lookup(uuid,uuid,jsonb,jsonb),public.decide_currency_report_recovery(uuid,uuid),
 public.currency_report_recovery_attempt(text,text,uuid),public.recover_currency_report_terminal_cases(uuid),
 public.reserve_currency_report_runtime(text,text,date,text,text,jsonb,bigint,bigint,uuid),public.reserve_currency_report_runtime_before_recovery(text,text,date,text,text,jsonb,bigint,bigint,uuid) to service_role;
revoke all on function app_private.runtime_terminal_rejection(app_private.currency_report_runtime_jobs),app_private.runtime_recovery_route(app_private.currency_report_runtime_jobs),app_private.enforce_recurring_runtime_retry() from public,anon,authenticated;
grant execute on function app_private.runtime_terminal_rejection(app_private.currency_report_runtime_jobs),app_private.runtime_recovery_route(app_private.currency_report_runtime_jobs),app_private.enforce_recurring_runtime_retry() to service_role;
revoke all on function public.currency_report_recovery_summary() from public,anon;
grant execute on function public.currency_report_recovery_summary() to authenticated,service_role;
revoke all on function app_private.runtime_recovery_route_after_response() from public,anon,authenticated;
grant execute on function app_private.runtime_recovery_route_after_response() to service_role;
grant delete on app_private.currency_report_recovery_routes to service_role;
alter function app_private.currency_report_review_items() rename to currency_report_review_items_before_recovery;
create function app_private.currency_report_review_items()
returns table(kind text,id text,version text,currency text,base_date date,title text,summary text,reason text,created_at timestamptz,target_id text)
language sql stable security invoker set search_path='' as $$
 select b.* from app_private.currency_report_review_items_before_recovery() b where b.kind<>'incident'
  or not exists(select 1 from app_private.currency_report_recovery_decisions d where d.job_id::text=b.id)
 union all
 select 'incident',j.id::text,encode(sha256(convert_to(jsonb_build_array(j.id,d.status,d.scope,j.cost_state,j.actual_nano,l.reason)::text,'UTF8')),'hex'),
  j.currency,j.base_date,case when d.scope='global' then '공통 리포트 복구 확인' else '리포트 복구·비용 확인' end,
  case when j.cost_state='unknown' then '최대 비용 예약을 유지하고 있습니다. 실제 비용은 아직 미확정입니다.' else '실제 비용은 확인됐으며 실패 단계의 재개 상태를 확인합니다.' end,
  d.status||' · '||d.scope||coalesce(' · '||l.reason,''),d.decided_at,j.id::text
 from app_private.currency_report_recovery_decisions d join app_private.currency_report_runtime_jobs j on j.id=d.job_id
 left join lateral(select reason from app_private.currency_report_recovery_lookups where job_id=j.id order by checked_at desc limit 1) l on true
 where d.scope='global' or j.cost_state='unknown' or d.status='recovery_retry_exhausted';
$$;
revoke all on function app_private.currency_report_review_items() from public,anon,authenticated;
grant execute on function app_private.currency_report_review_items() to service_role;
notify pgrst,'reload schema';
commit;
