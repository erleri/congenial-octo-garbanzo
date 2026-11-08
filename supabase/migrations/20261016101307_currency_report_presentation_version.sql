-- Additive display-only metadata. Approval, scores and grants remain unchanged.
create function app_private.preserve_currency_report_presentation()
returns trigger language plpgsql security invoker set search_path='' as $$
declare candidate jsonb;
begin
  select r.candidate into candidate from public.currency_report_runs r where r.id=new.run_id;
  new.report := new.report - 'presentationVersion';
  if candidate->>'presentationVersion'='monthly-facts/1' then
    new.report := new.report || jsonb_build_object('presentationVersion','monthly-facts/1');
  end if;
  return new;
end;
$$;
revoke all on function app_private.preserve_currency_report_presentation() from public,anon,authenticated,service_role;
create trigger currency_report_presentation before insert or update on public.currency_reports
  for each row execute function app_private.preserve_currency_report_presentation();
