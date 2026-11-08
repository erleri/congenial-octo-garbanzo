-- Local-first, additive provenance. No grants or publication criteria changed.
create or replace function app_private.preserve_currency_report_authorship()
returns trigger language plpgsql security invoker set search_path='' as $$
declare candidate jsonb;
begin
  select r.candidate into candidate from public.currency_report_runs r where r.id=new.run_id;
  new.report := new.report - 'authorship' - 'historicalReview';
  if candidate->>'authorship'='ai_with_manual_edit' then
    new.report := new.report || jsonb_build_object('authorship','ai_with_manual_edit');
  end if;
  if candidate->'comparison'->'historicalReview'='true'::jsonb
    or (candidate->'comparison'->'editorialRevision'='true'::jsonb
      and candidate->'comparison'->'historicalReview' is distinct from 'false'::jsonb) then
    new.report := new.report || jsonb_build_object('historicalReview',true);
  end if;
  return new;
end;
$$;
revoke all on function app_private.preserve_currency_report_authorship() from public,anon,authenticated,service_role;
create trigger currency_report_authorship before insert or update on public.currency_reports
  for each row execute function app_private.preserve_currency_report_authorship();
