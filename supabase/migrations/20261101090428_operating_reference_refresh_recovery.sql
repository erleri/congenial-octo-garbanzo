-- Local-first follow-up: never enables controls or installs an execution policy.
-- Same authorization cannot be reinstalled as another one-time allowance.
create unique index currency_operating_single_trial_authority on app_private.currency_report_operating_policies ((policy->>'authorizationReference')) where policy->>'state'='trial_configured';

create or replace function public.configure_currency_report_operating_policy(p_policy jsonb,p_expected_revision bigint) returns bigint
language plpgsql security invoker set search_path='' as $$
declare current_revision bigint; result bigint;
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
 if (p_policy->'limits'->>'batchUsd')::numeric not between 0.000000001 and 7
  or (p_policy->'limits'->>'perCallUsd')::numeric not between 0.000000001 and .25
  or (p_policy->'limits'->>'maxCalls')::integer not between 12 and 60 then
  raise exception 'operating cost bounds required' using errcode='22023'; end if;
 insert into app_private.currency_report_operating_policies(binding,policy) values(p_policy->>'binding',p_policy) returning revision into result;
 return result;
end;
$$;

create or replace function public.claim_currency_report_operating_batch(p_batch_key text,p_owner uuid,p_revision bigint,p_payload jsonb,
 p_budget_nano bigint,p_max_calls integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c app_private.currency_report_runtime_control; p app_private.currency_report_operating_policies;
 b app_private.currency_report_operating_batches;
begin
 select * into c from app_private.currency_report_runtime_control where singleton for update;
 select * into p from app_private.currency_report_operating_policies order by revision desc limit 1;
 if not c.enabled or not c.review_enabled or c.writer<>'sol' or p.revision is distinct from p_revision
  or p.policy->>'state' not in ('operator_configured','trial_configured')
  or p.policy->>'externalTransmissionAuthorization' is distinct from 'approved_by_operator'
  or (p.policy->>'state'='operator_configured' and p.policy->>'recurringBudgetAuthorization' is distinct from 'approved_by_operator')
  or c.monthly_limit_nano is distinct from ((case when p.policy->>'state'='trial_configured' then p.policy->'limits'->>'batchUsd' else p.policy->'limits'->>'monthlyUsd' end)::numeric*1000000000)::bigint
  or c.monthly_limit_nano<=0 then return jsonb_build_object('claimed',false,'reason','operating_configuration_hold'); end if;
 if p.policy->>'state'='trial_configured' and (
  (p.policy->>'expiresAt')::timestamptz<=clock_timestamp()
  or p.policy->>'datasetBinding' is distinct from p_payload->>'datasetBinding'
  or exists(select 1 from app_private.currency_report_operating_batches where policy_revision=p_revision and batch_key<>p_batch_key)) then
  return jsonb_build_object('claimed',false,'reason','one_time_scope_or_expiry_hold'); end if;
 if p_budget_nano<=0 or p_budget_nano>((p.policy->'limits'->>'batchUsd')::numeric*1000000000)::bigint
  or p_max_calls<12 or p_max_calls>(p.policy->'limits'->>'maxCalls')::integer then raise exception 'bound operating budget required' using errcode='22023'; end if;
 if exists(select 1 from app_private.currency_report_runtime_jobs where cost_state='unknown' or state in ('reserved','calling') or actual_nano>reserved_nano) then
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
$$;

create or replace function public.reserve_currency_report_runtime(p_task_key text,p_currency text,p_date date,p_stage text,
 p_request_hash text,p_context jsonb,p_reserved_nano bigint,p_revision bigint,p_parent_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
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
   and (cost_state='unknown' or state in ('reserved','calling') or actual_nano>reserved_nano)) then
   return jsonb_build_object('reserved',false,'reason','unresolved_or_inflight_call'); end if;
  if not exists(select 1 from app_private.currency_report_runtime_control where singleton and enabled and review_enabled and revision=p_revision) then
   return jsonb_build_object('reserved',false,'reason','runtime_configuration_changed'); end if;
  select coalesce(sum(case when cost_state='confirmed' then actual_nano else reserved_nano end),0),count(*) into spent,calls
   from app_private.currency_report_runtime_jobs where context->>'operatingBatchKey'=b.batch_key and id<>prior.id;
  if spent+p_reserved_nano>b.budget_nano or calls>=b.max_calls then return jsonb_build_object('reserved',false,'reason','operating_batch_budget_hold'); end if;
  select coalesce(sum(case when cost_state='confirmed' then actual_nano else reserved_nano end),0) into spent
   from app_private.currency_report_runtime_jobs where id<>prior.id and created_at>=date_trunc('month',clock_timestamp());
  if not exists(select 1 from app_private.currency_report_runtime_control where singleton
   and writer=p_context->>'writer' and per_call_limit_nano>=p_reserved_nano and monthly_limit_nano>=spent+p_reserved_nano) then
   return jsonb_build_object('reserved',false,'reason','runtime_budget_hold'); end if;
  update app_private.currency_report_runtime_jobs set state='reserved',cost_state='reserved',actual_nano=null,
   context=p_context,control_revision=p_revision,checkpoint=null where id=prior.id;
  return jsonb_build_object('reserved',true,'id',prior.id,'resumedUnsent',true);
 end if;
 return public.reserve_currency_report_runtime_v1(p_task_key,p_currency,p_date,p_stage,p_request_hash,p_context,p_reserved_nano,p_revision,p_parent_id);
end;
$$;

create or replace function public.begin_currency_report_runtime(p_id uuid,p_request_hash text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare j app_private.currency_report_runtime_jobs; b app_private.currency_report_operating_batches; latest bigint; policy jsonb;
begin
 perform 1 from app_private.currency_report_runtime_control where singleton for update;
 select * into j from app_private.currency_report_runtime_jobs where id=p_id for update;
 if j.state='reserved' and j.context ? 'operatingBatchKey' then
  select * into b from app_private.currency_report_operating_batches where batch_key=j.context->>'operatingBatchKey' for update;
  select max(revision) into latest from app_private.currency_report_operating_policies;
  select p.policy into policy from app_private.currency_report_operating_policies p where revision=latest;
  if b.batch_key is null or b.owner_id::text is distinct from j.context->>'operatingOwner' or b.state<>'running'
   or b.lease_until<clock_timestamp() or latest is distinct from b.policy_revision
   or (policy->>'state'='trial_configured' and (policy->>'expiresAt')::timestamptz<=clock_timestamp()) then
   update app_private.currency_report_runtime_jobs set state='cancelled',cost_state='confirmed',actual_nano=0 where id=p_id;
   return false;
  end if;
 end if;
 return public.begin_currency_report_runtime_v1(p_id,p_request_hash);
end;
$$;


create or replace function public.claim_currency_report_operating_case(p_batch_key text,p_owner uuid,p_case_key text,p_case_id text,p_currency text,p_material_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b app_private.currency_report_operating_batches; existing app_private.currency_report_operating_cases;
begin
 select * into b from app_private.currency_report_operating_batches where batch_key=p_batch_key for update;
 if b.owner_id is distinct from p_owner or b.state<>'running' or b.lease_until<clock_timestamp() then return jsonb_build_object('claimed',false,'reason','operating_lease_expired'); end if;
 select x.* into existing from app_private.currency_report_operating_cases x left join public.currency_report_runs r on r.id=x.run_id
 where x.currency=p_currency and x.case_id=p_case_id and (x.case_key=p_case_key or r.status='pending_review')
  and case when b.payload->>'testOnly'='true' then x.batch_key=p_batch_key
   else coalesce(r.candidate->>'testOnly','false')<>'true' and not exists(
    select 1 from app_private.currency_report_operating_batches synthetic where synthetic.batch_key=x.batch_key and synthetic.payload->>'testOnly'='true') end
 order by (r.status='pending_review') desc nulls last,x.updated_at desc limit 1 for update of x;
 if existing.case_key is not null then
  if existing.batch_key=p_batch_key and existing.case_key=p_case_key and (
   existing.state in ('running','paused') or (existing.state='held' and existing.result->>'status' in ('cost_unresolved','source_cost_unresolved')
    and not exists(select 1 from app_private.currency_report_runtime_jobs where cost_state='unknown' or state in ('reserved','calling') or actual_nano>reserved_nano)
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
$$;

-- Exact job states only. No originals/responses are exposed to public users.
create function public.currency_report_operating_recoverable_calls() returns jsonb
language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(x),'[]'::jsonb) from (
  select j.id,j.state,j.cost_state,j.response_id,j.reserved_nano,j.actual_nano,
   coalesce(j.response->>'valid','false')='true' as valid_response
  from app_private.currency_report_runtime_jobs j
  left join app_private.currency_report_operating_batches b on b.batch_key=j.context->>'operatingBatchKey'
  where j.context ? 'operatingBatchKey' and (b.batch_key is null or b.state<>'running' or b.lease_until<clock_timestamp())
   and (j.cost_state='unknown' or j.state='reserved' or j.actual_nano>j.reserved_nano)
  order by j.created_at limit 100
 ) x;
$$;
create function public.release_currency_report_operating_unsent(p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j app_private.currency_report_runtime_jobs; b app_private.currency_report_operating_batches;
begin
 perform 1 from app_private.currency_report_runtime_control where singleton for update;
 select * into j from app_private.currency_report_runtime_jobs where id=p_id for update;
 select * into b from app_private.currency_report_operating_batches where batch_key=j.context->>'operatingBatchKey' for update;
 if j.id is null or not (j.context ? 'operatingBatchKey') or j.state<>'reserved' or j.started_at is not null
  or j.response_id is not null or j.response is not null or (b.state='running' and b.lease_until>=clock_timestamp()) then
  return jsonb_build_object('released',false,'reason','live_or_dispatched_reservation'); end if;
 update app_private.currency_report_runtime_jobs set state='cancelled',cost_state='confirmed',actual_nano=0,
  checkpoint=jsonb_build_object('phase','unsent_released_never_dispatched') where id=p_id;
 return jsonb_build_object('released',true);
end;
$$;
revoke all on function public.currency_report_operating_recoverable_calls(),public.release_currency_report_operating_unsent(uuid) from public,anon,authenticated;
grant execute on function public.currency_report_operating_recoverable_calls(),public.release_currency_report_operating_unsent(uuid) to service_role;

-- Persist free checks even when no paid batch may be claimed. Whitelist only
-- compact source identifiers and states; never accept an original or API key.
create function public.record_currency_report_supply_check(p_key text,p_currency text,p_checked_at timestamptz,p_result jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare safe jsonb;
begin
 if jsonb_typeof(p_result->'sources') is distinct from 'array' or jsonb_array_length(p_result->'sources')>24
  or exists(select 1 from jsonb_array_elements(p_result->'sources') s where coalesce(s->>'sourceId','') !~ '^[a-zA-Z0-9_-]{1,100}$'
   or jsonb_typeof(s->'statuses') is distinct from 'array' or jsonb_array_length(s->'statuses')>6
   or exists(select 1 from jsonb_array_elements_text(s->'statuses') t where t !~ '^[a-z_]{1,100}$'))
  or p_key !~ '^[a-f0-9]{64}$' or p_checked_at>clock_timestamp()+interval '5 minutes' then
  raise exception 'safe supply summary required' using errcode='22023'; end if;
 safe:=jsonb_build_object('status',left(p_result->>'status',100),'baseDate',p_result->>'baseDate',
  'dataStatus',left(p_result->>'dataStatus',100),'qualityStatus','not_evaluated',
  'candidates',(p_result->>'candidates')::integer,'officialAdmission',left(p_result->>'officialAdmission',100),
  'sources',(select coalesce(jsonb_agg(jsonb_build_object('sourceId',s->>'sourceId','statuses',s->'statuses')),'[]'::jsonb)
   from jsonb_array_elements(p_result->'sources') s),'publicationApproved',false);
 if octet_length(safe::text)>4096 then raise exception 'bounded supply summary required' using errcode='22023'; end if;
 insert into app_private.currency_report_runtime_checks(check_key,currency,checked_at,result) values(p_key,p_currency,p_checked_at,safe)
 on conflict(check_key) do nothing;
end;
$$;
revoke all on function public.record_currency_report_supply_check(text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.record_currency_report_supply_check(text,text,timestamptz,jsonb) to service_role;
