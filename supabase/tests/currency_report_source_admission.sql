begin;
select no_plan();
create function pg_temp.admission_proof() returns jsonb language sql as $$
 select jsonb_build_object('version','source-admission/1','binding',repeat('b',64),'currency','COP',
 'url','https://news.example.org/economia/dolar','host','news.example.org','evidenceUrl','https://news.example.org/economia/dolar',
 'captureHash',repeat('c',64),'policyBinding',repeat('d',64),'checkedAt',now(),'capturedAt',now(),'expiresAt',now()+interval '7 days',
 'status','eligible','reason','explicit_article_license_matches_policy','profile','article_cc_by_4',
 'licenseUrl','https://creativecommons.org/licenses/by/4.0/','publisher','Example Economics','publicationAt',now()-interval '1 day',
 'scopes','{"discover":true,"collect":true,"analyze":true,"publishNotes":true}'::jsonb,
 'rawPublicDisplay',false,'publicationApproved',false,'licenseGranted',false);
$$;
select ok(not has_table_privilege('authenticated','app_private.currency_report_source_decisions','INSERT'),'login cannot bypass audited decision function');
select ok(not has_table_privilege('service_role','app_private.currency_report_source_decisions','INSERT'),'collector cannot impersonate administrator');
select ok(not has_function_privilege('anon','public.currency_report_source_admission_summary()','EXECUTE'),'public cannot see private source decisions');
set local role service_role;
select is(public.save_currency_report_source_proof(pg_temp.admission_proof()),true,'service stores proof without raw body');
select is(public.save_currency_report_source_proof(pg_temp.admission_proof()),true,'same proof is idempotent');
select is(jsonb_array_length(public.load_currency_report_source_admissions()->'proofs'),1,'service loads current source settings');
select throws_ok($$select public.save_currency_report_source_proof(pg_temp.admission_proof()||'{"rawArticle":"private"}')$$,'22023','safe source proof required','raw article rejected from management storage');
select throws_ok($$select public.save_currency_report_source_proof(pg_temp.admission_proof()||'{"publicationApproved":true}')$$,'22023','safe source proof required','proof cannot grant publication');
select throws_ok($$select public.save_currency_report_source_proof(pg_temp.admission_proof()||'{"licenseUrl":"https://example.org/anything"}')$$,'22023','source proof conditions invalid','automatic profile cannot widen licence');
reset role;
insert into public.business_plan_admins(email,active) values('source-admission-admin@example.test',true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"94000000-0000-0000-0000-000000000001","email":"reader@example.test","role":"authenticated"}',true);
select throws_ok($$select public.currency_report_source_admission_summary()$$,'42501','active administrator required','ordinary login cannot review candidates');
select throws_ok($$select public.decide_currency_report_source(repeat('b',64),0,'apply',pg_temp.admission_proof()->'scopes')$$,'42501','active administrator required','ordinary login cannot admit a source');
select set_config('request.jwt.claims','{"sub":"94000000-0000-0000-0000-000000000002","email":"source-admission-admin@example.test","role":"authenticated"}',true);
select is(public.decide_currency_report_source(repeat('b',64),0,'apply',pg_temp.admission_proof()->'scopes'),1,'existing active admin applies scoped policy');
select throws_ok($$select public.decide_currency_report_source(repeat('b',64),0,'exclude',pg_temp.admission_proof()->'scopes')$$,'40001','source decision changed; reload','stale concurrent decision cannot overwrite first decision');
select throws_ok($$select public.decide_currency_report_source(repeat('b',64),1,'apply','{"discover":false,"collect":false,"analyze":true,"publishNotes":true}')$$,'22023','valid source action and scopes required','analysis cannot bypass collection scope');
select is(public.decide_currency_report_source(repeat('b',64),1,'exclude',pg_temp.admission_proof()->'scopes'),2,'admin can revoke source without deleting evidence');
select is(public.currency_report_source_admission_summary()->'decisions'->0->>'action','exclude','latest decision reaches management and runtime view');
reset role;
select is((select count(*) from app_private.currency_report_source_decisions),2::bigint,'both prior and current decisions retained');
select is((select count(distinct actor) from app_private.currency_report_source_decisions),1::bigint,'decision actor recorded by server');
set local role service_role;
select is(public.save_currency_report_source_proof(pg_temp.admission_proof()||jsonb_build_object('binding',repeat('e',64),'status','hold','reason','use_scope_unconfirmed','profile',null,'licenseUrl',null,'scopes','{"discover":false,"collect":false,"analyze":false,"publishNotes":false}'::jsonb)),true,'fresh unresolved scope can be recorded');
reset role;
set local role authenticated;
select throws_ok($$select public.decide_currency_report_source(repeat('b',64),2,'apply',pg_temp.admission_proof()->'scopes')$$,'40001','source proof changed; reload','old proof cannot be approved after conditions change');
select throws_ok($$select public.decide_currency_report_source(repeat('e',64),2,'apply',pg_temp.admission_proof()->'scopes')$$,'22023','documented source scope review required','unclear terms require evidence rather than an approval click');
select is(public.decide_currency_report_source(repeat('e',64),2,'apply',pg_temp.admission_proof()->'scopes','https://news.example.org/terms','Reviewed explicit private analysis and attributed summary conditions.'),3,'documented review records evidence and allowed scopes');
reset role;
update public.business_plan_admins set active=false where email='source-admission-admin@example.test';
set local role authenticated;
select throws_ok($$select public.decide_currency_report_source(repeat('e',64),3,'hold',pg_temp.admission_proof()->'scopes')$$,'42501','active administrator required','revocation blocks the same session immediately');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.currency_report_source_admission_summary()$$,'42501','active administrator required','logout removes access');
reset role;
select * from finish();
rollback;
