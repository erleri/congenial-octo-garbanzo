-- Approved one-time trial capacity only; no activation, budget grant, or data rewrite.
-- Recurring/proposal policy limits remain $7/60 and per-call $0.25 remains fixed.

alter table app_private.currency_report_operating_batches
 drop constraint currency_report_operating_batches_budget_nano_check,
 add constraint currency_report_operating_batches_budget_nano_check check (budget_nano between 1 and 8000000000),
 drop constraint currency_report_operating_batches_max_calls_check,
 add constraint currency_report_operating_batches_max_calls_check check (max_calls between 12 and 62);

create or replace function public.configure_currency_report_operating_policy(p_policy jsonb,p_expected_revision bigint) returns bigint
language plpgsql security invoker set search_path='' as $$
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
   (select coalesce(sum(actual_nano),0) from app_private.currency_report_runtime_jobs
    where cost_state='confirmed' and created_at>=date_trunc('month',clock_timestamp()))
  or exists(select 1 from app_private.currency_report_runtime_jobs
    where cost_state='unknown' or state in ('reserved','calling') or actual_nano>reserved_nano)) then
  raise exception 'confirmed trial accounting baseline required' using errcode='22023'; end if;
 insert into app_private.currency_report_operating_policies(binding,policy) values(p_policy->>'binding',p_policy) returning revision into result;
 return result;
end;
$$;
