-- Public consumers read only the email-free current-value projection.
-- Raw append-only history and saver identity are restricted to active admins.
alter table public.business_plan_rates enable row level security;

drop policy if exists "Anyone can view business plan rates"
  on public.business_plan_rates;
drop policy if exists "Active admins can view business plan rate history"
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
  and created_by_email = lower((select auth.jwt()) ->> 'email')
);

revoke all on table public.business_plan_rates from public, anon, authenticated;
grant select, insert on table public.business_plan_rates to authenticated;
grant select, insert, update, delete on table public.business_plan_rates to service_role;
