create table if not exists public.fx_daily_rates (
  rate_date date not null,
  currency text not null check (
    currency in ('ARS', 'BRL', 'CLP', 'COP', 'GTQ', 'MXN', 'PYG', 'PEN', 'CNY', 'UYU', 'USD')
  ),
  rate_type text not null check (rate_type in ('LOCAL_PER_USD', 'KRW')),
  rate_value numeric,
  status text not null check (status in ('ok', 'empty', 'zero', 'error')),
  source text not null check (source in ('API', 'EXCEL', 'IMPUTED')),
  imputation_method text not null check (
    imputation_method in ('NONE', 'FFILL', 'LINEAR', 'MONTHLY_FALLBACK')
  ),
  updated_at timestamptz not null default now(),
  primary key (currency, rate_type, rate_date)
);

create index if not exists fx_daily_rates_date_idx
  on public.fx_daily_rates (rate_date);

create table if not exists public.fx_monthly_rates (
  period_month date not null,
  currency text not null check (
    currency in ('ARS', 'BRL', 'CLP', 'COP', 'GTQ', 'MXN', 'PYG', 'PEN', 'CNY', 'UYU', 'USD')
  ),
  rate_type text not null check (rate_type in ('LOCAL_PER_USD', 'KRW')),
  rate_value numeric,
  status text not null check (status in ('ok', 'empty', 'zero', 'error')),
  source text not null check (source in ('API', 'EXCEL', 'IMPUTED')),
  imputation_method text not null check (
    imputation_method in ('NONE', 'FFILL', 'LINEAR', 'MONTHLY_FALLBACK')
  ),
  updated_at timestamptz not null default now(),
  primary key (currency, rate_type, period_month)
);

create index if not exists fx_monthly_rates_period_idx
  on public.fx_monthly_rates (period_month);

create table if not exists public.fx_dataset_state (
  dataset_key text primary key check (dataset_key = 'primary'),
  base_date date not null,
  fetched_at timestamptz not null,
  data_version text not null,
  daily_row_count integer not null check (daily_row_count >= 0),
  monthly_row_count integer not null check (monthly_row_count >= 0),
  load_status text not null check (load_status in ('loading', 'ready', 'failed')),
  error_message text,
  updated_at timestamptz not null default now()
);

alter table public.fx_daily_rates enable row level security;
alter table public.fx_monthly_rates enable row level security;
alter table public.fx_dataset_state enable row level security;

drop policy if exists "Public can read daily FX rates" on public.fx_daily_rates;
create policy "Public can read daily FX rates"
on public.fx_daily_rates
for select
to anon, authenticated
using (true);

drop policy if exists "Public can read monthly FX rates" on public.fx_monthly_rates;
create policy "Public can read monthly FX rates"
on public.fx_monthly_rates
for select
to anon, authenticated
using (true);

drop policy if exists "Public can read FX dataset state" on public.fx_dataset_state;
create policy "Public can read FX dataset state"
on public.fx_dataset_state
for select
to anon, authenticated
using (true);

grant select on public.fx_daily_rates to anon, authenticated;
grant select on public.fx_monthly_rates to anon, authenticated;
grant select on public.fx_dataset_state to anon, authenticated;

create or replace function public.get_fx_dashboard()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with state as (
    select base_date, fetched_at, data_version
    from public.fx_dataset_state
    where dataset_key = 'primary'
      and load_status = 'ready'
  ),
  daily as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'currency', currency,
      'date', rate_date,
      'rateType', rate_type,
      'value', rate_value,
      'status', status,
      'source', source,
      'imputationMethod', imputation_method
    ) order by rate_date, currency, rate_type), '[]'::jsonb) as rows
    from public.fx_daily_rates, state
    where rate_date between state.base_date - interval '1 year' and state.base_date
  ),
  monthly as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'currency', currency,
      'periodMonth', period_month,
      'rateType', rate_type,
      'value', rate_value,
      'status', status,
      'source', source,
      'imputationMethod', imputation_method
    ) order by period_month, currency, rate_type), '[]'::jsonb) as rows
    from public.fx_monthly_rates, state
    where period_month >= date_trunc('month', state.base_date) - interval '23 months'
  )
  select jsonb_build_object(
    'baseDate', state.base_date,
    'fetchedAt', state.fetched_at,
    'dataVersion', state.data_version,
    'dailyRates', daily.rows,
    'monthlyRates', monthly.rows
  )
  from state cross join daily cross join monthly;
$$;

revoke all on function public.get_fx_dashboard() from public;
grant execute on function public.get_fx_dashboard() to anon, authenticated;
