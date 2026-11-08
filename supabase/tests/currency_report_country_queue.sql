begin;
set local search_path=public,extensions,pg_catalog;
select no_plan();
select ok(not has_function_privilege('anon','public.pending_currency_report_operating_batches(bigint)','EXECUTE'),'anonymous readers cannot see the work queue');
select ok(not has_function_privilege('authenticated','public.pending_currency_report_operating_batches(bigint)','EXECUTE'),'normal users cannot read frozen originals');
select ok(has_function_privilege('service_role','public.pending_currency_report_operating_batches(bigint)','EXECUTE'),'service worker retains queue access');
select ok(to_regclass('app_private.currency_operating_pending_revision') is not null,'bounded pending lookup has a partial index');
select set_config('queue.policy',jsonb_build_object('version','report-operating-policy/1','binding',repeat('a',64),
 'configurationTrust','server_owned_never_article_or_model_input','publication','separate_active_admin_review','state','operator_configured',
 'externalTransmissionAuthorization','approved_by_operator','recurringBudgetAuthorization','approved_by_operator',
 'authorizationReference','synthetic-queue-only','configuredAt',clock_timestamp(),
 'destination',jsonb_build_object('endpoint','https://openrouter.ai/api/v1/chat/completions','model','openai/gpt-6.1-sol','provider','azure','zdr',true,'dataCollection','deny','retries',0,'fallback',false,'rawPublicDisplay',false),
 'limits',jsonb_build_object('batchUsd',7,'monthlyUsd',7,'perCallUsd',.25,'maxCalls',60))::text,true);
set local role service_role;
select set_config('queue.revision',public.configure_currency_report_operating_policy(current_setting('queue.policy')::jsonb,coalesce((public.currency_report_operating_policy()->>'revision')::bigint,0))::text,true);
reset role;
update app_private.currency_report_runtime_control set enabled=true,review_enabled=true,writer='sol',monthly_limit_nano=7000000000,per_call_limit_nano=250000000;
set local role service_role;
select ok((public.claim_currency_report_operating_batch(repeat('1',64),'13000000-0000-0000-0000-000000000001',current_setting('queue.revision')::bigint,'{}',7000000000,60)->>'claimed')::boolean,'first envelope is leased');
select ok((public.claim_currency_report_operating_case(repeat('1',64),'13000000-0000-0000-0000-000000000001',repeat('2',64),repeat('3',64),'PEN',repeat('4',64))->>'claimed')::boolean,'PEN owns its original work');
select public.finish_currency_report_operating_case(repeat('1',64),'13000000-0000-0000-0000-000000000001',repeat('2',64),'paused','{"status":"frozen_source_refresh_wait"}');
select public.checkpoint_currency_report_operating_batch(repeat('1',64),'13000000-0000-0000-0000-000000000001','paused','{"status":"paused"}');
select ok((public.claim_currency_report_operating_batch(repeat('5',64),'13000000-0000-0000-0000-000000000002',current_setting('queue.revision')::bigint,'{}',7000000000,60)->>'claimed')::boolean,'recurring scope permits COP while PEN waits');
select ok((public.claim_currency_report_operating_case(repeat('5',64),'13000000-0000-0000-0000-000000000002',repeat('6',64),repeat('7',64),'COP',repeat('8',64))->>'claimed')::boolean,'COP owns a separate current edition');
select public.finish_currency_report_operating_case(repeat('5',64),'13000000-0000-0000-0000-000000000002',repeat('6',64),'paused','{"status":"runtime_endpoint_preflight_wait"}');
select public.checkpoint_currency_report_operating_batch(repeat('5',64),'13000000-0000-0000-0000-000000000002','paused','{"status":"paused"}');
select is(jsonb_array_length(public.pending_currency_report_operating_batches(current_setting('queue.revision')::bigint)),2,'both waiting envelopes are visible');
select is(public.pending_currency_report_operating_batches(current_setting('queue.revision')::bigint)->0->>'batch_key',repeat('1',64),'original ordering remains stable');
select is(public.pending_currency_report_operating_batches(current_setting('queue.revision')::bigint)->1->>'batch_key',repeat('5',64),'second waiting envelope is not hidden by the first');
select ok((public.claim_currency_report_operating_batch(repeat('5',64),'13000000-0000-0000-0000-000000000003',current_setting('queue.revision')::bigint,'{}',7000000000,60)->>'claimed')::boolean,'later envelope can be reclaimed without completing the oldest');
select ok((public.claim_currency_report_operating_case(repeat('5',64),'13000000-0000-0000-0000-000000000003',repeat('6',64),repeat('7',64),'COP',repeat('8',64))->>'resumed')::boolean,'COP resumes its exact original key');
select is((select state from app_private.currency_report_operating_cases where case_key=repeat('2',64)),'paused','PEN stays paused under its original owner');
select is(public.claim_currency_report_operating_batch(repeat('9',64),'13000000-0000-0000-0000-000000000004',current_setting('queue.revision')::bigint,'{}',7000000000,60)->>'reason','operating_batch_busy','a second active lease is still prohibited');
select set_config('queue.job',public.reserve_currency_report_runtime(repeat('a',64),'COP','2097-01-01','writer',repeat('b',64),
 jsonb_build_object('writer','sol','purpose','original_source_review','operatingBatchKey',repeat('5',64),'operatingOwner','13000000-0000-0000-0000-000000000003','operatingCaseKey',repeat('6',64)),10000000,(public.currency_report_runtime_control()->>'revision')::bigint)->>'id',true);
select ok(public.begin_currency_report_runtime(current_setting('queue.job')::uuid,repeat('b',64)),'synthetic request has a durable unknown reservation without a model call');
select public.finish_currency_report_operating_case(repeat('5',64),'13000000-0000-0000-0000-000000000003',repeat('6',64),'paused','{"status":"source_cost_unresolved"}');
select public.checkpoint_currency_report_operating_batch(repeat('5',64),'13000000-0000-0000-0000-000000000003','paused','{"status":"source_cost_unresolved"}');
select is(public.claim_currency_report_operating_batch(repeat('9',64),'13000000-0000-0000-0000-000000000004',current_setting('queue.revision')::bigint,'{}',7000000000,60)->>'reason','unresolved_or_inflight_call','unknown cost blocks every new envelope');
select public.receive_currency_report_runtime(current_setting('queue.job')::uuid,'{"valid":true,"costUsd":0.001}',1000000);
select is((select context->>'operatingBatchKey' from app_private.currency_report_runtime_jobs where id=current_setting('queue.job')::uuid),repeat('5',64),'expense stays in the envelope that sent it');
select is((select actual_nano from app_private.currency_report_runtime_jobs where id=current_setting('queue.job')::uuid),1000000::bigint,'queue lookup never resets confirmed spending');
reset role;
-- The seventeenth row is an explicit overflow signal to the coordinator.
insert into app_private.currency_report_operating_batches(batch_key,policy_revision,owner_id,state,lease_until,budget_nano,max_calls,payload)
select md5(n::text)||md5(('q'||n)::text),current_setting('queue.revision')::bigint,'13000000-0000-0000-0000-000000000005','paused',clock_timestamp(),7000000000,60,'{}'
from generate_series(1,18) n;
set local role service_role;
select is(jsonb_array_length(public.pending_currency_report_operating_batches(current_setting('queue.revision')::bigint)),17,'queue is bounded and exposes overflow rather than silently dropping work');
reset role;
select * from finish();
rollback;
