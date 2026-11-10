begin;
set local search_path=public,extensions,pg_catalog;
select no_plan();
select ok(not has_function_privilege('anon','public.register_currency_report_runtime_document(jsonb,text)','execute'),'anonymous cannot register private documents');
select ok(not has_function_privilege('authenticated','public.recover_currency_report_operating_technical_holds(bigint)','execute'),'administrator cannot directly recover worker cases');
select ok(not has_table_privilege('authenticated','app_private.currency_report_runtime_documents','select'),'private payload projections stay server-only');
select ok(not has_table_privilege('anon','app_private.currency_report_technical_recoveries','select'),'recovery audit stays private');
select is(public.currency_report_runtime_document_capability()->>'version','runtime-document/2','new persistence capability advertised');

insert into app_private.currency_report_operating_policies(binding,policy)
 values(encode(sha256(convert_to('runtime-document-fixture','UTF8')),'hex'),'{"state":"operator_configured"}');
select set_config('runtime_document.revision',(select max(revision)::text from app_private.currency_report_operating_policies),true);
insert into app_private.currency_report_operating_batches(batch_key,policy_revision,owner_id,state,lease_until,budget_nano,max_calls,payload,result)
 values(repeat('9',64),current_setting('runtime_document.revision')::bigint,'91000000-0000-0000-0000-000000000001','completed',now()-interval '1 hour',7000000000,60,'{}','{"modelCalls":5}');
insert into app_private.currency_report_operating_cases(case_key,case_id,currency,material_hash,batch_key,state,result)
 select lpad(n::text,64,'7'),lpad(n::text,64,'6'),currency,repeat('5',64),repeat('9',64),'held',result
 from (values
  (1,'BRL','{"status":"writing_input_hold","modelCalls":0,"sourceHolds":["source_endpoint_preflight_hold"]}'::jsonb),
  (2,'COP','{"status":"writer_preparation_hold","modelCalls":1,"sourceHolds":["unsafe_or_oversized_runtime_payload"]}'::jsonb),
  (3,'MXN','{"status":"writing_input_hold","modelCalls":0,"sourceHolds":["fx_explanation_required"]}'::jsonb),
  (4,'PEN','{"status":"writer_preparation_hold","modelCalls":1,"sourceHolds":["unsafe_or_oversized_runtime_payload"]}'::jsonb)
 )v(n,currency,result);
-- Only the COP case has a completed source stage. The PEN case already wrote
-- a manuscript, so it must never qualify for this narrowly scoped recovery.
insert into app_private.currency_report_runtime_jobs(task_key,currency,base_date,stage,state,request_hash,context,response,reserved_nano,actual_nano,cost_state,control_revision)
 select lpad(n::text,64,'8'),currency,'2099-11-10','writer','received',repeat('a',64),
  jsonb_build_object('operatingCaseKey',lpad(n::text,64,'7'),'purpose',purpose),'{"valid":true}',20000000,10000000,'confirmed',1
 from (values(2,'COP','original_source_review'),(4,'PEN','manuscript'))v(n,currency,purpose);
update app_private.currency_report_runtime_control set enabled=false,review_enabled=true;
select is((public.recover_currency_report_operating_technical_holds(current_setting('runtime_document.revision')::bigint)->>'recovered')::int,0,'disabled worker cannot requeue cases');
update app_private.currency_report_runtime_control set enabled=true;
select is(jsonb_array_length(public.inspect_currency_report_operating_technical_holds(current_setting('runtime_document.revision')::bigint)),1,'free inspection includes the original completed envelope');
select is((select state from app_private.currency_report_operating_batches where batch_key=repeat('9',64)),'completed','inspection does not requeue or reset anything');
savepoint accounting_boundary;
insert into app_private.currency_report_runtime_jobs(task_key,currency,base_date,stage,state,request_hash,context,reserved_nano,cost_state,control_revision)
 values(repeat('b',64),'ARS','2099-11-10','writer','calling',repeat('e',64),'{}',20000000,'unknown',1);
select is((public.recover_currency_report_operating_technical_holds(current_setting('runtime_document.revision')::bigint)->>'reason'),'unresolved_or_inflight_call','inflight/unknown accounting blocks automatic state recovery');
rollback to accounting_boundary;
set local role service_role;
select is((public.recover_currency_report_operating_technical_holds(current_setting('runtime_document.revision')::bigint)->>'recovered')::int,2,'common worker recovers zero-dispatch endpoint and source-only capacity cases');
select is((public.recover_currency_report_operating_technical_holds(current_setting('runtime_document.revision')::bigint)->>'recovered')::int,0,'repeated recovery is idempotent');
reset role;
select is((select state from app_private.currency_report_operating_cases where currency='BRL' and batch_key=repeat('9',64)),'paused','zero-dispatch case is resumable');
select is((select state from app_private.currency_report_operating_cases where currency='COP' and batch_key=repeat('9',64)),'paused','source-only case preserves completed work');
select is((select state from app_private.currency_report_operating_cases where currency='MXN' and batch_key=repeat('9',64)),'held','content hold is unchanged');
select is((select state from app_private.currency_report_operating_cases where currency='PEN' and batch_key=repeat('9',64)),'held','existing manuscript is never reset');
select is((select state from app_private.currency_report_operating_batches where batch_key=repeat('9',64)),'paused','original completed envelope is queued with original input');
select is((select result from app_private.currency_report_operating_batches where batch_key=repeat('9',64)),'{"modelCalls":5}'::jsonb,'prior batch result not rewritten');
select is((select original_result->>'status' from app_private.currency_report_technical_recoveries where case_key=lpad('2',64,'7')),'writer_preparation_hold','original result retained in audit');
select is((select actual_nano from app_private.currency_report_runtime_jobs where task_key=lpad('2',64,'8')),10000000::bigint,'actual source expense preserved');
select is((select response from app_private.currency_report_runtime_jobs where task_key=lpad('2',64,'8')),'{"valid":true}'::jsonb,'source response unchanged');

select public.record_currency_report_storage_incident('runtime','runtime_document_raw_limit_cop',false,'{}');
select set_config('runtime_document.incident_revision',(select revision::text from app_private.currency_report_storage_incidents where stage='runtime' and reason='runtime_document_raw_limit_cop'),true);
select public.record_currency_report_storage_incident('runtime','runtime_document_raw_limit_cop',false,'{}');
select is((select revision::text from app_private.currency_report_storage_incidents where stage='runtime' and reason='runtime_document_raw_limit_cop'),current_setting('runtime_document.incident_revision'),'persistent fault does not create a new notification version');
select ok(exists(select 1 from app_private.currency_report_review_items() where title='리포트 집필 입력·재개 기술 장애'),'runtime fault is visible in administrator inbox');
select public.record_currency_report_storage_incident('runtime','verified',true,'{}');
select ok(not exists(select 1 from app_private.currency_report_storage_incidents where stage='runtime' and active),'verified success resolves the incident');
select is(app_private.runtime_context_packet('{"packet":{"currency":"CLP"}}'),' {"currency":"CLP"}'::jsonb,'legacy inline packet still resolves');
select * from finish();
rollback;
