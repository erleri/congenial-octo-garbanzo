begin;
select plan(4);
insert into public.business_plan_rates(period_month,plan_type,currency,rate_value,created_at)
values ('2099-01-01','leading','BRL',5,'2099-01-01 00:00:00+00');
select is((select rate_value from public.business_plan_current where period_month='2099-01-01' and currency='BRL'),5::numeric,'history insertion updates current');
insert into public.business_plan_rates(period_month,plan_type,currency,rate_value,created_at)
values ('2099-01-01','leading','BRL',4,'2098-01-01 00:00:00+00');
select is((select rate_value from public.business_plan_current where period_month='2099-01-01' and currency='BRL'),5::numeric,'old history does not replace latest value');
set local role anon;
select is((select count(*) from public.business_plan_current where period_month='2099-01-01'),1::bigint,'anon can read current');
select is((select count(*) from public.business_plan_rates where period_month='2099-01-01'),2::bigint,'expand preserves legacy read until explicit closure');
reset role;
select * from finish();
rollback;
