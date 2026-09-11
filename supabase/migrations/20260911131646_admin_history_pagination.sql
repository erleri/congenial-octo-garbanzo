-- Additive RPC; access closure remains a separately approved checkpoint.
create or replace function public.get_business_plan_history(
  p_period_month date, p_before timestamptz default null,
  p_limit integer default 20, p_before_group text default null
)
returns table (
  change_group text, legacy boolean, period_month date, created_at timestamptz,
  created_by_email text, plan_type text, currency text,
  previous_rate_value numeric, rate_value numeric
)
language sql stable security invoker set search_path = ''
as $$
  with ordered as (
    select r.*,
      -- Legacy display buckets only: never backfill an inferred change_set_id.
      coalesce(r.change_set_id::text, 'legacy:' || r.created_at::text || ':' || md5(coalesce(r.created_by_email, ''))) as grp,
      lag(r.rate_value) over (
        partition by r.period_month, r.plan_type, r.currency
        order by r.created_at, r.id
      ) as previous_value
    from public.business_plan_rates r
    where r.period_month = p_period_month
      and (select app_private.is_business_plan_admin())
  ), groups as (
    select grp, max(o.created_at) as group_at from ordered o group by grp
  ), page as (
    select * from groups g
    where p_before is null or g.group_at < p_before
      or (g.group_at = p_before and g.grp < p_before_group)
    order by g.group_at desc, g.grp desc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  )
  select o.grp, o.change_set_id is null, o.period_month, p.group_at,
    o.created_by_email, o.plan_type, o.currency, o.previous_value, o.rate_value
  from ordered o join page p on p.grp = o.grp
  order by p.group_at desc, p.grp desc, o.plan_type, o.currency;
$$;
revoke all on function public.get_business_plan_history(date,timestamptz,integer,text) from public, anon;
grant execute on function public.get_business_plan_history(date,timestamptz,integer,text) to authenticated;
