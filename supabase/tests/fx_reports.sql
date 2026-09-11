begin;
select plan(12);

insert into public.business_plan_admins(email, active)
values ('report-admin@example.test', true);

insert into public.fx_report_runs(
  id, base_date, attempt, schema_version, generation_mode, publish_mode,
  evidence, deterministic_content, selected_content, validation
) values (
  '10000000-0000-0000-0000-000000000001', '2099-05-01', 1, '2.0.0',
  'deterministic', 'review',
  '{"confidence":"medium","facts":[],"news":[],"metrics":[]}',
  '{"headline":"test","confidence":"medium"}',
  '{"headline":"test","confidence":"medium"}',
  '{"valid":true,"errors":[]}'
);

insert into public.fx_report_runs(
  id, base_date, attempt, schema_version, generation_mode, publish_mode, status,
  evidence, deterministic_content, selected_content, validation, published_at
) values (
  '10000000-0000-0000-0000-000000000000', '2099-04-30', 1, '2.0.0',
  'deterministic', 'automatic', 'published',
  '{"confidence":"medium","facts":[],"news":[],"metrics":[]}',
  '{"headline":"already public","confidence":"medium"}',
  '{"headline":"already public","confidence":"medium"}',
  '{"valid":true,"errors":[]}', now()
);

insert into public.fx_reports(base_date, run_id, schema_version, generation_mode, confidence, content, evidence)
values (
  '2099-04-30', '10000000-0000-0000-0000-000000000000', '2.0.0',
  'deterministic', 'medium', '{"headline":"already public"}', '{}'
);

set local role anon;
select is((select count(*) from public.fx_reports), 1::bigint, 'anon can read published reports');
select ok(not has_table_privilege(current_user, 'public.fx_report_runs', 'SELECT'), 'anon cannot reach private runs');
select ok(not has_function_privilege(current_user, 'public.review_fx_report(uuid,text,text)', 'EXECUTE'), 'anon cannot review reports');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","email":"reader@example.test","role":"authenticated"}', true);
select is((select count(*) from public.fx_report_runs), 0::bigint, 'non-admin cannot read private runs');
select throws_ok(
  $$select public.review_fx_report('10000000-0000-0000-0000-000000000001', 'approved', null)$$,
  '42501', 'active administrator access required', 'non-admin cannot approve a report'
);
select ok(not has_function_privilege(current_user, 'public.publish_fx_report_system(uuid)', 'EXECUTE'), 'authenticated users cannot execute system publish');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000002","email":"report-admin@example.test","role":"authenticated"}', true);
select is((select count(*) from public.fx_report_runs), 2::bigint, 'active admin can read private runs');
select lives_ok(
  $$select public.review_fx_report('10000000-0000-0000-0000-000000000001', 'approved', null)$$,
  'active admin can approve and publish'
);
select is((select count(*) from public.fx_report_reviews), 1::bigint, 'approval creates one append-only review');
select is((select content ->> 'headline' from public.fx_reports where base_date = '2099-05-01'), 'test', 'approval publishes sanitized content');
reset role;

update public.business_plan_admins set active = false where email = 'report-admin@example.test';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000002","email":"report-admin@example.test","role":"authenticated"}', true);
select is((select count(*) from public.fx_report_runs), 0::bigint, 'revoked admin loses run access with the same JWT');
reset role;

insert into public.fx_report_runs(
  id, base_date, attempt, schema_version, generation_mode, publish_mode,
  evidence, deterministic_content, selected_content, validation
) values (
  '10000000-0000-0000-0000-000000000002', '2099-05-02', 1, '2.0.0',
  'deterministic', 'automatic',
  '{"confidence":"low","facts":[],"news":[],"metrics":[]}',
  '{"headline":"system","confidence":"low"}',
  '{"headline":"system","confidence":"low"}',
  '{"valid":true,"errors":[]}'
);
set local role service_role;
select lives_ok(
  $$select public.publish_fx_report_system('10000000-0000-0000-0000-000000000002')$$,
  'service role can publish automatically'
);
reset role;

select * from finish();
rollback;
