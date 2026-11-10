begin;
set local search_path=public,extensions,pg_catalog;
select no_plan();
select ok(not has_function_privilege('anon','public.recover_currency_report_operating_technical_holds(bigint)','execute'),'anonymous cannot recover worker cases');
select ok(not has_function_privilege('authenticated','app_private.recover_operating_before_candidate_scope(bigint)','execute'),'old recovery remains server-only');
insert into app_private.currency_report_operating_policies(binding,policy)
 values(encode(sha256(convert_to('candidate-scope-fixture','UTF8')),'hex'),'{"state":"operator_configured"}');
select set_config('candidate_scope.revision',(select max(revision)::text from app_private.currency_report_operating_policies),true);
insert into app_private.currency_report_operating_batches(batch_key,policy_revision,owner_id,state,lease_until,budget_nano,max_calls,payload,result)
 values(repeat('c',64),current_setting('candidate_scope.revision')::bigint,'92000000-0000-0000-0000-000000000001','completed',now()-interval '1 hour',7000000000,60,'{}','{"modelCalls":5}');
insert into app_private.currency_report_operating_cases(case_key,case_id,currency,material_hash,batch_key,state,result)
 select lpad(n::text,64,'d'),lpad(n::text,64,'e'),currency,repeat('f',64),repeat('c',64),'held',
  jsonb_build_object('status','frozen_source_review_revalidation_required','newInputDeferred',true,'holds',jsonb_build_array(hold))
 from (values(1,'COP','original_pipeline_failed'),(2,'MXN','source_review_withdrawn'),
  (3,'BRL','source_review_conflict'),(4,'PEN','original_support_hold'))v(n,currency,hold);
-- A prior runtime recovery must not prevent a distinct audited scope repair.
insert into app_private.currency_report_technical_recoveries
 values(lpad('1',64,'d'),'runtime-document/2','held','{"status":"writer_preparation_hold"}','completed',clock_timestamp());
insert into app_private.currency_report_runtime_jobs(task_key,currency,base_date,stage,state,request_hash,context,response,reserved_nano,actual_nano,cost_state,control_revision)
 values(repeat('a',64),'PEN','2099-11-10','writer','received',repeat('b',64),
  jsonb_build_object('operatingCaseKey',lpad('4',64,'d')),'{"valid":true}',20000000,10000000,'confirmed',1);
update app_private.currency_report_runtime_control set enabled=false,review_enabled=true;
select is((public.recover_currency_report_operating_technical_holds(current_setting('candidate_scope.revision')::bigint)->>'recovered')::int,0,'disabled worker cannot recover candidates');
update app_private.currency_report_runtime_control set enabled=true;
select is(jsonb_array_length(public.inspect_currency_report_operating_technical_holds(current_setting('candidate_scope.revision')::bigint)),1,'free inspector sees repairable completed envelope');
select is((select state from app_private.currency_report_operating_cases where case_key=lpad('1',64,'d')),'held','free inspection never changes state');
savepoint accounting;
insert into app_private.currency_report_runtime_jobs(task_key,currency,base_date,stage,state,request_hash,context,reserved_nano,cost_state,control_revision)
 values(repeat('1',64),'ARS','2099-11-10','writer','calling',repeat('2',64),'{}',20000000,'unknown',1);
select is(public.recover_currency_report_operating_technical_holds(current_setting('candidate_scope.revision')::bigint)->>'reason','unresolved_or_inflight_call','inflight costs prevent scope recovery');
rollback to accounting;
set local role service_role;
select is((public.recover_currency_report_operating_technical_holds(current_setting('candidate_scope.revision')::bigint)->>'recovered')::int,1,'worker requeues only candidate gate without a manuscript');
select is((public.recover_currency_report_operating_technical_holds(current_setting('candidate_scope.revision')::bigint)->>'recovered')::int,0,'scope recovery is idempotent');
reset role;
select is((select state from app_private.currency_report_operating_cases where case_key=lpad('1',64,'d')),'paused','original input can be rechecked by the worker');
select is((select count(*) from app_private.currency_report_operating_cases where batch_key=repeat('c',64) and state='held'),3::bigint,'withdrawal, conflict and already written work remain held');
select is((select count(*) from app_private.currency_report_technical_recoveries where case_key=lpad('1',64,'d')),2::bigint,'distinct recovery audits both survive');
select is((select original_result->>'status' from app_private.currency_report_technical_recoveries where case_key=lpad('1',64,'d') and repair_version='runtime-source-candidate/1'),'frozen_source_review_revalidation_required','old false hold remains in audit');
select is((select result->>'modelCalls' from app_private.currency_report_operating_batches where batch_key=repeat('c',64)),'5','earlier batch result is unchanged');
select is((select actual_nano from app_private.currency_report_runtime_jobs where task_key=repeat('a',64)),10000000::bigint,'cost and paid response remain unchanged');
select * from finish();
rollback;
