begin;
set local search_path=public,extensions,pg_catalog;
select no_plan();

update app_private.currency_report_runtime_control
 set enabled=false,review_enabled=false,writer='sol',monthly_limit_nano=30000000000,per_call_limit_nano=250000000;
select public.configure_currency_report_recovery_policy(true,1,'capacity-isolation-local-test');
select ok(not has_function_privilege('anon','public.receive_currency_report_runtime_accounted(uuid,jsonb,bigint,uuid)','execute'),'receipt writing is server only');
select ok(not has_function_privilege('authenticated','public.receive_currency_report_runtime_accounted(uuid,jsonb,bigint,uuid)','execute'),'admin browser cannot isolate expenses');

create function pg_temp.capacity_response(p_id text) returns jsonb language sql as $$
 select jsonb_build_object('responseId',p_id,'valid',false,'partialText','','usage',null,
  'httpStatus',200,'errors',jsonb_build_array('provider_stream_error'),'done',false,'finishReason',null,
  'providerError',jsonb_build_object('code',502,'metadata',jsonb_build_object('error_type','provider_unavailable')));
$$;

-- Public IDs are synthetic. The BRL error shape and reservation match the
-- observed production receipt, without copying the prompt or provider text.
insert into app_private.currency_report_runtime_jobs
 (id,task_key,currency,base_date,stage,state,request_hash,context,response,response_id,checkpoint,
  reserved_nano,cost_state,control_revision,created_at,received_at)
values('96000000-0000-0000-0000-000000000001',repeat('a',64),'BRL','2026-11-16','writer','received',repeat('b',64),
 jsonb_build_object('operatingBatchKey',repeat('c',64),'operatingCaseKey',repeat('d',64),'model','openai/gpt-6.1-sol','provider','azure/us'),
 pg_temp.capacity_response('gen-synthetic-brl-capacity'),'gen-synthetic-brl-capacity','{"responseId":"gen-synthetic-brl-capacity","phase":"headers"}',
 193063750,'unknown',1,date_trunc('month',clock_timestamp())-interval '1 month',clock_timestamp()-interval '2 days');

select public.record_currency_report_recovery_lookup('96000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001','{"version":"generation-cost-lookup/1","reason":"record_not_found","httpStatus":404}');
select is(public.decide_currency_report_recovery('96000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001')->>'status',
 'cost_fully_reserved_unconfirmed','observed BRL failure can be isolated');
select public.record_currency_report_recovery_lookup('96000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000002','{"version":"generation-cost-lookup/1","reason":"record_not_found","httpStatus":404}');
select is(public.decide_currency_report_recovery('96000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000002')->>'reservedNano',
 '193063750','repeated 404 preserves the entire original reserve');
select is((select count(*) from app_private.currency_report_recovery_events where job_id='96000000-0000-0000-0000-000000000001'),
 1::bigint,'repeat lookup does not create another isolation event');
select is((select count(*) from app_private.currency_report_recovery_routes),0::bigint,'historic error does not impose a new route cooldown');
select ok(not coalesce((public.currency_report_recovery_attempt(repeat('a',64),repeat('b',64),'97000000-0000-0000-0000-000000000003')->>'allowed')::boolean,false),
 '502 never acquires retry authority');

update app_private.currency_report_runtime_control set enabled=true,review_enabled=true,monthly_limit_nano=200000000;
select is(public.reserve_currency_report_runtime(repeat('e',64),'CLP','2026-11-20','writer',repeat('f',64),
 '{"writer":"sol","model":"openai/gpt-6.1-sol","provider":"azure"}',10000000,(select revision from app_private.currency_report_runtime_control),null)->>'reason',
 'monthly_budget_hold','unsettled prior month reservation reduces current budget');
select is(public.reserve_currency_report_runtime(repeat('e',64),'CLP','2026-11-20','writer',repeat('f',64),
 '{"writer":"sol","model":"openai/gpt-6.1-sol","provider":"azure"}',1000000,(select revision from app_private.currency_report_runtime_control),null)->>'reserved',
 'true','another currency can use the remaining budget');
delete from app_private.currency_report_runtime_jobs where task_key=repeat('e',64);

update app_private.currency_report_runtime_jobs set response=jsonb_set(response,'{partialText}','"partial"')
 where id='96000000-0000-0000-0000-000000000001';
select ok(not app_private.runtime_cost_escrowed('96000000-0000-0000-0000-000000000001'),'changed response loses the escrow proof');
select is(public.decide_currency_report_recovery('96000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000003')->>'scope',
 'global','partial output needs global accounting protection');
update app_private.currency_report_runtime_jobs set response=pg_temp.capacity_response(response_id)
 where id='96000000-0000-0000-0000-000000000001';

select public.record_currency_report_recovery_lookup('96000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000003',
 '{"version":"generation-cost-lookup/1","reason":"confirmed","httpStatus":200}',
 '{"source":"generation.total_cost","responseId":"gen-synthetic-brl-capacity","costNano":"12000000"}');
select is(public.decide_currency_report_recovery('96000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000003')->>'status',
 'response_failed_no_automatic_retry','late cost settles independent of report validity');
select is((select actual_nano from app_private.currency_report_runtime_jobs where id='96000000-0000-0000-0000-000000000001'),
 12000000::bigint,'actual expenditure is written exactly once');
select lives_ok($$select public.record_currency_report_recovery_lookup(
 '96000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000003',
 '{"version":"generation-cost-lookup/1","reason":"confirmed","httpStatus":200}',
 '{"source":"generation.total_cost","responseId":"gen-synthetic-brl-capacity","costNano":"12000000"}')$$,'identical receipt replay is safe');
select throws_ok($$select public.record_currency_report_recovery_lookup(
 '96000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000003',
 '{"version":"generation-cost-lookup/1","reason":"confirmed","httpStatus":200}',
 '{"source":"generation.total_cost","responseId":"gen-wrong-request","costNano":"12000000"}')$$,
 'P0001','matching confirmed lookup required','a duplicate lookup must still match the original request');
select ok(not app_private.runtime_cost_escrowed('96000000-0000-0000-0000-000000000001'),'settlement releases the accounting reserve');

insert into app_private.currency_report_operating_policies(binding,policy) values(repeat('1',64),'{}');
insert into app_private.currency_report_operating_batches(batch_key,policy_revision,owner_id,state,lease_until,budget_nano,max_calls,payload)
select repeat('2',64),revision,'97000000-0000-0000-0000-000000000004','running',clock_timestamp()+interval '5 minutes',7000000000,60,'{}'
from app_private.currency_report_operating_policies where binding=repeat('1',64);
insert into app_private.currency_report_runtime_jobs
 (id,task_key,currency,base_date,stage,state,request_hash,context,response_id,checkpoint,reserved_nano,cost_state,control_revision)
select '96000000-0000-0000-0000-000000000002',repeat('3',64),'BRL','2026-11-20','writer','calling',repeat('4',64),
 jsonb_build_object('operatingBatchKey',repeat('2',64),'operatingCaseKey',repeat('5',64),
  'operatingOwner','97000000-0000-0000-0000-000000000004','model','openai/gpt-6.1-sol','provider','azure/us'),
 'gen-synthetic-active-capacity','{"responseId":"gen-synthetic-active-capacity","phase":"headers"}',193063750,'unknown',revision
from app_private.currency_report_runtime_control;
select is(public.receive_currency_report_runtime_accounted('96000000-0000-0000-0000-000000000002',
 pg_temp.capacity_response('gen-synthetic-active-capacity'),null,'97000000-0000-0000-0000-000000000004')->>'scope',
 'job','active dispatch owner can store and isolate in one transaction');
select is(public.reserve_currency_report_runtime(repeat('6',64),'CLP','2026-11-20','writer',repeat('f',64),
 '{"writer":"sol","model":"openai/gpt-6.1-sol","provider":"azure/us"}',1000000,(select revision from app_private.currency_report_runtime_control),null)->>'reason',
 'recovery_route_wait','fresh capacity error cools down only the affected route');
select is(public.reserve_currency_report_runtime(repeat('6',64),'CLP','2026-11-20','writer',repeat('f',64),
 '{"writer":"sol","model":"openai/gpt-6.1-sol","provider":"azure"}',1000000,(select revision from app_private.currency_report_runtime_control),null)->>'reserved',
 'true','other route can continue in the same execution');

select public.record_currency_report_recovery_lookup('96000000-0000-0000-0000-000000000002','97000000-0000-0000-0000-000000000005',
 '{"version":"generation-cost-lookup/1","reason":"confirmed","httpStatus":200}',
 '{"source":"generation.total_cost","responseId":"gen-synthetic-active-capacity","costNano":"194000000"}');
select is(public.begin_currency_report_runtime((select id from app_private.currency_report_runtime_jobs where task_key=repeat('6',64)),repeat('f',64)),
 false,'late overrun blocks POST even when the next request already reserved its cost');
select is((select state from app_private.currency_report_runtime_jobs where task_key=repeat('6',64)),
 'reserved','overrun does not send the next request');

select * from finish();
rollback;
