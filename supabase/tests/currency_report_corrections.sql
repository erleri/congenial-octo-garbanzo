begin;
set local search_path=public,extensions,pg_catalog;
select no_plan();
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('app_private.currency_report_correction_candidates'::regclass,'app_private.currency_report_correction_reviews'::regclass,'app_private.currency_report_correction_checks'::regclass)),'all correction tables enable RLS');
select ok(not has_table_privilege('anon','app_private.currency_report_correction_candidates','select'),'anonymous cannot read candidate quotes');
select ok(not has_table_privilege('authenticated','app_private.currency_report_correction_candidates','select'),'even administrator browsers have no direct table access');
select ok(not has_function_privilege('anon','public.currency_report_corrections(boolean,timestamptz,text)','execute'),'anonymous cannot list corrections');
select ok(not has_function_privilege('authenticated','public.record_currency_report_corrections(text,timestamptz,jsonb,jsonb)','execute'),'browser cannot forge detection');
select ok(not has_table_privilege('service_role','app_private.currency_report_correction_candidates','update'),'service cannot overwrite immutable candidate or decision');
select ok(not has_function_privilege('service_role','public.review_currency_report_correction(text,text,text,bigint)','execute'),'service cannot impersonate administrator judgment');

insert into public.business_plan_admins(email,active) values('correction-admin@example.test',true);
insert into public.currency_report_runs(id,currency,base_date,attempt,rule_version,event_binding,packet,candidate,validation)
 values('83000000-0000-0000-0000-000000000001','PEN','2083-10-01',1,'synthetic-correction/1','synthetic','{}',
 '{"id":"SYNTHETIC-CORRECTION-PEN","currency":"PEN","baseDate":"2083-10-01","testOnly":true,"content":{"title":"합성 시험","summary":"합성 원고","change":{"title":"합성 변화","text":"합성 수치","kind":"fact","factIds":[],"evidenceIds":[]},"drivers":[],"watch":[],"implications":[{"title":"합성 지표","text":"해당 대상 월 지표가 증가했다.","kind":"fact","factIds":[],"evidenceIds":["official"]}]},"facts":[],"series":[],"evidence":[{"id":"official","url":"https://www.bcrp.gob.pe/synthetic"}]}','{}');
insert into public.currency_reports(currency,base_date,run_id,report) select currency,base_date,id,candidate from public.currency_report_runs where id='83000000-0000-0000-0000-000000000001';
create function pg_temp.correction_candidate(k text default repeat('8',64)) returns jsonb language sql as $$
 select jsonb_build_object('version','published-correction/1','key',k,'currency','PEN','reportId','SYNTHETIC-CORRECTION-PEN','baseDate','2083-10-01',
 'claimId','implications.0.text:0','claimHash',repeat('a',64),'evidenceId','official','sourceUrl','https://www.bcrp.gob.pe/synthetic',
 'quote','해당 대상 월 지표가 증가했다.','kind','official_value_revised','before',jsonb_build_object('value',3,'period','2026-09'),
 'after',jsonb_build_object('value',4,'period','2026-09'),'detectedAt','2026-11-01T00:00:00Z','reason','합성 수정값 검토 시험',
 'contentReview','not_performed','publicationApproved',false,'testOnly',true);$$;
create function pg_temp.correction_coverage() returns jsonb language sql as $$select '{"reportsChecked":1,"missingSnapshotReports":0,"unmappedEvidence":0,"currentArticles":0,"admittedStatistics":1,"semanticComparison":"not_performed","differentSourceContradictions":"not_evaluated","issues":[]}'::jsonb;$$;
set local role service_role;
select is(public.record_currency_report_corrections('PEN','2026-11-01T00:00:00Z',jsonb_build_array(pg_temp.correction_candidate()),pg_temp.correction_coverage())->>'inserted','1','service records exact published sentence');
select is(public.record_currency_report_corrections('PEN','2026-11-01T01:00:00Z',jsonb_build_array(pg_temp.correction_candidate()||'{"detectedAt":"2026-11-01T01:00:00Z"}'),pg_temp.correction_coverage())->>'duplicates','1','same finding with new clock is deduplicated');
select throws_ok($$select public.record_currency_report_corrections('PEN','2026-11-01T01:00:00Z',jsonb_build_array(pg_temp.correction_candidate()||'{"reason":"changed receipt"}'),pg_temp.correction_coverage())$$,'22023','immutable correction identity changed','receipt cannot be silently overwritten');
select throws_ok($$select public.record_currency_report_corrections('PEN','2026-11-01T00:00:00Z',jsonb_build_array(pg_temp.correction_candidate(repeat('7',64))||'{"quote":"다른 문장"}'),pg_temp.correction_coverage())$$,'55000','published claim identity changed','unrelated sentence rejected');
select throws_ok($$select public.record_currency_report_corrections('PEN','2026-11-01T00:00:00Z',jsonb_build_array(pg_temp.correction_candidate(repeat('7',64))||'{"rawBase64":"PRIVATE"}'),pg_temp.correction_coverage())$$,'22023','bound correction candidate required','raw payload cannot enter candidate display');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"83000000-0000-0000-0000-000000000002","email":"correction-reader@example.test","role":"authenticated"}',true);
select throws_ok($$select public.currency_report_corrections(true)$$,'42501','active administrator access required','ordinary login cannot list');
select throws_ok($$select public.review_currency_report_correction(repeat('8',64),'acknowledged','not admin',1)$$,'42501','active administrator access required','ordinary login cannot decide');
select set_config('request.jwt.claims','{"sub":"83000000-0000-0000-0000-000000000003","email":"correction-admin@example.test","role":"authenticated"}',true);
select is(public.currency_report_corrections(false)->>'pending','0','synthetic candidates hidden from normal queue');
select is(public.currency_report_corrections(true)->>'pending','1','active admin sees pending synthetic candidate explicitly');
select throws_ok($$select public.review_currency_report_correction(repeat('8',64),'dismissed','',1)$$,'22023','explicit correction review and reason required','judgment requires reason');
select is(public.review_currency_report_correction(repeat('8',64),'acknowledged','후속 내용 검토 필요',1),2::bigint,'acknowledgment is versioned');
select throws_ok($$select public.review_currency_report_correction(repeat('8',64),'dismissed','concurrent old decision',1)$$,'55000','correction review changed; reload','concurrent stale decision rejected');
select is(public.review_currency_report_correction(repeat('8',64),'dismissed','사후 수정이며 당시 원고를 오류로 보지 않음',2),3::bigint,'no-correction judgment preserves reason');
reset role;
select is((select count(*) from app_private.currency_report_correction_reviews where candidate_key=repeat('8',64)),2::bigint,'both decisions retained in audit');
select is((select report->'content'->'implications'->0->>'text' from public.currency_reports where run_id='83000000-0000-0000-0000-000000000001'),'해당 대상 월 지표가 증가했다.','review never changes public manuscript');
select is((select count(*) from public.currency_report_reviews where run_id='83000000-0000-0000-0000-000000000001'),0::bigint,'candidate judgment is not publication approval');
update public.business_plan_admins set active=false where email='correction-admin@example.test';
set local role authenticated;
select throws_ok($$select public.currency_report_corrections(true)$$,'42501','active administrator access required','revocation blocks list in same JWT session');
select throws_ok($$select public.review_currency_report_correction(repeat('8',64),'pending_review','reopen',3)$$,'42501','active administrator access required','revocation blocks decision in same session');
reset role;
update public.business_plan_admins set active=true where email='correction-admin@example.test';
update public.currency_reports set withdrawn_at=clock_timestamp() where run_id='83000000-0000-0000-0000-000000000001';
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.currency_report_corrections(true)->'items') x where x->>'key'=repeat('8',64) and x->>'status'='stale_target'),'withdrawn target is shown as stale instead of silently deleted');
select throws_ok($$select public.review_currency_report_correction(repeat('8',64),'pending_review','reopen',3)$$,'55000','public target changed; reload','stale public target cannot be judged as current');
reset role;
select * from finish();
rollback;
