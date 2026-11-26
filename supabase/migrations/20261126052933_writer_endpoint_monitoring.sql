begin;

create table app_private.currency_report_writer_endpoint_monitor (
  singleton boolean primary key default true check (singleton),
  last_scheduled_run bigint,
  last_failure_key text,
  consecutive_runs integer not null default 0 check (consecutive_runs between 0 and 2)
);
alter table app_private.currency_report_writer_endpoint_monitor enable row level security;
revoke all on app_private.currency_report_writer_endpoint_monitor from public, anon, authenticated;
grant select, insert, update on app_private.currency_report_writer_endpoint_monitor to service_role;
insert into app_private.currency_report_writer_endpoint_monitor default values;

create function public.observe_currency_report_writer_endpoint(
  p_reason text, p_stage text, p_model text, p_route text, p_scheduled_run text
) returns boolean language plpgsql security invoker set search_path='' as $$
declare
  monitor app_private.currency_report_writer_endpoint_monitor;
  failure_key text;
  run_id bigint;
  requires_action boolean;
begin
  if p_scheduled_run is not null and p_scheduled_run !~ '^[1-9][0-9]{0,17}$' then
    raise exception 'invalid writer endpoint schedule identifier';
  end if;
  run_id := p_scheduled_run::bigint;
  if p_reason is not null and (
    p_reason not in ('writer_endpoint_metadata_unavailable','writer_endpoint_route_unavailable',
      'writer_endpoint_unsupported_parameters','writer_endpoint_processing_conditions',
      'writer_endpoint_price_or_input_limit','writer_endpoint_request_configuration')
    or coalesce(p_stage,'') not in ('writer','reviewer')
    or coalesce(p_model,'') !~ '^[-a-zA-Z0-9._]+/[-a-zA-Z0-9._]+$'
    or coalesce(p_route,'') !~ '^[-a-zA-Z0-9._/]{1,60}$'
  ) then
    raise exception 'invalid writer endpoint observation';
  end if;

  select * into strict monitor from app_private.currency_report_writer_endpoint_monitor where singleton for update;
  if run_id is not null and run_id < monitor.last_scheduled_run then
    return false;
  end if;

  if p_reason is null then
    update app_private.currency_report_writer_endpoint_monitor
      set last_scheduled_run=coalesce(run_id,last_scheduled_run),last_failure_key=null,consecutive_runs=0
      where singleton;
    update app_private.currency_report_storage_incidents
      set active=false,resolved_at=now(),last_seen=now(),revision=revision+1
      where active and stage='runtime' and left(reason,16)='writer_endpoint_';
    return false;
  end if;

  failure_key := encode(sha256(convert_to(p_reason||':'||p_model||':'||p_route,'UTF8')),'hex');
  if run_id is not null and run_id is distinct from monitor.last_scheduled_run then
    monitor.consecutive_runs := case when failure_key=monitor.last_failure_key then least(2,monitor.consecutive_runs+1) else 1 end;
    monitor.last_failure_key := failure_key;
    update app_private.currency_report_writer_endpoint_monitor
      set last_scheduled_run=run_id,last_failure_key=failure_key,consecutive_runs=monitor.consecutive_runs
      where singleton;
  end if;

  requires_action := p_reason not in ('writer_endpoint_metadata_unavailable','writer_endpoint_route_unavailable')
    or (monitor.last_failure_key=failure_key and monitor.consecutive_runs>=2);
  if coalesce(requires_action,false) then
    perform public.record_currency_report_storage_incident('runtime',p_reason||'_'||left(failure_key,12),false,
      jsonb_build_object('stage',p_stage,'model',p_model,'route',p_route,'category',p_reason));
  end if;
  return coalesce(requires_action,false);
end;
$$;
revoke all on function public.observe_currency_report_writer_endpoint(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.observe_currency_report_writer_endpoint(text,text,text,text,text) to service_role;
notify pgrst,'reload schema';

commit;
