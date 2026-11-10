begin;
-- Exact gzip objects reuse the established server-only chunk store. The packet
-- projection is stored once as native JSONB for the existing SQL finalizer.
create table app_private.currency_report_runtime_documents(
 object_id text primary key references app_private.currency_report_storage_objects(id) on delete restrict,
 kind text not null check(kind in ('task','context')),
 projection jsonb not null check(octet_length(projection::text)<=262144),
 packet jsonb, packet_hash text,
 created_at timestamptz not null default clock_timestamp(),
 check((packet is null)=(packet_hash is null)),
 check(packet_hash is null or packet_hash~'^[a-f0-9]{64}$')
);
alter table app_private.currency_report_runtime_documents enable row level security;
revoke all on app_private.currency_report_runtime_documents from public,anon,authenticated;
grant select,insert on app_private.currency_report_runtime_documents to service_role;

create function public.register_currency_report_runtime_document(p_projection jsonb,p_packet_text text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
declare m jsonb=p_projection->'runtimeDocument'; o app_private.currency_report_storage_objects;
 prior app_private.currency_report_runtime_documents; packet jsonb;
begin
 if m->>'version' is distinct from 'runtime-document/2' or m->>'kind' not in ('task','context')
  or octet_length(p_projection::text)>262144 or m->>'codec' is distinct from 'gzip-json/1' then
  raise exception 'runtime document projection required' using errcode='22023';end if;
 select * into strict o from app_private.currency_report_storage_objects where id=m->>'id' for share;
 if not o.sealed or o.raw_bytes is distinct from (m->>'rawBytes')::bigint
  or o.compressed_bytes is distinct from (m->>'compressedBytes')::bigint
  or o.compressed_hash is distinct from m->>'compressedHash' or o.chunk_count is distinct from (m->>'chunkCount')::integer then
  raise exception 'runtime document reference mismatch' using errcode='22023';end if;
 if p_packet_text is not null then
  if m->>'kind'<>'context' or octet_length(p_packet_text)>134217728
   or encode(sha256(convert_to(p_packet_text,'UTF8')),'hex') is distinct from m->>'packetHash' then
   raise exception 'runtime packet hash mismatch' using errcode='22023';end if;
  packet:=p_packet_text::jsonb;
  if jsonb_typeof(packet) is distinct from 'object' then raise exception 'runtime packet required';end if;
 elsif m->>'packetHash' is not null then raise exception 'runtime packet missing' using errcode='22023';end if;
 insert into app_private.currency_report_runtime_documents(object_id,kind,projection,packet,packet_hash)
 values(o.id,m->>'kind',p_projection,packet,m->>'packetHash') on conflict(object_id) do nothing;
 select * into strict prior from app_private.currency_report_runtime_documents where object_id=o.id;
 if prior.projection is distinct from p_projection or prior.packet is distinct from packet then
  raise exception 'immutable runtime document conflict' using errcode='22023';end if;
 return true;
end;$$;
revoke all on function public.register_currency_report_runtime_document(jsonb,text) from public,anon,authenticated;
grant execute on function public.register_currency_report_runtime_document(jsonb,text) to service_role;

-- A manifest cannot enter an input/job until its exact object is complete and
-- its full projection has been registered. Legacy inline documents stay valid.
create function app_private.validate_runtime_document_reference() returns trigger
language plpgsql security invoker set search_path='' as $$
declare value jsonb; expected text; d app_private.currency_report_runtime_documents;
begin
 value:=case when tg_table_name='currency_report_runtime_inputs' then to_jsonb(new)->'task' else to_jsonb(new)->'context' end;
 if value ? 'runtimeDocument' then
  expected:=case when tg_table_name='currency_report_runtime_inputs' then 'task' else 'context' end;
  select * into strict d from app_private.currency_report_runtime_documents where object_id=value->'runtimeDocument'->>'id';
  if d.kind is distinct from expected or d.projection is distinct from value then
   raise exception 'unregistered runtime document reference' using errcode='22023';end if;
 end if;
 return new;
end;$$;
revoke all on function app_private.validate_runtime_document_reference() from public,anon,authenticated;
grant execute on function app_private.validate_runtime_document_reference() to service_role;
create trigger runtime_input_document before insert on app_private.currency_report_runtime_inputs
 for each row execute function app_private.validate_runtime_document_reference();
create trigger runtime_job_document before insert on app_private.currency_report_runtime_jobs
 for each row execute function app_private.validate_runtime_document_reference();

create function app_private.runtime_context_packet(p_context jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not(p_context ? 'runtimeDocument') then return p_context->'packet';end if;
 select packet into strict result from app_private.currency_report_runtime_documents
  where object_id=p_context->'runtimeDocument'->>'id' and kind='context' and projection=p_context;
 if result is null then raise exception 'runtime document packet missing';end if;
 return result;
end;$$;
revoke all on function app_private.runtime_context_packet(jsonb) from public,anon,authenticated;
grant execute on function app_private.runtime_context_packet(jsonb) to service_role;

-- Audit recovered states without editing original inputs, responses or costs.
create table app_private.currency_report_technical_recoveries(
 case_key text not null references app_private.currency_report_operating_cases(case_key) on delete restrict,
 repair_version text not null, original_state text not null, original_result jsonb not null,
 original_batch_state text not null, recovered_at timestamptz not null default clock_timestamp(),
 primary key(case_key,repair_version)
);
alter table app_private.currency_report_technical_recoveries enable row level security;
revoke all on app_private.currency_report_technical_recoveries from public,anon,authenticated;
grant select,insert on app_private.currency_report_technical_recoveries to service_role;
create function app_private.runtime_technical_recovery_reason(c app_private.currency_report_operating_cases) returns text
language plpgsql stable security invoker set search_path='' as $$
begin
 if c.state<>'held' or c.run_id is not null or exists(select 1 from app_private.currency_report_technical_recoveries r
  where r.case_key=c.case_key and r.repair_version='runtime-document/2') then return null;end if;
 if (coalesce(c.result->'sourceHolds','[]') @> '["source_endpoint_preflight_hold"]'::jsonb
   or coalesce(c.result->'holds','[]') @> '["source_endpoint_preflight_hold"]'::jsonb)
  and coalesce((c.result->>'modelCalls')::integer,-1)=0
  and not exists(select 1 from app_private.currency_report_runtime_jobs where context->>'operatingCaseKey'=c.case_key) then
   return 'zero_dispatch_endpoint_hold';
 elsif c.result->>'status'='writer_preparation_hold'
  and coalesce(c.result->'sourceHolds','[]') @> '["unsafe_or_oversized_runtime_payload"]'::jsonb
  and not exists(select 1 from app_private.currency_report_runtime_jobs
    where context->>'operatingCaseKey'=c.case_key and (context->>'purpose' is distinct from 'original_source_review'
     or cost_state<>'confirmed' or state not in ('received','held','finished') or actual_nano>reserved_nano)) then
   return 'legacy_runtime_capacity_hold';
 end if;
 return null;
end;$$;
revoke all on function app_private.runtime_technical_recovery_reason(app_private.currency_report_operating_cases) from public,anon,authenticated;
grant execute on function app_private.runtime_technical_recovery_reason(app_private.currency_report_operating_cases) to service_role;
create function public.inspect_currency_report_operating_technical_holds(p_revision bigint) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at,b.batch_key),'[]'::jsonb) from (
  select * from app_private.currency_report_operating_batches b where b.policy_revision=p_revision
   and b.state in ('completed','paused') and exists(select 1 from app_private.currency_report_operating_cases c
    where c.batch_key=b.batch_key and app_private.runtime_technical_recovery_reason(c) is not null)
   order by b.created_at,b.batch_key limit 17
 ) b;
$$;
revoke all on function public.inspect_currency_report_operating_technical_holds(bigint) from public,anon,authenticated;
grant execute on function public.inspect_currency_report_operating_technical_holds(bigint) to service_role;
create function public.recover_currency_report_operating_technical_holds(p_revision bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c app_private.currency_report_operating_cases; b app_private.currency_report_operating_batches;
 control app_private.currency_report_runtime_control; recovered integer=0; why text;
begin
 select * into control from app_private.currency_report_runtime_control where singleton for update;
 if not control.enabled or not control.review_enabled or p_revision is distinct from
  (select max(revision) from app_private.currency_report_operating_policies) then
  return jsonb_build_object('recovered',0,'reason','operating_scope_changed');end if;
 if exists(select 1 from app_private.currency_report_runtime_jobs
  where (cost_state='unknown' and not app_private.runtime_cost_escrowed(id)) or state in ('reserved','calling') or actual_nano>reserved_nano) then
  return jsonb_build_object('recovered',0,'reason','unresolved_or_inflight_call');end if;
 for b in select * from app_private.currency_report_operating_batches
  where policy_revision=p_revision and state in ('completed','paused') order by created_at for update skip locked loop
  for c in select * from app_private.currency_report_operating_cases where batch_key=b.batch_key and state='held' and run_id is null
   and not exists(select 1 from app_private.currency_report_technical_recoveries r where r.case_key=currency_report_operating_cases.case_key and repair_version='runtime-document/2')
   order by currency for update skip locked loop
   why:=app_private.runtime_technical_recovery_reason(c);
   if why is null then continue;end if;
   insert into app_private.currency_report_technical_recoveries values(c.case_key,'runtime-document/2',c.state,c.result,b.state,clock_timestamp());
   update app_private.currency_report_operating_cases set state='paused',updated_at=clock_timestamp() where case_key=c.case_key;
   update app_private.currency_report_operating_batches set state='paused',updated_at=clock_timestamp() where batch_key=b.batch_key;
   recovered:=recovered+1;
  end loop;
 end loop;
 return jsonb_build_object('recovered',recovered,'repairVersion','runtime-document/2','modelCalls',0);
end;$$;
revoke all on function public.recover_currency_report_operating_technical_holds(bigint) from public,anon,authenticated;
grant execute on function public.recover_currency_report_operating_technical_holds(bigint) to service_role;

-- Same finalization checks/receipts/idempotent wrapper; resolve the packet projection.
create or replace function app_private.finish_currency_report_runtime_before_continuation(p_id uuid,p_candidate jsonb,p_validation jsonb,p_cost jsonb)
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
 packet:=app_private.runtime_context_packet(case when j.stage='writer' then j.context else parent.context end);
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

alter table app_private.currency_report_storage_incidents drop constraint currency_report_storage_incidents_stage_check;
alter table app_private.currency_report_storage_incidents add constraint currency_report_storage_incidents_stage_check
 check(stage in ('preflight','write','restore','link','endpoint','runtime'));
create or replace function public.record_currency_report_storage_incident(p_stage text,p_reason text,p_healthy boolean,p_stats jsonb default '{}') returns boolean
language plpgsql security invoker set search_path='' as $$
declare key text;clean jsonb;
begin
 if p_stage is null or p_stage not in ('preflight','write','restore','link','endpoint','runtime') or p_healthy is null then raise exception 'storage incident stage required';end if;
 if p_healthy then
  update app_private.currency_report_storage_incidents set active=false,resolved_at=now(),last_seen=now(),revision=revision+1
   where active and stage=p_stage and (p_stage<>'runtime'
    or p_reason ~ '^verified_(brl|mxn|cop|pen|clp|ars)$' and right(reason,4)='_'||right(p_reason,3)
    or p_reason='verified_capability' and reason in ('runtime_document_capability_missing','runtime_store_currency_report_runtime_document_capability_failed')
    or p_reason='verified_recovery' and reason in ('runtime_recovery_unavailable','runtime_store_recover_currency_report_operating_technical_holds_failed'));
  return true;
 end if;
 if p_reason is null or p_reason!~'^[a-z0-9_]{1,160}$' then raise exception 'sanitized storage reason required';end if;
 key:=encode(sha256(convert_to('frozen-storage:'||p_stage||':'||p_reason,'UTF8')),'hex');
 -- Allowlisted size statistics and sanitized endpoint identifiers only.
 select coalesce(jsonb_object_agg(k,v),'{}') into clean from jsonb_each(p_stats) e(k,v)
 where k in ('rawBytes','compressedBytes','manifestBytes','newBytes','reusedBytes') and jsonb_typeof(v)='number'
 or k in ('model','route','category','stage','checkedAt','metadataHash') and jsonb_typeof(v)='string'
 and (v#>>'{}') ~ '^[A-Za-z0-9_./:+-]{1,100}$';
 insert into app_private.currency_report_storage_incidents(id,stage,reason,stats) values(key,p_stage,p_reason,clean)
 on conflict(id) do update set active=true,last_seen=now(),resolved_at=null,occurrences=app_private.currency_report_storage_incidents.occurrences+1,
 revision=app_private.currency_report_storage_incidents.revision+case when app_private.currency_report_storage_incidents.active then 0 else 1 end,stats=excluded.stats;
 return true;
end;$$;
create or replace function app_private.currency_report_review_items()
returns table(kind text,id text,version text,currency text,base_date date,title text,summary text,reason text,created_at timestamptz,target_id text)
language sql stable security invoker set search_path='' as $$
 select * from app_private.currency_report_review_items_before_storage()
 union all
 select 'incident',i.id,encode(sha256(convert_to(i.id||':'||i.revision,'UTF8')),'hex'),null::text,null::date,
 case when i.stage='runtime' then '리포트 집필 입력·재개 기술 장애' when i.stage='endpoint' then '모델 처리 전 기술 보류' else '자동 리포트 입력 저장·복원 확인' end,'기술 장애로 새 리포트 처리가 중단됐습니다. 기존 공개 리포트와 환율은 유지됩니다.',
 i.stage||' · '||i.reason,i.first_seen,i.id
 from app_private.currency_report_storage_incidents i where i.active;
$$;

create or replace function public.currency_report_storage_inspect(p_ids text[]) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if coalesce(cardinality(p_ids),0)>2 then raise exception 'storage reference limit' using errcode='22023';end if;
 return jsonb_build_object('version','operating-storage/2','objects',coalesce((select jsonb_agg(jsonb_build_object('id',id,'sealed',sealed))
  from app_private.currency_report_storage_objects where id=any(p_ids)),'[]'::jsonb),
  'retention',jsonb_build_object('deleteEnabled',false,
   'incompleteObjects',(select count(*) from app_private.currency_report_storage_objects where not sealed),
   'unreferencedObjects',(select count(*) from app_private.currency_report_storage_objects o where not exists(select 1 from app_private.currency_report_storage_refs r where r.object_id=o.id) and not exists(select 1 from app_private.currency_report_runtime_documents d where d.object_id=o.id)),
   'storedBytes',(select coalesce(sum(octet_length(data)),0) from app_private.currency_report_storage_chunks),
   'unreferencedBytes',(select coalesce(sum(octet_length(c.data)),0) from app_private.currency_report_storage_chunks c where not exists(select 1 from app_private.currency_report_storage_refs r where r.object_id=c.object_id) and not exists(select 1 from app_private.currency_report_runtime_documents d where d.object_id=c.object_id))));
end;$$;

create function public.currency_report_runtime_document_capability() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('version','runtime-document/2','rawLimit',134217728,'compressedLimit',33554432,
  'manifestLimit',262144,'archiveReferences',(select count(*) from app_private.currency_report_runtime_documents),
  'recoveredCases',(select count(*) from app_private.currency_report_technical_recoveries));
$$;
revoke all on function public.currency_report_runtime_document_capability() from public,anon,authenticated;
grant execute on function public.currency_report_runtime_document_capability() to service_role;
notify pgrst,'reload schema';
commit;
