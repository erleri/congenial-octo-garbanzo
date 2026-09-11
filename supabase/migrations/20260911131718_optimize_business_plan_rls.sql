-- Preserve the existing authorization contract while evaluating session claims
-- once per statement instead of once for every candidate row.
create or replace function app_private.is_business_plan_admin()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_plan_admins
    where email = lower((select auth.jwt()) ->> 'email')
      and active = true
  );
$$;

drop policy if exists "Business plan admins can view own admin row"
  on public.business_plan_admins;
create policy "Business plan admins can view own admin row"
on public.business_plan_admins
for select
to authenticated
using (email = lower((select auth.jwt()) ->> 'email'));

drop policy if exists "Only active business plan admins can insert rates"
  on public.business_plan_rates;
create policy "Only active business plan admins can insert rates"
on public.business_plan_rates
for insert
to authenticated
with check (
  (select app_private.is_business_plan_admin())
  and created_by_email = lower((select auth.jwt()) ->> 'email')
);
