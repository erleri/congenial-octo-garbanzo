-- Terminal 429 reservations remain UNKNOWN and count in full toward budget.
-- Only service-owned, explicit escrow can separate them from live uncertainty.
create table app_private.currency_report_terminal_cost_escrows (
 job_id uuid primary key references app_private.currency_report_runtime_jobs(id),
 response_id text not null, response_hash text not null,
 reserved_nano bigint not null check(reserved_nano between 1 and 250000000),
 authorization_reference text not null check(authorization_reference ~ '^[A-Za-z0-9:_-]{1,180}$'),
 created_at timestamptz not null default clock_timestamp()
);
alter table app_private.currency_report_terminal_cost_escrows enable row level security;
revoke all on app_private.currency_report_terminal_cost_escrows from public,anon,authenticated;
grant select,insert on app_private.currency_report_terminal_cost_escrows to service_role;
create function app_private.runtime_cost_escrowed(p_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from app_private.currency_report_runtime_jobs j
 join app_private.currency_report_terminal_cost_escrows e on e.job_id=j.id
 where j.id=p_id and j.state='received' and j.cost_state='unknown' and j.actual_nano is null
 and e.reserved_nano=j.reserved_nano and e.response_id=j.response_id and e.response_hash=md5(j.response::text)
 and j.response->>'valid'='false' and j.response->>'partialText'=''
 and j.response->'providerError'->>'code'='429' and (j.response->'usage' is null or j.response->'usage'='null'::jsonb));
$$;
revoke all on function app_private.runtime_cost_escrowed(uuid) from public,anon,authenticated;
grant execute on function app_private.runtime_cost_escrowed(uuid) to service_role;
create function public.currency_report_terminal_cost_escrow(p_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$ select app_private.runtime_cost_escrowed(p_id); $$;
revoke all on function public.currency_report_terminal_cost_escrow(uuid) from public,anon,authenticated;
grant execute on function public.currency_report_terminal_cost_escrow(uuid) to service_role;
create function public.escrow_currency_report_terminal_failure(p_id uuid,p_authorization text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j app_private.currency_report_runtime_jobs;
begin
 perform 1 from app_private.currency_report_runtime_control where singleton for update;
 select * into j from app_private.currency_report_runtime_jobs where id=p_id for update;
 if p_authorization is null or p_authorization !~ '^[A-Za-z0-9:_-]{1,180}$'
 or exists(select 1 from app_private.currency_report_runtime_control where enabled or review_enabled)
 or j.id is null or j.state is distinct from 'received' or j.cost_state is distinct from 'unknown'
 or j.actual_nano is not null or j.response_id is null
 or j.response->>'valid' is distinct from 'false' or j.response->>'partialText' is distinct from ''
 or j.response->'providerError'->>'code' is distinct from '429'
 or (j.response->'usage' is not null and j.response->'usage'<>'null'::jsonb) then
 raise exception 'terminal rejection and explicit full reservation required' using errcode='55000'; end if;
 insert into app_private.currency_report_terminal_cost_escrows(job_id,response_id,response_hash,reserved_nano,authorization_reference)
 values(j.id,j.response_id,md5(j.response::text),j.reserved_nano,p_authorization) on conflict(job_id) do nothing;
 if not app_private.runtime_cost_escrowed(j.id) then raise exception 'terminal reservation changed' using errcode='55000'; end if;
 return jsonb_build_object('escrowed',true,'costConfirmed',false,'reservedNano',j.reserved_nano);
end; $$;
revoke all on function public.escrow_currency_report_terminal_failure(uuid,text) from public,anon,authenticated;
grant execute on function public.escrow_currency_report_terminal_failure(uuid,text) to service_role;

-- Keep every retry as a separate immutable expense, including reviewer retries.
alter table app_private.currency_report_runtime_jobs drop constraint currency_report_runtime_jobs_parent_id_stage_key;
create unique index currency_runtime_parent_stage_attempt on app_private.currency_report_runtime_jobs
 (parent_id,stage,(coalesce(context->>'retryAttempt','0')));
create function app_private.validate_currency_runtime_retry() returns trigger
language plpgsql security invoker set search_path='' as $$
declare p app_private.currency_report_runtime_jobs; a integer;
begin
 if not(new.context ? 'retryOf' or new.context ? 'retryAttempt' or new.context ? 'retryRoot') then return new; end if;
 select * into p from app_private.currency_report_runtime_jobs where id=(new.context->>'retryOf')::uuid for update;
 a:=(new.context->>'retryAttempt')::integer;
 if p.id is null or a not between 1 and 2 or a is distinct from coalesce((p.context->>'retryAttempt')::integer,0)+1
 or new.context->>'retryRoot' is distinct from coalesce(p.context->>'retryRoot',p.task_key)
 or new.request_hash is distinct from p.request_hash or new.currency is distinct from p.currency or new.base_date is distinct from p.base_date
 or new.stage is distinct from p.stage or new.parent_id is distinct from p.parent_id
 or p.state is distinct from 'received' or p.response->>'valid' is distinct from 'false'
 or p.response->>'partialText' is distinct from '' or p.response->'providerError'->>'code' is distinct from '429'
 or (p.response->'usage' is not null and p.response->'usage'<>'null'::jsonb)
 or not(p.cost_state='confirmed' and p.actual_nano<=p.reserved_nano or app_private.runtime_cost_escrowed(p.id)) then
 raise exception 'bounded terminal retry with funded prior reservation required' using errcode='55000'; end if;
 return new;
end; $$;
revoke all on function app_private.validate_currency_runtime_retry() from public,anon,authenticated;
create trigger currency_runtime_retry before insert on app_private.currency_report_runtime_jobs
for each row execute function app_private.validate_currency_runtime_retry();

CREATE OR REPLACE FUNCTION public.claim_currency_report_operating_batch(p_batch_key text, p_owner uuid, p_revision bigint, p_payload jsonb, p_budget_nano bigint, p_max_calls integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c app_private.currency_report_runtime_control; p app_private.currency_report_operating_policies;
 b app_private.currency_report_operating_batches;
begin
 select * into c from app_private.currency_report_runtime_control where singleton for update;
 select * into p from app_private.currency_report_operating_policies order by revision desc limit 1;
 if not c.enabled or not c.review_enabled or c.writer<>'sol' or p.revision is distinct from p_revision
  or p.policy->>'state' not in ('operator_configured','trial_configured')
  or p.policy->>'externalTransmissionAuthorization' is distinct from 'approved_by_operator'
  or (p.policy->>'state'='operator_configured' and p.policy->>'recurringBudgetAuthorization' is distinct from 'approved_by_operator')
  or c.monthly_limit_nano is distinct from ((case when p.policy->>'state'='trial_configured' then ((p.policy->'limits'->>'batchUsd')::numeric+coalesce((p.policy->>'accountingPriorSpendUsd')::numeric,0))::text else p.policy->'limits'->>'monthlyUsd' end)::numeric*1000000000)::bigint
  or c.monthly_limit_nano<=0 then return jsonb_build_object('claimed',false,'reason','operating_configuration_hold'); end if;
 if p.policy->>'state'='trial_configured' and (
  (p.policy->>'expiresAt')::timestamptz<=clock_timestamp()
  or p.policy->>'datasetBinding' is distinct from p_payload->>'datasetBinding'
  or exists(select 1 from app_private.currency_report_operating_batches where policy_revision=p_revision and batch_key<>p_batch_key)) then
  return jsonb_build_object('claimed',false,'reason','one_time_scope_or_expiry_hold'); end if;
 if p_budget_nano<=0 or p_budget_nano>((p.policy->'limits'->>'batchUsd')::numeric*1000000000)::bigint
  or p_max_calls<12 or p_max_calls>(p.policy->'limits'->>'maxCalls')::integer then raise exception 'bound operating budget required' using errcode='22023'; end if;
 if exists(select 1 from app_private.currency_report_runtime_jobs where (cost_state='unknown' and not app_private.runtime_cost_escrowed(id)) or state in ('reserved','calling') or actual_nano>reserved_nano) then
  return jsonb_build_object('claimed',false,'reason','unresolved_or_inflight_call'); end if;
 if exists(select 1 from app_private.currency_report_operating_batches where state='running' and lease_until>clock_timestamp()) then
  return jsonb_build_object('claimed',false,'reason','operating_batch_busy'); end if;
 select * into b from app_private.currency_report_operating_batches where batch_key=p_batch_key for update;
 if b.batch_key is not null then
  if b.state='completed' then return jsonb_build_object('claimed',false,'reason',b.state); end if;
  if b.policy_revision<>p_revision or b.payload<>p_payload or b.budget_nano<>p_budget_nano or b.max_calls<>p_max_calls then
   raise exception 'immutable operating batch changed' using errcode='22023'; end if;
  update app_private.currency_report_operating_batches set owner_id=p_owner,state='running',lease_until=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() where batch_key=p_batch_key;
 else
  insert into app_private.currency_report_operating_batches(batch_key,policy_revision,owner_id,state,lease_until,budget_nano,max_calls,payload)
  values(p_batch_key,p_revision,p_owner,'running',clock_timestamp()+interval '5 minutes',p_budget_nano,p_max_calls,p_payload);
 end if;
 return jsonb_build_object('claimed',true,'batchKey',p_batch_key);
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_currency_report_operating_case(p_batch_key text, p_owner uuid, p_case_key text, p_case_id text, p_currency text, p_material_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b app_private.currency_report_operating_batches; existing app_private.currency_report_operating_cases;
begin
 select * into b from app_private.currency_report_operating_batches where batch_key=p_batch_key for update;
 if b.owner_id is distinct from p_owner or b.state<>'running' or b.lease_until<clock_timestamp() then return jsonb_build_object('claimed',false,'reason','operating_lease_expired'); end if;
 select x.* into existing from app_private.currency_report_operating_cases x left join public.currency_report_runs r on r.id=x.run_id
 where x.currency=p_currency and x.case_id=p_case_id and (x.case_key=p_case_key or (r.status='pending_review' and x.state='pending_admin_review'))
  and case when b.payload->>'testOnly'='true' then x.batch_key=p_batch_key
   else coalesce(r.candidate->>'testOnly','false')<>'true' and not exists(
    select 1 from app_private.currency_report_operating_batches synthetic where synthetic.batch_key=x.batch_key and synthetic.payload->>'testOnly'='true') end
 order by (r.status='pending_review') desc nulls last,x.updated_at desc limit 1 for update of x;
 if existing.case_key is not null then
  if existing.batch_key=p_batch_key and existing.case_key=p_case_key and (
   existing.state in ('running','paused') or (existing.state='held' and existing.result->>'status' in ('cost_unresolved','source_cost_unresolved')
    and not exists(select 1 from app_private.currency_report_runtime_jobs where (cost_state='unknown' and not app_private.runtime_cost_escrowed(id)) or state in ('reserved','calling') or actual_nano>reserved_nano)
    and exists(select 1 from app_private.currency_report_runtime_jobs j where j.context->>'operatingCaseKey'=p_case_key
     and j.state='received' and j.cost_state='confirmed' and j.response->>'valid'='true' and j.actual_nano<=j.reserved_nano))) then
   update app_private.currency_report_operating_cases set state='running',updated_at=clock_timestamp() where case_key=p_case_key;
   return jsonb_build_object('claimed',true,'resumed',true); end if;
  return jsonb_build_object('claimed',false,'reason',case when existing.state='pending_admin_review' then 'pending_admin_review' else 'unchanged_case_already_processed' end);
 end if;
 insert into app_private.currency_report_operating_cases(case_key,case_id,currency,material_hash,batch_key,state)
 values(p_case_key,p_case_id,p_currency,p_material_hash,p_batch_key,'running');
 return jsonb_build_object('claimed',true,'resumed',false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.configure_currency_report_operating_policy(p_policy jsonb, p_expected_revision bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare current_revision bigint; result bigint; parent app_private.currency_report_operating_policies;
begin
 perform 1 from app_private.currency_report_runtime_control where singleton for update;
 select coalesce(max(revision),0) into current_revision from app_private.currency_report_operating_policies;
 if current_revision is distinct from p_expected_revision then raise exception 'operating policy revision changed' using errcode='40001'; end if;
 if p_policy->>'version' is distinct from 'report-operating-policy/1'
  or p_policy->>'binding' !~ '^[a-f0-9]{64}$'
  or p_policy->>'configurationTrust' is distinct from 'server_owned_never_article_or_model_input'
  or p_policy->>'publication' is distinct from 'separate_active_admin_review'
  or p_policy->>'state' not in ('proposal_not_enabled','operator_configured','trial_configured') then
  raise exception 'server operating policy required' using errcode='22023'; end if;
 if p_policy->>'state'='operator_configured' and (
  p_policy->>'externalTransmissionAuthorization' is distinct from 'approved_by_operator'
  or p_policy->>'recurringBudgetAuthorization' is distinct from 'approved_by_operator'
  or nullif(p_policy->>'authorizationReference','') is null
  or (p_policy->'limits'->>'monthlyUsd')::numeric<=0
  or p_policy->'destination'->>'endpoint' is distinct from 'https://openrouter.ai/api/v1/chat/completions'
  or p_policy->'destination'->>'model' is distinct from 'openai/gpt-6.1-sol'
  or p_policy->'destination'->>'provider' is distinct from 'azure'
  or p_policy->'destination'->>'zdr' is distinct from 'true'
  or p_policy->'destination'->>'dataCollection' is distinct from 'deny'
  or p_policy->'destination'->>'retries' is distinct from '0'
  or p_policy->'destination'->>'fallback' is distinct from 'false'
  or p_policy->'destination'->>'rawPublicDisplay' is distinct from 'false') then
  raise exception 'explicit restricted operating configuration required' using errcode='22023'; end if;
 if p_policy->>'state'='trial_configured' and (
  p_policy->>'externalTransmissionAuthorization' is distinct from 'approved_by_operator'
  or p_policy->>'trialBudgetAuthorization' is distinct from 'approved_by_operator'
  or p_policy->>'recurringBudgetAuthorization' is distinct from 'not_authorized'
  or p_policy->>'budgetScope' is distinct from 'one_time_trial_only'
  or (p_policy->'limits'->>'monthlyUsd')::numeric is distinct from 0
  or nullif(p_policy->>'datasetBinding','') is null
  or nullif(p_policy->>'expiresAt','') is null
  or nullif(p_policy->>'configuredAt','') is null
  or p_policy->>'datasetBinding' !~ '^[a-f0-9]{64}$'
  or nullif(p_policy->>'authorizationReference','') is null
  or (p_policy->>'expiresAt')::timestamptz<=clock_timestamp()
  or (p_policy->>'configuredAt')::timestamptz>(p_policy->>'expiresAt')::timestamptz
  or p_policy->'destination'->>'endpoint' is distinct from 'https://openrouter.ai/api/v1/chat/completions'
  or p_policy->'destination'->>'model' is distinct from 'openai/gpt-6.1-sol'
  or p_policy->'destination'->>'provider' is distinct from 'azure'
  or p_policy->'destination'->>'zdr' is distinct from 'true'
  or p_policy->'destination'->>'dataCollection' is distinct from 'deny'
  or p_policy->'destination'->>'retries' is distinct from '0'
  or p_policy->'destination'->>'fallback' is distinct from 'false'
  or p_policy->'destination'->>'rawPublicDisplay' is distinct from 'false') then
  raise exception 'explicit bound one-time configuration required' using errcode='22023'; end if;
 if (p_policy->'limits'->>'batchUsd')::numeric not between 0.000000001 and (case when p_policy->>'state'='trial_configured' then 8 else 7 end)
  or (p_policy->'limits'->>'perCallUsd')::numeric not between 0.000000001 and .25
  or (p_policy->'limits'->>'maxCalls')::integer not between 12 and (case when p_policy->>'state'='trial_configured' then 62 else 60 end) then
  raise exception 'operating cost bounds required' using errcode='22023'; end if;
 if p_policy ? 'continuationOfRevision' then
  select * into parent from app_private.currency_report_operating_policies
   where policy->>'state'='trial_configured' and policy->>'authorizationReference'=p_policy->>'authorizationReference'
   order by revision desc limit 1;
  if p_policy->>'state' is distinct from 'trial_configured' or parent.revision is null
   or (p_policy->>'continuationOfRevision')::bigint is distinct from parent.revision
   or (p_policy-array['binding','configuredAt','continuationOfRevision','serializedOperatingPolicy']) is distinct from
      (parent.policy-array['binding','configuredAt','continuationOfRevision','serializedOperatingPolicy'])
   or exists(select 1 from app_private.currency_report_runtime_jobs j
    join app_private.currency_report_operating_batches b on b.batch_key=j.context->>'operatingBatchKey'
    join app_private.currency_report_operating_policies p on p.revision=b.policy_revision
    where p.policy->>'authorizationReference'=p_policy->>'authorizationReference')
   or exists(select 1 from app_private.currency_report_operating_batches b
    join app_private.currency_report_operating_policies p on p.revision=b.policy_revision
    where p.policy->>'authorizationReference'=p_policy->>'authorizationReference'
     and (b.state<>'completed' or coalesce((b.result->>'modelCalls')::integer,-1)<>0)) then
   raise exception 'same unspent trial scope required' using errcode='23505'; end if;
 end if;
 -- A fresh one-time allowance is additional to confirmed earlier spending.
 -- Verify the baseline against the ledger rather than trusting a caller's sum.
 if p_policy->>'state'='trial_configured' and (
  coalesce((p_policy->>'accountingPriorSpendUsd')::numeric,0) not between 0 and 1000
  or coalesce((p_policy->>'accountingPriorSpendUsd')::numeric,0)*1000000000 is distinct from
   (select coalesce(sum(case when cost_state='confirmed' and created_at>=date_trunc('month',clock_timestamp()) then actual_nano when app_private.runtime_cost_escrowed(id) then reserved_nano else 0 end),0) from app_private.currency_report_runtime_jobs)
  or exists(select 1 from app_private.currency_report_runtime_jobs
    where (cost_state='unknown' and not app_private.runtime_cost_escrowed(id)) or state in ('reserved','calling') or actual_nano>reserved_nano)) then
  raise exception 'confirmed trial accounting baseline required' using errcode='22023'; end if;
 insert into app_private.currency_report_operating_policies(binding,policy) values(p_policy->>'binding',p_policy) returning revision into result;
 return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.currency_report_operating_recoverable_calls()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(x),'[]'::jsonb) from (
  select j.id,j.state,j.cost_state,j.response_id,j.reserved_nano,j.actual_nano,
   coalesce(j.response->>'valid','false')='true' as valid_response, app_private.runtime_cost_escrowed(j.id) as escrowed
  from app_private.currency_report_runtime_jobs j
  left join app_private.currency_report_operating_batches b on b.batch_key=j.context->>'operatingBatchKey'
  where j.context ? 'operatingBatchKey' and (b.batch_key is null or b.state<>'running' or b.lease_until<clock_timestamp())
   and (j.cost_state='unknown' or j.state='reserved' or j.actual_nano>j.reserved_nano)
  order by j.created_at limit 100
 ) x;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_currency_report_runtime(p_task_key text, p_currency text, p_date date, p_stage text, p_request_hash text, p_context jsonb, p_reserved_nano bigint, p_revision bigint, p_parent_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b app_private.currency_report_operating_batches; p app_private.currency_report_operating_policies;
 spent numeric; calls integer; prior app_private.currency_report_runtime_jobs;
begin
 perform 1 from app_private.currency_report_runtime_control where singleton for update;
 if p_context ? 'operatingBatchKey' then
  select * into b from app_private.currency_report_operating_batches where batch_key=p_context->>'operatingBatchKey' for update;
  select * into p from app_private.currency_report_operating_policies order by revision desc limit 1;
  if b.batch_key is null or b.owner_id::text is distinct from p_context->>'operatingOwner'
   or b.state<>'running' or b.lease_until<clock_timestamp() or p.revision<>b.policy_revision
   or p.policy->>'state' not in ('operator_configured','trial_configured')
   or (p.policy->>'state'='trial_configured' and (p.policy->>'expiresAt')::timestamptz<=clock_timestamp())
   or not exists(select 1 from app_private.currency_report_operating_cases where case_key=p_context->>'operatingCaseKey' and batch_key=b.batch_key and currency=p_currency and state='running') then
   return jsonb_build_object('reserved',false,'reason','operating_scope_or_lease_changed'); end if;
  if p_reserved_nano>((p.policy->'limits'->>'perCallUsd')::numeric*1000000000)::bigint then
   return jsonb_build_object('reserved',false,'reason','operating_per_call_budget_hold'); end if;
  if not exists(select 1 from app_private.currency_report_runtime_jobs where task_key=p_task_key) then
   select coalesce(sum(case when cost_state='confirmed' then actual_nano else reserved_nano end),0),count(*) into spent,calls
   from app_private.currency_report_runtime_jobs where context->>'operatingBatchKey'=b.batch_key;
   if spent+p_reserved_nano>b.budget_nano or calls>=b.max_calls then return jsonb_build_object('reserved',false,'reason','operating_batch_budget_hold'); end if;
  end if;
  update app_private.currency_report_operating_batches set lease_until=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() where batch_key=b.batch_key;
 end if;
 select * into prior from app_private.currency_report_runtime_jobs where task_key=p_task_key for update;
 if prior.state='cancelled' and prior.cost_state='confirmed' and prior.actual_nano=0
  and prior.checkpoint->>'phase'='unsent_released_never_dispatched' and p_context ? 'operatingBatchKey' then
  if prior.request_hash is distinct from p_request_hash or prior.currency is distinct from p_currency
   or prior.base_date is distinct from p_date or prior.stage is distinct from p_stage
   or prior.parent_id is distinct from p_parent_id or prior.reserved_nano<>p_reserved_nano
   or prior.context->>'operatingBatchKey' is distinct from p_context->>'operatingBatchKey'
   or prior.context->>'operatingCaseKey' is distinct from p_context->>'operatingCaseKey' then
   return jsonb_build_object('reserved',false,'reason','released_request_changed'); end if;
  if exists(select 1 from app_private.currency_report_runtime_jobs where id<>prior.id
   and ((cost_state='unknown' and not app_private.runtime_cost_escrowed(id)) or state in ('reserved','calling') or actual_nano>reserved_nano)) then
   return jsonb_build_object('reserved',false,'reason','unresolved_or_inflight_call'); end if;
  if not exists(select 1 from app_private.currency_report_runtime_control where singleton and enabled and review_enabled and revision=p_revision) then
   return jsonb_build_object('reserved',false,'reason','runtime_configuration_changed'); end if;
  select coalesce(sum(case when cost_state='confirmed' then actual_nano else reserved_nano end),0),count(*) into spent,calls
   from app_private.currency_report_runtime_jobs where context->>'operatingBatchKey'=b.batch_key and id<>prior.id;
  if spent+p_reserved_nano>b.budget_nano or calls>=b.max_calls then return jsonb_build_object('reserved',false,'reason','operating_batch_budget_hold'); end if;
  select coalesce(sum(case when cost_state='confirmed' then actual_nano else reserved_nano end),0) into spent
   from app_private.currency_report_runtime_jobs where id<>prior.id and (created_at>=date_trunc('month',clock_timestamp()) or app_private.runtime_cost_escrowed(id));
  if not exists(select 1 from app_private.currency_report_runtime_control where singleton
   and writer=p_context->>'writer' and per_call_limit_nano>=p_reserved_nano and monthly_limit_nano>=spent+p_reserved_nano) then
   return jsonb_build_object('reserved',false,'reason','runtime_budget_hold'); end if;
  update app_private.currency_report_runtime_jobs set state='reserved',cost_state='reserved',actual_nano=null,
   context=p_context,control_revision=p_revision,checkpoint=null where id=prior.id;
  return jsonb_build_object('reserved',true,'id',prior.id,'resumedUnsent',true);
 end if;
 return public.reserve_currency_report_runtime_v1(p_task_key,p_currency,p_date,p_stage,p_request_hash,p_context,p_reserved_nano,p_revision,p_parent_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_currency_report_runtime_v1(p_task_key text, p_currency text, p_date date, p_stage text, p_request_hash text, p_context jsonb, p_reserved_nano bigint, p_revision bigint, p_parent_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c app_private.currency_report_runtime_control; j app_private.currency_report_runtime_jobs;
 parent app_private.currency_report_runtime_jobs; spent numeric;
begin
 select * into c from app_private.currency_report_runtime_control where singleton for update;
 if not c.enabled or c.revision is distinct from p_revision or c.monthly_limit_nano=0
   or p_stage='reviewer' and not c.review_enabled then return jsonb_build_object('reserved',false,'reason','runtime_disabled_or_changed'); end if;
 if p_reserved_nano is null or p_reserved_nano<=0 or p_reserved_nano>c.per_call_limit_nano
   or p_context->>'writer' is distinct from c.writer then raise exception 'runtime policy mismatch' using errcode='22023'; end if;
 if exists(select 1 from app_private.currency_report_runtime_jobs where task_key=p_task_key) then
   return jsonb_build_object('reserved',false,'reason','duplicate_task'); end if;
 if exists(select 1 from app_private.currency_report_runtime_jobs where (cost_state='unknown' and not app_private.runtime_cost_escrowed(id)) or state in ('reserved','calling') or actual_nano>reserved_nano) then
   return jsonb_build_object('reserved',false,'reason','unresolved_or_inflight_call'); end if;
 if p_stage='reviewer' then
   select * into parent from app_private.currency_report_runtime_jobs where id=p_parent_id;
   if parent.id is null or parent.stage<>'writer' or parent.currency<>p_currency or parent.base_date<>p_date
     or parent.state<>'received' or parent.cost_state<>'confirmed' or parent.actual_nano>parent.reserved_nano then
     raise exception 'completed writer response required' using errcode='55000'; end if;
 end if;
 select coalesce(sum(case when cost_state='confirmed' then actual_nano else reserved_nano end),0)
   into spent from app_private.currency_report_runtime_jobs
   where created_at>=date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC' or app_private.runtime_cost_escrowed(id);
 if spent+p_reserved_nano>c.monthly_limit_nano then return jsonb_build_object('reserved',false,'reason','monthly_budget_hold'); end if;
 insert into app_private.currency_report_runtime_jobs(task_key,currency,base_date,stage,parent_id,request_hash,context,reserved_nano,control_revision)
 values(p_task_key,p_currency,p_date,p_stage,p_parent_id,p_request_hash,p_context,p_reserved_nano,c.revision) returning * into j;
 return jsonb_build_object('reserved',true,'id',j.id,'revision',c.revision);
end;
$function$;

CREATE OR REPLACE FUNCTION public.supersede_currency_report_operating_batch(p_batch_key text, p_revision bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b app_private.currency_report_operating_batches; c app_private.currency_report_runtime_control; latest bigint;
begin
 select * into c from app_private.currency_report_runtime_control where singleton for update;
 select max(revision) into latest from app_private.currency_report_operating_policies;
 select * into b from app_private.currency_report_operating_batches where batch_key=p_batch_key for update;
 if p_reason is null or p_reason not in ('frozen_reference_superseded','frozen_material_superseded') then raise exception 'explicit supersession reason required'; end if;
 if not c.enabled or not c.review_enabled or c.writer<>'sol' or latest is distinct from p_revision
  or b.policy_revision is distinct from p_revision or b.state not in ('paused','running','cost_unresolved')
  or (b.state='running' and b.lease_until>clock_timestamp()) then
  return jsonb_build_object('superseded',false,'reason','operating_scope_or_lease_changed'); end if;
 if exists(select 1 from app_private.currency_report_runtime_jobs where (cost_state='unknown' and not app_private.runtime_cost_escrowed(id)) or state in ('reserved','calling') or actual_nano>reserved_nano) then
  return jsonb_build_object('superseded',false,'reason','unresolved_or_inflight_call'); end if;
 update app_private.currency_report_operating_cases set state='held',
  result=jsonb_build_object('status',p_reason,'previousResult',result,'publicationApproved',false),updated_at=clock_timestamp()
  where batch_key=p_batch_key and state in ('paused','running');
 update app_private.currency_report_operating_batches set state='completed',
  result=jsonb_build_object('status',p_reason,'previousResult',result,'publicationApproved',false),updated_at=clock_timestamp()
  where batch_key=p_batch_key;
 return jsonb_build_object('superseded',true);
end;
$function$;
