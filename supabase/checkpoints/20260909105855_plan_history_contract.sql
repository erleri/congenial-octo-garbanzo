drop policy if exists "Anyone can view business plan rates"
  on public.business_plan_rates;
drop policy if exists "Only active business plan admins can insert rates"
  on public.business_plan_rates;

create policy "Active admins can view business plan rate history"
on public.business_plan_rates
for select
to authenticated
using ((select app_private.is_business_plan_admin()));

create policy "Only active business plan admins can insert rates"
on public.business_plan_rates
for insert
to authenticated
with check (
  (select app_private.is_business_plan_admin())
  and created_by_email = lower(auth.jwt() ->> 'email')
);


revoke all on public.business_plan_rates from anon;
grant select, insert on public.business_plan_rates to authenticated;
