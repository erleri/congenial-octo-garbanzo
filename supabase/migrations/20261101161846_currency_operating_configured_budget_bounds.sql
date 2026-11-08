-- Separate a new one-time allowance from earlier confirmed monthly spending.
-- No policy, budget, controls, privileges or existing records are changed.
-- Existing $7 batch / $0.25 per-request / 60-call ceilings remain in force.
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
 -- A fresh one-time allowance is additional to confirmed earlier spending.
 -- Verify the baseline against the ledger rather than trusting a caller's sum.
 if p_policy->>'state'='trial_configured' and (
  coalesce((p_policy->>'accountingPriorSpendUsd')::numeric,0) not between 0 and 1000
  or coalesce((p_policy->>'accountingPriorSpendUsd')::numeric,0)*1000000000 is distinct from
   (select coalesce(sum(actual_nano),0) from app_private.currency_report_runtime_jobs
    where cost_state='confirmed' and created_at>=date_trunc('month',clock_timestamp()))
  or exists(select 1 from app_private.currency_report_runtime_jobs
    where cost_state='unknown' or state in ('reserved','calling') or actual_nano>reserved_nano)) then
  raise exception 'confirmed trial accounting baseline required' using errcode='22023'; end if;
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
  or c.monthly_limit_nano is distinct from ((case when p.policy->>'state'='trial_configured' then ((p.policy->'limits'->>'batchUsd')::numeric+coalesce((p.policy->>'accountingPriorSpendUsd')::numeric,0))::text else p.policy->'limits'->>'monthlyUsd' end)::numeric*1000000000)::bigint
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

