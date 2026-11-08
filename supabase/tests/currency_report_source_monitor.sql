begin;
select no_plan();
create function pg_temp.monitor_state() returns jsonb language sql as $$
 select jsonb_build_object('version','source-monitor/1','currency','COP','checkedAt','2026-11-01T04:00:00Z',
  'binding',repeat('a',64),'candidates',jsonb_build_array(jsonb_build_object(
   'domain','newspaper.example.org','sampleUrl','https://newspaper.example.org/economia/dolar',
   'discoveredFrom','https://www.larepublica.co/finanzas/','discoveredSourceId','cop-larepublica',
   'firstSeenAt','2026-11-01T04:00:00Z','lastSeenAt','2026-11-01T04:00:00Z',
   'status','candidate_only','access','not_checked','extraction','not_checked','useScope','unconfirmed',
   'lastCheckedAt',null,'nextCheckAt',null,'checkHash',null,'attempts',0)),
  'sources','[]'::jsonb,'gaps','["no_registered_capture"]'::jsonb,'omittedCandidates',0,'technicalChecks',0,
  'networkCalls',0,'modelCalls',0,'attentionRequired',true,'writingEligible',false,'publicationApproved',false);
$$;
select ok(not has_table_privilege('anon','app_private.currency_report_source_monitors','SELECT'),'candidate records are private');
select ok(not has_table_privilege('authenticated','app_private.currency_report_source_monitors','UPDATE'),'login cannot register or edit candidate records');
select ok(not has_function_privilege('anon','public.currency_report_source_monitor_summary()','EXECUTE'),'anonymous cannot list source candidates');
select ok(not has_function_privilege('authenticated','public.save_currency_report_source_monitor(jsonb,text)','EXECUTE'),'administrator login cannot forge service observations');
set local role service_role;
select is(public.save_currency_report_source_monitor(pg_temp.monitor_state(),null),true,'service creates a bounded working queue');
select is(public.load_currency_report_source_monitor('COP')->'candidates'->0->>'domain','newspaper.example.org','candidate can be loaded across executions');
select is(public.save_currency_report_source_monitor(pg_temp.monitor_state()||jsonb_build_object('binding',repeat('b',64)),null),false,'concurrent bootstrap cannot overwrite a queue');
select is(public.save_currency_report_source_monitor(pg_temp.monitor_state()||jsonb_build_object('binding',repeat('b',64)),repeat('f',64)),false,'stale binding cannot overwrite a queue');
select is(public.save_currency_report_source_monitor(pg_temp.monitor_state()||jsonb_build_object('binding',repeat('b',64)),repeat('a',64)),true,'matching binding permits state update');
select is(public.save_currency_report_source_monitor(pg_temp.monitor_state()||'{"checkedAt":"2026-10-31T04:00:00Z"}',repeat('b',64)),false,'older observation cannot replace current state');
select throws_ok($$select public.save_currency_report_source_monitor(pg_temp.monitor_state()||'{"rawBody":"PRIVATE"}',repeat('b',64))$$,'22023','safe source monitor required','raw article cannot enter monitor state');
select throws_ok($$select public.save_currency_report_source_monitor(pg_temp.monitor_state()||'{"publicationApproved":true}',repeat('b',64))$$,'22023','safe source monitor required','monitor cannot become publication approval');
select throws_ok($$select public.save_currency_report_source_monitor(pg_temp.monitor_state()||'{"modelCalls":1}',repeat('b',64))$$,'22023','safe source monitor required','monitor cannot account for paid calls');
select throws_ok($$select public.save_currency_report_source_monitor(jsonb_set(pg_temp.monitor_state(),'{candidates,0,sampleUrl}','"https://newspaper.example.org/x?token=PRIVATE"'),repeat('b',64))$$,'22023','safe source candidate required','secret-bearing candidate URLs are rejected');
select throws_ok($$select public.save_currency_report_source_monitor(jsonb_set(pg_temp.monitor_state(),'{candidates,0,useScope}','"approved"'),repeat('b',64))$$,'22023','safe source candidate required','candidate cannot grant use permission');
select throws_ok($$select public.save_currency_report_source_monitor(pg_temp.monitor_state()||jsonb_build_object('candidates',(select jsonb_agg(pg_temp.monitor_state()->'candidates'->0) from generate_series(1,33))),repeat('b',64))$$,'22023','bounded source monitor required','candidate capacity is enforced in storage');
reset role;
insert into public.business_plan_admins(email,active) values('source-monitor-admin@example.test',true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"93000000-0000-0000-0000-000000000001","email":"source-monitor-reader@example.test","role":"authenticated"}',true);
select throws_ok($$select public.currency_report_source_monitor_summary()$$,'42501','active administrator required','ordinary login cannot list candidates');
select set_config('request.jwt.claims','{"sub":"93000000-0000-0000-0000-000000000002","email":"source-monitor-admin@example.test","role":"authenticated"}',true);
select ok(exists(select 1 from jsonb_array_elements(public.currency_report_source_monitor_summary()) s where s->>'currency'='COP'),'existing active administrator can see candidates');
reset role;
update public.business_plan_admins set active=false where email='source-monitor-admin@example.test';
set local role authenticated;
select throws_ok($$select public.currency_report_source_monitor_summary()$$,'42501','active administrator required','revocation blocks same session immediately');
reset role;
select is((select count(*) from app_private.currency_report_source_monitors where currency='COP'),1::bigint,'updates keep one row per country instead of an unbounded event log');
select * from finish();
rollback;
