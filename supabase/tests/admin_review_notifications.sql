begin;
set local search_path=public,extensions,pg_catalog;
select no_plan();
select ok((select relrowsecurity from pg_class where oid='app_private.admin_review_email_deliveries'::regclass),'mail ledger uses RLS');
select ok(not has_table_privilege('anon','app_private.admin_review_email_deliveries','select'),'anonymous cannot read private mail ledger');
select ok(not has_table_privilege('authenticated','app_private.admin_review_email_deliveries','select'),'administrator uses bounded inbox rather than private ledger access');
select ok(not has_function_privilege('anon','public.currency_report_review_inbox(text,text)','execute'),'anonymous cannot read review inbox');
select ok(not has_function_privilege('authenticated','public.admin_review_email(text,jsonb)','execute'),'browser cannot dispatch or forge mail receipt');
select ok(not has_function_privilege('service_role','public.review_currency_report_request(uuid,text,text,text,text,text,text)','execute'),'mail worker cannot approve as a person');
insert into public.business_plan_admins(email,active) values('notice-admin@example.test',true),('notice-second@example.test',true),('notice-revoked@example.test',false);
insert into public.currency_report_runs(id,currency,base_date,attempt,rule_version,event_binding,packet,candidate,validation,status)
 values('91000000-0000-0000-0000-000000000001','CLP','2091-11-09',1,'notice-fixture/1','fixture','{}',
 '{"id":"NOTICE-CLP-1","currency":"CLP","baseDate":"2091-11-09","content":{"title":"첫 검토 원고","summary":"새 환율 설명"}}', '{}','pending_review'),
 ('91000000-0000-0000-0000-000000000002','BRL','2091-11-09',1,'notice-fixture/1','fixture','{}',
 '{"id":"NOTICE-BRL-TEST","testOnly":true,"content":{"title":"합성 제외","summary":"합성"}}', '{}','pending_review'),
 ('91000000-0000-0000-0000-000000000003','PEN','2091-11-09',1,'notice-fixture/1','fixture','{}',
 '{"id":"NOTICE-PEN-PAST","historicalReview":true,"content":{"title":"과거 시험 제외","summary":"과거"}}', '{}','pending_review');
create temp table notice_expected as select * from app_private.currency_report_review_items() where id='91000000-0000-0000-0000-000000000001';
select is((select count(*) from app_private.currency_report_review_items() where id in('91000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000003')),0::bigint,'synthetic and historical drafts cannot trigger operating notices');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"91000000-0000-0000-0000-000000000010","email":"reader@example.test","role":"authenticated"}',true);
select throws_ok($$select public.currency_report_review_inbox()$$,'42501','active administrator required','ordinary login cannot read inbox');
select set_config('request.jwt.claims','{"sub":"91000000-0000-0000-0000-000000000011","email":"notice-admin@example.test","role":"authenticated"}',true);
select ok((public.currency_report_review_inbox()->>'total')::integer>=1,'active administrator reads pending items');
select is(public.currency_report_review_target('report','91000000-0000-0000-0000-000000000001',repeat('0',64))->>'state','changed','wrong mail version is explicit');
select throws_ok($$select public.review_currency_report_request('91000000-0000-0000-0000-000000000001',repeat('0',64),'approved')$$,'55000','review request target changed; reopen current version','stale mail cannot approve even if UI checks are bypassed');
select is(public.currency_report_review_target('report','missing',repeat('0',64))->>'state','resolved_or_unavailable','missing target does not substitute a newer report');
reset role;
-- Costs with full reservation escrow are already filtered by the common cost guard.
create temp table notice_receipt(key text,payload_hash text);
grant all on notice_receipt,notice_expected to service_role;
set local role service_role;
select is(public.admin_review_email('preview','{"recipient":"notice-revoked@example.test"}')->>'status','recipient_not_active_admin','inactive address cannot receive private review mail');
select is(public.admin_review_email('preview','{"recipient":"notice-admin@example.test"}')->>'status','plan_only','planning does not dispatch');
select is((select count(*) from app_private.admin_review_email_deliveries),0::bigint,'planning has no ledger writes');
insert into notice_receipt(key) select public.admin_review_email('claim','{"recipient":"notice-admin@example.test","owner":"91000000-0000-0000-0000-000000000020"}')->>'key';
select is(public.admin_review_email('claim','{"recipient":"notice-admin@example.test","owner":"91000000-0000-0000-0000-000000000021"}')->>'status','already_recorded','second owner cannot duplicate the same daily digest');
update notice_receipt set payload_hash=(public.admin_review_email('freeze',jsonb_build_object('key',key,'owner','91000000-0000-0000-0000-000000000020','payloadJson',jsonb_build_object('version','admin-review-email/1','refs',(select refs from app_private.admin_review_email_deliveries where delivery_key=key),'subject','Synthetic notice','text','Review current item','html','<p>Review current item</p>')::text))->>'payloadHash');
select is(public.admin_review_email('begin',jsonb_build_object('key',key,'owner','91000000-0000-0000-0000-000000000020','payloadHash',payload_hash))->>'started','true','current target dispatches once') from notice_receipt;
select is(public.admin_review_email('begin',jsonb_build_object('key',key,'owner','91000000-0000-0000-0000-000000000020','payloadHash',payload_hash))->>'started','false','sending record prevents a second dispatch') from notice_receipt;
select ok((public.admin_review_email('finish',jsonb_build_object('key',key,'owner','91000000-0000-0000-0000-000000000020','payloadHash',payload_hash,'outcome','{"status":"unknown","code":null,"reason":"transport_result_unknown"}'::jsonb))->>'recorded')::boolean,'uncertain dispatch is retained') from notice_receipt;
select is((public.admin_review_email('preview','{"recipient":"notice-admin@example.test"}')->'items') @> (select jsonb_build_array(jsonb_build_object('id',id,'version',version)) from notice_expected),false,'unknown dispatch is not automatically resent');
reset role;
-- Advance only the fixture ledger date to test a later day without altering a clock.
update app_private.admin_review_email_deliveries set edition_date=edition_date-1 where recipient='notice-admin@example.test';
update public.currency_report_runs set candidate=jsonb_set(candidate,'{content,title}','"보강된 검토 원고"') where id='91000000-0000-0000-0000-000000000001';
select ok((select version from app_private.currency_report_review_items() where id='91000000-0000-0000-0000-000000000001')<>(select version from notice_expected),'changed draft has a new notification version');
set local role service_role;
select ok(jsonb_array_length(public.admin_review_email('preview','{"recipient":"notice-admin@example.test"}')->'items')>=1,'important content change becomes a new notice');
truncate notice_receipt;
insert into notice_receipt(key) select public.admin_review_email('claim','{"recipient":"notice-second@example.test","owner":"91000000-0000-0000-0000-000000000030"}')->>'key';
update notice_receipt set payload_hash=(public.admin_review_email('freeze',jsonb_build_object('key',key,'owner','91000000-0000-0000-0000-000000000030','payloadJson',jsonb_build_object('version','admin-review-email/1','refs',(select refs from app_private.admin_review_email_deliveries where delivery_key=key),'subject','Synthetic notice','text','Review','html','<p>Review</p>')::text))->>'payloadHash');
reset role;
update public.business_plan_admins set active=false where email='notice-second@example.test';
set local role service_role;
select is(public.admin_review_email('begin',jsonb_build_object('key',key,'owner','91000000-0000-0000-0000-000000000030','payloadHash',payload_hash))->>'reason','target_or_access_changed','permission revoked after preparation cancels dispatch') from notice_receipt;
reset role;
select is((select count(*) from public.currency_reports where run_id='91000000-0000-0000-0000-000000000001'),0::bigint,'mail workflow never publishes a manuscript');
-- Source identity is stable across collection clocks; policy review takes
-- precedence only for the same verified publisher and path.
insert into app_private.currency_report_source_proofs(binding,currency,url,checked_at,proof)
 values(repeat('a',64),'MXN','https://news.example.test/economia/uno',now(),jsonb_build_object('host','news.example.test','publisher','Synthetic publisher','status','hold','reason','use_scope_unconfirmed','expiresAt',now()+interval '7 days','articleBinding',repeat('b',64),'captureHash',repeat('c',64),'articleChecks','{"ownArticle":true,"freeAccess":true,"bodyVerified":true}'::jsonb));
insert into app_private.currency_report_source_heads(currency,url,binding) values('MXN','https://news.example.test/economia/uno',repeat('a',64));
create temp table notice_source as select id,version from app_private.currency_report_review_items() where kind='source' and target_id=repeat('a',64);
select is((select count(*) from notice_source),1::bigint,'unresolved article scope becomes a review item');
insert into app_private.currency_report_source_proofs(binding,currency,url,checked_at,proof)
 select repeat('d',64),currency,url,now()+interval '1 second',proof||jsonb_build_object('checkedAt',now()+interval '1 second') from app_private.currency_report_source_proofs where binding=repeat('a',64);
update app_private.currency_report_source_heads set binding=repeat('d',64) where binding=repeat('a',64);
select is((select version from app_private.currency_report_review_items() where kind='source' and target_id=repeat('d',64)),(select version from notice_source),'same article with a new collection clock does not re-notify');
insert into app_private.currency_report_source_policies(id,currency,host,path_prefix,publisher,terms_url,action,revision,scopes)
 values('91000000-0000-0000-0000-000000000050','MXN','news.example.test','/economia/','Synthetic publisher','https://news.example.test/terms','prepare',1,'{"discover":true,"collect":true,"analyze":true,"publishNotes":true}');
select is((select count(*) from app_private.currency_report_review_items() where kind='source' and currency='MXN'),0::bigint,'publisher preparation and article scope are not duplicate notices');
insert into app_private.currency_report_source_terms(policy_id,checked_at,url,status,hash,excerpt)
 values('91000000-0000-0000-0000-000000000050',now()-interval '1 minute','https://news.example.test/terms','available',repeat('e',64),'Synthetic conditions');
select is((select count(*) from app_private.currency_report_review_items() where kind='policy' and id='91000000-0000-0000-0000-000000000050'),1::bigint,'collected terms request a publisher decision');
update app_private.currency_report_source_policies set action='apply',approved_terms_hash=repeat('e',64),expires_at=now()+interval '90 days' where id='91000000-0000-0000-0000-000000000050';
select is((select count(*) from app_private.currency_report_review_items() where kind='policy' and id='91000000-0000-0000-0000-000000000050'),0::bigint,'current applied publisher policy needs no notice');
insert into app_private.currency_report_source_terms(policy_id,checked_at,url,status,hash,excerpt)
 values('91000000-0000-0000-0000-000000000050',now(),'https://news.example.test/terms','available',repeat('f',64),'Changed conditions');
select is((select count(*) from app_private.currency_report_review_items() where kind='policy' and id='91000000-0000-0000-0000-000000000050'),1::bigint,'changed publisher conditions require review');
-- Unsent, abandoned preparations can resume; a DATA-started message never can.
insert into public.business_plan_admins(email,active) values('notice-resume@example.test',true);
set local role service_role;
truncate notice_receipt;
insert into notice_receipt(key) select public.admin_review_email('claim','{"recipient":"notice-resume@example.test","owner":"91000000-0000-0000-0000-000000000060"}')->>'key';
reset role;
update app_private.admin_review_email_deliveries set lease_until=now()-interval '1 minute' where recipient='notice-resume@example.test';
set local role service_role;
select is(public.admin_review_email('claim','{"recipient":"notice-resume@example.test","owner":"91000000-0000-0000-0000-000000000061"}')->>'status','claimed','expired unsent preparation is safely reclaimed');
select throws_ok($$select public.admin_review_email('freeze',jsonb_build_object('key',(select key from notice_receipt),'owner','91000000-0000-0000-0000-000000000060','payloadJson','{}'))$$,'55000','notification ownership required','old worker cannot dispatch reclaimed preparation');
reset role;
select * from finish();
rollback;
