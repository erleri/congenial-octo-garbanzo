-- Additive private object storage. No control/budget/publication changes.
begin;
create table app_private.currency_report_storage_objects(
 id text primary key check(id~'^[a-f0-9]{64}$'),
 codec text not null check(codec='gzip-json/1'),
 raw_bytes bigint not null check(raw_bytes between 1 and 134217728),
 compressed_bytes bigint not null check(compressed_bytes between 1 and 33554432),
 compressed_hash text not null check(compressed_hash~'^[a-f0-9]{64}$'),
 chunk_count integer not null check(chunk_count between 1 and 64),
 sealed boolean not null default false, created_at timestamptz not null default now(),
 check(chunk_count=ceil(compressed_bytes::numeric/524288))
);
create table app_private.currency_report_storage_chunks(
 object_id text not null references app_private.currency_report_storage_objects(id) on delete restrict,
 ordinal integer not null check(ordinal between 0 and 63),data bytea not null check(octet_length(data) between 1 and 524288),
 primary key(object_id,ordinal)
);
create table app_private.currency_report_storage_refs(
 batch_key text not null references app_private.currency_report_operating_batches(batch_key) on delete restrict,
 role text not null check(role in ('dataset','prepared')),
 object_id text not null references app_private.currency_report_storage_objects(id) on delete restrict,
 primary key(batch_key,role)
);
create index currency_report_storage_refs_object_idx on app_private.currency_report_storage_refs(object_id);
alter table app_private.currency_report_storage_objects enable row level security;
alter table app_private.currency_report_storage_chunks enable row level security;
alter table app_private.currency_report_storage_refs enable row level security;
revoke all on app_private.currency_report_storage_objects,app_private.currency_report_storage_chunks,app_private.currency_report_storage_refs from public,anon,authenticated;
grant select,insert,update on app_private.currency_report_storage_objects to service_role;
grant select,insert on app_private.currency_report_storage_chunks,app_private.currency_report_storage_refs to service_role;

create function public.currency_report_storage_inspect(p_ids text[]) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if coalesce(cardinality(p_ids),0)>2 then raise exception 'storage reference limit' using errcode='22023';end if;
 return jsonb_build_object('version','operating-storage/2','objects',coalesce((select jsonb_agg(jsonb_build_object('id',id,'sealed',sealed))
  from app_private.currency_report_storage_objects where id=any(p_ids)),'[]'::jsonb),
  'retention',jsonb_build_object('deleteEnabled',false,
   'incompleteObjects',(select count(*) from app_private.currency_report_storage_objects where not sealed),
   'unreferencedObjects',(select count(*) from app_private.currency_report_storage_objects o where not exists(select 1 from app_private.currency_report_storage_refs r where r.object_id=o.id)),
   'storedBytes',(select coalesce(sum(octet_length(data)),0) from app_private.currency_report_storage_chunks),
   'unreferencedBytes',(select coalesce(sum(octet_length(c.data)),0) from app_private.currency_report_storage_chunks c where not exists(select 1 from app_private.currency_report_storage_refs r where r.object_id=c.object_id))));
end;$$;
create function public.prepare_currency_report_storage_object(p_meta jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o app_private.currency_report_storage_objects;
begin
 insert into app_private.currency_report_storage_objects(id,codec,raw_bytes,compressed_bytes,compressed_hash,chunk_count)
 values(p_meta->>'id',p_meta->>'codec',(p_meta->>'rawBytes')::bigint,(p_meta->>'compressedBytes')::bigint,p_meta->>'compressedHash',(p_meta->>'chunkCount')::integer)
 on conflict(id) do nothing;
 select * into strict o from app_private.currency_report_storage_objects where id=p_meta->>'id' for update;
 if o.codec is distinct from p_meta->>'codec' or o.raw_bytes is distinct from (p_meta->>'rawBytes')::bigint
  or o.compressed_bytes is distinct from (p_meta->>'compressedBytes')::bigint or o.compressed_hash is distinct from p_meta->>'compressedHash'
  or o.chunk_count is distinct from (p_meta->>'chunkCount')::integer then raise exception 'immutable storage object conflict' using errcode='22023';end if;
 return jsonb_build_object('sealed',o.sealed);
end;$$;
create function public.put_currency_report_storage_chunk(p_id text,p_index integer,p_data text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare o app_private.currency_report_storage_objects; bytes bytea; prior bytea;
begin
 if p_data is null or octet_length(p_data)>699052 then raise exception 'storage chunk too large' using errcode='22023';end if;
 bytes:=decode(p_data,'base64');
 select * into strict o from app_private.currency_report_storage_objects where id=p_id for update;
 if p_index is null or p_index<0 or p_index>=o.chunk_count or octet_length(bytes)<>least(524288,o.compressed_bytes-p_index::bigint*524288) then
  raise exception 'storage chunk size or position invalid' using errcode='22023';end if;
 select data into prior from app_private.currency_report_storage_chunks where object_id=p_id and ordinal=p_index;
 if found then
  if prior<>bytes then raise exception 'immutable storage chunk conflict' using errcode='22023';end if;
  return false;
 end if;
 if o.sealed then raise exception 'sealed storage object immutable' using errcode='22023';end if;
 insert into app_private.currency_report_storage_chunks values(p_id,p_index,bytes);return true;
end;$$;
create function public.seal_currency_report_storage_object(p_id text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare o app_private.currency_report_storage_objects; joined bytea; n integer;
begin
 select * into strict o from app_private.currency_report_storage_objects where id=p_id for update;
 select count(*),string_agg(data,''::bytea order by ordinal) into n,joined from app_private.currency_report_storage_chunks where object_id=p_id;
 if n<>o.chunk_count or octet_length(joined)<>o.compressed_bytes or encode(sha256(joined),'hex')<>o.compressed_hash then
  raise exception 'storage object incomplete or corrupt' using errcode='22023';end if;
 update app_private.currency_report_storage_objects set sealed=true where id=p_id;return true;
end;$$;
create function public.read_currency_report_storage_chunk(p_id text,p_index integer) returns text
language plpgsql security invoker set search_path='' as $$
declare bytes bytea;
begin
 select c.data into strict bytes from app_private.currency_report_storage_chunks c join app_private.currency_report_storage_objects o on o.id=c.object_id
 where o.id=p_id and o.sealed and c.ordinal=p_index;
 return encode(bytes,'base64');
end;$$;
revoke all on function public.currency_report_storage_inspect(text[]),public.prepare_currency_report_storage_object(jsonb),
 public.put_currency_report_storage_chunk(text,integer,text),public.seal_currency_report_storage_object(text),public.read_currency_report_storage_chunk(text,integer) from public,anon,authenticated;
grant execute on function public.currency_report_storage_inspect(text[]),public.prepare_currency_report_storage_object(jsonb),
 public.put_currency_report_storage_chunk(text,integer,text),public.seal_currency_report_storage_object(text),public.read_currency_report_storage_chunk(text,integer) to service_role;

-- Preserve all existing accounting/lease gates in the original implementation.
alter function public.claim_currency_report_operating_batch(text,uuid,bigint,jsonb,bigint,integer) rename to claim_currency_report_operating_batch_accounted;
alter function public.claim_currency_report_operating_batch_accounted(text,uuid,bigint,jsonb,bigint,integer) set schema app_private;
revoke all on function app_private.claim_currency_report_operating_batch_accounted(text,uuid,bigint,jsonb,bigint,integer) from public,anon,authenticated;
grant execute on function app_private.claim_currency_report_operating_batch_accounted(text,uuid,bigint,jsonb,bigint,integer) to service_role;
create function public.claim_currency_report_operating_batch(p_batch_key text,p_owner uuid,p_revision bigint,p_payload jsonb,p_budget_nano bigint,p_max_calls integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare obj jsonb; o app_private.currency_report_storage_objects; result jsonb; total_raw bigint:=0;total_zip bigint:=0;
begin
 if p_payload->>'version'='operating-frozen-input/2' then
  if p_payload->>'serializedOperatingPayload' is null or octet_length(p_payload->>'serializedOperatingPayload')>262144
   or (p_payload->>'serializedOperatingPayload')::jsonb<>p_payload-'serializedOperatingPayload'
   or p_payload->>'resumeIdentity' is distinct from p_batch_key
   or jsonb_typeof(p_payload->'objects') is distinct from 'array'
   or jsonb_array_length(p_payload->'objects') is distinct from 2
   or coalesce(p_payload->>'datasetBinding','')!~'^[a-f0-9]{64}$'
   or coalesce(p_payload->>'payloadHash','')!~'^[a-f0-9]{64}$'
   or (select count(distinct value->>'role') from jsonb_array_elements(p_payload->'objects'))<>2 then
   raise exception 'invalid storage manifest' using errcode='22023';end if;
  for obj in select value from jsonb_array_elements(p_payload->'objects') loop
   select * into strict o from app_private.currency_report_storage_objects where id=obj->>'id' for share;
   if obj->>'role' not in ('dataset','prepared') or not o.sealed or o.codec is distinct from obj->>'codec'
    or o.raw_bytes is distinct from (obj->>'rawBytes')::bigint or o.compressed_bytes is distinct from (obj->>'compressedBytes')::bigint
    or o.compressed_hash is distinct from obj->>'compressedHash' or o.chunk_count is distinct from (obj->>'chunkCount')::integer then
    raise exception 'unsealed or inconsistent storage reference' using errcode='22023';end if;
   total_raw:=total_raw+o.raw_bytes;total_zip:=total_zip+o.compressed_bytes;
  end loop;
  if total_raw>134217728 or total_zip>33554432 then raise exception 'storage reference capacity exceeded' using errcode='22023';end if;
 -- Keep the pre-versioned service RPC contract as well as /1. New Node callers
 -- always send a version; unknown explicit versions are never accepted.
 elsif p_payload ? 'version' and p_payload->>'version' is distinct from 'operating-frozen-input/1' then raise exception 'unknown frozen format' using errcode='22023';end if;
 result:=app_private.claim_currency_report_operating_batch_accounted(p_batch_key,p_owner,p_revision,p_payload,p_budget_nano,p_max_calls);
 if result->>'claimed'='true' and p_payload->>'version'='operating-frozen-input/2' then
  insert into app_private.currency_report_storage_refs(batch_key,role,object_id)
  select p_batch_key,value->>'role',value->>'id' from jsonb_array_elements(p_payload->'objects') on conflict do nothing;
 end if;
 return result;
end;$$;
revoke all on function public.claim_currency_report_operating_batch(text,uuid,bigint,jsonb,bigint,integer) from public,anon,authenticated;
grant execute on function public.claim_currency_report_operating_batch(text,uuid,bigint,jsonb,bigint,integer) to service_role;

create table app_private.currency_report_storage_incidents(
 id text primary key,stage text not null check(stage in ('preflight','write','restore','link')), reason text not null,
 active boolean not null default true,revision integer not null default 1,
 first_seen timestamptz not null default now(),last_seen timestamptz not null default now(),resolved_at timestamptz,
 occurrences bigint not null default 1,stats jsonb not null default '{}' check(octet_length(stats::text)<=2048)
);
alter table app_private.currency_report_storage_incidents enable row level security;
revoke all on app_private.currency_report_storage_incidents from public,anon,authenticated;
grant select,insert,update on app_private.currency_report_storage_incidents to service_role;
create function public.record_currency_report_storage_incident(p_stage text,p_reason text,p_healthy boolean,p_stats jsonb default '{}') returns boolean
language plpgsql security invoker set search_path='' as $$
declare key text;clean jsonb;
begin
 if p_stage is null or p_stage not in ('preflight','write','restore','link') or p_healthy is null then raise exception 'storage incident stage required';end if;
 if p_healthy then
  update app_private.currency_report_storage_incidents set active=false,resolved_at=now(),last_seen=now(),revision=revision+1 where active and stage=p_stage;
  return true;
 end if;
 if p_reason is null or p_reason!~'^[a-z0-9_]{1,160}$' then raise exception 'sanitized storage reason required';end if;
 key:=encode(sha256(convert_to('frozen-storage:'||p_stage||':'||p_reason,'UTF8')),'hex');
 -- Allowlisted numeric statistics only; never copy arbitrary exception/data text.
 select coalesce(jsonb_object_agg(k,v),'{}') into clean from jsonb_each(p_stats) e(k,v)
 where k in ('rawBytes','compressedBytes','manifestBytes','newBytes','reusedBytes') and jsonb_typeof(v)='number';
 insert into app_private.currency_report_storage_incidents(id,stage,reason,stats) values(key,p_stage,p_reason,clean)
 on conflict(id) do update set active=true,last_seen=now(),resolved_at=null,occurrences=app_private.currency_report_storage_incidents.occurrences+1,
 revision=app_private.currency_report_storage_incidents.revision+case when app_private.currency_report_storage_incidents.active then 0 else 1 end,stats=excluded.stats;
 return true;
end;$$;
revoke all on function public.record_currency_report_storage_incident(text,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.record_currency_report_storage_incident(text,text,boolean,jsonb) to service_role;
-- Use the existing inbox/version/digest/deep link contract, including active admin checks.
alter function app_private.currency_report_review_items() rename to currency_report_review_items_before_storage;
create function app_private.currency_report_review_items()
returns table(kind text,id text,version text,currency text,base_date date,title text,summary text,reason text,created_at timestamptz,target_id text)
language sql stable security invoker set search_path='' as $$
 select * from app_private.currency_report_review_items_before_storage()
 union all
 select 'incident',i.id,encode(sha256(convert_to(i.id||':'||i.revision,'UTF8')),'hex'),null::text,null::date,
 '자동 리포트 입력 저장·복원 확인','기술 장애로 새 리포트 처리가 중단됐습니다. 기존 공개 리포트와 환율은 유지됩니다.',
 i.stage||' · '||i.reason,i.first_seen,i.id
 from app_private.currency_report_storage_incidents i where i.active;
$$;
revoke all on function app_private.currency_report_review_items() from public,anon,authenticated;
grant execute on function app_private.currency_report_review_items() to service_role;
notify pgrst,'reload schema';
commit;
