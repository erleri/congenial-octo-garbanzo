-- Private durable runtime. No activation, cleanup or legacy-table replacement.
create table app_private.currency_report_runtime_control (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 review_enabled boolean not null default false,
 writer text not null default 'sol' check(writer in ('sol','sol-us','sonnet','argon')),
 monthly_limit_nano bigint not null default 0 check(monthly_limit_nano between 0 and 1000000000000),
 per_call_limit_nano bigint not null default 250000000 check(per_call_limit_nano between 1 and 250000000),
 revision bigint not null default 1
);
insert into app_private.currency_report_runtime_control(singleton) values(true);
create table app_private.currency_report_runtime_inputs (
 id uuid primary key default gen_random_uuid(),
 currency text not null check(currency in ('BRL','MXN','CLP','COP','PEN','ARS')),
 snapshot_id text not null check(snapshot_id ~ '^[a-f0-9]{64}$'),
 payload_hash text not null unique check(payload_hash ~ '^[a-f0-9]{64}$'),
 task jsonb not null check(jsonb_typeof(task)='object' and octet_length(task::text)<=900000),
 created_at timestamptz not null default clock_timestamp()
);
alter table app_private.currency_report_runtime_inputs enable row level security;
revoke all on app_private.currency_report_runtime_inputs from public,anon,authenticated;
grant select,insert on app_private.currency_report_runtime_inputs to service_role;
create function public.stage_currency_report_runtime_input(p_task jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare r uuid;
begin
 if p_task->>'version' is distinct from 'currency-report-runtime/1' or p_task->>'status' is distinct from 'prepared'
  or p_task->>'publicationApproved' is distinct from 'false' then raise exception 'prepared private runtime input required' using errcode='22023'; end if;
 insert into app_private.currency_report_runtime_inputs(currency,snapshot_id,payload_hash,task)
 values(p_task->>'currency',p_task->'snapshot'->>'snapshotId',p_task->>'binding',p_task) returning id into r;
 return r;
end;
$$;
revoke all on function public.stage_currency_report_runtime_input(jsonb) from public,anon,authenticated;
grant execute on function public.stage_currency_report_runtime_input(jsonb) to service_role;
create function public.load_currency_report_runtime_input(p_currency text,p_snapshot_id text) returns jsonb
language sql security invoker set search_path='' as $$
 select task from app_private.currency_report_runtime_inputs where currency=p_currency and snapshot_id=p_snapshot_id order by created_at desc,id desc limit 1;
$$;
revoke all on function public.load_currency_report_runtime_input(text,text) from public,anon,authenticated;
grant execute on function public.load_currency_report_runtime_input(text,text) to service_role;
create table app_private.currency_report_runtime_jobs (
 id uuid primary key default gen_random_uuid(),
 task_key text not null unique check(task_key ~ '^[a-f0-9]{64}$'),
 currency text not null check(currency in ('BRL','MXN','CLP','COP','PEN','ARS')),
 base_date date not null,
 stage text not null check(stage in ('writer','reviewer')),
 parent_id uuid references app_private.currency_report_runtime_jobs(id),
 state text not null default 'reserved' check(state in ('reserved','calling','received','held','finished','cancelled')),
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 context jsonb not null check(jsonb_typeof(context)='object' and octet_length(context::text)<=1000000),
 response jsonb,
 checkpoint jsonb,
 response_id text,
 cost_receipt jsonb,
 reserved_nano bigint not null check(reserved_nano between 1 and 250000000),
 actual_nano bigint check(actual_nano>=0),
 cost_state text not null default 'reserved' check(cost_state in ('reserved','unknown','confirmed')),
 control_revision bigint not null,
 run_id uuid references public.currency_report_runs(id),
 created_at timestamptz not null default clock_timestamp(),
 started_at timestamptz,
 received_at timestamptz,
 unique(parent_id,stage),
 check((cost_state='confirmed')=(actual_nano is not null)),
 check((stage='writer' and parent_id is null) or (stage='reviewer' and parent_id is not null))
);
create index currency_runtime_month_idx on app_private.currency_report_runtime_jobs(created_at);
create table app_private.currency_report_runtime_checks (
 check_key text primary key check(check_key ~ '^[a-f0-9]{64}$'),
 currency text not null check(currency in ('BRL','MXN','CLP','COP','PEN','ARS')),
 checked_at timestamptz not null,
 result jsonb not null check(octet_length(result::text)<=4096)
);
alter table app_private.currency_report_runtime_checks enable row level security;
revoke all on app_private.currency_report_runtime_checks from public,anon,authenticated;
grant select,insert on app_private.currency_report_runtime_checks to service_role;
create function public.record_currency_report_runtime_check(p_check_key text,p_currency text,p_checked_at timestamptz,p_result jsonb) returns void
language sql security invoker set search_path='' as $$
 insert into app_private.currency_report_runtime_checks(check_key,currency,checked_at,result)
 values(p_check_key,p_currency,p_checked_at,
  jsonb_build_object('status',p_result->>'status','baseDate',p_result->>'baseDate',
   'dataStatus',p_result->>'dataStatus','qualityStatus',p_result->>'qualityStatus','publicationApproved',false))
 on conflict(check_key) do nothing;
$$;
revoke all on function public.record_currency_report_runtime_check(text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.record_currency_report_runtime_check(text,text,timestamptz,jsonb) to service_role;
alter table app_private.currency_report_runtime_control enable row level security;
alter table app_private.currency_report_runtime_jobs enable row level security;
revoke all on app_private.currency_report_runtime_control,app_private.currency_report_runtime_jobs from public,anon,authenticated;
grant select,insert,update on app_private.currency_report_runtime_control,app_private.currency_report_runtime_jobs to service_role;

create function app_private.bump_currency_runtime_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
begin new.revision:=old.revision+1; return new; end;
$$;
revoke all on function app_private.bump_currency_runtime_revision() from public,anon,authenticated;
create trigger currency_runtime_revision before update on app_private.currency_report_runtime_control
for each row execute function app_private.bump_currency_runtime_revision();

create function public.currency_report_runtime_control() returns jsonb
language sql security invoker set search_path='' as $$
 select to_jsonb(c) from app_private.currency_report_runtime_control c where singleton;
$$;
revoke all on function public.currency_report_runtime_control() from public,anon,authenticated;
grant execute on function public.currency_report_runtime_control() to service_role;

create function public.reserve_currency_report_runtime(p_task_key text,p_currency text,p_date date,p_stage text,
 p_request_hash text,p_context jsonb,p_reserved_nano bigint,p_revision bigint,p_parent_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
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
 if exists(select 1 from app_private.currency_report_runtime_jobs where cost_state='unknown' or state in ('reserved','calling') or actual_nano>reserved_nano) then
   return jsonb_build_object('reserved',false,'reason','unresolved_or_inflight_call'); end if;
 if p_stage='reviewer' then
   select * into parent from app_private.currency_report_runtime_jobs where id=p_parent_id;
   if parent.id is null or parent.stage<>'writer' or parent.currency<>p_currency or parent.base_date<>p_date
     or parent.state<>'received' or parent.cost_state<>'confirmed' or parent.actual_nano>parent.reserved_nano then
     raise exception 'completed writer response required' using errcode='55000'; end if;
 end if;
 select coalesce(sum(case when cost_state='confirmed' then actual_nano else reserved_nano end),0)
   into spent from app_private.currency_report_runtime_jobs
   where created_at>=date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
 if spent+p_reserved_nano>c.monthly_limit_nano then return jsonb_build_object('reserved',false,'reason','monthly_budget_hold'); end if;
 insert into app_private.currency_report_runtime_jobs(task_key,currency,base_date,stage,parent_id,request_hash,context,reserved_nano,control_revision)
 values(p_task_key,p_currency,p_date,p_stage,p_parent_id,p_request_hash,p_context,p_reserved_nano,c.revision) returning * into j;
 return jsonb_build_object('reserved',true,'id',j.id,'revision',c.revision);
end;
$$;
revoke all on function public.reserve_currency_report_runtime(text,text,date,text,text,jsonb,bigint,bigint,uuid) from public,anon,authenticated;
grant execute on function public.reserve_currency_report_runtime(text,text,date,text,text,jsonb,bigint,bigint,uuid) to service_role;

create function public.begin_currency_report_runtime(p_id uuid,p_request_hash text) returns boolean
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
 update app_private.currency_report_runtime_jobs set state='calling',cost_state='unknown',started_at=clock_timestamp() where id=p_id;
 return true;
end;
$$;
revoke all on function public.begin_currency_report_runtime(uuid,text) from public,anon,authenticated;
grant execute on function public.begin_currency_report_runtime(uuid,text) to service_role;

create function public.checkpoint_currency_report_runtime(p_id uuid,p_checkpoint jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare j app_private.currency_report_runtime_jobs; rid text:=p_checkpoint->>'responseId';
begin
 select * into j from app_private.currency_report_runtime_jobs where id=p_id for update;
 if j.id is null or j.state<>'calling' or octet_length(p_checkpoint::text)>4096
   or rid is not null and rid!~'^gen-[A-Za-z0-9-]{1,200}$'
   or j.response_id is not null and rid is distinct from j.response_id then
   raise exception 'invalid runtime checkpoint' using errcode='55000'; end if;
 update app_private.currency_report_runtime_jobs set checkpoint=p_checkpoint,response_id=coalesce(rid,response_id) where id=p_id;
end;
$$;
revoke all on function public.checkpoint_currency_report_runtime(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.checkpoint_currency_report_runtime(uuid,jsonb) to service_role;

create function public.receive_currency_report_runtime(p_id uuid,p_response jsonb,p_actual_nano bigint) returns void
language plpgsql security invoker set search_path='' as $$
declare j app_private.currency_report_runtime_jobs;
begin
 select * into j from app_private.currency_report_runtime_jobs where id=p_id for update;
 if j.id is null or j.state<>'calling' or jsonb_typeof(p_response) is distinct from 'object'
   or octet_length(p_response::text)>1000000 or p_actual_nano<0 then
   raise exception 'immutable runtime response required' using errcode='55000'; end if;
 update app_private.currency_report_runtime_jobs set state='received',response=p_response,
   received_at=clock_timestamp(),actual_nano=p_actual_nano,cost_state=case when p_actual_nano is null then 'unknown' else 'confirmed' end where id=p_id;
end;
$$;
revoke all on function public.receive_currency_report_runtime(uuid,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.receive_currency_report_runtime(uuid,jsonb,bigint) to service_role;

-- Resolve an expense, never replay a generation. Original responses are immutable.
create function public.reconcile_currency_report_runtime_cost(p_id uuid,p_response_id text,p_actual_nano bigint,p_receipt jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare j app_private.currency_report_runtime_jobs;
begin
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
revoke all on function public.reconcile_currency_report_runtime_cost(uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.reconcile_currency_report_runtime_cost(uuid,text,bigint,jsonb) to service_role;

-- The receipt table deliberately has no service INSERT grant. Use a private,
-- service-only transaction rather than weakening its established permissions.
create function app_private.finish_currency_report_runtime(p_id uuid,p_candidate jsonb,p_validation jsonb,p_cost jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare j app_private.currency_report_runtime_jobs; parent app_private.currency_report_runtime_jobs;
 r uuid; n integer; digest text; packet jsonb;
begin
 select * into j from app_private.currency_report_runtime_jobs where id=p_id for update;
 if j.id is null or j.state<>'received' then raise exception 'stored response required' using errcode='55000'; end if;
 if p_candidate is null then
   update app_private.currency_report_runtime_jobs set state='held' where id=p_id;
   return null;
 end if;
 if j.stage='reviewer' then
   select * into parent from app_private.currency_report_runtime_jobs where id=j.parent_id for update;
   if parent.state<>'received' or parent.run_id is not null then raise exception 'writer already finalized' using errcode='55000'; end if;
 end if;
 packet:=case when j.stage='writer' then j.context->'packet' else parent.context->'packet' end;
 if p_candidate->>'currency' is distinct from j.currency or p_candidate->>'baseDate' is distinct from j.base_date::text
   or p_candidate->>'status' is distinct from 'draft' or p_candidate->>'publishedAt' is not null
   or jsonb_typeof(packet) is distinct from 'object' or jsonb_typeof(p_candidate->'content') is distinct from 'object'
   or p_validation->>'publicationApproved' is distinct from 'false' then
   raise exception 'runtime candidate identity mismatch' using errcode='22023'; end if;
 if p_validation->>'contentReview'='passed' and (j.stage<>'reviewer' or j.cost_state<>'confirmed'
   or parent.cost_state<>'confirmed' or j.actual_nano>j.reserved_nano or parent.actual_nano>parent.reserved_nano) then
   raise exception 'complete independently costed review required' using errcode='55000'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('currency_runtime_run:'||j.currency||':'||j.base_date::text,0));
 select coalesce(max(attempt),0)+1 into n from public.currency_report_runs where currency=j.currency and base_date=j.base_date;
 insert into public.currency_report_runs(currency,base_date,attempt,rule_version,event_binding,packet,candidate,validation,cost,storage_required)
 values(j.currency,j.base_date,n,j.context->>'ruleVersion',j.task_key,packet,p_candidate,p_validation,p_cost,true) returning id into r;
 digest:=pg_catalog.encode(extensions.digest(j.context::text||j.response::text||coalesce(parent.context::text,'')||coalesce(parent.response::text,''),'sha256'),'hex');
 insert into public.currency_report_storage_receipts(run_id,bundle_id,manifest_hash,candidate_digest,packet_digest,validation_digest)
 values(r,'runtime-'||r::text,digest,
   pg_catalog.encode(extensions.digest(p_candidate::text,'sha256'),'hex'),pg_catalog.encode(extensions.digest(packet::text,'sha256'),'hex'),
   pg_catalog.encode(extensions.digest(p_validation::text,'sha256'),'hex'));
 update app_private.currency_report_runtime_jobs set state='finished',run_id=r where id=p_id or id=j.parent_id;
 return r;
end;
$$;
revoke all on function app_private.finish_currency_report_runtime(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function app_private.finish_currency_report_runtime(uuid,jsonb,jsonb,jsonb) to service_role;
create function public.finish_currency_report_runtime(p_id uuid,p_candidate jsonb,p_validation jsonb,p_cost jsonb)
returns uuid language sql security invoker set search_path='' as $$select app_private.finish_currency_report_runtime(p_id,p_candidate,p_validation,p_cost);$$;
revoke all on function public.finish_currency_report_runtime(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finish_currency_report_runtime(uuid,jsonb,jsonb,jsonb) to service_role;

create function public.currency_report_runtime_history(p_currency text) returns jsonb
language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('currency',r.currency,'baseDate',r.base_date,'publishedAt',r.published_at,
 'runId',r.run_id,'report',r.report,'runtimeContext',j.context) order by r.published_at desc),'[]')
 from (select * from public.currency_reports where currency=p_currency and withdrawn_at is null order by published_at desc limit 1000) r
 left join app_private.currency_report_runtime_jobs j on j.run_id=r.run_id and j.stage='writer';
$$;
revoke all on function public.currency_report_runtime_history(text) from public,anon,authenticated;
grant execute on function public.currency_report_runtime_history(text) to service_role;

-- Safe summary only. Raw requests/responses remain service-only in app_private.
create function app_private.currency_report_runtime_summary() returns jsonb
language plpgsql security definer set search_path='' as $$
declare c app_private.currency_report_runtime_control; spent numeric; reserved numeric; unresolved integer; checks jsonb;
begin
 if (select auth.uid()) is null or not (select app_private.is_business_plan_admin()) then
   raise exception 'active administrator required' using errcode='42501'; end if;
 select * into c from app_private.currency_report_runtime_control where singleton;
 select coalesce(sum(actual_nano) filter(where cost_state='confirmed'),0),
   coalesce(sum(reserved_nano) filter(where cost_state<>'confirmed'),0),count(*) filter(where cost_state='unknown')
   into spent,reserved,unresolved from app_private.currency_report_runtime_jobs
   where created_at>=date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
 select count(*) into unresolved from app_private.currency_report_runtime_jobs where cost_state='unknown' or actual_nano>reserved_nano;
 select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'checkedAt',checked_at,'result',result)),'[]') into checks
  from (select distinct on(currency) currency,checked_at,result from app_private.currency_report_runtime_checks order by currency,checked_at desc,check_key desc) latest;
 return jsonb_build_object('enabled',c.enabled,'reviewEnabled',c.review_enabled,'writer',c.writer,
   'monthlyLimitUsd',c.monthly_limit_nano/1000000000.0,'confirmedUsd',spent/1000000000.0,
   'reservedUsd',reserved/1000000000.0,'unresolvedCalls',unresolved,'monthBasis','UTC','checks',checks);
end;
$$;
revoke all on function app_private.currency_report_runtime_summary() from public,anon,service_role;
grant execute on function app_private.currency_report_runtime_summary() to authenticated;
create function public.currency_report_runtime_summary() returns jsonb
language sql security invoker set search_path='' as $$select app_private.currency_report_runtime_summary();$$;
revoke all on function public.currency_report_runtime_summary() from public,anon,service_role;
grant execute on function public.currency_report_runtime_summary() to authenticated;
comment on table app_private.currency_report_runtime_jobs is 'Bounded private input/response and durable cost reservations. No automatic retries, fallback or publication.';
comment on table public.currency_report_storage_receipts is 'Private storage integrity receipts bound to candidate, packet and validation. runtime- bundle IDs identify transactionally stored private DB inputs/responses; older IDs identify verified file bundles. Does not approve publication.';
notify pgrst,'reload schema';
