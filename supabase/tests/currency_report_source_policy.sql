begin;
select no_plan();
create function pg_temp.scope_proof() returns jsonb language sql as $$
 select jsonb_build_object('version','source-admission/1','binding',repeat('a',64),'currency','PEN',
 'url','https://news.example.org/economia/dolar','host','news.example.org','evidenceUrl','https://news.example.org/economia/dolar',
 'captureHash',repeat('c',64),'policyBinding',repeat('d',64),'checkedAt',now(),'capturedAt',now(),'expiresAt',now()+interval '7 days',
 'status','hold','reason','use_scope_unconfirmed','profile',null,'licenseUrl',null,'publisher','Example Economics','publicationAt',now()-interval '1 day',
 'scopes','{"discover":false,"collect":false,"analyze":false,"publishNotes":false}'::jsonb,
 'articleChecks','{"ownArticle":true,"freeAccess":true,"bodyVerified":true}'::jsonb,
 'rawPublicDisplay',false,'publicationApproved',false,'licenseGranted',false);
$$;
create function pg_temp.policy_id() returns uuid language sql as $$ select id from app_private.currency_report_source_policies where currency='PEN'; $$;
create function pg_temp.terms_check() returns jsonb language sql as $$ select jsonb_build_object('policyId',pg_temp.policy_id(),'url','https://news.example.org/terms/',
 'checkedAt',now(),'status','available','hash',repeat('b',64),'excerpt','Example verified processing terms for this publisher.'); $$;
select ok(not has_table_privilege('authenticated','app_private.currency_report_source_policies','UPDATE'),'browser cannot alter policy table');
select ok(not has_table_privilege('service_role','app_private.currency_report_source_policies','UPDATE'),'collector cannot approve a policy');
select ok(not has_function_privilege('anon','public.prepare_currency_report_source_policy(text,text,text,integer)','EXECUTE'),'public cannot request scope changes');
set local role service_role;
select is(public.save_currency_report_source_proof(pg_temp.scope_proof()),true,'collector saves article metadata for admin scope preparation');
select throws_ok($$select public.save_currency_report_source_proof(pg_temp.scope_proof()-'capturedAt')$$,'22023','source proof conditions invalid','missing capture time rejected');
reset role;
insert into public.business_plan_admins(email,active) values('source-policy-admin@example.test',true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"95000000-0000-0000-0000-000000000001","email":"reader@example.test","role":"authenticated"}',true);
select throws_ok($$select public.prepare_currency_report_source_policy(repeat('a',64),'/economia/','https://news.example.org/terms/',0)$$,'42501','active administrator required','ordinary login cannot prepare a reusable scope');
select set_config('request.jwt.claims','{"sub":"95000000-0000-0000-0000-000000000002","email":"source-policy-admin@example.test","role":"authenticated"}',true);
select throws_ok($$select public.prepare_currency_report_source_policy(repeat('a',64),'/other/','https://news.example.org/terms/',0)$$,'22023','verified own-article scope required','prefix must include verified article');
select throws_ok($$select public.prepare_currency_report_source_policy(repeat('a',64),'/economia/','https://another.example.org/terms/',0)$$,'22023','verified own-article scope required','terms must belong to exact publisher host');
select lives_ok($$select public.prepare_currency_report_source_policy(repeat('a',64),'/economia/','https://news.example.org/terms/',0)$$,'active admin prepares a scope without enabling it');
reset role;
select is((select action from app_private.currency_report_source_policies where id=pg_temp.policy_id()),'prepare','request is not approval');
set local role authenticated;
select throws_ok($$select public.decide_currency_report_source_policy((public.currency_report_source_admission_summary()->'policies'->0->>'id')::uuid,1,'apply','{"discover":true,"collect":true,"analyze":true,"publishNotes":true}',repeat('b',64),'Confirmed permitted private analysis and independent attribution.')$$,'40001','current terms check required','approval cannot precede automatic terms capture');
reset role;
set local role service_role;
select is(public.save_currency_report_source_terms(pg_temp.terms_check()),true,'collector records a bounded terms fingerprint');
select is(public.save_currency_report_source_terms(pg_temp.terms_check()),true,'same terms observation idempotent');
select throws_ok($$select public.save_currency_report_source_terms(pg_temp.terms_check()||'{"body":"unbounded raw terms"}')$$,'22023','bounded terms check required','raw terms do not enter admin storage');
reset role;
set local role authenticated;
select is(public.decide_currency_report_source_policy((public.currency_report_source_admission_summary()->'policies'->0->>'id')::uuid,1,'apply','{"discover":true,"collect":true,"analyze":true,"publishNotes":true}',repeat('b',64),'Confirmed permitted private analysis and independent attribution.'),2,'admin binds reviewed scope to collected terms');
select throws_ok($$select public.decide_currency_report_source_policy((public.currency_report_source_admission_summary()->'policies'->0->>'id')::uuid,1,'exclude','{"discover":false,"collect":false,"analyze":false,"publishNotes":false}',null,'Exclude this publisher until conditions are reviewed again.')$$,'40001','source scope changed; reload','concurrent stale decision cannot overwrite current approval');
select is(public.currency_report_source_admission_summary()->'policies'->0->>'approvedTermsHash',repeat('b',64),'runtime receives approved terms hash');
select is(jsonb_array_length(public.currency_report_source_admission_summary()->'policyHistory'),2,'preparation and approval both retained in admin history');
reset role;
select is((select expires_at-decided_at from app_private.currency_report_source_policies where id=pg_temp.policy_id()),interval '90 days','review scope has explicit expiry');
set local role service_role;
select is(public.save_currency_report_source_terms(pg_temp.terms_check()||jsonb_build_object('checkedAt',now()+interval '1 second','hash',repeat('c',64))),true,'changed terms recorded independently of approval');
select is(public.load_currency_report_source_admissions()->'policies'->0->>'approvedTermsHash',repeat('b',64),'collector cannot silently reapprove changed terms');
select is(public.load_currency_report_source_admissions()->'terms'->0->>'hash',repeat('c',64),'new terms fingerprint reaches automatic scope validator');
reset role;
update public.business_plan_admins set active=false where email='source-policy-admin@example.test';
set local role authenticated;
select throws_ok($$select public.prepare_currency_report_source_policy(repeat('a',64),'/economia/','https://news.example.org/terms/',2)$$,'42501','active administrator required','revoked admin cannot renew scope');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.currency_report_source_admission_summary()$$,'42501','active administrator required','logout hides policy metadata and history');
reset role;
select * from finish();
rollback;
