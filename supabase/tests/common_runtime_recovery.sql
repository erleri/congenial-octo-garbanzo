begin;
set local search_path=public,extensions,pg_catalog;
select no_plan();
select ok(not has_function_privilege('anon','public.decide_currency_report_recovery(uuid,uuid)','execute'),'anonymous cannot change recovery');
select ok(not has_function_privilege('authenticated','public.record_currency_report_recovery_lookup(uuid,uuid,jsonb,jsonb)','execute'),'admin browser cannot write expenses');
select ok(not has_table_privilege('authenticated','app_private.currency_report_recovery_lookups','select'),'lookup history is private');
select ok(not (public.currency_report_recovery_policy()->>'enabled')::boolean,'recovery defaults off');
update app_private.currency_report_runtime_control set enabled=false,review_enabled=false;
select is(public.configure_currency_report_recovery_policy(true,1,'synthetic-local-only'),2::bigint,'explicit paused policy activation');
insert into app_private.currency_report_runtime_jobs(id,task_key,currency,base_date,stage,state,request_hash,context,response,response_id,reserved_nano,cost_state,control_revision,received_at)
values('91000000-0000-0000-0000-000000000001',repeat('9',64),'ARS','2099-11-10','writer','received',repeat('8',64),
 jsonb_build_object('operatingBatchKey',repeat('7',64),'model','openai/gpt-6.1-sol','provider','azure/us'),
 '{"valid":false,"partialText":"","usage":null,"providerError":{"code":429},"errors":["provider_stream_error"]}','gen-synthetic-terminal',94902500,'unknown',1,clock_timestamp()-interval '1 hour');
set local role service_role;
select is(public.decide_currency_report_recovery('91000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001')->>'scope','job','terminal rejection can be isolated');
select is(public.currency_report_recovery_attempt(repeat('9',64),repeat('8',64),'92000000-0000-0000-0000-000000000001')->>'reason','recovery_next_execution_wait','same execution cannot retry');
select public.decide_currency_report_recovery('91000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000002');
select ok((public.currency_report_recovery_attempt(repeat('9',64),repeat('8',64),'92000000-0000-0000-0000-000000000002')->>'allowed')::boolean,'later execution does not reset first decision identity');
select is(public.currency_report_recovery_attempt(repeat('9',64),repeat('1',64),'92000000-0000-0000-0000-000000000002')->>'reason','recovery_request_changed','changed input cannot alias retry');
select is(public.currency_report_recovery_attempt(repeat('9',64),repeat('8',64),null)->>'reason','recovery_execution_required','missing execution identity cannot authorize retry');
reset role;
select is((select actual_nano from app_private.currency_report_runtime_jobs where id='91000000-0000-0000-0000-000000000001'),null::bigint,'unknown expense is not set to zero');
select is((select reserved_nano from app_private.currency_report_runtime_jobs where id='91000000-0000-0000-0000-000000000001'),94902500::bigint,'entire reservation retained');
select ok(app_private.runtime_cost_escrowed('91000000-0000-0000-0000-000000000001'),'escrow proof matches original response');
select public.record_currency_report_recovery_lookup('91000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000002','{"version":"generation-cost-lookup/1","reason":"record_not_found","httpStatus":404}',null);
select ok(not (select (r->>'lookupDue')::boolean from jsonb_array_elements(public.currency_report_recovery_candidates()->'items') r where r->>'id'='91000000-0000-0000-0000-000000000001'),'free lookup respects next due time');
select public.record_currency_report_recovery_lookup('91000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000002','{"version":"generation-cost-lookup/1","reason":"record_not_found","httpStatus":404}',null);
select is((select count(*) from app_private.currency_report_recovery_lookups where job_id='91000000-0000-0000-0000-000000000001'),1::bigint,'duplicate execution lookup is idempotent');
select throws_ok($$select public.record_currency_report_recovery_lookup('91000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000003','{"version":"generation-cost-lookup/1","reason":"lookup_error","raw":"private"}',null)$$,'P0001','bounded recovery diagnostic required','raw response cannot enter diagnostic');
insert into app_private.currency_report_runtime_jobs(id,task_key,currency,base_date,stage,state,request_hash,context,response,response_id,reserved_nano,cost_state,control_revision,received_at)
values('91000000-0000-0000-0000-000000000002',repeat('6',64),'PEN','2099-11-10','writer','received',repeat('5',64),
 jsonb_build_object('operatingBatchKey',repeat('7',64),'model','openai/gpt-6.1-sol','provider','azure/us'),
 '{"valid":false,"partialText":"partial","usage":null,"providerError":{"code":429},"errors":["provider_stream_error"]}','gen-synthetic-partial',40000000,'unknown',1,clock_timestamp()-interval '1 hour');
select is(public.decide_currency_report_recovery('91000000-0000-0000-0000-000000000002','92000000-0000-0000-0000-000000000002')->>'scope','global','partial output remains globally uncertain');
select ok(not app_private.runtime_cost_escrowed('91000000-0000-0000-0000-000000000002'),'partial rejection cannot be escrowed');
select public.record_currency_report_recovery_lookup('91000000-0000-0000-0000-000000000002','92000000-0000-0000-0000-000000000003','{"version":"generation-cost-lookup/1","reason":"confirmed","httpStatus":200}',
 '{"source":"generation.total_cost","responseId":"gen-synthetic-partial","costNano":"0"}');
select is(public.decide_currency_report_recovery('91000000-0000-0000-0000-000000000002','92000000-0000-0000-0000-000000000003')->>'status','response_failed_no_automatic_retry','confirmed cost does not make partial response valid');
select is((select actual_nano from app_private.currency_report_runtime_jobs where id='91000000-0000-0000-0000-000000000002'),0::bigint,'only matching zero receipt establishes zero cost');
select throws_ok($$select public.record_currency_report_recovery_lookup('91000000-0000-0000-0000-000000000002','92000000-0000-0000-0000-000000000004','{"version":"generation-cost-lookup/1","reason":"confirmed","httpStatus":200}',
 '{"source":"generation.total_cost","responseId":"gen-synthetic-partial","costNano":"1"}')$$,'P0001','conflicting expense receipt','late conflicting receipt cannot replace ledger');
-- A funded failure is not released by crossing a month boundary.
update app_private.currency_report_runtime_jobs set created_at=date_trunc('month',clock_timestamp())-interval '1 day' where id='91000000-0000-0000-0000-000000000001';
update app_private.currency_report_runtime_control set enabled=true,review_enabled=true,writer='sol',monthly_limit_nano=100000000,per_call_limit_nano=250000000;
select is(public.reserve_currency_report_runtime(repeat('2',64),'CLP','2099-11-10','writer',repeat('3',64),'{"writer":"sol","model":"openai/gpt-6.1-sol","provider":"azure"}',10000000,(select revision from app_private.currency_report_runtime_control),null)->>'reason','monthly_budget_hold','prior-month unknown reservation still consumes current capacity');
update app_private.currency_report_recovery_routes set blocked_until=clock_timestamp()+interval '1 hour';
select is(public.reserve_currency_report_runtime(repeat('2',64),'CLP','2099-11-10','writer',repeat('3',64),'{"writer":"sol","model":"openai/gpt-6.1-sol","provider":"azure/us"}',10000000,1,null)->>'reason','recovery_route_wait','provider backoff blocks another country');
update app_private.currency_report_recovery_routes set blocked_until=clock_timestamp()-interval '1 minute';
insert into app_private.currency_report_runtime_jobs(id,task_key,currency,base_date,stage,state,request_hash,context,response,response_id,reserved_nano,actual_nano,cost_state,control_revision,received_at)
 values('91000000-0000-0000-0000-000000000003',repeat('4',64),'ARS','2099-11-10','writer','received',repeat('8',64),
 jsonb_build_object('model','openai/gpt-6.1-sol','provider','azure/us','retryOf','91000000-0000-0000-0000-000000000001','retryRoot',repeat('9',64),'retryAttempt',1,'recoveryRevision',2,'recoveryExecutionId','92000000-0000-0000-0000-000000000003'),
 '{"valid":false,"partialText":"","usage":null,"providerError":{"code":429},"errors":["provider_stream_error"]}','gen-synthetic-second',94902500,0,'confirmed',1,clock_timestamp());
select is(public.currency_report_recovery_attempt(repeat('9',64),repeat('8',64),'92000000-0000-0000-0000-000000000004')->>'reason','recovery_retry_exhausted','retry count survives different executions');
select throws_ok($$insert into app_private.currency_report_runtime_jobs(task_key,currency,base_date,stage,state,request_hash,context,reserved_nano,cost_state,control_revision)
 values(repeat('1',64),'ARS','2099-11-10','writer','reserved',repeat('8',64),jsonb_build_object('retryOf','91000000-0000-0000-0000-000000000001','retryRoot',repeat('9',64),'retryAttempt',1,'recoveryRevision',2,'recoveryExecutionId','92000000-0000-0000-0000-000000000004'),94902500,'reserved',1)$$,
 'P0001','one funded next-execution retry required','different task ID cannot buy a second retry');
select is(public.decide_currency_report_recovery('91000000-0000-0000-0000-000000000003','92000000-0000-0000-0000-000000000004')->>'status','recovery_retry_exhausted','retry failure is a per-job hold');
select ok((select blocked_until>clock_timestamp()+interval '23 hours' from app_private.currency_report_recovery_routes where provider='azure/us'),'second rejection opens 24-hour route backoff');
select set_config('recovery.notice',(select version from app_private.currency_report_review_items() where id='91000000-0000-0000-0000-000000000001'),true);
select public.decide_currency_report_recovery('91000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000005');
select set_config('recovery.notice',(select version from app_private.currency_report_review_items() where id='91000000-0000-0000-0000-000000000001'),true);
select public.decide_currency_report_recovery('91000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000006');
select is((select version from app_private.currency_report_review_items() where id='91000000-0000-0000-0000-000000000001'),current_setting('recovery.notice'),'unchanged observation does not create a mail version');
select is((select count(*) from app_private.currency_report_recovery_events where job_id='91000000-0000-0000-0000-000000000001'),2::bigint,'state transitions append audits while repeated observations do not');
select ok(not has_table_privilege('authenticated','app_private.currency_report_recovery_events','select'),'audit history remains private');
update app_private.currency_report_recovery_routes set blocked_until=clock_timestamp()-interval '1 minute',probe_id=null;
update app_private.currency_report_runtime_control set writer='sol-us',monthly_limit_nano=1000000000;
select set_config('recovery.probe',(public.reserve_currency_report_runtime(repeat('2',64),'CLP','2099-11-10','writer',repeat('3',64),'{"writer":"sol-us","model":"openai/gpt-6.1-sol","provider":"azure/us"}',10000000,(select revision from app_private.currency_report_runtime_control),null)->>'id'),true);
select ok(current_setting('recovery.probe') is not null,'one route probe can reserve within remaining budget');
select is(public.reserve_currency_report_runtime(repeat('0',64),'BRL','2099-11-10','writer',repeat('3',64),'{"writer":"sol-us","model":"openai/gpt-6.1-sol","provider":"azure/us"}',10000000,(select revision from app_private.currency_report_runtime_control),null)->>'reason','recovery_route_wait','second concurrent route probe is denied');
select ok(public.begin_currency_report_runtime(current_setting('recovery.probe')::uuid,repeat('3',64)),'probe begins under normal controls');
select public.receive_currency_report_runtime(current_setting('recovery.probe')::uuid,'{"valid":true,"responseId":"gen-probe-success","actualModel":"openai/gpt-6.1-sol","payload":{},"costUsd":0}',0);
select is((select count(*) from app_private.currency_report_recovery_routes where provider='azure/us'),0::bigint,'confirmed successful probe restores route');
insert into app_private.currency_report_runtime_jobs(task_key,currency,base_date,stage,state,request_hash,context,response,reserved_nano,cost_state,control_revision)
select md5(n::text)||md5(n::text),'CLP','2099-11-10','writer','received',repeat('c',64),jsonb_build_object('operatingBatchKey',repeat('7',64)),'{"valid":false}',100,'unknown',1 from generate_series(1,105)n;
select is(jsonb_array_length(public.currency_report_recovery_candidates()->'items'),100,'recovery reads a bounded first page');
select ok(public.currency_report_recovery_candidates()->>'nextCursor' is not null,'next page is explicit');
select ok(jsonb_array_length(public.currency_report_recovery_candidates((public.currency_report_recovery_candidates()->>'nextCursor')::uuid)->'items')>0,'remaining uncertainty is not dropped after 100 rows');
insert into app_private.currency_report_runtime_jobs(id,task_key,currency,base_date,stage,state,request_hash,context,reserved_nano,cost_state,control_revision)
values('91000000-0000-0000-0000-000000000004',repeat('f',64),'BRL','2099-11-10','writer','calling',repeat('e',64),jsonb_build_object('operatingBatchKey',repeat('7',64)),1000000,'unknown',1);
select is(public.decide_currency_report_recovery('91000000-0000-0000-0000-000000000004','92000000-0000-0000-0000-000000000007')->>'scope','global','missing response is diagnosed without assuming no charge');
select ok((select response_hash is not null from app_private.currency_report_recovery_events where job_id='91000000-0000-0000-0000-000000000004'),'missing response has a bounded audit identity');
set local role anon;
select throws_ok('select public.currency_report_recovery_summary()','42501','permission denied for function currency_report_recovery_summary','anonymous cannot read summary');
reset role;
set local role authenticated;
select throws_ok('select public.currency_report_recovery_summary()','42501','active admin required','ordinary login cannot read summary');
reset role;
select * from finish();
rollback;
