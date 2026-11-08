begin;
set local search_path=public,extensions,pg_catalog;
select no_plan();
select ok(not has_function_privilege('anon','public.pending_currency_report_operating_batches(bigint)','EXECUTE'),'anonymous readers cannot inspect frozen originals');
select ok(not has_function_privilege('authenticated','public.supersede_currency_report_operating_batch(text,bigint,text)','EXECUTE'),'normal login cannot supersede an executor batch');
select throws_ok($$select public.supersede_currency_report_operating_batch(repeat('f',64),0,null)$$,'P0001','explicit supersession reason required','a missing replacement reason cannot close work');
select set_config('completion.policy',jsonb_build_object('version','report-operating-policy/1','binding',repeat('a',64),
 'configurationTrust','server_owned_never_article_or_model_input','publication','separate_active_admin_review','state','operator_configured',
 'externalTransmissionAuthorization','approved_by_operator','recurringBudgetAuthorization','approved_by_operator',
 'authorizationReference','synthetic-completion-only','configuredAt',clock_timestamp(),
 'destination',jsonb_build_object('endpoint','https://openrouter.ai/api/v1/chat/completions','model','openai/gpt-6.1-sol','provider','azure','zdr',true,'dataCollection','deny','retries',0,'fallback',false,'rawPublicDisplay',false),
 'limits',jsonb_build_object('batchUsd',7,'monthlyUsd',7,'perCallUsd',.25,'maxCalls',60))::text,true);
set local role service_role;
select set_config('completion.revision',public.configure_currency_report_operating_policy(current_setting('completion.policy')::jsonb,coalesce((public.currency_report_operating_policy()->>'revision')::bigint,0))::text,true);
reset role;
update app_private.currency_report_runtime_control set enabled=true,review_enabled=true,writer='sol',monthly_limit_nano=7000000000,per_call_limit_nano=250000000;
set local role service_role;
select ok((public.claim_currency_report_operating_batch(repeat('1',64),'12000000-0000-0000-0000-000000000001',current_setting('completion.revision')::bigint,'{}',7000000000,60)->>'claimed')::boolean,'synthetic original batch is leased');
select ok((public.claim_currency_report_operating_case(repeat('1',64),'12000000-0000-0000-0000-000000000001',repeat('2',64),repeat('3',64),'COP',repeat('4',64))->>'claimed')::boolean,'COP has an original case');
select is(public.supersede_currency_report_operating_batch(repeat('1',64),current_setting('completion.revision')::bigint,'frozen_reference_superseded')->>'reason','operating_scope_or_lease_changed','another active lease cannot be superseded');
select public.finish_currency_report_operating_case(repeat('1',64),'12000000-0000-0000-0000-000000000001',repeat('2',64),'paused','{"status":"source_endpoint_preflight_hold"}');
select public.checkpoint_currency_report_operating_batch(repeat('1',64),'12000000-0000-0000-0000-000000000001','paused','{"status":"paused"}');
select is(jsonb_array_length(public.pending_currency_report_operating_batches(current_setting('completion.revision')::bigint)),1,'the frozen batch is discoverable independently of new material hashes');
select is(public.pending_currency_report_operating_batches(current_setting('completion.revision')::bigint)->0->>'batch_key',repeat('1',64),'lookup returns original identity');
select ok((public.claim_currency_report_operating_batch(repeat('1',64),'12000000-0000-0000-0000-000000000002',current_setting('completion.revision')::bigint,'{}',7000000000,60)->>'claimed')::boolean,'a recovered worker reclaims the original batch');
select ok((public.claim_currency_report_operating_case(repeat('1',64),'12000000-0000-0000-0000-000000000002',repeat('2',64),repeat('3',64),'COP',repeat('4',64))->>'resumed')::boolean,'same COP case resumes in its original batch');
select set_config('completion.job',public.reserve_currency_report_runtime(repeat('5',64),'COP','2097-01-01','writer',repeat('6',64),
 jsonb_build_object('writer','sol','purpose','original_source_review','operatingBatchKey',repeat('1',64),'operatingOwner','12000000-0000-0000-0000-000000000002','operatingCaseKey',repeat('2',64)),10000000,(public.currency_report_runtime_control()->>'revision')::bigint)->>'id',true);
select ok(public.begin_currency_report_runtime(current_setting('completion.job')::uuid,repeat('6',64)),'synthetic job begins without sending a request');
select public.finish_currency_report_operating_case(repeat('1',64),'12000000-0000-0000-0000-000000000002',repeat('2',64),'paused','{"status":"source_cost_unresolved"}');
select public.checkpoint_currency_report_operating_batch(repeat('1',64),'12000000-0000-0000-0000-000000000002','paused','{"status":"paused"}');
select is(public.supersede_currency_report_operating_batch(repeat('1',64),current_setting('completion.revision')::bigint,'frozen_reference_superseded')->>'reason','unresolved_or_inflight_call','unknown accounting cannot be bypassed through supersession');
select public.receive_currency_report_runtime(current_setting('completion.job')::uuid,'{"valid":true,"costUsd":0.001}',1000000);
select ok((public.supersede_currency_report_operating_batch(repeat('1',64),current_setting('completion.revision')::bigint,'frozen_reference_superseded')->>'superseded')::boolean,'a changed reference closes the old frozen edition explicitly');
select is((select result->>'status' from app_private.currency_report_operating_cases where case_key=repeat('2',64)),'frozen_reference_superseded','case records the replacement reason');
select is((select actual_nano from app_private.currency_report_runtime_jobs where id=current_setting('completion.job')::uuid),1000000::bigint,'supersession preserves original confirmed expense');
select is((select context->>'operatingBatchKey' from app_private.currency_report_runtime_jobs where id=current_setting('completion.job')::uuid),repeat('1',64),'expense remains bound to its original batch');
select is(jsonb_array_length(public.pending_currency_report_operating_batches(current_setting('completion.revision')::bigint)),0,'superseded work is no longer an unfinished batch');
select ok((public.claim_currency_report_operating_batch(repeat('7',64),'12000000-0000-0000-0000-000000000003',current_setting('completion.revision')::bigint,'{}',7000000000,60)->>'claimed')::boolean,'separately checked recurring scope may start a new batch');
select ok((public.claim_currency_report_operating_case(repeat('7',64),'12000000-0000-0000-0000-000000000003',repeat('8',64),repeat('3',64),'COP',repeat('4',64))->>'claimed')::boolean,'a new reference identity is not mislabeled already processed');
-- Current coordinator closes changed countries individually in the original
-- envelope. Unchanged paused countries retain their original case and ledger.
select ok((public.claim_currency_report_operating_case(repeat('7',64),'12000000-0000-0000-0000-000000000003',repeat('9',64),repeat('a',64),'PEN',repeat('b',64))->>'claimed')::boolean,'another country owns a separate case in the same envelope');
select public.finish_currency_report_operating_case(repeat('7',64),'12000000-0000-0000-0000-000000000003',repeat('9',64),'paused','{"status":"runtime_endpoint_preflight_wait"}');
select public.finish_currency_report_operating_case(repeat('7',64),'12000000-0000-0000-0000-000000000003',repeat('8',64),'held','{"status":"frozen_country_reference_superseded","newInputDeferred":true}');
select is((select state from app_private.currency_report_operating_cases where case_key=repeat('9',64)),'paused','closing COP does not close PEN');
select public.checkpoint_currency_report_operating_batch(repeat('7',64),'12000000-0000-0000-0000-000000000003','paused','{"status":"paused"}');
select ok((public.claim_currency_report_operating_batch(repeat('7',64),'12000000-0000-0000-0000-000000000004',current_setting('completion.revision')::bigint,'{}',7000000000,60)->>'claimed')::boolean,'original accounting envelope is reclaimed without replacement');
select ok((public.claim_currency_report_operating_case(repeat('7',64),'12000000-0000-0000-0000-000000000004',repeat('9',64),repeat('a',64),'PEN',repeat('b',64))->>'resumed')::boolean,'PEN resumes the same country key after COP changed');
select public.finish_currency_report_operating_case(repeat('7',64),'12000000-0000-0000-0000-000000000004',repeat('9',64),'held','{"status":"synthetic_complete"}');
select public.checkpoint_currency_report_operating_batch(repeat('7',64),'12000000-0000-0000-0000-000000000004','completed','{"status":"completed"}');
select ok((public.claim_currency_report_operating_batch(repeat('f',64),'12000000-0000-0000-0000-000000000005',current_setting('completion.revision')::bigint,'{}',7000000000,60)->>'claimed')::boolean,'new inputs have a subsequent separately budgeted envelope');
select ok((public.claim_currency_report_operating_case(repeat('f',64),'12000000-0000-0000-0000-000000000005',repeat('0',64),repeat('3',64),'COP',repeat('4',64))->>'claimed')::boolean,'changed COP input owns a new edition without reusing the held key');
select is((select actual_nano from app_private.currency_report_runtime_jobs where id=current_setting('completion.job')::uuid),1000000::bigint,'country transitions never move or rewrite old costs');
reset role;
-- Directly stored synthetic responses isolate finalization from historic monthly
-- expenses in this long-lived local test DB. No reservation or model is sent.
insert into app_private.currency_report_runtime_jobs(id,task_key,currency,base_date,stage,state,request_hash,context,response,reserved_nano,actual_nano,cost_state,control_revision)
values('12000000-0000-0000-0000-000000000011',repeat('b',64),'BRL','2097-01-02','writer','received',repeat('c',64),
 '{"writer":"sol","ruleVersion":"synthetic/1","packet":{"synthetic":true}}','{"valid":true,"costUsd":0.01}',200000000,10000000,'confirmed',1);
insert into app_private.currency_report_runtime_jobs(id,task_key,currency,base_date,stage,parent_id,state,request_hash,context,response,reserved_nano,actual_nano,cost_state,control_revision)
values('12000000-0000-0000-0000-000000000012',repeat('d',64),'BRL','2097-01-02','reviewer','12000000-0000-0000-0000-000000000011','received',repeat('e',64),
 '{"writer":"sol","ruleVersion":"synthetic/1","packet":{"synthetic":true}}','{"valid":true,"costUsd":0.02}',200000000,20000000,'confirmed',1);
set local role service_role;
select set_config('completion.run',public.finish_currency_report_runtime('12000000-0000-0000-0000-000000000012',
 '{"id":"BRL-2097-01-02-1","schemaVersion":"currency-report/1","currency":"BRL","baseDate":"2097-01-02","observedDate":"2097-01-02","status":"draft","publishedAt":null,"generationMode":"ai_enhanced","testOnly":true,"content":{"title":"합성 시험","summary":"실제 원고 품질 표본 아님","change":{},"drivers":[],"implications":[],"watch":[]},"facts":[],"series":[],"evidence":[],"limitations":[]}',
 '{"structureValid":true,"contentReview":"passed","criticalErrors":0,"qualityAverage":4,"evidenceScore":4,"publicationApproved":false}',
 '{"costUsd":0.03,"modelCalls":0,"synthetic":true}')::text,true);
select is(public.finish_currency_report_runtime('12000000-0000-0000-0000-000000000012',
 (select candidate from public.currency_report_runs where id=current_setting('completion.run')::uuid),
 (select validation from public.currency_report_runs where id=current_setting('completion.run')::uuid),
 '{"modelCalls":0,"costUsd":0}')::text,current_setting('completion.run'),'lost acknowledgement returns the same finalized run');
select is((select count(*) from public.currency_report_storage_receipts where run_id=current_setting('completion.run')::uuid),1::bigint,'repeated finalization creates no second receipt');
select is((select cost->>'costUsd' from public.currency_report_runs where id=current_setting('completion.run')::uuid),'0.03','repeated finalization preserves the original cost');
select throws_ok($$select public.finish_currency_report_runtime('12000000-0000-0000-0000-000000000012',
 (select candidate||'{"content":{"title":"changed"}}'::jsonb from public.currency_report_runs where id=current_setting('completion.run')::uuid),
 (select validation from public.currency_report_runs where id=current_setting('completion.run')::uuid),'{}')$$,'55000','finalized candidate changed','different candidate cannot overwrite finalized output');
reset role;
select * from finish();
rollback;
