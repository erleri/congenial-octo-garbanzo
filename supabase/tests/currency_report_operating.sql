begin;
set local search_path=public,extensions,pg_catalog;
select no_plan();
-- Preserve existing paid history. Only the synthetic headroom is new, and all
-- test configuration/reservations below roll back.
select set_config('operating.test.prior_nano',(select coalesce(sum(case when cost_state='confirmed' and created_at>=date_trunc('month',clock_timestamp()) then actual_nano when app_private.runtime_cost_escrowed(id) then reserved_nano else 0 end),0)::text from app_private.currency_report_runtime_jobs),true);
select ok(not has_table_privilege('anon','app_private.currency_report_operating_batches','SELECT'),'anonymous users cannot read frozen originals');
select ok(not has_table_privilege('authenticated','app_private.currency_report_operating_policies','INSERT'),'ordinary login cannot configure sending or budget');
select ok(not has_function_privilege('authenticated','public.claim_currency_report_operating_batch(text,uuid,bigint,jsonb,bigint,integer)','EXECUTE'),'admins cannot impersonate the service executor');
select ok(not has_function_privilege('anon','public.load_currency_report_runtime_job(text)','EXECUTE'),'original/model response cache is service-only');
select is((select enabled from app_private.currency_report_runtime_control),false,'migration does not activate generation');
select set_config('operating.test.policy',jsonb_build_object('version','report-operating-policy/1','binding',repeat('1',64),
 'configurationTrust','server_owned_never_article_or_model_input','publication','separate_active_admin_review','state','operator_configured',
 'externalTransmissionAuthorization','approved_by_operator','recurringBudgetAuthorization','approved_by_operator','authorizationReference','synthetic-test-only',
 'destination',jsonb_build_object('endpoint','https://openrouter.ai/api/v1/chat/completions','model','openai/gpt-6.1-sol','provider','azure','zdr',true,'dataCollection','deny','retries',0,'fallback',false,'rawPublicDisplay',false),
 'limits',jsonb_build_object('batchUsd',.2,'monthlyUsd',1+current_setting('operating.test.prior_nano')::numeric/1000000000,'perCallUsd',.1,'maxCalls',12))::text,true);
set local role service_role;
select set_config('operating.test.rev',public.configure_currency_report_operating_policy(current_setting('operating.test.policy')::jsonb,
 coalesce((public.currency_report_operating_policy()->>'revision')::bigint,0))::text,true);
select throws_ok($$select public.configure_currency_report_operating_policy(current_setting('operating.test.policy')::jsonb,0)$$,'40001','operating policy revision changed','stale settings cannot overwrite current policy');
select is(public.claim_currency_report_operating_batch(repeat('2',64),'01000000-0000-0000-0000-000000000001',current_setting('operating.test.rev')::bigint,'{}',200000000,12)->>'reason','operating_configuration_hold','policy alone cannot activate execution');
reset role;
update app_private.currency_report_runtime_control set enabled=true,review_enabled=true,writer='sol',monthly_limit_nano=1000000000+current_setting('operating.test.prior_nano')::bigint;
set local role service_role;
select is(public.claim_currency_report_operating_batch(repeat('2',64),'01000000-0000-0000-0000-000000000001',current_setting('operating.test.rev')::bigint,'{}',200000000,12)->>'claimed','true','explicit synthetic controls and policy permit one batch');
select is(public.claim_currency_report_operating_batch(repeat('2',64),'01000000-0000-0000-0000-000000000002',current_setting('operating.test.rev')::bigint,'{}',200000000,12)->>'reason','operating_batch_busy','another owner cannot take a live lease');
select is(public.claim_currency_report_operating_case(repeat('2',64),'01000000-0000-0000-0000-000000000001',repeat('3',64),repeat('4',64),'BRL',repeat('5',64))->>'claimed','true','case is claimed before article spending');
select set_config('operating.test.context',jsonb_build_object('writer','sol','operatingBatchKey',repeat('2',64),'operatingOwner','01000000-0000-0000-0000-000000000001','operatingCaseKey',repeat('3',64))::text,true);
select set_config('operating.test.job',public.reserve_currency_report_runtime(repeat('6',64),'BRL','2096-11-01','writer',repeat('7',64),current_setting('operating.test.context')::jsonb,80000000,(public.currency_report_runtime_control()->>'revision')::bigint)->>'id',true);
select ok(current_setting('operating.test.job')::uuid is not null,'source stage uses the same atomic monthly ledger');
select ok(public.begin_currency_report_runtime(current_setting('operating.test.job')::uuid,repeat('7',64)),'only one reservation can begin');
select is(public.claim_currency_report_operating_batch(repeat('8',64),'01000000-0000-0000-0000-000000000002',current_setting('operating.test.rev')::bigint,'{}',200000000,12)->>'reason','unresolved_or_inflight_call','unknown paid expense blocks another batch');
select public.receive_currency_report_runtime(current_setting('operating.test.job')::uuid,'{"valid":true}',60000000);
select set_config('operating.test.job2',public.reserve_currency_report_runtime(repeat('9',64),'BRL','2096-11-01','reviewer',repeat('a',64),current_setting('operating.test.context')::jsonb,90000000,(public.currency_report_runtime_control()->>'revision')::bigint,current_setting('operating.test.job')::uuid)->>'id',true);
select ok(public.begin_currency_report_runtime(current_setting('operating.test.job2')::uuid,repeat('a',64)),'comparison has a separate reservation');
select public.receive_currency_report_runtime(current_setting('operating.test.job2')::uuid,'{"valid":true}',90000000);
select is(public.reserve_currency_report_runtime(repeat('b',64),'BRL','2096-11-01','writer',repeat('c',64),current_setting('operating.test.context')::jsonb,80000000,(public.currency_report_runtime_control()->>'revision')::bigint)->>'reason','operating_batch_budget_hold','source and writing stages cannot exceed shared batch budget');
select public.finish_currency_report_operating_case(repeat('2',64),'01000000-0000-0000-0000-000000000001',repeat('3',64),'held','{"status":"source_support_hold"}');
select is(public.claim_currency_report_operating_case(repeat('2',64),'01000000-0000-0000-0000-000000000001',repeat('3',64),repeat('4',64),'BRL',repeat('5',64))->>'reason','unchanged_case_already_processed','same failed material cannot be purchased again');
select public.checkpoint_currency_report_operating_batch(repeat('2',64),'01000000-0000-0000-0000-000000000001','completed','{"status":"synthetic-complete"}');
select is(public.claim_currency_report_operating_batch(repeat('2',64),'01000000-0000-0000-0000-000000000002',current_setting('operating.test.rev')::bigint,'{}',200000000,12)->>'reason','completed','finished batch is not restarted');
reset role;

insert into public.business_plan_admins(email,active) values('operating-admin@example.test',true);
insert into public.currency_report_runs(id,currency,base_date,attempt,rule_version,event_binding,packet,candidate,validation)
values('02000000-0000-0000-0000-000000000001','PEN','2096-11-01',1,'operating-synthetic/1','synthetic','{}',
 '{"id":"OPERATING-PERIODIC-TEST","schemaVersion":"currency-report/1","currency":"PEN","baseDate":"2096-11-01","observedDate":"2096-11-01","generationMode":"ai_enhanced","purpose":"periodic_check","testOnly":true,"content":{"title":"합성 정기 점검","summary":"실제 발행·모델 평가 아님","change":{"title":"합성","text":"합성","kind":"fact","factIds":[],"evidenceIds":[]},"drivers":[],"implications":[],"watch":[],"limitations":[]},"facts":[],"series":[],"evidence":[],"limitations":[]}',
 '{"structureValid":true,"contentReview":"passed","criticalErrors":0,"qualityAverage":4,"evidenceScore":4}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"03000000-0000-0000-0000-000000000001","email":"ordinary@example.test","role":"authenticated"}',true);
select throws_ok($$select public.currency_report_operating_summary()$$,'42501','active administrator required','normal login cannot inspect private operations');
select set_config('request.jwt.claims','{"sub":"03000000-0000-0000-0000-000000000002","email":"operating-admin@example.test","role":"authenticated"}',true);
select is(public.review_currency_report_version('02000000-0000-0000-0000-000000000001','approved',null,null,null,'periodic'),'published','periodic purpose approves atomically through existing admin flow');
select throws_ok($$select public.review_currency_report('02000000-0000-0000-0000-000000000001','approved')$$,'55000','report run is no longer reviewable','second approval does not create a second audit');
select ok(not (public.currency_report_operating_summary()::text like '%operating.test.context%'),'admin summary does not include private payload');
reset role;
set local role anon;
select is(public.resolve_currency_report('PEN','2096-11-01',null,true)->'report'->>'purpose','periodic_check','anonymous reader receives only the approved periodic report');
reset role;
update public.business_plan_admins set active=false where email='operating-admin@example.test';
set local role authenticated;
select throws_ok($$select public.currency_report_operating_summary()$$,'42501','active administrator required','same-session admin revocation applies immediately');
reset role;
select is((select count(*) from public.currency_report_reviews where run_id='02000000-0000-0000-0000-000000000001'),1::bigint,'one successful review produces one audit');
select * from finish();
rollback;
