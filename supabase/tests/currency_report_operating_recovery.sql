begin;
set local search_path=public,extensions,pg_catalog;
select no_plan();
select set_config('recovery.prior_nano',(select coalesce(sum(case when cost_state='confirmed' and created_at>=date_trunc('month',clock_timestamp()) then actual_nano when app_private.runtime_cost_escrowed(id) then reserved_nano else 0 end),0)::text from app_private.currency_report_runtime_jobs),true);
select ok(not has_function_privilege('anon','public.currency_report_operating_recoverable_calls()','EXECUTE'),'recovery is not an anonymous endpoint');
select ok(not has_function_privilege('authenticated','public.release_currency_report_operating_unsent(uuid)','EXECUTE'),'ordinary login cannot release model reservations');
select ok(not has_function_privilege('anon','public.record_currency_report_supply_check(text,text,timestamptz,jsonb)','EXECUTE'),'free collection diagnostics remain service-only');
select is((select enabled from app_private.currency_report_runtime_control),false,'follow-up does not activate generation');
select set_config('recovery.policy',jsonb_build_object('version','report-operating-policy/1','binding',repeat('e',64),
 'configurationTrust','server_owned_never_article_or_model_input','publication','separate_active_admin_review','state','trial_configured',
 'externalTransmissionAuthorization','approved_by_operator','recurringBudgetAuthorization','not_authorized','trialBudgetAuthorization','approved_by_operator',
 'budgetScope','one_time_trial_only','datasetBinding',repeat('d',64),'authorizationReference','synthetic-one-time-recovery-only',
 'configuredAt',clock_timestamp(),'expiresAt',clock_timestamp()+interval '1 hour',
 'accountingPriorSpendUsd',current_setting('recovery.prior_nano')::numeric/1000000000,
 'destination',jsonb_build_object('endpoint','https://openrouter.ai/api/v1/chat/completions','model','openai/gpt-6.1-sol','provider','azure','zdr',true,'dataCollection','deny','retries',0,'fallback',false,'rawPublicDisplay',false),
 'limits',jsonb_build_object('batchUsd',.2,'monthlyUsd',0,'perCallUsd',.1,'maxCalls',12))::text,true);
set local role service_role;
select public.record_currency_report_supply_check(repeat('a',64),'CLP',clock_timestamp(),'{"status":"collection_returned_not_approved","baseDate":"2026-10-30","dataStatus":"usable_reference","candidates":0,"sources":[{"sourceId":"clp-fixture","statuses":["access_failed"],"body":"NOT-ALLOWED-IN-SUMMARY"}],"raw":"NOT-ALLOWED-IN-SUMMARY"}');
reset role;
select ok(not (select result::text like '%NOT-ALLOWED-IN-SUMMARY%' from app_private.currency_report_runtime_checks where check_key=repeat('a',64)),'diagnostics strip top-level and nested original fields');
set local role service_role;
select throws_ok($$select public.configure_currency_report_operating_policy(current_setting('recovery.policy')::jsonb || jsonb_build_object('expiresAt',clock_timestamp()-interval '1 minute'),coalesce((public.currency_report_operating_policy()->>'revision')::bigint,0))$$,'22023','explicit bound one-time configuration required','expired approval cannot be configured');
select set_config('recovery.revision',public.configure_currency_report_operating_policy(current_setting('recovery.policy')::jsonb,coalesce((public.currency_report_operating_policy()->>'revision')::bigint,0))::text,true);
select throws_ok($$select public.configure_currency_report_operating_policy(current_setting('recovery.policy')::jsonb || jsonb_build_object('binding',repeat('f',64)),current_setting('recovery.revision')::bigint)$$,'23505',null,'same trial authorization cannot be reinstalled as more allowance');
reset role;
update app_private.currency_report_runtime_control set enabled=true,review_enabled=true,writer='sol',monthly_limit_nano=200000000+current_setting('recovery.prior_nano')::bigint,per_call_limit_nano=100000000;
set local role service_role;
select is(public.claim_currency_report_operating_batch(repeat('1',64),'11000000-0000-0000-0000-000000000001',current_setting('recovery.revision')::bigint,'{}',200000000,12)->>'reason','one_time_scope_or_expiry_hold','wrong dataset is not authorized by the one-time budget');
select ok((public.claim_currency_report_operating_batch(repeat('1',64),'11000000-0000-0000-0000-000000000001',current_setting('recovery.revision')::bigint,jsonb_build_object('datasetBinding',repeat('d',64)),200000000,12)->>'claimed')::boolean,'one bound trial can claim one batch');
select ok((public.claim_currency_report_operating_case(repeat('1',64),'11000000-0000-0000-0000-000000000001',repeat('2',64),repeat('3',64),'CLP',repeat('4',64))->>'claimed')::boolean,'case is claimed before any request');
select set_config('recovery.context',jsonb_build_object('writer','sol','operatingBatchKey',repeat('1',64),'operatingOwner','11000000-0000-0000-0000-000000000001','operatingCaseKey',repeat('2',64),'testOnly',true)::text,true);
select set_config('recovery.job',public.reserve_currency_report_runtime(repeat('5',64),'CLP','2096-11-01','writer',repeat('6',64),current_setting('recovery.context')::jsonb,90000000,(public.currency_report_runtime_control()->>'revision')::bigint)->>'id',true);
select is(public.release_currency_report_operating_unsent(current_setting('recovery.job')::uuid)->>'reason','live_or_dispatched_reservation','live worker reservation cannot be cancelled by recovery');
select public.checkpoint_currency_report_operating_batch(repeat('1',64),'11000000-0000-0000-0000-000000000001','paused','{"status":"synthetic-interrupted-before-dispatch"}');
select ok((public.release_currency_report_operating_unsent(current_setting('recovery.job')::uuid)->>'released')::boolean,'paused reservation never begun can be released with zero cost');
select ok((public.claim_currency_report_operating_batch(repeat('1',64),'11000000-0000-0000-0000-000000000001',current_setting('recovery.revision')::bigint,jsonb_build_object('datasetBinding',repeat('d',64)),200000000,12)->>'claimed')::boolean,'same frozen batch resumes');
select is(public.reserve_currency_report_runtime(repeat('5',64),'CLP','2096-11-01','writer',repeat('7',64),current_setting('recovery.context')::jsonb,90000000,(public.currency_report_runtime_control()->>'revision')::bigint)->>'reason','released_request_changed','unsent recovery does not allow a different request');
select ok((public.reserve_currency_report_runtime(repeat('5',64),'CLP','2096-11-01','writer',repeat('6',64),current_setting('recovery.context')::jsonb,90000000,(public.currency_report_runtime_control()->>'revision')::bigint)->>'resumedUnsent')::boolean,'same never-dispatched request is reserved again without a second job');
select ok(public.begin_currency_report_runtime(current_setting('recovery.job')::uuid,repeat('6',64)),'recovered unsent request can begin once');
select public.checkpoint_currency_report_runtime(current_setting('recovery.job')::uuid,'{"responseId":"gen-synthetic-recovery","phase":"headers"}');
select is(public.release_currency_report_operating_unsent(current_setting('recovery.job')::uuid)->>'reason','live_or_dispatched_reservation','dispatched uncertain request is never released as zero cost');
select public.checkpoint_currency_report_operating_batch(repeat('1',64),'11000000-0000-0000-0000-000000000001','cost_unresolved','{"status":"synthetic-unknown-cost"}');
select is((select count(*) from jsonb_array_elements(public.currency_report_operating_recoverable_calls()) j where j->>'id'=current_setting('recovery.job')),1::bigint,'unknown request appears in service-only reconciliation queue');
select public.reconcile_currency_report_runtime_cost(current_setting('recovery.job')::uuid,'gen-synthetic-recovery',20000000,'{"source":"generation.total_cost","responseId":"gen-synthetic-recovery","costNano":"20000000"}');
select ok((public.claim_currency_report_operating_batch(repeat('1',64),'11000000-0000-0000-0000-000000000001',current_setting('recovery.revision')::bigint,jsonb_build_object('datasetBinding',repeat('d',64)),200000000,12)->>'claimed')::boolean,'reconciled batch can resume under its original budget');
select set_config('recovery.validjob',public.reserve_currency_report_runtime(repeat('b',64),'CLP','2096-11-01','writer',repeat('c',64),current_setting('recovery.context')::jsonb,90000000,(public.currency_report_runtime_control()->>'revision')::bigint)->>'id',true);
select ok(public.begin_currency_report_runtime(current_setting('recovery.validjob')::uuid,repeat('c',64)),'synthetic valid response has its own reserved stage');
select public.checkpoint_currency_report_runtime(current_setting('recovery.validjob')::uuid,'{"responseId":"gen-synthetic-recovery-valid","phase":"headers"}');
select public.receive_currency_report_runtime(current_setting('recovery.validjob')::uuid,'{"valid":true,"costUsd":null}',null);
select public.finish_currency_report_operating_case(repeat('1',64),'11000000-0000-0000-0000-000000000001',repeat('2',64),'held','{"status":"source_cost_unresolved"}');
select public.checkpoint_currency_report_operating_batch(repeat('1',64),'11000000-0000-0000-0000-000000000001','cost_unresolved','{"status":"synthetic-valid-unknown-cost"}');
select public.reconcile_currency_report_runtime_cost(current_setting('recovery.validjob')::uuid,'gen-synthetic-recovery-valid',10000000,'{"source":"generation.total_cost","responseId":"gen-synthetic-recovery-valid","costNano":"10000000"}');
select ok((public.claim_currency_report_operating_batch(repeat('1',64),'11000000-0000-0000-0000-000000000001',current_setting('recovery.revision')::bigint,jsonb_build_object('datasetBinding',repeat('d',64)),200000000,12)->>'claimed')::boolean,'valid response cost reconciliation retains the same batch');
select ok((public.claim_currency_report_operating_case(repeat('1',64),'11000000-0000-0000-0000-000000000001',repeat('2',64),repeat('3',64),'CLP',repeat('4',64))->>'resumed')::boolean,'only a held cost case with a confirmed reusable response resumes');
select is(public.claim_currency_report_operating_batch(repeat('8',64),'11000000-0000-0000-0000-000000000001',current_setting('recovery.revision')::bigint,jsonb_build_object('datasetBinding',repeat('d',64)),200000000,12)->>'reason','one_time_scope_or_expiry_hold','trial cannot acquire a second batch after a reconciled expense');
reset role;
select is((select actual_nano from app_private.currency_report_runtime_jobs where id=current_setting('recovery.job')::uuid),20000000::bigint,'reconciled cost is preserved');
select is((select response->>'costUsd' from app_private.currency_report_runtime_jobs where id=current_setting('recovery.validjob')::uuid),null::text,'cost reconciliation never rewrites the original model response');
select is((select count(*) from app_private.currency_report_runtime_jobs where task_key=repeat('5',64)),1::bigint,'unsent recovery preserves one job identity');
select * from finish();
rollback;
