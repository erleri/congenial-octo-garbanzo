begin;
select plan(21);
select ok((select relrowsecurity from pg_class where oid='app_private.currency_report_official_inputs'::regclass),'official cache RLS enabled');
select ok(not has_table_privilege('anon','app_private.currency_report_official_inputs','select'),'anon has no original access');
select ok(not has_table_privilege('authenticated','app_private.currency_report_official_inputs','select'),'authenticated including admin has no cache originals');
select ok(not has_function_privilege('anon','public.load_currency_report_official_input(text,text,timestamptz)','execute'),'anon cannot load');
select ok(not has_function_privilege('authenticated','public.load_currency_report_official_input(text,text,timestamptz)','execute'),'authenticated cannot load');
select ok(not has_function_privilege('authenticated','public.save_currency_report_official_input(text)','execute'),'authenticated cannot save');
select ok(has_function_privilege('service_role','public.save_currency_report_official_input(text)','execute'),'service can save');
select ok(not has_table_privilege('service_role','app_private.currency_report_official_inputs','update'),'service cannot overwrite receipts');
select ok(not has_table_privilege('service_role','app_private.currency_report_official_inputs','delete'),'cache has no implicit deletion grant');

create function pg_temp.official_test_record(k text,c text default 'PEN',t text default '2026-10-27T12:00:00Z') returns text
language sql as $$select jsonb_build_object('version','official-input-cache/1','definitions','synthetic-cache-test/1','currency',c,
 'key',k,'binding',repeat('a',64),'observedAt',t,'inputs',jsonb_build_object('synthetic','PRIVATE-CACHE-SYNTHETIC'))::text;$$;
set local role service_role;
select is(public.save_currency_report_official_input(pg_temp.official_test_record(repeat('1',64)))->>'status','stored','service stores free capture');
select is(public.load_currency_report_official_input('PEN','synthetic-cache-test/1','2026-11-01T00:00:00Z'),pg_temp.official_test_record(repeat('1',64)),'exact JSON bytes preserved');
select is(public.save_currency_report_official_input(pg_temp.official_test_record(repeat('1',64),'PEN','2026-10-28T12:00:00Z'))->>'status','duplicate_preserved','recapture does not replace original receipt');
select is(public.load_currency_report_official_input('PEN','synthetic-cache-test/1','2026-11-01T00:00:00Z'),pg_temp.official_test_record(repeat('1',64)),'first capture clock retained');
select is(public.load_currency_report_official_input('PEN','synthetic-cache-test/1','2026-10-26T00:00:00Z'),null,'future unavailable capture excluded');
select is(public.load_currency_report_official_input('BRL','synthetic-cache-test/1','2026-11-01T00:00:00Z'),null,'other country is isolated');
select is(public.load_currency_report_official_input('PEN','other-definitions','2026-11-01T00:00:00Z'),null,'definition versions isolated');
select throws_ok($$select public.save_currency_report_official_input(pg_temp.official_test_record(repeat('1',64),'BRL'));$$,'22023','official cache identity conflict','identity cannot change country');
select throws_ok($$select public.save_currency_report_official_input(repeat('x',16000001));$$,'22023','official cache input limit','single-record bound');
select throws_ok($$select public.save_currency_report_official_input('{}');$$,'22023','registered official cache record required','unregistered payload rejected');
select throws_ok($$select public.save_currency_report_official_input(replace(pg_temp.official_test_record(repeat('2',64)),'PRIVATE-CACHE-SYNTHETIC','sk-or-test-only'));$$,'22023','registered official cache record required','obvious secrets rejected');
reset role;
-- Exercise the quota without calling an external service or deleting history.
insert into app_private.currency_report_official_inputs(cache_key,currency,definitions,observed_at,record_json)
 select repeat(n::text,64),'ARS','synthetic-quota','2026-10-27',repeat('x',16000000) from generate_series(7,9) n;
set local role service_role;
select is(public.save_currency_report_official_input(replace(pg_temp.official_test_record(repeat('3',64)),'PRIVATE-CACHE-SYNTHETIC',repeat('x',2100000)))->>'status','capacity_hold','global quota holds without truncation/deletion');
reset role;
select * from finish();
rollback;
