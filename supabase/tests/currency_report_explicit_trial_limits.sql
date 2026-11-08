begin;
set local search_path=public,extensions,pg_catalog;
select no_plan();
-- Synthetic authorization/configuration only; all rows and enabled controls
-- below roll back. No model request is made by these database functions.
select set_config('limits.rev',(select coalesce(max(revision),0)::text from app_private.currency_report_operating_policies),true);
select set_config('limits.base',jsonb_build_object(
 'version','report-operating-policy/1','binding',repeat('a',64),'configurationTrust','server_owned_never_article_or_model_input',
 'publication','separate_active_admin_review','state','proposal_not_enabled',
 'limits',jsonb_build_object('batchUsd',7,'maxCalls',60,'perCallUsd',.25,'monthlyUsd',0))::text,true);
select throws_ok(format('select public.configure_currency_report_operating_policy(%L::jsonb,%s)',
 jsonb_set(current_setting('limits.base')::jsonb,'{limits,batchUsd}','7.01'),current_setting('limits.rev')),
 '22023','operating cost bounds required','ordinary proposal cannot exceed the unchanged $7 ceiling');
select throws_ok(format('select public.configure_currency_report_operating_policy(%L::jsonb,%s)',
 jsonb_set(current_setting('limits.base')::jsonb,'{limits,maxCalls}','61'),current_setting('limits.rev')),
 '22023','operating cost bounds required','ordinary proposal cannot exceed 60 calls');
select set_config('limits.trial',(current_setting('limits.base')::jsonb || jsonb_build_object(
 'state','trial_configured','budgetScope','one_time_trial_only','externalTransmissionAuthorization','approved_by_operator',
 'trialBudgetAuthorization','approved_by_operator','recurringBudgetAuthorization','not_authorized',
 'authorizationReference','synthetic-extended-trial-rollback-only','datasetBinding',repeat('d',64),
 'configuredAt',clock_timestamp(),'expiresAt',clock_timestamp()+interval '3 hours',
 'accountingPriorSpendUsd',(select coalesce(sum(case when cost_state='confirmed' and created_at>=date_trunc('month',clock_timestamp()) then actual_nano when app_private.runtime_cost_escrowed(id) then reserved_nano else 0 end),0)::numeric/1000000000 from app_private.currency_report_runtime_jobs),
 'destination',jsonb_build_object('endpoint','https://openrouter.ai/api/v1/chat/completions','model','openai/gpt-6.1-sol',
  'provider','azure','zdr',true,'dataCollection','deny','retries',0,'fallback',false,'rawPublicDisplay',false),
 'limits',jsonb_build_object('batchUsd',8,'maxCalls',62,'perCallUsd',.25,'monthlyUsd',0)))::text,true);
select throws_ok(format('select public.configure_currency_report_operating_policy(%L::jsonb,%s)',
 jsonb_set(current_setting('limits.trial')::jsonb,'{limits,batchUsd}','8.000000001'),current_setting('limits.rev')),
 '22023','operating cost bounds required','a one-time trial also rejects spending above its new absolute ceiling');
select throws_ok(format('select public.configure_currency_report_operating_policy(%L::jsonb,%s)',
 jsonb_set(current_setting('limits.trial')::jsonb,'{limits,maxCalls}','63'),current_setting('limits.rev')),
 '22023','operating cost bounds required','trial cannot add a 63rd call');
select throws_ok(format('select public.configure_currency_report_operating_policy(%L::jsonb,%s)',
 jsonb_set(current_setting('limits.trial')::jsonb,'{limits,perCallUsd}','0.250000001'),current_setting('limits.rev')),
 '22023','operating cost bounds required','per-request ceiling is unchanged');
select throws_ok(format('select public.configure_currency_report_operating_policy(%L::jsonb,%s)',
 current_setting('limits.trial')::jsonb-'datasetBinding',current_setting('limits.rev')),
 '22023','explicit bound one-time configuration required','extended trial requires its fixed dataset binding');
select throws_ok(format('select public.configure_currency_report_operating_policy(%L::jsonb,%s)',
 jsonb_set(current_setting('limits.trial')::jsonb,'{expiresAt}',to_jsonb(clock_timestamp()-interval '1 minute')),current_setting('limits.rev')),
 '22023','explicit bound one-time configuration required','expired one-time approval cannot use extended limits');
select set_config('limits.recurring',(current_setting('limits.trial')::jsonb || jsonb_build_object(
 'state','operator_configured','recurringBudgetAuthorization','approved_by_operator',
 'budgetScope','recurring_service_separate_from_single_trial_approval',
 'limits',jsonb_build_object('batchUsd',8,'maxCalls',62,'perCallUsd',.25,'monthlyUsd',20)))::text,true);
select throws_ok(format('select public.configure_currency_report_operating_policy(%L::jsonb,%s)',
 current_setting('limits.recurring'),current_setting('limits.rev')),
 '22023','operating cost bounds required','recurring service cannot inherit the one-time extension');
select set_config('limits.accepted',public.configure_currency_report_operating_policy(current_setting('limits.trial')::jsonb,current_setting('limits.rev')::bigint)::text,true);
select is((select (policy->'limits'->>'batchUsd')::numeric from app_private.currency_report_operating_policies
 where revision=current_setting('limits.accepted')::bigint),8::numeric,'explicit $8/62 bound trial is stored without activation');
select ok(not (public.currency_report_runtime_control()->>'enabled')::boolean,'configuration alone does not activate writing');
select ok(not has_function_privilege('anon','public.configure_currency_report_operating_policy(jsonb,bigint)','EXECUTE'),'no new anonymous configuration privilege');
select ok(not has_function_privilege('authenticated','public.configure_currency_report_operating_policy(jsonb,bigint)','EXECUTE'),'normal login cannot grant model budget');
update app_private.currency_report_runtime_control set enabled=true,review_enabled=true,writer='sol',
 monthly_limit_nano=((current_setting('limits.trial')::jsonb->>'accountingPriorSpendUsd')::numeric*1000000000)::bigint+8000000000,
 per_call_limit_nano=250000000,revision=revision+1 where singleton;
select ok((public.claim_currency_report_operating_batch(repeat('9',64),'91000000-0000-0000-0000-000000000001',
 current_setting('limits.accepted')::bigint,jsonb_build_object('datasetBinding',repeat('d',64),'testOnly',true),8000000000,62)->>'claimed')::boolean,
 'actual batch table and claim function accept the funded one-time trial envelope');
select is((select max_calls from app_private.currency_report_operating_batches where batch_key=repeat('9',64)),62,'stored envelope retains the explicit call limit');
select * from finish();
rollback;
