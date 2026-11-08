-- Reviewable additive SQL. Not an applied production migration.
-- Export to a versioned migration with the installed CLI before release.
begin;
create table if not exists app_private.usage_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  scope text not null default 'production' check(scope in ('local','production'))
);
revoke all on app_private.usage_settings from public,anon,authenticated;
insert into app_private.usage_settings(singleton) values(true) on conflict do nothing;
create table if not exists public.app_usage_daily (
  day date not null,
  scope text not null check(scope in ('local','production')),
  event text not null check(event in ('page_view','report_open','report_30s','evidence_open','dashboard_report')),
  screen text not null check(screen in ('dashboard','trends','reports')),
  currency text not null default '' check(currency in ('','BRL','MXN','CLP','COP','PEN','ARS')),
  report_id text not null default '' check(length(report_id)<=120),
  count bigint not null default 1 check(count between 1 and 1000000000),
  primary key(day,scope,event,screen,currency,report_id)
);
alter table public.app_usage_daily enable row level security;
revoke all on public.app_usage_daily from public,anon,authenticated,service_role;
grant select on public.app_usage_daily to authenticated;
grant select,insert,update,delete on public.app_usage_daily to service_role;
drop policy if exists "Active admins read usage" on public.app_usage_daily;
create policy "Active admins read usage" on public.app_usage_daily for select to authenticated
using ((select app_private.is_business_plan_admin()));

-- Explicit anonymous counter endpoint: accepts only fixed public dimensions.
-- It cannot read aggregates, write originals or accept arbitrary user content.
create or replace function public.record_app_usage(
 p_event text,p_screen text,p_currency text default '',p_report_id text default '',p_scope text default 'production'
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_scope text; v_enabled boolean;
begin
 if (select auth.uid()) is not null then return false; end if;
 select enabled,scope into v_enabled,v_scope from app_private.usage_settings where singleton;
 if not coalesce(v_enabled,false) or p_scope is distinct from v_scope then return false; end if;
 if p_event is null or p_event not in ('page_view','report_open','report_30s','evidence_open','dashboard_report')
  or p_screen is null or p_screen not in ('dashboard','trends','reports')
  or p_currency is null or p_currency not in ('','BRL','MXN','CLP','COP','PEN','ARS')
  or p_report_id is null or length(p_report_id)>120
  or p_report_id<>'' and p_report_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]*$'
 then raise exception using errcode='22023',message='invalid_usage_dimension'; end if;
 if p_event in ('report_open','report_30s','evidence_open','dashboard_report')
  and (p_screen<>'reports' or p_currency='') then
  raise exception using errcode='22023',message='invalid_usage_context';
 end if;
 if p_event in ('report_open','report_30s','evidence_open') and p_report_id=''
 then raise exception using errcode='22023',message='public_report_required'; end if;
 if p_report_id<>'' and not exists (
  select 1 from public.currency_report_summaries s where s.public_id=p_report_id and s.currency=p_currency and coalesce(s.test_only,false)=false
 ) then return false; end if;
 insert into public.app_usage_daily(day,scope,event,screen,currency,report_id,count)
 values((now() at time zone 'UTC')::date,v_scope,p_event,p_screen,p_currency,p_report_id,1)
 on conflict(day,scope,event,screen,currency,report_id) do update
 set count=least(public.app_usage_daily.count+1,1000000000);
 return true;
end;
$$;
revoke all on function public.record_app_usage(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_app_usage(text,text,text,text,text) to anon;
comment on table public.app_usage_daily is 'Anonymous daily counters only. No user ID, IP, URL, user agent or event log. UTC. Admin read only.';
notify pgrst,'reload schema';
commit;
