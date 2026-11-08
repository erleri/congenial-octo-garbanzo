-- Review signals only: no publication, withdrawal, paid call or control changes.
create table app_private.currency_report_correction_candidates (
 candidate_key text primary key check(candidate_key ~ '^[a-f0-9]{64}$'),
 currency text not null check(currency in ('BRL','MXN','COP','PEN','CLP','ARS')),
 public_id text not null,
 record jsonb not null check(octet_length(record::text)<=16000),
 status text not null default 'pending_review' check(status in ('pending_review','acknowledged','dismissed')),
 revision bigint not null default 1,
 created_at timestamptz not null default clock_timestamp()
);
create index currency_correction_target on app_private.currency_report_correction_candidates(public_id);
create index currency_correction_queue on app_private.currency_report_correction_candidates(status,created_at desc,candidate_key);
create table app_private.currency_report_correction_reviews (
 id bigint generated always as identity primary key,
 candidate_key text not null references app_private.currency_report_correction_candidates(candidate_key),
 revision bigint not null,
 decision text not null,
 reason text not null check(length(reason) between 1 and 500),
 reviewer uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(candidate_key,revision)
);
create table app_private.currency_report_correction_checks (
 currency text primary key check(currency in ('BRL','MXN','COP','PEN','CLP','ARS')),
 checked_at timestamptz not null,
 coverage jsonb not null check(octet_length(coverage::text)<=12000)
);
alter table app_private.currency_report_correction_candidates enable row level security;
alter table app_private.currency_report_correction_reviews enable row level security;
alter table app_private.currency_report_correction_checks enable row level security;
revoke all on app_private.currency_report_correction_candidates,app_private.currency_report_correction_reviews,app_private.currency_report_correction_checks from public,anon,authenticated,service_role;
grant select,insert on app_private.currency_report_correction_candidates to service_role;
grant select,insert,update on app_private.currency_report_correction_checks to service_role;

create function public.record_currency_report_corrections(p_currency text,p_checked_at timestamptz,p_candidates jsonb,p_coverage jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c jsonb; p public.currency_reports; n integer:=0; d integer:=0; stale integer:=0; existing jsonb; target text;
begin
 if coalesce(p_currency,'') not in ('BRL','MXN','COP','PEN','CLP','ARS') or p_checked_at is null
  or p_checked_at>clock_timestamp()+interval '5 minutes' or jsonb_typeof(p_candidates) is distinct from 'array'
  or jsonb_array_length(p_candidates)>100 or octet_length(p_candidates::text)>1600000
  or jsonb_typeof(p_coverage) is distinct from 'object' or octet_length(p_coverage::text)>12000
  or p_coverage->>'semanticComparison' is distinct from 'not_performed'
  or p_coverage->>'differentSourceContradictions' is distinct from 'not_evaluated'
  or (p_coverage-array['reportsChecked','missingSnapshotReports','unmappedEvidence','currentArticles','admittedStatistics','semanticComparison','differentSourceContradictions','issues','historyWindowLimited'])<>'{}'::jsonb then
  raise exception 'bounded correction scan required' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('currency_report_correction_capacity',0));
 for c in select value from jsonb_array_elements(p_candidates) loop
  if c->>'version' is distinct from 'published-correction/1' or c->>'currency' is distinct from p_currency
   or coalesce(c->>'key','') !~ '^[a-f0-9]{64}$' or coalesce(c->>'claimHash','') !~ '^[a-f0-9]{64}$'
   or coalesce(c->>'claimId','') !~ '^(title|summary|(drivers|implications|watch)\.[0-9]+\.(title|text)):[0-9]+$'
   or coalesce(c->>'kind','') not in ('official_value_revised','official_definition_changed','cited_source_edition_changed')
   or c->>'contentReview' is distinct from 'not_performed' or c->'publicationApproved' is distinct from 'false'::jsonb
   or c->>'detectedAt' is null or (c->>'detectedAt')::timestamptz>p_checked_at
   or length(coalesce(c->>'quote','')) not between 1 and 2000 or length(coalesce(c->>'reason','')) not between 1 and 500
   or coalesce(c->>'sourceUrl','') !~ '^https://' or length(c->>'sourceUrl')>2048
   or octet_length(c::text)>16000 or c::text ~* '(sk-or-|bearer[[:space:]]|-----BEGIN .*PRIVATE KEY|rawBase64|serializedRuntime|[?&](token|api_?key|password)=)'
   or (c-array['version','currency','reportId','claimId','claimHash','evidenceId','sourceUrl','kind','before','after','key','baseDate','quote','detectedAt','reason','contentReview','publicationApproved','testOnly'])<>'{}'::jsonb then
   raise exception 'bound correction candidate required' using errcode='22023'; end if;
  select * into p from public.currency_reports where currency=p_currency and report->>'id'=c->>'reportId' and withdrawn_at is null;
  if p.run_id is null then stale:=stale+1;continue;end if;
  target:=split_part(c->>'claimId',':',1);
  if c->>'baseDate' is distinct from p.base_date::text or c->'testOnly' is distinct from coalesce(p.report->'testOnly','false'::jsonb)
   or position(c->>'quote' in coalesce(p.report->'content'#>>string_to_array(target,'.'),''))=0
   or not exists(select 1 from jsonb_array_elements(p.report->'evidence') e where e->>'id'=c->>'evidenceId' and e->>'url'=c->>'sourceUrl') then
   raise exception 'published claim identity changed' using errcode='55000'; end if;
  select record into existing from app_private.currency_report_correction_candidates where candidate_key=c->>'key';
  if existing is not null then
   if existing-'detectedAt' is distinct from c-'detectedAt' then raise exception 'immutable correction identity changed' using errcode='22023';end if;
   d:=d+1;continue;
  end if;
  if (select coalesce(sum(octet_length(record::text)),0) from app_private.currency_report_correction_candidates)+octet_length(c::text)>50000000 then
   raise exception 'correction queue capacity hold' using errcode='54000';end if;
  insert into app_private.currency_report_correction_candidates(candidate_key,currency,public_id,record) values(c->>'key',p_currency,c->>'reportId',c);
  n:=n+1;
 end loop;
 insert into app_private.currency_report_correction_checks(currency,checked_at,coverage) values(p_currency,p_checked_at,p_coverage)
 on conflict(currency) do update set checked_at=excluded.checked_at,coverage=excluded.coverage
 where app_private.currency_report_correction_checks.checked_at<=excluded.checked_at;
 return jsonb_build_object('inserted',n,'duplicates',d,'obsolete',stale);
end;
$$;
revoke all on function public.record_currency_report_corrections(text,timestamptz,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.record_currency_report_corrections(text,timestamptz,jsonb,jsonb) to service_role;

-- Internal definers are necessary for narrowly scoped active-admin decisions;
-- browser roles receive no direct private-table privileges.
create function app_private.currency_report_corrections(p_include_test boolean,p_before timestamptz,p_before_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare items jsonb; checks jsonb; pending bigint;
begin
 if (select auth.uid()) is null or not (select app_private.is_business_plan_admin()) then
  raise exception 'active administrator access required' using errcode='42501';end if;
 select coalesce(jsonb_agg(x.item order by x.created_at desc,x.candidate_key desc),'[]') into items from
 (select c.created_at,c.candidate_key,jsonb_build_object('key',c.candidate_key,'record',c.record,'revision',c.revision,
  'createdAt',c.created_at,'status',case when p.run_id is null then 'stale_target' else c.status end,
  'lastReview',(select jsonb_build_object('decision',r.decision,'reason',r.reason,'createdAt',r.created_at)
    from app_private.currency_report_correction_reviews r where r.candidate_key=c.candidate_key order by r.revision desc limit 1)) item
  from app_private.currency_report_correction_candidates c
  left join public.currency_reports p on p.report->>'id'=c.public_id and p.currency=c.currency and p.withdrawn_at is null
  where (p_include_test or c.record->'testOnly' is distinct from 'true'::jsonb)
   and (p_before is null or (c.created_at,c.candidate_key)<(p_before,p_before_key))
  order by c.created_at desc,c.candidate_key desc limit 31) x;
 select count(*) into pending from app_private.currency_report_correction_candidates c
 where c.status='pending_review' and (p_include_test or c.record->'testOnly' is distinct from 'true'::jsonb)
  and exists(select 1 from public.currency_reports p where p.report->>'id'=c.public_id and p.currency=c.currency and p.withdrawn_at is null);
 select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'checkedAt',checked_at,'coverage',coverage) order by currency),'[]') into checks
 from app_private.currency_report_correction_checks;
 return jsonb_build_object('items',items,'pending',pending,'checks',checks);
end;
$$;
create function public.currency_report_corrections(p_include_test boolean default false,p_before timestamptz default null,p_before_key text default null)
returns jsonb language sql security invoker set search_path='' as $$select app_private.currency_report_corrections(p_include_test,p_before,p_before_key);$$;
revoke all on function app_private.currency_report_corrections(boolean,timestamptz,text),public.currency_report_corrections(boolean,timestamptz,text) from public,anon,service_role;
grant execute on function app_private.currency_report_corrections(boolean,timestamptz,text),public.currency_report_corrections(boolean,timestamptz,text) to authenticated;

create function app_private.review_currency_report_correction(p_key text,p_decision text,p_reason text,p_revision bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare c app_private.currency_report_correction_candidates;
begin
 if (select auth.uid()) is null or not (select app_private.is_business_plan_admin()) then
  raise exception 'active administrator access required' using errcode='42501';end if;
 if coalesce(p_decision,'') not in ('acknowledged','dismissed','pending_review') or length(trim(coalesce(p_reason,''))) not between 1 and 500 then
  raise exception 'explicit correction review and reason required' using errcode='22023';end if;
 select * into c from app_private.currency_report_correction_candidates where candidate_key=p_key for update;
 if c.candidate_key is null then raise exception 'correction candidate not found' using errcode='P0002';end if;
 if c.revision is distinct from p_revision then raise exception 'correction review changed; reload' using errcode='55000';end if;
 if not exists(select 1 from public.currency_reports p where p.report->>'id'=c.public_id and p.currency=c.currency and p.withdrawn_at is null) then
  raise exception 'public target changed; reload' using errcode='55000';end if;
 update app_private.currency_report_correction_candidates set status=p_decision,revision=revision+1 where candidate_key=p_key;
 insert into app_private.currency_report_correction_reviews(candidate_key,revision,decision,reason,reviewer)
 values(p_key,c.revision+1,p_decision,trim(p_reason),auth.uid());
 return c.revision+1;
end;
$$;
create function public.review_currency_report_correction(p_key text,p_decision text,p_reason text,p_revision bigint)
returns bigint language sql security invoker set search_path='' as $$select app_private.review_currency_report_correction(p_key,p_decision,p_reason,p_revision);$$;
revoke all on function app_private.review_currency_report_correction(text,text,text,bigint),public.review_currency_report_correction(text,text,text,bigint) from public,anon,service_role;
grant execute on function app_private.review_currency_report_correction(text,text,text,bigint),public.review_currency_report_correction(text,text,text,bigint) to authenticated;
notify pgrst,'reload schema';
