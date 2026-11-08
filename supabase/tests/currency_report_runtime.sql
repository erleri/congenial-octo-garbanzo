begin;
set local search_path=public,extensions,pg_catalog;
select no_plan();
select ok(not has_table_privilege('anon','app_private.currency_report_runtime_inputs','SELECT'),'anonymous readers cannot read prepared inputs');
select ok(not has_table_privilege('authenticated','app_private.currency_report_runtime_jobs','SELECT'),'ordinary sessions cannot read private responses');
select ok(not has_function_privilege('authenticated','public.reserve_currency_report_runtime(text,text,date,text,text,jsonb,bigint,bigint,uuid)','EXECUTE'),'administrators cannot reserve model spending through the public API');
select ok(not has_function_privilege('anon','public.currency_report_runtime_summary()','EXECUTE'),'anonymous readers cannot inspect operational budget');
insert into public.business_plan_admins(email,active) values('runtime-fixture-20261031@example.test',true);
set local role service_role;
select is((public.currency_report_runtime_control()->>'enabled')::boolean,false,'new runtime is disabled by default');
select is((public.currency_report_runtime_control()->>'monthly_limit_nano')::bigint,0::bigint,'new runtime has no implicitly approved monthly budget');
select is(public.reserve_currency_report_runtime(repeat('a',64),'BRL','2094-01-01','writer',repeat('b',64),
 '{"writer":"sol","ruleVersion":"runtime-test/1","packet":{"private":"PRIVATE_RUNTIME_PACKET"}}',200000000,1)->>'reason',
 'runtime_disabled_or_changed','disabled runtime does not reserve an expense');
reset role;
update app_private.currency_report_runtime_control set enabled=true,review_enabled=true;
set local role service_role;
select is(public.reserve_currency_report_runtime(repeat('a',64),'BRL','2094-01-01','writer',repeat('b',64),
 '{"writer":"sol"}',200000000,(public.currency_report_runtime_control()->>'revision')::bigint)->>'reason',
 'runtime_disabled_or_changed','enabled flag alone does not grant an unapproved budget');
reset role;
update app_private.currency_report_runtime_control set monthly_limit_nano=250000000;
set local role service_role;
select is(public.reserve_currency_report_runtime(repeat('a',64),'BRL','2094-01-01','writer',repeat('b',64),
 '{"writer":"sol"}',200000000,null)->>'reason','runtime_disabled_or_changed','missing revision cannot bypass the configuration check');
select set_config('runtime.test.cancel',public.reserve_currency_report_runtime(repeat('a',64),'BRL','2094-01-01','writer',repeat('b',64),
 '{"writer":"sol"}',200000000,(public.currency_report_runtime_control()->>'revision')::bigint)->>'id',true);
select ok(current_setting('runtime.test.cancel')::uuid is not null,'first atomic reservation succeeds');
select is(public.reserve_currency_report_runtime(repeat('a',64),'BRL','2094-01-01','writer',repeat('b',64),
 '{"writer":"sol"}',200000000,(public.currency_report_runtime_control()->>'revision')::bigint)->>'reason',
 'duplicate_task','same report case cannot create a second reservation');
select is(public.reserve_currency_report_runtime(repeat('c',64),'COP','2094-01-01','writer',repeat('d',64),
 '{"writer":"sol"}',200000000,(public.currency_report_runtime_control()->>'revision')::bigint)->>'reason',
 'unresolved_or_inflight_call','another runner cannot overlap an in-flight reservation');
reset role;
update app_private.currency_report_runtime_control set enabled=false;
set local role service_role;
select is(public.begin_currency_report_runtime(current_setting('runtime.test.cancel')::uuid,repeat('b',64)),false,'stop between reservation and POST prevents the call');
reset role;
select is((select actual_nano from app_private.currency_report_runtime_jobs where id=current_setting('runtime.test.cancel')::uuid),0::bigint,'cancelled pre-call reservation settles at known zero');
update app_private.currency_report_runtime_control set enabled=true;
set local role service_role;
select set_config('runtime.test.writer',public.reserve_currency_report_runtime(repeat('e',64),'BRL','2094-01-01','writer',repeat('f',64),
 '{"writer":"sol","ruleVersion":"runtime-test/1","packet":{"private":"PRIVATE_RUNTIME_PACKET"}}',200000000,
 (public.currency_report_runtime_control()->>'revision')::bigint)->>'id',true);
select is(public.begin_currency_report_runtime(current_setting('runtime.test.writer')::uuid,null),false,'missing request hash cannot begin a paid request');
select is(public.begin_currency_report_runtime(current_setting('runtime.test.writer')::uuid,repeat('f',64)),true,'bound request begins once');
select is(public.begin_currency_report_runtime(current_setting('runtime.test.writer')::uuid,repeat('f',64)),false,'second begin cannot replay the same POST');
select throws_ok($$select public.checkpoint_currency_report_runtime(current_setting('runtime.test.writer')::uuid,'{"responseId":"bad id"}')$$,
 '55000','invalid runtime checkpoint','malformed response identifiers are rejected');
select lives_ok($$select public.checkpoint_currency_report_runtime(current_setting('runtime.test.writer')::uuid,'{"responseId":"gen-runtime-writer","phase":"headers"}')$$,'response identifier survives a worker interruption');
select lives_ok($$select public.receive_currency_report_runtime(current_setting('runtime.test.writer')::uuid,
 '{"valid":true,"costUsd":null,"responseId":"gen-runtime-writer","private":"PRIVATE_RUNTIME_RESPONSE"}',null)$$,'raw response survives missing cost');
select is(public.reserve_currency_report_runtime(repeat('1',64),'PEN','2094-01-01','writer',repeat('2',64),
 '{"writer":"sol"}',200000000,(public.currency_report_runtime_control()->>'revision')::bigint)->>'reason',
 'unresolved_or_inflight_call','unknown cost blocks later generation even for another currency');
select throws_ok($$select public.receive_currency_report_runtime(current_setting('runtime.test.writer')::uuid,'{"changed":true}',1)$$,
 '55000','immutable runtime response required','received response cannot be overwritten');
select throws_ok($$select public.reconcile_currency_report_runtime_cost(current_setting('runtime.test.writer')::uuid,'gen-wrong',10000000,
 '{"source":"generation.total_cost","responseId":"gen-wrong","costNano":10000000}')$$,
 '55000','verified unresolved generation cost required','cost reconciliation rejects another response ID');
select lives_ok($$select public.reconcile_currency_report_runtime_cost(current_setting('runtime.test.writer')::uuid,'gen-runtime-writer',10000000,
 '{"source":"generation.total_cost","responseId":"gen-runtime-writer","costNano":10000000}')$$,'verified cost can be reconciled without another model call');
reset role;
select is((select response->>'private' from app_private.currency_report_runtime_jobs where id=current_setting('runtime.test.writer')::uuid),
 'PRIVATE_RUNTIME_RESPONSE','cost reconciliation preserves the original response');
set local role service_role;
select is(public.reserve_currency_report_runtime(repeat('3',64),'BRL','2094-01-01','reviewer',repeat('4',64),
 '{"writer":"sol"}',250000000,(public.currency_report_runtime_control()->>'revision')::bigint,current_setting('runtime.test.writer')::uuid)->>'reason',
 'monthly_budget_hold','writer and reviewer share one atomic monthly budget');
select throws_ok($$select public.finish_currency_report_runtime(current_setting('runtime.test.writer')::uuid,
 '{"currency":"BRL","baseDate":"2094-01-01","status":"draft","publishedAt":null,"content":{}}',
 '{"contentReview":"passed","publicationApproved":false}','{}')$$,'55000','complete independently costed review required',
 'writer structural success cannot self-approve content');
select set_config('runtime.test.reviewer',public.reserve_currency_report_runtime(repeat('5',64),'BRL','2094-01-01','reviewer',repeat('6',64),
 '{"writer":"sol","ruleVersion":"runtime-test/1","packet":{"private":"PRIVATE_RUNTIME_PACKET"}}',20000000,
 (public.currency_report_runtime_control()->>'revision')::bigint,current_setting('runtime.test.writer')::uuid)->>'id',true);
select is(public.begin_currency_report_runtime(current_setting('runtime.test.reviewer')::uuid,repeat('6',64)),true,'independent reviewer begins under its own reservation');
select lives_ok($$select public.receive_currency_report_runtime(current_setting('runtime.test.reviewer')::uuid,'{"valid":true,"costUsd":0.02}',20000000)$$,'review response and its actual cost persist independently');
select set_config('runtime.test.run',public.finish_currency_report_runtime(current_setting('runtime.test.reviewer')::uuid,
 '{"id":"BRL-2094-01-01-1","schemaVersion":"currency-report/1","currency":"BRL","baseDate":"2094-01-01","observedDate":"2094-01-01","status":"draft","publishedAt":null,"generationMode":"ai_enhanced","testOnly":true,"content":{"title":"합성 연결 시험","summary":"실제 AI 품질 평가가 아닌 저장·권한 시험","change":{"title":"합성 관측","text":"합성 값","kind":"fact","factIds":[],"evidenceIds":[]},"drivers":[],"implications":[],"watch":[],"limitations":[]},"facts":[],"series":[],"evidence":[],"limitations":[]}',
 '{"structureValid":true,"contentReview":"passed","criticalErrors":0,"qualityAverage":4,"evidenceScore":4,"publicationApproved":false}',
 '{"costUsd":0.03,"modelCalls":0,"synthetic":true}')::text,true);
reset role;
select is((select status from public.currency_report_runs where id=current_setting('runtime.test.run')::uuid),'pending_review','completion creates an admin-pending run, never a public report');
select is((select count(*) from public.currency_report_storage_receipts where run_id=current_setting('runtime.test.run')::uuid),1::bigint,'run and private storage receipt commit atomically');
select is((select count(*) from public.currency_reports where run_id=current_setting('runtime.test.run')::uuid),0::bigint,'automatic generation never writes the public report table');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"51000000-0000-0000-0000-000000000010","email":"runtime-fixture-20261031@example.test","role":"authenticated"}',true);
select is(public.currency_report_runtime_summary()->>'confirmedUsd','0.03000000000000000000','active admin sees the confirmed total of both calls');
select ok(not(public.currency_report_runtime_summary() ? 'response'),'admin summary contains no raw model response');
reset role;
update public.business_plan_admins set active=false where email='runtime-fixture-20261031@example.test';
set local role authenticated;
select throws_ok($$select public.currency_report_runtime_summary()$$,'42501','active administrator required','revoked temporary admin loses operational summary with the same JWT');
reset role;
select * from finish();
rollback;
