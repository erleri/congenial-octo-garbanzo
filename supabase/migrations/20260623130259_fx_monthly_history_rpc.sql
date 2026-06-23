create or replace function public.get_fx_monthly_history()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'currency', currency,
        'periodMonth', period_month,
        'rateType', rate_type,
        'value', rate_value,
        'status', status,
        'source', source,
        'imputationMethod', imputation_method
      )
      order by period_month, currency, rate_type
    ),
    '[]'::jsonb
  )
  from public.fx_monthly_rates;
$$;

revoke all on function public.get_fx_monthly_history() from public;
grant execute on function public.get_fx_monthly_history() to anon, authenticated;
