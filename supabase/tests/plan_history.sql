begin;
select plan(7);
insert into public.business_plan_admins(email,active) values ('history-test@example.test',true);
insert into public.business_plan_rates(id,period_month,plan_type,currency,rate_value,created_at,change_set_id)
select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 '2099-03-01','leading','BRL',5,'2099-03-01',
 ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,21) i;
set local role authenticated;
select set_config('request.jwt.claims','{"email":"history-test@example.test"}',true);
select is((select count(distinct change_group) from public.get_business_plan_history('2099-03-01')),20::bigint,'first page has 20 groups at same timestamp');
select is((select count(*) from public.get_business_plan_history('2099-03-01','2099-03-01',20,'00000000-0000-0000-0000-000000000002')),1::bigint,'cursor retains remaining same-timestamp group');
select is((select count(*) from public.get_business_plan_history('2099-03-01') where previous_rate_value=rate_value),20::bigint,'unchanged groups still advance pagination');
select set_config('request.jwt.claims','{"email":"reader@example.test"}',true);
select is((select count(*) from public.get_business_plan_history('2099-03-01')),0::bigint,'non-admin RPC returns no history even before contract');
reset role;
select ok(not has_function_privilege('anon','public.get_business_plan_history(date,timestamptz,integer,text)','EXECUTE'),'anon cannot execute RPC');
insert into public.business_plan_rates(period_month,plan_type,currency,rate_value,created_at)
values ('2099-04-01','leading','BRL',6,'2099-04-01');
set local role authenticated;
select set_config('request.jwt.claims','{"email":"history-test@example.test"}',true);
select ok((select legacy from public.get_business_plan_history('2099-04-01')),'legacy row remains legacy');
reset role;
update public.business_plan_admins set active=false where email='history-test@example.test';
set local role authenticated;
select is((select count(*) from public.get_business_plan_history('2099-03-01')),0::bigint,'revoked admin loses RPC access with same JWT');
reset role;
select * from finish();
rollback;
