-- Preserve the applied migration. Guard the existing atomic review and enrich its public copy.
alter function app_private.review_currency_report(uuid,text,text) rename to review_currency_report_v1;
revoke all on function app_private.review_currency_report_v1(uuid,text,text) from public, anon, authenticated, service_role;

create function app_private.review_currency_report(p_run_id uuid, p_decision text, p_reason text default null)
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
    if r.candidate ? 'purpose' and r.candidate->>'purpose' not in ('economic_update','fx_explanation') then
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
revoke all on function app_private.review_currency_report(uuid,text,text) from public, anon, service_role;
grant execute on function app_private.review_currency_report(uuid,text,text) to authenticated;
create or replace function public.review_currency_report(p_run_id uuid,p_decision text,p_reason text default null)
returns text language sql security invoker set search_path='' as $$
  select app_private.review_currency_report(p_run_id,p_decision,p_reason);
$$;
revoke all on function public.review_currency_report(uuid,text,text) from public, anon, service_role;
grant execute on function public.review_currency_report(uuid,text,text) to authenticated;
