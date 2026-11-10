begin;
set local search_path=public,extensions,pg_catalog;
select no_plan();
select ok(not has_function_privilege('anon','public.admin_app_usage_v2(integer,integer,text)','execute'),'anonymous cannot read summaries');
select ok(not has_function_privilege('authenticated','public.record_app_usage_v2(text,text,text,text,text,text,text)','execute'),'signed in cannot write counters');
select ok(not has_table_privilege('anon','app_private.app_usage_daily_v2','select'),'raw counter read forbidden');
update app_private.usage_settings set enabled=false,scope='local',v2_enabled=false;
set local role anon;
select is(public.record_app_usage_v2('page_view','dashboard','','','','email','local'),false,'disabled gate');
reset role;
update app_private.usage_settings set enabled=true,v2_enabled=true;
select ok((select v2_activated_at is not null from app_private.usage_settings),'activation recorded');
insert into public.currency_report_runs(id,currency,base_date,attempt,rule_version,event_binding,status,packet,candidate,validation,storage_required)
select gen_random_uuid(),c,'2026-10-14',9901,'synthetic-mail-sql/1','synthetic-mail-sql',
 case when c='MXN' then 'pending_review' else 'published' end,'{}',
 jsonb_build_object('id','mail-sql-'||c,'currency',c,'baseDate','2026-10-14','status',case when c='ARS' then 'draft' else 'approved' end,
  'purpose','periodic_check','testOnly',c='COP','comparison',jsonb_build_object('historicalReview',c='PEN'),
  'content',jsonb_build_object('title','Synthetic','summary','Synthetic approved summary',
   'change',jsonb_build_object('title','Synthetic','text','Synthetic','kind','fact','factIds','[]'::jsonb,'evidenceIds','[]'::jsonb),
   'drivers','[]'::jsonb,'implications','[]'::jsonb,'watch','[]'::jsonb,'limitations','[]'::jsonb),
  'facts','[]'::jsonb,'series','[]'::jsonb,'evidence','[]'::jsonb,'limitations','[]'::jsonb),
 '{}'::jsonb,false from unnest(array['BRL','MXN','CLP','COP','ARS','PEN'])c;
insert into public.currency_report_reviews(run_id,decision,reviewer_email)
 select id,'approved','fixture@example.invalid' from public.currency_report_runs where event_binding='synthetic-mail-sql' and currency<>'MXN';
insert into public.currency_reports(currency,base_date,run_id,report,published_at)
 select currency,base_date,id,candidate,case when currency='CLP' then '2026-10-16T00:00:00Z'::timestamptz else '2026-10-14T00:00:00Z'::timestamptz end
 from public.currency_report_runs where event_binding='synthetic-mail-sql';

set local role anon;
select is(public.record_app_usage_v2('page_view','dashboard','','','','email','local'),true,'valid anonymous view');
select is(public.record_app_usage_v2('email_entry','dashboard','','','','email','local'),true,'email entry separate');
select is(public.record_app_usage_v2('report_open','reports','CLP','mail-sql-CLP','','email','local'),true,'public report counted');
select is(public.record_app_usage_v2('report_open','reports','COP','mail-sql-COP','','email','local'),false,'test report excluded');
select is(public.record_app_usage_v2('report_open','reports','CLP','private-draft','','email','local'),false,'non-public report excluded');
select is(public.record_app_usage_v2('page_view','dashboard','','','','email','verification'),false,'anonymous cannot inject verification records');
select throws_ok($$select public.record_app_usage_v2('page_view','dashboard','','','','https://private.example/','local')$$,'P0001','invalid_usage_dimension','arbitrary URL rejected');
reset role;
select is((select count(*) from app_private.app_usage_daily_v2 where scope='local' and day=(now() at time zone 'Asia/Seoul')::date),3::bigint,'KST date assigned by database');
-- >1000 groups: full aggregation and report-only pagination, never client row truncation.
insert into app_private.app_usage_daily_v2(day,scope,event,screen,report_id,currency,entry_source,count)
select (now() at time zone 'Asia/Seoul')::date,'local','report_open','reports','historical.'||i,'CLP','direct_or_unknown',2 from generate_series(1,1201)i;
insert into app_private.app_usage_daily_v2(day,scope,event,screen,entry_source,count)
values((now() at time zone 'Asia/Seoul')::date,'verification','page_view','dashboard','direct_or_unknown',99999),
((now() at time zone 'Asia/Seoul')::date-8,'local','page_view','dashboard','direct_or_unknown',10);
insert into public.business_plan_admins(email,active) values('usage-v2-admin@example.test',true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"33000000-0000-0000-0000-000000000021","email":"usage-v2-reader@example.test","role":"authenticated"}',true);
select throws_ok($$select public.admin_app_usage_v2(30,0,'local')$$,'42501',null,'ordinary reader denied');
select set_config('request.jwt.claims','{"sub":"33000000-0000-0000-0000-000000000022","email":"usage-v2-admin@example.test","role":"authenticated"}',true);
select is((public.admin_app_usage_v2(30,0,'local')->'totals'->>'report_open')::bigint,2403::bigint,'all 1202 report groups included');
select is(jsonb_array_length(public.admin_app_usage_v2(30,0,'local')->'reports'),20,'report pagination only');
select is((public.admin_app_usage_v2(30,0,'local')->>'reportTotal')::integer,1202,'report total independent of page');
select is((public.admin_app_usage_v2(7,0,'local')->'totals'->>'page_view')::integer,1,'seven days excludes old and verification');
select is((public.admin_app_usage_v2(30,0,'local')->'totals'->>'page_view')::integer,11,'thirty days includes old only');
reset role;
update public.business_plan_admins set active=false where email='usage-v2-admin@example.test';
set local role authenticated;
select throws_ok($$select public.admin_app_usage_v2(30,0,'local')$$,'42501',null,'revoked admin loses access immediately');
reset role;
select public.record_currency_report_storage_incident('endpoint','source_endpoint_route_unavailable',false,'{"model":"openai/gpt-6.1-sol","route":"azure/us","privateBody":"NEVER_STORE"}');
select public.record_currency_report_storage_incident('endpoint','source_endpoint_route_unavailable',false,'{}');
select is((select revision from app_private.currency_report_storage_incidents where stage='endpoint' and reason='source_endpoint_route_unavailable'),1,'same failure has stable notification revision');
select ok(not exists(select 1 from app_private.currency_report_storage_incidents where stats::text like '%NEVER_STORE%'),'incident private content omitted');
select public.record_currency_report_storage_incident('endpoint','verified',true,'{}');
select ok(not exists(select 1 from app_private.currency_report_storage_incidents where stage='endpoint' and active),'healthy check resolves incident');
select * from finish();
rollback;
