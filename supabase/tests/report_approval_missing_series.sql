begin;
select no_plan();
insert into public.business_plan_admins(email,active) values('series-admin@example.test',true);
insert into public.currency_report_runs(id,currency,base_date,attempt,rule_version,event_binding,storage_required,packet,candidate,validation)
values('73000000-0000-0000-0000-000000000001','CLP','2098-02-02',1,'synthetic-missing-series/1','synthetic',true,'{"private":"SYNTHETIC_INPUT_UNCHANGED"}',
'{"id":"CLP-SYNTHETIC-MISSING-SERIES","schemaVersion":"currency-report/1","testOnly":true,"currency":"CLP","baseDate":"2098-02-02","observedDate":"2098-02-02","generationMode":"ai_enhanced","content":{"title":"합성 승인 검사","summary":"실제 원고 아님","change":{"title":"관측","text":"합성 값","kind":"fact","factIds":["spot"],"evidenceIds":[]},"drivers":[],"implications":[],"watch":[],"limitations":[]},"facts":[{"id":"spot","label":"합성 값","value":102}],"series":[{"date":"2098-02-01","value":100},{"date":"2098-02-02","value":null},{"date":"2098-02-03","value":102}],"evidence":[],"limitations":[]}',
'{"structureValid":true,"contentReview":"passed","criticalErrors":0,"qualityAverage":4,"evidenceScore":4}');
set local role service_role;
select lives_ok($$select public.seal_currency_report_storage('73000000-0000-0000-0000-000000000001','synthetic-series-bundle',repeat('a',64))$$,'seal exact private series including null');
reset role;
create temporary table series_original as select md5(candidate::text) c,md5(packet::text) p,md5(validation::text) v from public.currency_report_runs where id='73000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"73000000-0000-0000-0000-000000000010","email":"series-admin@example.test","role":"authenticated"}',true);
select lives_ok($$select public.review_currency_report_version('73000000-0000-0000-0000-000000000001','approved',null,null,null,null)$$,'admin approves stored gap without editing manuscript or seal');
reset role;
select is((select report->'series' from public.currency_reports where run_id='73000000-0000-0000-0000-000000000001'),'[{"date":"2098-02-01","value":100},{"date":"2098-02-03","value":102}]'::jsonb,'public chart retains exact numeric observations and order');
select ok((select c=md5(candidate::text) and p=md5(packet::text) and v=md5(validation::text) from public.currency_report_runs,series_original where id='73000000-0000-0000-0000-000000000001'),'private manuscript packet and validation bytes unchanged');
select ok((select candidate->'series'->1->'value'='null'::jsonb from public.currency_report_runs where id='73000000-0000-0000-0000-000000000001'),'missing observation is still missing in original');
select ok((select s.candidate_digest=encode(extensions.digest(r.candidate::text,'sha256'),'hex') from public.currency_report_storage_receipts s join public.currency_report_runs r on r.id=s.run_id where r.id='73000000-0000-0000-0000-000000000001'),'original storage receipt still matches');

-- Same observed shape as the production failure; values and dates are synthetic.
insert into public.currency_report_runs(id,currency,base_date,attempt,rule_version,event_binding,storage_required,packet,candidate,validation)
select '73000000-0000-0000-0000-000000000002','CLP','2098-02-03',1,rule_version,event_binding,false,packet,
candidate||jsonb_build_object('id','CLP-SYNTHETIC-LARGE-GAPS','baseDate','2098-02-03','series',
 (select jsonb_agg(jsonb_build_object('date',(date '2080-01-01'+i)::text,'value',case when i<=1245 then null else 100+i end) order by i) from generate_series(1,5633)i)),validation
from public.currency_report_runs where id='73000000-0000-0000-0000-000000000001';
set local role authenticated;
select lives_ok($$select public.review_currency_report_version('73000000-0000-0000-0000-000000000002','approved',null,null,null,null)$$,'production-size gap shape also passes common approval');
reset role;
select is((select jsonb_array_length(report->'series') from public.currency_reports where run_id='73000000-0000-0000-0000-000000000002'),4388,'only 4388 real numeric synthetic points appear publicly');
select is((select count(*) from public.currency_report_runs r,jsonb_array_elements(r.candidate->'series') s where r.id='73000000-0000-0000-0000-000000000002' and s->'value'='null'::jsonb),1245::bigint,'all 1245 private gaps retained');

select throws_ok($$update public.currency_reports set report=jsonb_set(report,'{series}','[{"date":"2098-02-01","value":"100"}]') where run_id='73000000-0000-0000-0000-000000000002'$$,'22023','invalid public field type','numeric-looking string is not silently dropped');
select throws_ok($$update public.currency_reports set report=jsonb_set(report,'{series}','[{"date":"2098-02-01"}]') where run_id='73000000-0000-0000-0000-000000000002'$$,'22023','invalid public field type','missing key remains malformed');
select throws_ok($$update public.currency_reports set report=jsonb_set(report,'{series}','[{"date":42,"value":null}]') where run_id='73000000-0000-0000-0000-000000000002'$$,'22023','invalid public field type','bad date type is not hidden by null value');
select throws_ok($$update public.currency_reports set report=jsonb_set(report,'{facts,0,value}','null') where run_id='73000000-0000-0000-0000-000000000002'$$,'22023','invalid public field type','required spot fact still cannot be null');
select ok(not has_function_privilege('anon','public.review_currency_report_version(uuid,text,text,text,text,text)','EXECUTE'),'anonymous approval stays denied');
select ok(not has_table_privilege('authenticated','public.currency_reports','INSERT'),'login alone still cannot bypass approval');
select is((select count(*) from public.currency_report_reviews where run_id in ('73000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000002')),2::bigint,'only successful approvals append audit records');
select * from finish();
rollback;
