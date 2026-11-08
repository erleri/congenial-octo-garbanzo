-- Additive public identity/state projection. No old bodies or private runs exposed.
create sequence app_private.currency_public_state_seq;
create table public.currency_report_public_states (
 public_id text primary key check(public_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'),
 currency text not null check(currency in ('BRL','MXN','CLP','COP','PEN','ARS')),
 base_date date not null,
 state text not null check(state in ('active','superseded','withdrawn')),
 state_version bigint not null default nextval('app_private.currency_public_state_seq'),
 published_at timestamptz,
 changed_at timestamptz not null default now(),
 revision_kind text check(revision_kind in ('correction','editorial','replacement')),
 report_kind text check(report_kind in ('movement','periodic')),
 test_only boolean not null default false
);
alter table public.currency_report_public_states enable row level security;
revoke all on public.currency_report_public_states from public,anon,authenticated,service_role;
grant select on public.currency_report_public_states to anon,authenticated,service_role;
create policy "Read published identities only" on public.currency_report_public_states
 for select to anon,authenticated using(true);
create index currency_public_state_date_idx on public.currency_report_public_states(currency,base_date);
create unique index currency_public_active_idx on public.currency_report_public_states(currency,base_date) where state='active';

-- Preflight fails rather than altering a pre-existing identity.
do $$ begin
 if exists(select 1 from public.currency_reports where report->>'id' is null
  or report->>'id' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$')
  or exists(select 1 from public.currency_reports group by report->>'id' having count(*)>1) then
  raise exception 'public identity preflight required';
 end if;
end $$;
insert into public.currency_report_public_states(public_id,currency,base_date,state,published_at,changed_at,test_only)
 select report->>'id',currency,base_date,case when withdrawn_at is null then 'active' else 'withdrawn' end,
 published_at,coalesce(withdrawn_at,published_at),coalesce(report->'testOnly'='true'::jsonb,false)
 from public.currency_reports;

create function app_private.track_currency_public_state() returns trigger
language plpgsql security definer set search_path='' as $$
declare identity text:=new.report->>'id'; previous text;
begin
 if tg_op='UPDATE' then previous:=old.report->>'id'; end if;
 if exists(select 1 from public.currency_report_public_states s where s.public_id=identity
  and (s.currency<>new.currency or s.base_date<>new.base_date)) then
  raise exception 'public identity already belongs to another report' using errcode='22023';
 end if;
 if tg_op='UPDATE' and previous<>identity then
  update public.currency_report_public_states set state='superseded',changed_at=now(),
   state_version=nextval('app_private.currency_public_state_seq') where public_id=previous;
 end if;
 if not exists(select 1 from public.currency_report_public_states where public_id=identity) then
  insert into public.currency_report_public_states(public_id,currency,base_date,state,published_at,revision_kind,report_kind,test_only)
   values(identity,new.currency,new.base_date,case when new.withdrawn_at is null then 'active' else 'withdrawn' end,new.published_at,
    case when previous is not null and previous<>identity then coalesce(nullif(current_setting('app.fx_report_revision',true),''),'replacement') end,
    nullif(current_setting('app.fx_report_kind',true),''),coalesce(new.report->'testOnly'='true'::jsonb,false));
 elsif new.withdrawn_at is not null then
  update public.currency_report_public_states set state='withdrawn',changed_at=new.withdrawn_at,
   state_version=nextval('app_private.currency_public_state_seq') where public_id=identity and state='active';
 elsif exists(select 1 from public.currency_report_public_states where public_id=identity and state<>'active') then
  raise exception 'removed immutable identity cannot be republished' using errcode='55000';
 end if;
 -- Existing approval appends safe metadata after the initial insert in the same transaction.
 update public.currency_report_public_states set test_only=coalesce(new.report->'testOnly'='true'::jsonb,false),
  state_version=nextval('app_private.currency_public_state_seq')
  where public_id=identity and test_only is distinct from coalesce(new.report->'testOnly'='true'::jsonb,false);
 return new;
end $$;
revoke all on function app_private.track_currency_public_state() from public,anon,authenticated,service_role;
create trigger currency_report_track_public_state after insert or update on public.currency_reports
 for each row execute function app_private.track_currency_public_state();

create view public.currency_report_summaries with(security_invoker=true) as
 select p.currency,p.base_date,s.public_id,s.state_version,s.revision_kind,s.report_kind,p.published_at,
 p.report->>'observedDate' as observed_date,p.report->>'generationMode' as generation_mode,
 p.report->>'purpose' as purpose,p.report->'historicalReview'='true'::jsonb as historical_review,
 coalesce(p.report->'testOnly'='true'::jsonb,false) as test_only,
 p.report->'content'->>'title' as title,p.report->'content'->>'summary' as summary
 from public.currency_reports p join public.currency_report_public_states s
 on s.public_id=p.report->>'id' and s.currency=p.currency and s.base_date=p.base_date
 where p.withdrawn_at is null and s.state='active';
revoke all on public.currency_report_summaries from public,anon,authenticated,service_role;
grant select on public.currency_report_summaries to anon,authenticated,service_role;

create function public.currency_report_periods(p_currency text,p_include_test boolean default false)
returns table(period text) language sql stable security invoker set search_path='' as $$
 select distinct to_char(base_date,'YYYY-MM') from public.currency_report_summaries
 where currency=p_currency and (p_include_test or not test_only) order by 1 desc;
$$;
revoke all on function public.currency_report_periods(text,boolean) from public;
grant execute on function public.currency_report_periods(text,boolean) to anon,authenticated,service_role;

-- One database snapshot for identity/state/body. The replaced body is never returned.
create function public.resolve_currency_report(p_currency text,p_date date default null,p_public_id text default null,p_include_test boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare s public.currency_report_public_states; replacement jsonb; body jsonb;
begin
 if p_public_id is not null then
  select * into s from public.currency_report_public_states where public_id=p_public_id
   and currency=p_currency and (p_date is null or base_date=p_date) and (p_include_test or not test_only);
 else
  select t.* into s from public.currency_report_public_states t
   where t.currency=p_currency and t.base_date=p_date and (p_include_test or not t.test_only)
   order by (t.state='active') desc,t.state_version desc limit 1;
 end if;
 if s.public_id is null then return jsonb_build_object('state','not_found'); end if;
 if s.state='active' then
  select report into body from public.currency_reports where currency=s.currency and base_date=s.base_date
   and report->>'id'=s.public_id and withdrawn_at is null;
  if body is null then raise exception 'public state/body mismatch'; end if;
 else
  select jsonb_build_object('id',x.public_id,'currency',x.currency,'baseDate',x.base_date) into replacement
   from public.currency_report_public_states x where x.currency=s.currency and x.base_date=s.base_date
    and x.state='active' and (p_include_test or not x.test_only);
 end if;
 return jsonb_build_object('state',s.state,'id',s.public_id,'currency',s.currency,'baseDate',s.base_date,
  'version',s.state_version,'publishedAt',s.published_at,'changedAt',s.changed_at,'revisionKind',s.revision_kind,
  'reportKind',s.report_kind,'replacement',replacement,'report',body);
end $$;
revoke all on function public.resolve_currency_report(text,date,text,boolean) from public;
grant execute on function public.resolve_currency_report(text,date,text,boolean) to anon,authenticated,service_role;

create function app_private.review_currency_report_version(p_run_id uuid,p_decision text,p_reason text,
 p_expected_public_id text,p_revision_kind text,p_report_kind text) returns text
language plpgsql security definer set search_path='' as $$
declare r public.currency_report_runs; current_id text;
begin
 if (select auth.uid()) is null or not (select app_private.is_business_plan_admin()) then
  raise exception 'active administrator access required' using errcode='42501';
 end if;
 select * into r from public.currency_report_runs where id=p_run_id;
 if r.id is null then raise exception 'report run not found' using errcode='P0002'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.currency||':'||r.base_date::text,0));
 if p_decision='approved' and r.status<>'pending_review' then
  return app_private.review_currency_report(p_run_id,p_decision,p_reason);
 end if;
 if p_decision='approved' then
  select report->>'id' into current_id from public.currency_reports where currency=r.currency and base_date=r.base_date;
  if current_id is distinct from p_expected_public_id then
   raise exception 'public report changed; reload before approval' using errcode='55000';
  end if;
  if current_id is not null and (p_revision_kind is null or p_revision_kind not in ('correction','editorial','replacement')) then
   raise exception 'explicit replacement classification required' using errcode='22023';
  end if;
  if p_report_kind is not null and p_report_kind not in ('movement','periodic') then
   raise exception 'invalid publication kind' using errcode='22023';
  end if;
  if exists(select 1 from public.currency_report_public_states where public_id=r.candidate->>'id') then
   raise exception 'published identity is immutable; use a new report id' using errcode='55000';
  end if;
  perform set_config('app.fx_report_revision',coalesce(p_revision_kind,''),true);
  perform set_config('app.fx_report_kind',coalesce(p_report_kind,
   case when p_revision_kind in ('correction','editorial') then
    (select report_kind from public.currency_report_public_states where public_id=current_id) end,''),true);
 end if;
 return app_private.review_currency_report(p_run_id,p_decision,p_reason);
end $$;
revoke all on function app_private.review_currency_report_version(uuid,text,text,text,text,text) from public,anon,authenticated,service_role;
create function public.review_currency_report_version(p_run_id uuid,p_decision text,p_reason text default null,
 p_expected_public_id text default null,p_revision_kind text default null,p_report_kind text default null)
returns text language sql security invoker set search_path='' as $$
 select app_private.review_currency_report_version(p_run_id,p_decision,p_reason,p_expected_public_id,p_revision_kind,p_report_kind);
$$;
revoke all on function public.review_currency_report_version(uuid,text,text,text,text,text) from public,anon,service_role;
grant execute on function app_private.review_currency_report_version(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.review_currency_report_version(uuid,text,text,text,text,text) to authenticated;
-- Preserve initial approve/reject/withdraw callers; silent replacement is no longer allowed.
create or replace function public.review_currency_report(p_run_id uuid,p_decision text,p_reason text default null)
returns text language sql security invoker set search_path='' as $$
 select app_private.review_currency_report_version(p_run_id,p_decision,p_reason,null,null,null);
$$;
notify pgrst,'reload schema';
