-- Configuration revisions must never orphan resumable or unpaid work.
begin;
set local search_path=public,extensions,pg_catalog;
select no_plan();
select set_config('drain.policy',jsonb_build_object('version','report-operating-policy/1','binding',repeat('c',64),
 'configurationTrust','server_owned_never_article_or_model_input','publication','separate_active_admin_review','state','proposal_not_enabled',
 'limits',jsonb_build_object('batchUsd',.2,'perCallUsd',.1,'maxCalls',12))::text,true);
set local role service_role;
select set_config('drain.rev',public.configure_currency_report_operating_policy(current_setting('drain.policy')::jsonb,
 coalesce((public.currency_report_operating_policy()->>'revision')::bigint,0))::text,true);
reset role;
insert into app_private.currency_report_operating_batches(batch_key,policy_revision,owner_id,state,lease_until,budget_nano,max_calls,payload)
values(repeat('d',64),current_setting('drain.rev')::bigint,'dc000000-0000-0000-0000-000000000001','paused',clock_timestamp()-interval '1 minute',100000000,12,'{}');
select set_config('drain.next',jsonb_set(current_setting('drain.policy')::jsonb,'{binding}',to_jsonb(repeat('e',64)))::text,true);
set local role service_role;
select throws_ok($$select public.configure_currency_report_operating_policy(current_setting('drain.next')::jsonb,current_setting('drain.rev')::bigint)$$,
 '55000','resolve pending operating work before configuration change','paused work keeps its recoverable revision');
select is((public.currency_report_operating_policy()->>'revision')::bigint,current_setting('drain.rev')::bigint,'rejected change leaves configuration unchanged');
reset role;
update app_private.currency_report_operating_batches set state='running' where batch_key=repeat('d',64);
set local role service_role;
select throws_ok($$select public.configure_currency_report_operating_policy(current_setting('drain.next')::jsonb,current_setting('drain.rev')::bigint)$$,
 '55000','resolve pending operating work before configuration change','expired running lease remains recoverable');
reset role;
update app_private.currency_report_operating_batches set state='cost_unresolved' where batch_key=repeat('d',64);
set local role service_role;
select throws_ok($$select public.configure_currency_report_operating_policy(current_setting('drain.next')::jsonb,current_setting('drain.rev')::bigint)$$,
 '55000','resolve pending operating work before configuration change','unresolved batch cannot be hidden');
reset role;
update app_private.currency_report_operating_batches set state='completed' where batch_key=repeat('d',64);
insert into app_private.currency_report_runtime_jobs(id,task_key,currency,base_date,stage,state,request_hash,context,reserved_nano,cost_state,control_revision)
values('dc000000-0000-0000-0000-000000000002',repeat('f',64),'MXN','2095-01-02','writer','reserved',repeat('f',64),'{}',100000000,'reserved',1);
set local role service_role;
select throws_ok($$select public.configure_currency_report_operating_policy(current_setting('drain.next')::jsonb,current_setting('drain.rev')::bigint)$$,
 '55000','resolve pending operating work before configuration change','unstarted reservation must be settled before reconfiguration');
reset role;
update app_private.currency_report_runtime_jobs set state='received',cost_state='unknown' where id='dc000000-0000-0000-0000-000000000002';
set local role service_role;
select throws_ok($$select public.configure_currency_report_operating_policy(current_setting('drain.next')::jsonb,current_setting('drain.rev')::bigint)$$,
 '55000','resolve pending operating work before configuration change','unknown charge remains visible');
reset role;
update app_private.currency_report_runtime_jobs set cost_state='confirmed',actual_nano=0 where id='dc000000-0000-0000-0000-000000000002';
set local role service_role;
select lives_ok($$select public.configure_currency_report_operating_policy(current_setting('drain.next')::jsonb,current_setting('drain.rev')::bigint)$$,
 'completed settled work allows a new configuration without deleting history');
reset role;
select is((select count(*) from app_private.currency_report_operating_batches where batch_key=repeat('d',64)),1::bigint,'old batch is preserved');
select ok(not has_function_privilege('authenticated','public.configure_currency_report_operating_policy(jsonb,bigint)','EXECUTE'),'configuration stays server-only');
select * from finish();
rollback;
