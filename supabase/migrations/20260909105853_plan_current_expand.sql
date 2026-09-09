alter table public.business_plan_rates
  add column if not exists change_set_id uuid;

create index if not exists business_plan_rates_history_idx
  on public.business_plan_rates (period_month, created_at desc, change_set_id);

create table if not exists public.business_plan_current (
  period_month date not null,
  plan_type text not null check (plan_type in ('leading', 'moving')),
  currency text not null check (
    currency in ('ARS', 'BRL', 'CLP', 'COP', 'GTQ', 'MXN', 'PYG', 'PEN', 'CNY', 'UYU', 'USD')
  ),
  rate_value numeric,
  updated_at timestamptz not null,
  primary key (period_month, plan_type, currency)
);

alter table public.business_plan_current enable row level security;

insert into public.business_plan_current (
  period_month,
  plan_type,
  currency,
  rate_value,
  updated_at
)
select distinct on (period_month, plan_type, currency)
  period_month,
  plan_type,
  currency,
  rate_value,
  created_at
from public.business_plan_rates
order by period_month, plan_type, currency, created_at desc, id desc
on conflict (period_month, plan_type, currency) do update
set rate_value = excluded.rate_value,
    updated_at = excluded.updated_at;

create schema if not exists app_private;

create or replace function app_private.is_business_plan_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_plan_admins
    where email = lower(auth.jwt() ->> 'email')
      and active = true
  );
$$;

create or replace function app_private.sync_business_plan_current()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.business_plan_current (
    period_month,
    plan_type,
    currency,
    rate_value,
    updated_at
  )
  values (
    new.period_month,
    new.plan_type,
    new.currency,
    new.rate_value,
    new.created_at
  )
  on conflict (period_month, plan_type, currency) do update
  set rate_value = excluded.rate_value,
      updated_at = excluded.updated_at
  where public.business_plan_current.updated_at <= excluded.updated_at;

  return new;
end;
$$;

drop trigger if exists sync_business_plan_current_after_insert
  on public.business_plan_rates;
create trigger sync_business_plan_current_after_insert
after insert on public.business_plan_rates
for each row execute function app_private.sync_business_plan_current();

revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

revoke execute on function app_private.is_business_plan_admin()
  from public, anon, authenticated;
grant execute on function app_private.is_business_plan_admin()
  to authenticated;

revoke execute on function app_private.sync_business_plan_current()
  from public, anon, authenticated;

drop policy if exists "Anyone can view current business plan rates"
  on public.business_plan_current;
create policy "Anyone can view current business plan rates"
on public.business_plan_current
for select
to anon, authenticated
using (true);

revoke all on table public.business_plan_admins from anon, authenticated;
grant select on table public.business_plan_admins to authenticated;
grant select, insert, update, delete on table public.business_plan_admins to service_role;

revoke all on table public.business_plan_current from anon, authenticated;
grant select on table public.business_plan_current to anon, authenticated;
grant select, insert, update, delete on table public.business_plan_current to service_role;

grant select, insert, update, delete on table public.fx_daily_rates to service_role;
grant select, insert, update, delete on table public.fx_monthly_rates to service_role;
grant select, insert, update, delete on table public.fx_dataset_state to service_role;


grant select on public.business_plan_rates to anon, authenticated;
grant insert on public.business_plan_rates to authenticated;
grant select, insert, update, delete on public.business_plan_rates to service_role;
