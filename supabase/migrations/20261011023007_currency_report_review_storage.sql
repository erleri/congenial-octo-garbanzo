-- Additive currency-specific storage. The existing multi-currency reports remain intact.
create table public.currency_report_runs (
  id uuid primary key default gen_random_uuid(),
  currency text not null check (currency in ('BRL','CLP','MXN')),
  base_date date not null,
  attempt integer not null check (attempt > 0),
  rule_version text not null,
  event_binding text not null,
  status text not null default 'pending_review' check (status in ('pending_review','published','rejected','withdrawn','failed')),
  packet jsonb not null,
  candidate jsonb not null,
  validation jsonb not null,
  cost jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(currency, base_date, attempt)
);
create table public.currency_report_reviews (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.currency_report_runs(id),
  decision text not null check (decision in ('approved','rejected','withdrawn')),
  reason text check (char_length(reason) <= 500),
  reviewer_email text not null,
  reviewed_at timestamptz not null default now(),
  unique(run_id, decision)
);
create table public.currency_reports (
  currency text not null check (currency in ('BRL','CLP','MXN')),
  base_date date not null,
  run_id uuid not null unique references public.currency_report_runs(id),
  report jsonb not null,
  withdrawn_at timestamptz,
  published_at timestamptz not null default now(),
  primary key(currency, base_date)
);
create index currency_report_pending_idx on public.currency_report_runs(created_at, id) where status = 'pending_review';
create index currency_report_history_idx on public.currency_report_runs(currency, base_date desc, created_at desc, id);
alter table public.currency_report_runs enable row level security;
alter table public.currency_report_reviews enable row level security;
alter table public.currency_reports enable row level security;
revoke all on public.currency_report_runs, public.currency_report_reviews, public.currency_reports from public, anon, authenticated, service_role;
revoke all on sequence public.currency_report_reviews_id_seq from public, anon, authenticated, service_role;
grant select on public.currency_report_runs, public.currency_report_reviews to authenticated;
grant select on public.currency_reports to anon, authenticated;
grant select, insert on public.currency_report_runs to service_role;
grant select on public.currency_report_reviews, public.currency_reports to service_role;
create policy "Admins read currency runs" on public.currency_report_runs for select to authenticated using ((select app_private.is_business_plan_admin()));
create policy "Admins read currency reviews" on public.currency_report_reviews for select to authenticated using ((select app_private.is_business_plan_admin()));
create policy "Visible currency reports" on public.currency_reports for select to anon, authenticated using (withdrawn_at is null);

create function app_private.public_currency_claim(p jsonb) returns jsonb
language sql immutable security invoker set search_path = '' as $$
  select jsonb_build_object('title', p->'title', 'text', p->'text', 'kind', p->'kind', 'factIds', p->'factIds', 'evidenceIds', p->'evidenceIds');
$$;
revoke all on function app_private.public_currency_claim(jsonb) from public, anon, authenticated;

create function app_private.review_currency_report(p_run_id uuid, p_decision text, p_reason text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  r public.currency_report_runs;
  sanitized jsonb;
  c jsonb;
  v_email text := lower((select auth.jwt())->>'email');
begin
  if (select auth.uid()) is null or v_email is null or not (select app_private.is_business_plan_admin()) then
    raise exception 'active administrator access required' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved','rejected','withdrawn') then
    raise exception 'invalid review decision' using errcode = '22023';
  end if;
  select * into r from public.currency_report_runs where id=p_run_id for update;
  if r.id is null then raise exception 'report run not found' using errcode='P0002'; end if;
  if (p_decision='withdrawn' and r.status<>'published') or (p_decision<>'withdrawn' and r.status<>'pending_review') then
    raise exception 'report run is no longer reviewable' using errcode='55000';
  end if;
  if p_decision='approved' then
    if r.validation->>'structureValid' is distinct from 'true' or r.validation->>'contentReview' is distinct from 'passed'
      or r.validation->>'criticalErrors' is distinct from '0'
      or jsonb_typeof(r.validation->'qualityAverage') is distinct from 'number'
      or jsonb_typeof(r.validation->'evidenceScore') is distinct from 'number'
      or (r.validation->>'qualityAverage')::numeric < 4 or (r.validation->>'qualityAverage')::numeric > 5
      or (r.validation->>'evidenceScore')::numeric < 4 or (r.validation->>'evidenceScore')::numeric > 5 then
      raise exception 'content validation required' using errcode='22023';
    end if;
    c := r.candidate->'content';
    if r.candidate->>'schemaVersion' is distinct from 'currency-report/1'
      or r.candidate->>'currency' is distinct from r.currency
      or r.candidate->>'baseDate' is distinct from r.base_date::text
      or r.candidate->>'generationMode' is distinct from 'ai_enhanced'
      or jsonb_typeof(c) is distinct from 'object'
      or jsonb_typeof(c->'title') is distinct from 'string' or nullif(trim(c->>'title'),'') is null
      or jsonb_typeof(c->'summary') is distinct from 'string' or nullif(trim(c->>'summary'),'') is null
      or jsonb_typeof(c->'change') is distinct from 'object'
      or jsonb_typeof(c->'drivers') is distinct from 'array'
      or jsonb_typeof(c->'implications') is distinct from 'array'
      or jsonb_typeof(c->'watch') is distinct from 'array'
      or jsonb_typeof(c->'limitations') is distinct from 'array'
      or jsonb_typeof(r.candidate->'evidence') is distinct from 'array'
      or jsonb_typeof(r.candidate->'facts') is distinct from 'array'
      or jsonb_typeof(r.candidate->'series') is distinct from 'array' then
      raise exception 'candidate identity or schema mismatch' using errcode='22023';
    end if;
    sanitized := jsonb_build_object(
      'id',r.candidate->'id','schemaVersion','currency-report/1','currency',r.currency,'baseDate',r.base_date,
      'observedDate',r.candidate->'observedDate','observationAt',r.candidate->'observationAt',
      'publishedAt',now(),'status','approved','generationMode','ai_enhanced',
      'content',jsonb_build_object('title',c->'title','summary',c->'summary','change',app_private.public_currency_claim(c->'change'),
        'drivers',(select coalesce(jsonb_agg(app_private.public_currency_claim(x)),'[]') from jsonb_array_elements(c->'drivers') x),
        'implications',(select coalesce(jsonb_agg(app_private.public_currency_claim(x)),'[]') from jsonb_array_elements(c->'implications') x),
        'watch',(select coalesce(jsonb_agg(app_private.public_currency_claim(x)),'[]') from jsonb_array_elements(c->'watch') x),'limitations',c->'limitations'),
      'facts',(select coalesce(jsonb_agg(jsonb_build_object('id',x->'id','value',x->'value','label',x->'label')),'[]') from jsonb_array_elements(r.candidate->'facts') x),
      'series',(select coalesce(jsonb_agg(jsonb_build_object('date',x->'date','value',x->'value')),'[]') from jsonb_array_elements(r.candidate->'series') x),
      'evidence',(select coalesce(jsonb_agg(jsonb_build_object('id',x->'id','country',x->'country','title',x->'title','publisher',x->'publisher','url',x->'url','publishedAt',x->'publishedAt','eventDate',x->'eventDate','period',x->'period','collectedAt',x->'collectedAt','summary',x->'summary','provenance',x->'provenance')),'[]') from jsonb_array_elements(r.candidate->'evidence') x),
      'limitations',r.candidate->'limitations');
    if sanitized::text ~* '(sk-or-|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})' then
      raise exception 'private data in candidate' using errcode='22023';
    end if;
    insert into public.currency_reports(currency,base_date,run_id,report) values(r.currency,r.base_date,r.id,sanitized)
      on conflict(currency,base_date) do update set run_id=excluded.run_id,report=excluded.report,withdrawn_at=null,published_at=now();
  elsif p_decision='withdrawn' then
    if nullif(trim(p_reason),'') is null then raise exception 'withdrawal reason required' using errcode='22023'; end if;
    update public.currency_reports set withdrawn_at=now() where run_id=r.id;
  end if;
  insert into public.currency_report_reviews(run_id,decision,reason,reviewer_email) values(r.id,p_decision,nullif(trim(p_reason),''),v_email);
  update public.currency_report_runs set status=case p_decision when 'approved' then 'published' else p_decision end where id=r.id;
  return case p_decision when 'approved' then 'published' else p_decision end;
end;
$$;
revoke all on function app_private.review_currency_report(uuid,text,text) from public, anon, authenticated;
grant execute on function app_private.review_currency_report(uuid,text,text) to authenticated;
create function public.review_currency_report(p_run_id uuid,p_decision text,p_reason text default null)
returns text language sql security invoker set search_path='' as $$
  select app_private.review_currency_report(p_run_id,p_decision,p_reason);
$$;
revoke all on function public.review_currency_report(uuid,text,text) from public, anon;
grant execute on function public.review_currency_report(uuid,text,text) to authenticated;
comment on table public.currency_reports is 'Approved sanitized currency reports; withdrawn rows are hidden without deleting audit history.';
