-- Disabled until a separately configured server policy AND existing runtime
-- controls allow execution. No existing FX/report rows or control values change.
create table app_private.currency_report_operating_policies (
 revision bigint generated always as identity primary key,
 binding text not null unique check(binding ~ '^[a-f0-9]{64}$'),
 policy jsonb not null check(jsonb_typeof(policy)='object' and octet_length(policy::text)<=32000),
 created_at timestamptz not null default clock_timestamp()
);
alter table app_private.currency_report_operating_policies enable row level security;
revoke all on app_private.currency_report_operating_policies from public,anon,authenticated;
grant select,insert on app_private.currency_report_operating_policies to service_role;
grant usage,select on sequence app_private.currency_report_operating_policies_revision_seq to service_role;

create function public.currency_report_operating_policy() returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('revision',revision,'binding',binding,'policy',policy)
 from app_private.currency_report_operating_policies order by revision desc limit 1;
$$;
create function public.configure_currency_report_operating_policy(p_policy jsonb,p_expected_revision bigint) returns bigint
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
  or p_policy->>'state' not in ('proposal_not_enabled','operator_configured') then
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
 if (p_policy->'limits'->>'batchUsd')::numeric not between 0.000000001 and 7
  or (p_policy->'limits'->>'perCallUsd')::numeric not between 0.000000001 and .25
  or (p_policy->'limits'->>'maxCalls')::integer not between 12 and 60 then
  raise exception 'operating cost bounds required' using errcode='22023'; end if;
 insert into app_private.currency_report_operating_policies(binding,policy) values(p_policy->>'binding',p_policy) returning revision into result;
 return result;
end;
$$;

create table app_private.currency_report_operating_batches (
 batch_key text primary key check(batch_key ~ '^[a-f0-9]{64}$'),
 policy_revision bigint not null references app_private.currency_report_operating_policies(revision),
 owner_id uuid not null,
 state text not null check(state in ('running','paused','completed','cost_unresolved')),
 lease_until timestamptz not null,
 budget_nano bigint not null check(budget_nano between 1 and 7000000000),
 max_calls integer not null check(max_calls between 12 and 60),
 payload jsonb not null check(octet_length(payload::text)<=32000000),
 result jsonb,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create table app_private.currency_report_operating_cases (
 case_key text primary key check(case_key ~ '^[a-f0-9]{64}$'),
 case_id text not null check(case_id ~ '^[a-f0-9]{64}$'),
 currency text not null check(currency in ('BRL','MXN','COP','PEN','CLP','ARS')),
 material_hash text not null check(material_hash ~ '^[a-f0-9]{64}$'),
 batch_key text not null references app_private.currency_report_operating_batches(batch_key),
 state text not null check(state in ('running','paused','held','pending_admin_review','finished')),
 result jsonb,
 run_id uuid references public.currency_report_runs(id),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create index currency_operating_case_lookup on app_private.currency_report_operating_cases(currency,case_id,updated_at desc);
alter table app_private.currency_report_operating_batches enable row level security;
alter table app_private.currency_report_operating_cases enable row level security;
revoke all on app_private.currency_report_operating_batches,app_private.currency_report_operating_cases from public,anon,authenticated;
grant select,insert,update on app_private.currency_report_operating_batches,app_private.currency_report_operating_cases to service_role;

create function public.load_currency_report_operating_batch(p_batch_key text) returns jsonb
language sql security invoker set search_path='' as $$
 select to_jsonb(b) from app_private.currency_report_operating_batches b where batch_key=p_batch_key;
$$;
create function public.claim_currency_report_operating_batch(p_batch_key text,p_owner uuid,p_revision bigint,p_payload jsonb,
 p_budget_nano bigint,p_max_calls integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c app_private.currency_report_runtime_control; p app_private.currency_report_operating_policies;
 b app_private.currency_report_operating_batches;
begin
 select * into c from app_private.currency_report_runtime_control where singleton for update;
 select * into p from app_private.currency_report_operating_policies order by revision desc limit 1;
 if not c.enabled or not c.review_enabled or c.writer<>'sol' or p.revision is distinct from p_revision
  or p.policy->>'state' is distinct from 'operator_configured'
  or p.policy->>'externalTransmissionAuthorization' is distinct from 'approved_by_operator'
  or p.policy->>'recurringBudgetAuthorization' is distinct from 'approved_by_operator'
  or c.monthly_limit_nano is distinct from ((p.policy->'limits'->>'monthlyUsd')::numeric*1000000000)::bigint
  or c.monthly_limit_nano<=0 then return jsonb_build_object('claimed',false,'reason','operating_configuration_hold'); end if;
 if p_budget_nano<=0 or p_budget_nano>((p.policy->'limits'->>'batchUsd')::numeric*1000000000)::bigint
  or p_max_calls<12 or p_max_calls>(p.policy->'limits'->>'maxCalls')::integer then raise exception 'bound operating budget required' using errcode='22023'; end if;
 if exists(select 1 from app_private.currency_report_runtime_jobs where cost_state='unknown' or state in ('reserved','calling') or actual_nano>reserved_nano) then
  return jsonb_build_object('claimed',false,'reason','unresolved_or_inflight_call'); end if;
 if exists(select 1 from app_private.currency_report_operating_batches where state='running' and lease_until>clock_timestamp()) then
  return jsonb_build_object('claimed',false,'reason','operating_batch_busy'); end if;
 select * into b from app_private.currency_report_operating_batches where batch_key=p_batch_key for update;
 if b.batch_key is not null then
  if b.state in ('completed','cost_unresolved') then return jsonb_build_object('claimed',false,'reason',b.state); end if;
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
create function public.checkpoint_currency_report_operating_batch(p_batch_key text,p_owner uuid,p_state text,p_result jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if p_state not in ('running','paused','completed','cost_unresolved') or octet_length(p_result::text)>64000 then raise exception 'invalid batch checkpoint' using errcode='22023'; end if;
 update app_private.currency_report_operating_batches set state=p_state,result=p_result,updated_at=clock_timestamp(),lease_until=clock_timestamp()+interval '5 minutes'
 where batch_key=p_batch_key and owner_id=p_owner and state='running';
 if not found then raise exception 'operating lease changed' using errcode='55000'; end if;
end;
$$;
create function public.claim_currency_report_operating_case(p_batch_key text,p_owner uuid,p_case_key text,p_case_id text,p_currency text,p_material_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b app_private.currency_report_operating_batches; existing app_private.currency_report_operating_cases;
begin
 select * into b from app_private.currency_report_operating_batches where batch_key=p_batch_key for update;
 if b.owner_id is distinct from p_owner or b.state<>'running' or b.lease_until<clock_timestamp() then return jsonb_build_object('claimed',false,'reason','operating_lease_expired'); end if;
 select x.* into existing from app_private.currency_report_operating_cases x left join public.currency_report_runs r on r.id=x.run_id
 where x.currency=p_currency and x.case_id=p_case_id and (x.case_key=p_case_key or r.status='pending_review')
 order by (r.status='pending_review') desc nulls last,x.updated_at desc limit 1 for update of x;
 if existing.case_key is not null then
  if existing.batch_key=p_batch_key and existing.state in ('running','paused') and existing.case_key=p_case_key then
   update app_private.currency_report_operating_cases set state='running',updated_at=clock_timestamp() where case_key=p_case_key;
   return jsonb_build_object('claimed',true,'resumed',true); end if;
  return jsonb_build_object('claimed',false,'reason',case when existing.state='pending_admin_review' then 'pending_admin_review' else 'unchanged_case_already_processed' end);
 end if;
 insert into app_private.currency_report_operating_cases(case_key,case_id,currency,material_hash,batch_key,state)
 values(p_case_key,p_case_id,p_currency,p_material_hash,p_batch_key,'running');
 return jsonb_build_object('claimed',true,'resumed',false);
end;
$$;
create function public.finish_currency_report_operating_case(p_batch_key text,p_owner uuid,p_case_key text,p_state text,p_result jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if p_state not in ('paused','held','pending_admin_review','finished') or octet_length(p_result::text)>32000 then raise exception 'invalid case checkpoint' using errcode='22023'; end if;
 perform 1 from app_private.currency_report_operating_batches where batch_key=p_batch_key and owner_id=p_owner and state='running' for update;
 if not found then raise exception 'operating lease changed' using errcode='55000'; end if;
 update app_private.currency_report_operating_cases set state=p_state,result=p_result,run_id=nullif(p_result->>'runId','')::uuid,updated_at=clock_timestamp()
 where case_key=p_case_key and batch_key=p_batch_key and state='running';
 if not found then raise exception 'operating case changed' using errcode='55000'; end if;
end;
$$;
create function public.load_currency_report_runtime_job(p_task_key text) returns jsonb
language sql security invoker set search_path='' as $$
 select to_jsonb(j) from app_private.currency_report_runtime_jobs j where task_key=p_task_key;
$$;

-- All paid stages still use the established global monthly ledger. This adds
-- batch/case/lease/config checks before that same atomic reservation.
alter function public.reserve_currency_report_runtime(text,text,date,text,text,jsonb,bigint,bigint,uuid) rename to reserve_currency_report_runtime_v1;
revoke all on function public.reserve_currency_report_runtime_v1(text,text,date,text,text,jsonb,bigint,bigint,uuid) from public,anon,authenticated;
create function public.reserve_currency_report_runtime(p_task_key text,p_currency text,p_date date,p_stage text,
 p_request_hash text,p_context jsonb,p_reserved_nano bigint,p_revision bigint,p_parent_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b app_private.currency_report_operating_batches; p app_private.currency_report_operating_policies;
 spent numeric; calls integer;
begin
 perform 1 from app_private.currency_report_runtime_control where singleton for update;
 if p_context ? 'operatingBatchKey' then
  select * into b from app_private.currency_report_operating_batches where batch_key=p_context->>'operatingBatchKey' for update;
  select * into p from app_private.currency_report_operating_policies order by revision desc limit 1;
  if b.batch_key is null or b.owner_id::text is distinct from p_context->>'operatingOwner'
   or b.state<>'running' or b.lease_until<clock_timestamp() or p.revision<>b.policy_revision
   or p.policy->>'state' is distinct from 'operator_configured'
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
 return public.reserve_currency_report_runtime_v1(p_task_key,p_currency,p_date,p_stage,p_request_hash,p_context,p_reserved_nano,p_revision,p_parent_id);
end;
$$;

-- Server-only RPCs; no public or normal-login access to settings, originals or
-- executor authority. Admins use the existing authenticated safe summary.
do $$declare r record; begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('currency_report_operating_policy','configure_currency_report_operating_policy',
 'load_currency_report_operating_batch','claim_currency_report_operating_batch','checkpoint_currency_report_operating_batch',
 'claim_currency_report_operating_case','finish_currency_report_operating_case','load_currency_report_runtime_job','reserve_currency_report_runtime') loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature);
 execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end $$;
notify pgrst,'reload schema';

create table app_private.currency_report_operating_source_reviews (
 cache_key text primary key check(cache_key ~ '^[a-f0-9]{64}$'),
 currency text not null check(currency in ('BRL','MXN','COP','PEN','CLP','ARS')),
 rules_binding text not null check(rules_binding ~ '^[a-f0-9]{64}$'),
 record jsonb not null check(octet_length(record::text)<=8000000),
 created_at timestamptz not null default clock_timestamp()
);
alter table app_private.currency_report_operating_source_reviews enable row level security;
revoke all on app_private.currency_report_operating_source_reviews from public,anon,authenticated;
grant select,insert on app_private.currency_report_operating_source_reviews to service_role;
create function public.currency_report_operating_source_cache(p_currency text,p_rules text) returns jsonb
language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(record),'[]') from (select record from app_private.currency_report_operating_source_reviews
 where currency=p_currency and rules_binding=p_rules order by created_at desc,cache_key limit 500) x;
$$;
create function public.save_currency_report_operating_source_review(p_record jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if (p_record->'review'->>'heldStatus' is null and p_record->'review'->'receipt'->>'cardBinding' is distinct from p_record->'card'->>'binding')
  or p_record->'review'->>'cardBinding' is distinct from p_record->'card'->>'binding' then
  raise exception 'immutable source review binding required' using errcode='22023'; end if;
 insert into app_private.currency_report_operating_source_reviews(cache_key,currency,rules_binding,record)
 values(p_record->>'key',p_record->>'currency',p_record->>'rulesBinding',p_record) on conflict(cache_key) do nothing;
 if exists(select 1 from app_private.currency_report_operating_source_reviews where cache_key=p_record->>'key' and record<>p_record) then
  raise exception 'source review cache is immutable' using errcode='22023'; end if;
end;
$$;
revoke all on function public.currency_report_operating_source_cache(text,text),public.save_currency_report_operating_source_review(jsonb) from public,anon,authenticated;
grant execute on function public.currency_report_operating_source_cache(text,text),public.save_currency_report_operating_source_review(jsonb) to service_role;

-- Recheck configuration at dispatch, after reservation, not only at planning.
alter function public.begin_currency_report_runtime(uuid,text) rename to begin_currency_report_runtime_v1;
revoke all on function public.begin_currency_report_runtime_v1(uuid,text) from public,anon,authenticated;
create function public.begin_currency_report_runtime(p_id uuid,p_request_hash text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare j app_private.currency_report_runtime_jobs; b app_private.currency_report_operating_batches; latest bigint;
begin
 perform 1 from app_private.currency_report_runtime_control where singleton for update;
 select * into j from app_private.currency_report_runtime_jobs where id=p_id for update;
 if j.state='reserved' and j.context ? 'operatingBatchKey' then
  select * into b from app_private.currency_report_operating_batches where batch_key=j.context->>'operatingBatchKey' for update;
  select max(revision) into latest from app_private.currency_report_operating_policies;
  if b.batch_key is null or b.owner_id::text is distinct from j.context->>'operatingOwner' or b.state<>'running'
   or b.lease_until<clock_timestamp() or latest is distinct from b.policy_revision then
   update app_private.currency_report_runtime_jobs set state='cancelled',cost_state='confirmed',actual_nano=0 where id=p_id;
   return false;
  end if;
 end if;
 return public.begin_currency_report_runtime_v1(p_id,p_request_hash);
end;
$$;
revoke all on function public.begin_currency_report_runtime(uuid,text) from public,anon,authenticated;
grant execute on function public.begin_currency_report_runtime(uuid,text) to service_role;

create function app_private.currency_report_operating_summary() returns jsonb
language plpgsql security definer set search_path='' as $$
declare p app_private.currency_report_operating_policies; cases jsonb; batches jsonb;
begin
 if (select auth.uid()) is null or not (select app_private.is_business_plan_admin()) then
  raise exception 'active administrator required' using errcode='42501'; end if;
 select * into p from app_private.currency_report_operating_policies order by revision desc limit 1;
 select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'state',state,'updatedAt',updated_at,
  'status',result->>'status','runId',run_id,'testOnly',coalesce(result->>'testOnly'='true',false) or coalesce((select r.candidate->'testOnly'='true'::jsonb from public.currency_report_runs r where r.id=run_id),false),
  'sourceIssues',(select coalesce(jsonb_agg(jsonb_build_object('sourceId',i->>'sourceId','status',i->>'status')),'[]')
   from jsonb_array_elements(coalesce(result->'sourceIssues','[]')) i
   where i->>'sourceId' ~ '^[a-z0-9-]{1,100}$' and i->>'status' ~ '^[a-z_]{1,100}$'))),'[]') into cases from (
  select distinct on(currency) currency,state,updated_at,result,run_id from app_private.currency_report_operating_cases
  order by currency,updated_at desc,case_key desc) x;
 select coalesce(jsonb_agg(jsonb_build_object('state',state,'updatedAt',updated_at,'status',result->>'status')),'[]') into batches
 from (select state,updated_at,result from app_private.currency_report_operating_batches order by updated_at desc limit 3) x;
 return jsonb_build_object('policyState',coalesce(p.policy->>'state','not_configured'),'policyRevision',p.revision,
  'externalProcessingConfigured',coalesce(p.policy->>'externalTransmissionAuthorization'='approved_by_operator',false),
  'recurringBudgetConfigured',coalesce(p.policy->>'recurringBudgetAuthorization'='approved_by_operator',false),
  'cases',cases,'batches',batches);
end;
$$;
revoke all on function app_private.currency_report_operating_summary() from public,anon,service_role;
grant execute on function app_private.currency_report_operating_summary() to authenticated;
create function public.currency_report_operating_summary() returns jsonb
language sql security invoker set search_path='' as $$select app_private.currency_report_operating_summary();$$;
revoke all on function public.currency_report_operating_summary() from public,anon,service_role;
grant execute on function public.currency_report_operating_summary() to authenticated;

-- Same atomic active-admin approval; add the supported periodic purpose.
create or replace function app_private.review_currency_report(p_run_id uuid, p_decision text, p_reason text default null)
returns text language plpgsql security definer set search_path='' as $$
declare
  r public.currency_report_runs;
  current_attempt integer;
  result text;
  metadata jsonb;
begin
  if (select auth.uid()) is null or not (select app_private.is_business_plan_admin()) then
    raise exception 'active administrator access required' using errcode='42501';
  end if;
  select * into r from public.currency_report_runs where id=p_run_id;
  if r.id is null then raise exception 'report run not found' using errcode='P0002'; end if;
  -- Separate attempts for one currency/date share a lock, as well as the original row lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.currency || ':' || r.base_date::text, 0));
  if p_decision='approved' then
    select x.attempt into current_attempt from public.currency_reports p
      join public.currency_report_runs x on x.id=p.run_id
      where p.currency=r.currency and p.base_date=r.base_date;
    if current_attempt > r.attempt then
      raise exception 'newer report attempt already published' using errcode='55000';
    end if;
    if r.candidate ? 'purpose' and r.candidate->>'purpose' not in ('economic_update','fx_explanation','periodic_check') then
      raise exception 'invalid report purpose' using errcode='22023';
    end if;
    if exists (select 1 from jsonb_array_elements(r.candidate->'evidence') e
      where e->>'url' is null or e->>'url' !~ '^https://[^[:space:]@/]+/' or e->>'url' ~ '[<>]') then
      raise exception 'invalid public evidence url' using errcode='22023';
    end if;
  end if;
  result := app_private.review_currency_report_v1(p_run_id,p_decision,p_reason);
  if result='published' then
    metadata := jsonb_build_object('purpose',coalesce(r.candidate->>'purpose','fx_explanation'));
    if r.candidate->'testOnly'='true'::jsonb then
      metadata := metadata || jsonb_build_object('testOnly',true);
    end if;
    if r.candidate->>'assemblyVersion'='currency-assembly/1' then
      metadata := metadata || jsonb_build_object('assemblyVersion','currency-assembly/1');
    end if;
    if jsonb_typeof(r.candidate->'marketData')='object' then
      metadata := metadata || jsonb_build_object('marketData',jsonb_build_object(
        'fetchedAt',r.candidate->'marketData'->'fetchedAt',
        'source',case when r.candidate->'marketData'->>'source' in ('API','JSON','EXCEL') then r.candidate->'marketData'->>'source' else 'UNKNOWN' end,
        'rateType','LOCAL_PER_USD'));
    end if;
    update public.currency_reports set report=report || metadata where run_id=r.id;
  end if;
  return result;
end;
$$;
