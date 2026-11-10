begin;
-- Additive KST counters. Legacy UTC counters remain untouched and separate.
alter table app_private.usage_settings add column v2_enabled boolean not null default false;
alter table app_private.usage_settings add column v2_activated_at timestamptz;
create function app_private.track_usage_activation() returns trigger language plpgsql set search_path='' as $$
begin
 if new.enabled and new.v2_enabled and not(old.enabled and old.v2_enabled) then
  new.v2_activated_at=now();
 end if;
 return new;
end;$$;
revoke all on function app_private.track_usage_activation() from public,anon,authenticated;
create trigger usage_activation before update on app_private.usage_settings for each row execute function app_private.track_usage_activation();

create table app_private.app_usage_daily_v2(
 day date not null,scope text not null check(scope in ('production','local','verification')),
 event text not null check(event in ('page_view','email_entry','report_open','report_30s','evidence_open','dashboard_report')),
 screen text not null check(screen in ('dashboard','trends','reports')),
 view text not null default '' check(view in ('','daily','monthly','comparison')),
 currency text not null default '' check(currency in ('','BRL','MXN','COP','PEN','CLP','ARS')),
 report_id text not null default '' check(length(report_id)<=200),
 entry_source text not null check(entry_source in ('email','direct_or_unknown')),
 count bigint not null default 1 check(count between 1 and 1000000000),
 primary key(day,scope,event,screen,view,currency,report_id,entry_source)
);
alter table app_private.app_usage_daily_v2 enable row level security;
revoke all on app_private.app_usage_daily_v2 from public,anon,authenticated;
grant select,insert,update on app_private.app_usage_daily_v2 to service_role;
comment on table app_private.app_usage_daily_v2 is 'KST aggregate v2; no identity, IP, URL, referrer, device or individual event records. Verification scope never appears in production summaries.';

create function public.record_app_usage_v2(p_event text,p_screen text,p_currency text default '',p_report_id text default '',
 p_view text default '',p_entry_source text default 'direct_or_unknown',p_scope text default 'production')
returns boolean language plpgsql security definer set search_path='' as $$
declare settings app_private.usage_settings;
begin
 if auth.uid() is not null then return false;end if;
 select * into settings from app_private.usage_settings where singleton;
 if not coalesce(settings.enabled and settings.v2_enabled,false) or p_scope is distinct from settings.scope then return false;end if;
 if p_event is null or p_event not in ('page_view','email_entry','report_open','report_30s','evidence_open','dashboard_report')
  or p_screen is null or p_screen not in ('dashboard','trends','reports')
  or p_currency is null or p_currency not in ('','BRL','MXN','COP','PEN','CLP','ARS')
  or p_view is null or p_view not in ('','daily','monthly','comparison')
  or p_entry_source is null or p_entry_source not in ('email','direct_or_unknown')
  or p_report_id is null or length(p_report_id)>200 or p_report_id<>'' and p_report_id!~'^[A-Za-z0-9][A-Za-z0-9._-]*$'
  or p_scope is null or p_scope not in ('production','local') then raise exception 'invalid_usage_dimension';end if;
 if p_view<>'' and p_screen<>'trends' or p_event='email_entry' and p_entry_source<>'email'
  or p_event in ('report_open','report_30s','evidence_open','dashboard_report') and (p_screen<>'reports' or p_currency='')
  or p_event in ('report_open','report_30s','evidence_open') and p_report_id=''
 then raise exception 'invalid_usage_context';end if;
 if p_report_id<>'' and not exists(select 1 from public.currency_report_summaries where public_id=p_report_id and currency=p_currency and not test_only) then return false;end if;
 insert into app_private.app_usage_daily_v2(day,scope,event,screen,view,currency,report_id,entry_source)
 values((now() at time zone 'Asia/Seoul')::date,p_scope,p_event,p_screen,p_view,p_currency,p_report_id,p_entry_source)
 on conflict(day,scope,event,screen,view,currency,report_id,entry_source) do update
 set count=least(app_private.app_usage_daily_v2.count+1,1000000000);
 return true;
end;$$;
revoke all on function public.record_app_usage_v2(text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_app_usage_v2(text,text,text,text,text,text,text) to anon;

create function public.admin_app_usage_v2(p_days integer default 30,p_page integer default 0,p_scope text default 'production')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare settings app_private.usage_settings; today date=(now() at time zone 'Asia/Seoul')::date; answer jsonb;
begin
 if auth.uid() is null or not app_private.is_business_plan_admin() then raise insufficient_privilege;end if;
 if p_days is null or p_days not in (7,30) or p_page is null or p_page<0 or p_page>100000
  or p_scope is null or p_scope not in ('production','local') then raise exception 'invalid_usage_period';end if;
 select * into settings from app_private.usage_settings where singleton;
 with period as materialized (
  select * from app_private.app_usage_daily_v2 where scope=p_scope and day between today-(p_days-1) and today
 ), totals as (select event,sum(count) as count from period group by event),
 daily as (select day,event,sum(count) as count from period group by day,event),
 dimensions as (select screen,view,currency,sum(count) as count from period where event='page_view' group by screen,view,currency),
 reports as (
  select report_id,currency,
   coalesce(sum(count) filter(where event='report_open'),0) as opens,
   coalesce(sum(count) filter(where event='report_30s'),0) as dwell,
   coalesce(sum(count) filter(where event='evidence_open'),0) as evidence,
   coalesce(sum(count) filter(where event='report_open' and entry_source='email'),0) as email
  from period where report_id<>'' group by report_id,currency
 ), report_page as (
  select r.*,s.title,s.base_date,s.public_id is not null as available from reports r
  left join public.currency_report_summaries s on s.public_id=r.report_id and s.currency=r.currency
  order by r.opens desc,r.report_id limit 20 offset p_page*20
 )
 select jsonb_build_object('version',2,'timezone','Asia/Seoul','enabled',settings.enabled and settings.v2_enabled and settings.scope=p_scope,
  'activatedAt',settings.v2_activated_at,'from',today-(p_days-1),'to',today,
  'latestDay',(select max(day) from app_private.app_usage_daily_v2 where scope=p_scope),
  'totals',coalesce((select jsonb_object_agg(event,count) from totals),'{}'),
  'daily',coalesce((select jsonb_agg(d order by day,event) from daily d),'[]'),
  'dimensions',coalesce((select jsonb_agg(d order by count desc,screen,view,currency) from dimensions d),'[]'),
  'reportTotal',(select count(*) from reports),'page',p_page,
  'reports',coalesce((select jsonb_agg(r) from report_page r),'[]')) into answer;
 return answer;
end;$$;
revoke all on function public.admin_app_usage_v2(integer,integer,text) from public,anon,authenticated;
grant execute on function public.admin_app_usage_v2(integer,integer,text) to authenticated;
alter table app_private.currency_report_storage_incidents drop constraint currency_report_storage_incidents_stage_check;
alter table app_private.currency_report_storage_incidents add constraint currency_report_storage_incidents_stage_check check(stage in ('preflight','write','restore','link','endpoint'));
create or replace function public.record_currency_report_storage_incident(p_stage text,p_reason text,p_healthy boolean,p_stats jsonb default '{}') returns boolean
language plpgsql security invoker set search_path='' as $$
declare key text;clean jsonb;
begin
 if p_stage is null or p_stage not in ('preflight','write','restore','link','endpoint') or p_healthy is null then raise exception 'storage incident stage required';end if;
 if p_healthy then
  update app_private.currency_report_storage_incidents set active=false,resolved_at=now(),last_seen=now(),revision=revision+1 where active and stage=p_stage;
  return true;
 end if;
 if p_reason is null or p_reason!~'^[a-z0-9_]{1,160}$' then raise exception 'sanitized storage reason required';end if;
 key:=encode(sha256(convert_to('frozen-storage:'||p_stage||':'||p_reason,'UTF8')),'hex');
 -- Allowlisted size statistics and sanitized endpoint identifiers only.
 select coalesce(jsonb_object_agg(k,v),'{}') into clean from jsonb_each(p_stats) e(k,v)
 where k in ('rawBytes','compressedBytes','manifestBytes','newBytes','reusedBytes') and jsonb_typeof(v)='number'
 or k in ('model','route','category','stage','checkedAt','metadataHash') and jsonb_typeof(v)='string'
 and (v#>>'{}') ~ '^[A-Za-z0-9_./:+-]{1,100}$';
 insert into app_private.currency_report_storage_incidents(id,stage,reason,stats) values(key,p_stage,p_reason,clean)
 on conflict(id) do update set active=true,last_seen=now(),resolved_at=null,occurrences=app_private.currency_report_storage_incidents.occurrences+1,
 revision=app_private.currency_report_storage_incidents.revision+case when app_private.currency_report_storage_incidents.active then 0 else 1 end,stats=excluded.stats;
 return true;
end;$$;
create or replace function app_private.currency_report_review_items()
returns table(kind text,id text,version text,currency text,base_date date,title text,summary text,reason text,created_at timestamptz,target_id text)
language sql stable security invoker set search_path='' as $$
 select * from app_private.currency_report_review_items_before_storage()
 union all
 select 'incident',i.id,encode(sha256(convert_to(i.id||':'||i.revision,'UTF8')),'hex'),null::text,null::date,
 case when i.stage='endpoint' then '모델 처리 전 기술 보류' else '자동 리포트 입력 저장·복원 확인' end,'기술 장애로 새 리포트 처리가 중단됐습니다. 기존 공개 리포트와 환율은 유지됩니다.',
 i.stage||' · '||i.reason,i.first_seen,i.id
 from app_private.currency_report_storage_incidents i where i.active;
$$;

notify pgrst,'reload schema';
commit;
