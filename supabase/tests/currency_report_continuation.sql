-- Synthetic operating-state regression only; no HTTP/model call. All rollback.
begin;
set local search_path=public,extensions,pg_catalog;
select no_plan();
select is((select enabled or review_enabled from app_private.currency_report_runtime_control),false,'continuation testing starts with generation disabled');
select set_config('continuation.policy',jsonb_build_object(
 'version','report-operating-policy/1','binding',repeat('1',64),'configurationTrust','server_owned_never_article_or_model_input',
 'publication','separate_active_admin_review','state','trial_configured','externalTransmissionAuthorization','approved_by_operator',
 'recurringBudgetAuthorization','not_authorized','trialBudgetAuthorization','approved_by_operator','budgetScope','one_time_trial_only',
 'datasetBinding',repeat('d',64),'authorizationReference','synthetic-zero-dispatch-rollback-only',
 'configuredAt',clock_timestamp(),'expiresAt',clock_timestamp()+interval '1 hour',
 'accountingPriorSpendUsd',(select coalesce(sum(case when cost_state='confirmed' and created_at>=date_trunc('month',clock_timestamp()) then actual_nano when app_private.runtime_cost_escrowed(id) then reserved_nano else 0 end),0)/1e9 from app_private.currency_report_runtime_jobs),
 'destination',jsonb_build_object('endpoint','https://openrouter.ai/api/v1/chat/completions','model','openai/gpt-6.1-sol','provider','azure','zdr',true,'dataCollection','deny','retries',0,'fallback',false,'rawPublicDisplay',false),
 'limits',jsonb_build_object('batchUsd',.2,'monthlyUsd',0,'perCallUsd',.1,'maxCalls',12))::text,true);
set local role service_role;
select set_config('continuation.first',public.configure_currency_report_operating_policy(current_setting('continuation.policy')::jsonb,coalesce((public.currency_report_operating_policy()->>'revision')::bigint,0))::text,true);
reset role;
update app_private.currency_report_runtime_control set enabled=true,review_enabled=true,writer='sol',
 monthly_limit_nano=(((current_setting('continuation.policy')::jsonb->>'accountingPriorSpendUsd')::numeric+.2)*1e9)::bigint;
set local role service_role;
select public.claim_currency_report_operating_batch(repeat('2',64),'52000000-0000-0000-0000-000000000001',current_setting('continuation.first')::bigint,jsonb_build_object('datasetBinding',repeat('d',64)),200000000,12);
select public.checkpoint_currency_report_operating_batch(repeat('2',64),'52000000-0000-0000-0000-000000000001','completed','{"modelCalls":0}');
select set_config('continuation.next',(current_setting('continuation.policy')::jsonb || jsonb_build_object('binding',repeat('3',64),'continuationOfRevision',current_setting('continuation.first')::bigint))::text,true);
select lives_ok($$select public.configure_currency_report_operating_policy(current_setting('continuation.next')::jsonb,current_setting('continuation.first')::bigint)$$,'zero dispatched jobs permit only the same allowance to continue');
select set_config('continuation.revision',(public.currency_report_operating_policy()->>'revision'),true);
select throws_ok($$select public.configure_currency_report_operating_policy(jsonb_set(current_setting('continuation.next')::jsonb,'{limits,batchUsd}','0.21'),current_setting('continuation.revision')::bigint)$$,'23505','same unspent trial scope required','continuation cannot increase funding');
select public.claim_currency_report_operating_batch(repeat('4',64),'52000000-0000-0000-0000-000000000001',current_setting('continuation.revision')::bigint,jsonb_build_object('datasetBinding',repeat('d',64)),200000000,12);
reset role;
insert into public.currency_report_runs(id,currency,base_date,attempt,rule_version,event_binding,packet,candidate,validation)
 values('52000000-0000-0000-0000-000000000002','BRL','2095-12-09',1,'synthetic-continuation/1','synthetic','{}','{"testOnly":false}','{"contentReview":"unverified"}');
insert into app_private.currency_report_operating_cases(case_key,case_id,currency,material_hash,batch_key,state,run_id)
 values(repeat('5',64),repeat('6',64),'BRL',repeat('7',64),repeat('2',64),'held','52000000-0000-0000-0000-000000000002');
set local role service_role;
select is(public.claim_currency_report_operating_case(repeat('4',64),'52000000-0000-0000-0000-000000000001',repeat('8',64),repeat('6',64),'BRL',repeat('8',64))->>'claimed','true','held manuscript with pending row status does not block changed material');
select public.finish_currency_report_operating_case(repeat('4',64),'52000000-0000-0000-0000-000000000001',repeat('8',64),'held','{"status":"synthetic_hold"}');
reset role;
update app_private.currency_report_operating_cases set state='pending_admin_review' where case_key=repeat('5',64);
set local role service_role;
select is(public.claim_currency_report_operating_case(repeat('4',64),'52000000-0000-0000-0000-000000000001',repeat('9',64),repeat('6',64),'BRL',repeat('9',64))->>'reason','pending_admin_review','a real pending approval still blocks another manuscript');
reset role;
insert into app_private.currency_report_runtime_jobs(task_key,currency,base_date,stage,state,request_hash,context,reserved_nano,actual_nano,cost_state,control_revision)
 values(repeat('c',64),'BRL','2095-12-09','writer','finished',repeat('d',64),jsonb_build_object('operatingBatchKey',repeat('4',64)),1,1,'confirmed',(select revision from app_private.currency_report_runtime_control));
set local role service_role;
select public.checkpoint_currency_report_operating_batch(repeat('4',64),'52000000-0000-0000-0000-000000000001','completed','{"modelCalls":1}');
select throws_ok($$select public.configure_currency_report_operating_policy(current_setting('continuation.next')::jsonb || jsonb_build_object('binding',repeat('e',64),'continuationOfRevision',current_setting('continuation.revision')::bigint),current_setting('continuation.revision')::bigint)$$,'23505','same unspent trial scope required','a recorded job prevents reinstalling a used allowance');
reset role;
select * from finish();
rollback;
