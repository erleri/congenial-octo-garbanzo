begin;
-- Common public projection only: no manuscript, price, receipt or policy rewrite.
create or replace function app_private.guard_currency_public_fields()
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
    where jsonb_typeof(s->'date') is distinct from 'string' or coalesce(jsonb_typeof(s->'value'),'missing') not in ('number','null')) then
  raise exception 'invalid public field type' using errcode='22023';
 end if;
 -- Preserve the sealed private series. Only explicit missing observations
 -- are absent from the public numeric chart; malformed values still fail.
 new.report := jsonb_set(new.report,'{series}',(select coalesce(jsonb_agg(s order by ord),'[]')
   from jsonb_array_elements(new.report->'series') with ordinality as points(s,ord)
   where jsonb_typeof(s->'value')='number'));
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
notify pgrst,'reload schema';
commit;
