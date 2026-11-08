begin;
select plan(25);
insert into public.business_plan_admins(email,active) values('history-admin@example.test',true);
insert into public.currency_report_runs(id,currency,base_date,attempt,rule_version,event_binding,packet,candidate,validation)
 select md5('history-test-'||i)::uuid,'CLP',date '2074-12-01'+i,1,'history-pgtap/1','synthetic-only','{"raw":"PRIVATE_HISTORY"}',
 jsonb_build_object('id','HISTORY-CLP-'||(date '2074-12-01'+i),'schemaVersion','currency-report/1','currency','CLP',
  'baseDate',date '2074-12-01'+i,'observedDate',date '2074-12-01'+i,'generationMode','ai_enhanced','testOnly',true,
  'content',jsonb_build_object('title','합성 이력 시험','summary','AI 미사용 · 실제 발행 아님','change',
    jsonb_build_object('title','시험','text','합성','kind','fact','factIds','[]'::jsonb,'evidenceIds','[]'::jsonb),
    'drivers','[]'::jsonb,'implications','[]'::jsonb,'watch','[]'::jsonb,'limitations','[]'::jsonb),
  'facts','[]'::jsonb,'series','[]'::jsonb,'evidence','[]'::jsonb,'limitations','[]'::jsonb),
 '{"structureValid":true,"contentReview":"passed","criticalErrors":0,"qualityAverage":4,"evidenceScore":4}'
 from generate_series(0,64) i;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"71000000-0000-0000-0000-000000000001","email":"history-admin@example.test","role":"authenticated"}',true);
do $$ declare r record; begin
 for r in select id from public.currency_report_runs where rule_version='history-pgtap/1' loop
  perform public.review_currency_report_version(r.id,'approved',null,null,null,'periodic');
 end loop;
end $$;
reset role;
set local role anon;
select is((select count(*) from public.currency_report_summaries where base_date between '2074-12-01' and '2075-02-03'),65::bigint,'65 isolated synthetic dates are queryable');
select is((select count(*) from (select base_date from public.currency_report_summaries where currency='CLP' and base_date between '2074-12-01' and '2075-02-03' order by base_date desc limit 30) p),30::bigint,'page size is 30 not retention');
select is((select count(*) from public.currency_report_summaries where currency='CLP' and base_date between '2074-12-01' and '2074-12-05'),5::bigint,'last page has five');
select is(public.resolve_currency_report('CLP','2074-12-01','HISTORY-CLP-2074-12-01',true)->>'state','active','direct old identity does not depend on latest page');
select is(public.resolve_currency_report('MXN','2074-12-01','HISTORY-CLP-2074-12-01',true)->>'state','not_found','currency mismatch does not fall back');
select is(public.resolve_currency_report('CLP','2074-12-02','HISTORY-CLP-2074-12-01',true)->>'state','not_found','date mismatch does not fall back');
select is(public.resolve_currency_report('CLP','2074-12-01',null,false)->>'state','not_found','test data excluded by default');
select is((select count(*) from public.currency_report_periods('CLP',true) where period in ('2074-12','2075-01','2075-02')),3::bigint,'period metadata spans the full history');
select ok(not has_table_privilege('anon','public.currency_report_public_states','UPDATE'),'anon cannot change state');
select ok(not has_table_privilege('service_role','public.currency_report_public_states','INSERT'),'service cannot forge publication state');
select ok((public.resolve_currency_report('CLP','2074-12-01',null,true)::text not like '%PRIVATE_HISTORY%'),'private packets omitted');
reset role;
insert into public.currency_report_runs(id,currency,base_date,attempt,rule_version,event_binding,packet,candidate,validation)
 select md5('history-replacement')::uuid,currency,base_date,2,rule_version,event_binding,packet,
 jsonb_set(candidate,'{id}','"HISTORY-CLP-corrected"'),validation from public.currency_report_runs where id=md5('history-test-0')::uuid;
set local role authenticated;
select throws_ok($$select public.review_currency_report_version(md5('history-replacement')::uuid,'approved',null,'wrong','correction',null)$$,'55000','public report changed; reload before approval','stale approval context rejected');
select throws_ok($$select public.review_currency_report(md5('history-replacement')::uuid,'approved',null)$$,'55000','public report changed; reload before approval','legacy callers cannot silently replace');
select throws_ok($$select public.review_currency_report_version(md5('history-replacement')::uuid,'approved',null,'HISTORY-CLP-2074-12-01',null,null)$$,'22023','explicit replacement classification required','replacement kind required');
select lives_ok($$select public.review_currency_report_version(md5('history-replacement')::uuid,'approved',null,'HISTORY-CLP-2074-12-01','correction',null)$$,'explicit correction succeeds atomically');
reset role;
set local role anon;
select is(public.resolve_currency_report('CLP','2074-12-01','HISTORY-CLP-2074-12-01',true)->>'state','superseded','old identity becomes superseded');
select ok((public.resolve_currency_report('CLP','2074-12-01','HISTORY-CLP-2074-12-01',true)->>'report') is null,'superseded body never returned');
select is(public.resolve_currency_report('CLP','2074-12-01',null,true)->>'id','HISTORY-CLP-corrected','date alias resolves current correction');
select ok(public.resolve_currency_report('CLP','2074-12-01',null,true)->>'revisionKind'='correction' and public.resolve_currency_report('CLP','2074-12-01',null,true)->>'reportKind'='periodic','correction metadata retains the verified publication kind');
reset role;
set local role authenticated;
select lives_ok($$select public.review_currency_report(md5('history-replacement')::uuid,'withdrawn','test complete')$$,'withdrawal updates body visibility and public state');
reset role;
set local role anon;
select is(public.resolve_currency_report('CLP','2074-12-01','HISTORY-CLP-corrected',true)->>'state','withdrawn','withdrawn distinguished from nonexistent');
select is(public.resolve_currency_report('CLP','2074-12-01',null,true)->>'state','withdrawn','date alias retains withdrawal status without reading hidden body');
select ok((public.resolve_currency_report('CLP','2074-12-01','HISTORY-CLP-2074-12-01',true)->>'replacement') is null,'no valid correction after final withdrawal');
reset role;
update public.business_plan_admins set active=false where email='history-admin@example.test';
set local role authenticated;
select throws_ok($$select public.review_currency_report_version(md5('history-replacement')::uuid,'rejected')$$,'42501','active administrator access required','same session revocation blocks version review');
reset role;
select is((select count(*) from public.currency_report_reviews where run_id=md5('history-replacement')::uuid),2::bigint,'failed attempts add no review and successful audit is retained');
select * from finish();
rollback;

