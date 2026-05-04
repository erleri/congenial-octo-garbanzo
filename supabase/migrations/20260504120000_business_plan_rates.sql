create extension if not exists pgcrypto;

create table if not exists public.business_plan_admins (
  email text primary key,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.business_plan_rates (
  id uuid primary key default gen_random_uuid(),
  period_month date not null,
  plan_type text not null check (plan_type in ('leading', 'moving')),
  currency text not null check (
    currency in ('ARS', 'BRL', 'CLP', 'COP', 'GTQ', 'MXN', 'PYG', 'PEN', 'CNY', 'UYU', 'USD')
  ),
  rate_value numeric,
  created_by_email text,
  created_at timestamptz not null default now()
);

create index if not exists business_plan_rates_period_idx
  on public.business_plan_rates (period_month, created_at desc);

create index if not exists business_plan_rates_latest_lookup_idx
  on public.business_plan_rates (period_month, plan_type, currency, created_at desc);

alter table public.business_plan_admins enable row level security;
alter table public.business_plan_rates enable row level security;

create schema if not exists app_private;

create or replace function app_private.is_business_plan_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_plan_admins
    where email = lower(auth.jwt() ->> 'email')
      and active = true
  );
$$;

drop policy if exists "Business plan admins can view own admin row" on public.business_plan_admins;
create policy "Business plan admins can view own admin row"
on public.business_plan_admins
for select
to authenticated
using (email = lower(auth.jwt() ->> 'email'));

drop policy if exists "Anyone can view business plan rates" on public.business_plan_rates;
create policy "Anyone can view business plan rates"
on public.business_plan_rates
for select
to anon, authenticated
using (true);

drop policy if exists "Only active business plan admins can insert rates" on public.business_plan_rates;
create policy "Only active business plan admins can insert rates"
on public.business_plan_rates
for insert
to authenticated
with check (
  app_private.is_business_plan_admin()
  and created_by_email = lower(auth.jwt() ->> 'email')
);
