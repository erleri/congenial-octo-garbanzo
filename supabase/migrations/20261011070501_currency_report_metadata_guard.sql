-- Enforce the same public metadata boundary for every publication path.
create function app_private.guard_currency_report_metadata()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
  m jsonb := new.report->'marketData';
  fetched text := m->>'fetchedAt';
begin
  if m is not null then
    if fetched is not null then
      if fetched !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then
        fetched := null;
      else
        begin
          perform fetched::timestamptz;
        exception when invalid_datetime_format or datetime_field_overflow then fetched := null;
        end;
      end if;
    end if;
    new.report := jsonb_set(new.report,'{marketData}',jsonb_build_object('fetchedAt',fetched,
      'source',case when m->>'source' in ('API','JSON','EXCEL') then m->>'source' else 'UNKNOWN' end,
      'rateType','LOCAL_PER_USD'));
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_currency_report_metadata() from public,anon,authenticated,service_role;
create trigger currency_report_public_metadata_guard before insert or update on public.currency_reports
  for each row execute function app_private.guard_currency_report_metadata();
