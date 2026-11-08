-- Free official acquisition cache. No public/admin raw-body access, paid job,
-- enabled flag, source approval or old report is changed by this migration.
-- Original JSON is stored once as text so hashes survive JSONB key reordering.
create table app_private.currency_report_official_inputs (
 cache_key text primary key check(cache_key ~ '^[a-f0-9]{64}$'),
 currency text not null check(currency in ('BRL','MXN','COP','PEN','CLP','ARS')),
 definitions text not null,
 observed_at timestamptz not null,
 record_json text not null check(octet_length(record_json)<=16000000),
 created_at timestamptz not null default clock_timestamp()
);
create index currency_official_input_lookup on app_private.currency_report_official_inputs(currency,definitions,observed_at desc);
alter table app_private.currency_report_official_inputs enable row level security;
revoke all on app_private.currency_report_official_inputs from public,anon,authenticated;
grant select,insert on app_private.currency_report_official_inputs to service_role;

create function public.load_currency_report_official_input(p_currency text,p_definitions text,p_as_of timestamptz)
returns text language plpgsql security invoker set search_path='' as $$
begin
 if p_currency not in ('BRL','MXN','COP','PEN','CLP','ARS') or p_currency is null
  or p_definitions is null or p_as_of is null then raise exception 'official cache context required' using errcode='22023'; end if;
 return (select record_json from app_private.currency_report_official_inputs
  where currency=p_currency and definitions=p_definitions and observed_at<=p_as_of
  order by observed_at desc,created_at desc,cache_key limit 1);
end;
$$;
create function public.save_currency_report_official_input(p_record_json text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb; used_bytes bigint; new_bytes integer;
begin
 new_bytes:=octet_length(p_record_json);
 if new_bytes is null or new_bytes>16000000 then raise exception 'official cache input limit' using errcode='22023'; end if;
 r:=p_record_json::jsonb;
 if r->>'version' is distinct from 'official-input-cache/1'
  or r->>'definitions' is null or length(r->>'definitions')>200
  or coalesce(r->>'currency','') not in ('BRL','MXN','COP','PEN','CLP','ARS')
  or coalesce(r->>'key','') !~ '^[a-f0-9]{64}$' or coalesce(r->>'binding','') !~ '^[a-f0-9]{64}$'
  or r->>'observedAt' is null or (r->>'observedAt')::timestamptz>clock_timestamp()+interval '5 minutes'
  or jsonb_typeof(r->'inputs') is distinct from 'object'
  or (select count(*) from jsonb_object_keys(r))<>7
  or p_record_json ~* '(sk-or-|bearer[[:space:]]|-----BEGIN .*PRIVATE KEY|[?&](token|api_?key)=)' then
  raise exception 'registered official cache record required' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('currency_report_official_cache_capacity',0));
 select coalesce(sum(octet_length(record_json)),0) into used_bytes from app_private.currency_report_official_inputs;
 if exists(select 1 from app_private.currency_report_official_inputs where cache_key=r->>'key') then
  if exists(select 1 from app_private.currency_report_official_inputs where cache_key=r->>'key'
   and (currency<>r->>'currency' or definitions<>r->>'definitions')) then
   raise exception 'official cache identity conflict' using errcode='22023'; end if;
  return jsonb_build_object('status','duplicate_preserved','bytes',used_bytes,'limitBytes',50000000);
 end if;
 if used_bytes+new_bytes>50000000 then
  return jsonb_build_object('status','capacity_hold','bytes',used_bytes,'limitBytes',50000000);
 end if;
 insert into app_private.currency_report_official_inputs(cache_key,currency,definitions,observed_at,record_json)
 values(r->>'key',r->>'currency',r->>'definitions',(r->>'observedAt')::timestamptz,p_record_json);
 return jsonb_build_object('status','stored','bytes',used_bytes+new_bytes,'limitBytes',50000000);
end;
$$;
revoke all on function public.load_currency_report_official_input(text,text,timestamptz),public.save_currency_report_official_input(text) from public,anon,authenticated;
grant execute on function public.load_currency_report_official_input(text,text,timestamptz),public.save_currency_report_official_input(text) to service_role;
notify pgrst,'reload schema';
