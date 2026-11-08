-- Local-first, additive. Existing manuscripts remain legacy; new managed writes opt in.
alter table public.currency_report_runs add column storage_required boolean not null default false;
create table public.currency_report_storage_receipts (
 run_id uuid primary key references public.currency_report_runs(id),
 manifest_hash text not null check(manifest_hash ~ '^[a-f0-9]{64}$'),
 bundle_id text not null check(bundle_id ~ '^[A-Za-z0-9_-]{1,120}$'),
 candidate_digest text not null,
 packet_digest text not null,
 validation_digest text not null,
 sealed_at timestamptz not null default now()
);
alter table public.currency_report_storage_receipts enable row level security;
revoke all on public.currency_report_storage_receipts from public,anon,authenticated,service_role;
grant select on public.currency_report_storage_receipts to authenticated,service_role;
create policy "Active admins read storage receipts" on public.currency_report_storage_receipts
 for select to authenticated using((select app_private.is_business_plan_admin()));

-- Only the trusted server importer can attest that it read and verified local files.
-- This records storage integrity, never source permission or content-quality approval.
create function app_private.seal_currency_report_storage(p_run_id uuid,p_bundle_id text,p_manifest_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.currency_report_runs;
begin
 select * into r from public.currency_report_runs where id=p_run_id for update;
 if r.id is null or not r.storage_required or r.status<>'pending_review' then
  raise exception 'managed pending run required' using errcode='55000';
 end if;
 insert into public.currency_report_storage_receipts(run_id,bundle_id,manifest_hash,candidate_digest,packet_digest,validation_digest)
 values(r.id,p_bundle_id,p_manifest_hash,
  pg_catalog.encode(extensions.digest(r.candidate::text,'sha256'),'hex'),
  pg_catalog.encode(extensions.digest(r.packet::text,'sha256'),'hex'),
  pg_catalog.encode(extensions.digest(r.validation::text,'sha256'),'hex'));
end;
$$;
revoke all on function app_private.seal_currency_report_storage(uuid,text,text) from public,anon,authenticated;
grant execute on function app_private.seal_currency_report_storage(uuid,text,text) to service_role;
grant usage on schema app_private to service_role;
create function public.seal_currency_report_storage(p_run_id uuid,p_bundle_id text,p_manifest_hash text)
returns void language sql security invoker set search_path='' as $$
 select app_private.seal_currency_report_storage(p_run_id,p_bundle_id,p_manifest_hash);
$$;
revoke all on function public.seal_currency_report_storage(uuid,text,text) from public,anon,authenticated;
grant execute on function public.seal_currency_report_storage(uuid,text,text) to service_role;

create function app_private.guard_currency_report_storage()
returns trigger language plpgsql security invoker set search_path='' as $$
declare r public.currency_report_runs; s public.currency_report_storage_receipts;
begin
 if new.withdrawn_at is not null then return new; end if;
 select * into r from public.currency_report_runs where id=new.run_id;
 if not r.storage_required then return new; end if;
 select * into s from public.currency_report_storage_receipts where run_id=r.id;
 if s.run_id is null or s.candidate_digest<>pg_catalog.encode(extensions.digest(r.candidate::text,'sha256'),'hex')
  or s.packet_digest<>pg_catalog.encode(extensions.digest(r.packet::text,'sha256'),'hex')
  or s.validation_digest<>pg_catalog.encode(extensions.digest(r.validation::text,'sha256'),'hex') then
  raise exception 'storage incomplete or approval input changed' using errcode='55000';
 end if;
 return new;
end;
$$;
revoke all on function app_private.guard_currency_report_storage() from public,anon,authenticated,service_role;
create trigger currency_report_storage_guard before insert or update on public.currency_reports
 for each row execute function app_private.guard_currency_report_storage();

-- No destructive cleanup; every new seal is append-only and one run cannot be resealed.
comment on table public.currency_report_storage_receipts is 'Private verified-file receipts bound to exact candidate, packet and validation. Does not approve publication.';

-- Existing SQL already builds claims/facts/series explicitly. Close the remaining
-- root/evidence extension points without copying arbitrary future fields.
create function app_private.guard_currency_public_fields()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from (
   select new.report->'content'->'change' c
   union all select x from jsonb_array_elements(new.report->'content'->'drivers') x
   union all select x from jsonb_array_elements(new.report->'content'->'implications') x
   union all select x from jsonb_array_elements(new.report->'content'->'watch') x
  ) claims where jsonb_typeof(c->'title') is distinct from 'string'
    or jsonb_typeof(c->'text') is distinct from 'string'
    or c->>'kind' not in ('fact','interpretation','mechanism')
    or jsonb_typeof(c->'factIds') is distinct from 'array'
    or jsonb_typeof(c->'evidenceIds') is distinct from 'array')
  or exists(select 1 from jsonb_array_elements(new.report->'facts') f
    where jsonb_typeof(f->'id') is distinct from 'string' or jsonb_typeof(f->'label') is distinct from 'string' or jsonb_typeof(f->'value') is distinct from 'number')
  or exists(select 1 from jsonb_array_elements(new.report->'series') s
    where jsonb_typeof(s->'date') is distinct from 'string' or jsonb_typeof(s->'value') is distinct from 'number') then
  raise exception 'invalid public field type' using errcode='22023';
 end if;
 new.report := (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(new.report)
  where key=any(array['id','schemaVersion','currency','baseDate','observedDate','observationAt','publishedAt','status','generationMode',
   'content','facts','series','evidence','limitations','purpose','testOnly','assemblyVersion','marketData','authorship','historicalReview','presentationVersion']));
 new.report := jsonb_set(new.report,'{evidence}',(select coalesce(jsonb_agg(
  (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(e)
   where key=any(array['id','country','title','publisher','url','publishedAt','eventDate','period','collectedAt','summary','eventAt','scope','role','causalStatus'])
    and jsonb_typeof(value) in ('string','null'))
   ||case when e->>'provenance' in ('official','market_reporting') then jsonb_build_object('provenance',e->>'provenance') else '{}'::jsonb end
 ),'[]') from jsonb_array_elements(new.report->'evidence') e));
 if new.report::text ~* '(sk-or-|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|[?&](token|api_?key|access_token|signature)=)' then
  raise exception 'private data in public projection' using errcode='22023';
 end if;
 return new;
end;
$$;
revoke all on function app_private.guard_currency_public_fields() from public,anon,authenticated,service_role;
create trigger zz_currency_report_public_allowlist before insert or update on public.currency_reports
 for each row execute function app_private.guard_currency_public_fields();
notify pgrst, 'reload schema';
