-- Bounded service-only queue. Preserve original envelopes/ledgers; callers
-- must still claim each lease and keep unknown costs globally blocking.
create index if not exists currency_operating_pending_revision
 on app_private.currency_report_operating_batches(policy_revision,created_at,batch_key)
 where state in ('paused','cost_unresolved','running');

create or replace function public.pending_currency_report_operating_batches(p_revision bigint) returns jsonb
language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at,b.batch_key),'[]'::jsonb) from (
  select * from app_private.currency_report_operating_batches
  where policy_revision=p_revision and state in ('paused','cost_unresolved','running')
  -- The extra row detects backlog overflow; it is not silently discarded.
  order by created_at,batch_key limit 17
 ) b;
$$;
revoke all on function public.pending_currency_report_operating_batches(bigint) from public,anon,authenticated;
grant execute on function public.pending_currency_report_operating_batches(bigint) to service_role;
