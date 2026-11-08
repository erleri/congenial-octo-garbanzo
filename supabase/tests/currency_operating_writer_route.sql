begin;
set local search_path=public,extensions,pg_catalog;
select no_plan();
select set_config('writer.test.policy',jsonb_build_object('version','report-operating-policy/1','binding',repeat('8',64),
 'configurationTrust','server_owned_never_article_or_model_input','publication','separate_active_admin_review','state','operator_configured',
 'writer','sol-us','externalTransmissionAuthorization','approved_by_operator','recurringBudgetAuthorization','approved_by_operator',
 'authorizationReference','synthetic-writer-route',
 'destination',jsonb_build_object('endpoint','https://openrouter.ai/api/v1/chat/completions','model','openai/gpt-6.1-sol',
 'provider','azure','writerProvider','azure/us','zdr',true,'dataCollection','deny','retries',0,'fallback',false,'rawPublicDisplay',false),
 'limits',jsonb_build_object('batchUsd',.2,'monthlyUsd',1+(select coalesce(sum(case when cost_state='confirmed' and created_at>=date_trunc('month',clock_timestamp()) then actual_nano when app_private.runtime_cost_escrowed(id) then reserved_nano else 0 end),0)/1e9 from app_private.currency_report_runtime_jobs),
 'perCallUsd',.1,'maxCalls',12))::text,true);
set local role service_role;
select set_config('writer.test.rev',public.configure_currency_report_operating_policy(current_setting('writer.test.policy')::jsonb,
 coalesce((public.currency_report_operating_policy()->>'revision')::bigint,0))::text,true);
select throws_ok($$select public.configure_currency_report_operating_policy(jsonb_set(current_setting('writer.test.policy')::jsonb,'{destination,writerProvider}','"azure"'),current_setting('writer.test.rev')::bigint)$$,
 '22023','server operating policy required','a selected US writer cannot silently use another route');
reset role;
update app_private.currency_report_runtime_control set enabled=true,review_enabled=true,writer='sol',
 monthly_limit_nano=((current_setting('writer.test.policy')::jsonb->'limits'->>'monthlyUsd')::numeric*1e9)::bigint;
set local role service_role;
select is(public.claim_currency_report_operating_batch(repeat('8',64),'08000000-0000-0000-0000-000000000001',current_setting('writer.test.rev')::bigint,'{}',200000000,12)->>'reason',
 'operating_configuration_hold','writer selection must match in server policy and DB control');
reset role;
update app_private.currency_report_runtime_control set writer='sol-us';
set local role service_role;
select is(public.claim_currency_report_operating_batch(repeat('8',64),'08000000-0000-0000-0000-000000000001',current_setting('writer.test.rev')::bigint,'{}',200000000,12)->>'claimed',
 'true','an explicitly configured same-model US writer can execute');
reset role;
update app_private.currency_report_operating_batches set state='paused',lease_until=clock_timestamp()-interval '1 second' where batch_key=repeat('8',64);
set local role service_role;
select is(public.supersede_currency_report_operating_batch(repeat('8',64),current_setting('writer.test.rev')::bigint,'frozen_material_superseded')->>'superseded',
 'true','the same explicit writer binding also permits controlled recovery');
reset role;
select ok(not has_function_privilege('authenticated','public.claim_currency_report_operating_batch(text,uuid,bigint,jsonb,bigint,integer)','EXECUTE'),
 'writer selection adds no client execution permission');
select * from finish();
rollback;
