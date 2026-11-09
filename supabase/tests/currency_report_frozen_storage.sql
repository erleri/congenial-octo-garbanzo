begin;
set local search_path=public,extensions,pg_catalog;
select no_plan();
select ok(not has_table_privilege('authenticated','app_private.currency_report_storage_chunks','SELECT'),'authenticated raw chunks denied');
select ok(not has_function_privilege('anon','public.read_currency_report_storage_chunk(text,integer)','EXECUTE'),'anonymous raw read denied');
select ok(not has_function_privilege('authenticated','public.prepare_currency_report_storage_object(jsonb)','EXECUTE'),'admin cannot prepare original objects');
select ok(not has_function_privilege('authenticated','public.record_currency_report_storage_incident(text,text,boolean,jsonb)','EXECUTE'),'admin cannot dismiss incidents');
set local role service_role;
select public.record_currency_report_storage_incident('link','synthetic_link_failure',false);
select public.record_currency_report_storage_incident('write','verified',true);
select public.record_currency_report_storage_incident('link','synthetic_link_failure',false);
select is((select revision from app_private.currency_report_storage_incidents where reason='synthetic_link_failure'),1,'repeated unresolved link failure has stable notification version');
select is((select active from app_private.currency_report_storage_incidents where reason='synthetic_link_failure'),true,'successful object write does not resolve failed execution link');
select public.record_currency_report_storage_incident('link','verified',true);
select is((select active from app_private.currency_report_storage_incidents where reason='synthetic_link_failure'),false,'verified same-stage recovery resolves incident');
reset role;
-- Small synthetic objects are created inside this rollback transaction.
set local role service_role;
select set_config('storage.test.dataset','44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',true);
select public.prepare_currency_report_storage_object('{"id":"44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a","codec":"gzip-json/1","rawBytes":2,"compressedBytes":22,"compressedHash":"c48af1e2b469cf8c869097540babee7b3e9810571595fb4a312b69e12a372a8a","chunkCount":1}');
select public.put_currency_report_storage_chunk('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',0,'H4sIAAAAAAACCquuBQBDv6ajAgAAAA==');
select public.seal_currency_report_storage_object('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
select set_config('storage.test.prepared','4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',true);
select public.prepare_currency_report_storage_object('{"id":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","codec":"gzip-json/1","rawBytes":2,"compressedBytes":22,"compressedHash":"61663fde99b3394d71653f41c19fe91269442622a4a6695f8352a70fbf5ca4c1","chunkCount":1}');
select public.put_currency_report_storage_chunk('4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',0,'H4sIAAAAAAACCouOBQApu0wNAgAAAA==');
select public.seal_currency_report_storage_object('4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945');
reset role;
create function pg_temp.storage_manifest(k text) returns jsonb language sql as $$
 with refs as (select role,o.* from (values('dataset',current_setting('storage.test.dataset')),('prepared',current_setting('storage.test.prepared')))s(role,id)
 join app_private.currency_report_storage_objects o on o.id=s.id), manifest as (
 select jsonb_build_object('version','operating-frozen-input/2','datasetBinding',current_setting('storage.test.dataset'),'payloadHash',repeat('a',64),
 'resumeIdentity',k,'policyBinding',repeat('1',64),'template','{}','objects',(select jsonb_agg(jsonb_build_object('role',role,'id',id,'codec',codec,'rawBytes',raw_bytes,
 'compressedBytes',compressed_bytes,'compressedHash',compressed_hash,'chunkCount',chunk_count)) from refs)) m)
 select m||jsonb_build_object('serializedOperatingPayload',m::text) from manifest;
$$;
select set_config('storage.test.prior_nano',(select coalesce(sum(case when cost_state='confirmed' and created_at>=date_trunc('month',clock_timestamp()) then actual_nano when app_private.runtime_cost_escrowed(id) then reserved_nano else 0 end),0)::text from app_private.currency_report_runtime_jobs),true);
select set_config('storage.test.policy',jsonb_build_object('version','report-operating-policy/1','binding',repeat('1',64),
 'configurationTrust','server_owned_never_article_or_model_input','publication','separate_active_admin_review','state','operator_configured',
 'externalTransmissionAuthorization','approved_by_operator','recurringBudgetAuthorization','approved_by_operator','authorizationReference','synthetic-storage-test-only',
 'destination',jsonb_build_object('endpoint','https://openrouter.ai/api/v1/chat/completions','model','openai/gpt-6.1-sol','provider','azure','zdr',true,'dataCollection','deny','retries',0,'fallback',false,'rawPublicDisplay',false),
 'limits',jsonb_build_object('batchUsd',.2,'monthlyUsd',1+current_setting('storage.test.prior_nano')::numeric/1000000000,'perCallUsd',.1,'maxCalls',12))::text,true);
set local role service_role;
select set_config('storage.test.rev',public.configure_currency_report_operating_policy(current_setting('storage.test.policy')::jsonb,
 coalesce((public.currency_report_operating_policy()->>'revision')::bigint,0))::text,true);
select is(public.claim_currency_report_operating_batch(repeat('f',64),'01000000-0000-0000-0000-000000000001',current_setting('storage.test.rev')::bigint,pg_temp.storage_manifest(repeat('f',64)),200000000,12)->>'reason','operating_configuration_hold','storage does not activate generation');
reset role;
update app_private.currency_report_runtime_control set enabled=true,review_enabled=true,writer='sol',monthly_limit_nano=1000000000+current_setting('storage.test.prior_nano')::bigint;
set local role service_role;
select is(public.claim_currency_report_operating_batch(repeat('f',64),'01000000-0000-0000-0000-000000000001',current_setting('storage.test.rev')::bigint,pg_temp.storage_manifest(repeat('f',64)),200000000,12)->>'claimed','true','v2 uses unchanged accounting gate');
select is((select count(*) from app_private.currency_report_storage_refs where batch_key=repeat('f',64)),2::bigint,'both object references linked atomically');
select is(public.claim_currency_report_operating_batch(repeat('f',64),'01000000-0000-0000-0000-000000000002',current_setting('storage.test.rev')::bigint,pg_temp.storage_manifest(repeat('f',64)),200000000,12)->>'reason','operating_batch_busy','concurrent owner cannot acquire new format');
select public.checkpoint_currency_report_operating_batch(repeat('f',64),'01000000-0000-0000-0000-000000000001','paused','{"status":"synthetic-storage-pause"}');
select is(public.claim_currency_report_operating_batch(repeat('f',64),'01000000-0000-0000-0000-000000000002',current_setting('storage.test.rev')::bigint,pg_temp.storage_manifest(repeat('f',64)),200000000,12)->>'claimed','true','restart claims the same immutable manifest');
select is((select count(*) from app_private.currency_report_storage_refs where batch_key=repeat('f',64)),2::bigint,'restart creates no duplicate references');
select public.checkpoint_currency_report_operating_batch(repeat('f',64),'01000000-0000-0000-0000-000000000002','paused','{"status":"synthetic-storage-pause"}');
select throws_ok($$select public.claim_currency_report_operating_batch(repeat('e',64),'01000000-0000-0000-0000-000000000001',current_setting('storage.test.rev')::bigint,pg_temp.storage_manifest(repeat('f',64)),200000000,12)$$,'22023','invalid storage manifest','mismatched execution reference rejected before claim');
select throws_ok($$select public.claim_currency_report_operating_batch(repeat('e',64),'01000000-0000-0000-0000-000000000001',current_setting('storage.test.rev')::bigint,'{"version":"operating-frozen-input/2"}',200000000,12)$$,'22023','invalid storage manifest','missing object references cannot pass SQL null comparisons');
reset role;
update app_private.currency_report_storage_objects set sealed=false where id=current_setting('storage.test.dataset');
set local role service_role;
select throws_ok($$select public.claim_currency_report_operating_batch(repeat('e',64),'01000000-0000-0000-0000-000000000001',current_setting('storage.test.rev')::bigint,pg_temp.storage_manifest(repeat('e',64)),200000000,12)$$,'22023','unsealed or inconsistent storage reference','partial objects cannot execute');
reset role;
delete from app_private.currency_report_storage_chunks where object_id=current_setting('storage.test.dataset');
select throws_ok($$delete from app_private.currency_report_storage_objects where id=current_setting('storage.test.dataset')$$,'23503',null,'referenced objects protected by foreign keys');
select * from finish();
rollback;
