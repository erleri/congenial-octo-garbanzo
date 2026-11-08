-- Local-first, service-only continuation. No controls/policies/data are enabled.
create function public.pending_currency_report_operating_batches(p_revision bigint) returns jsonb
language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) from (
  select * from app_private.currency_report_operating_batches
  where policy_revision=p_revision and state in ('paused','cost_unresolved','running')
  order by created_at,batch_key limit 1
 ) b;
$$;
revoke all on function public.pending_currency_report_operating_batches(bigint) from public,anon,authenticated;
grant execute on function public.pending_currency_report_operating_batches(bigint) to service_role;

create function public.supersede_currency_report_operating_batch(p_batch_key text,p_revision bigint,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b app_private.currency_report_operating_batches; c app_private.currency_report_runtime_control; latest bigint;
begin
 select * into c from app_private.currency_report_runtime_control where singleton for update;
 select max(revision) into latest from app_private.currency_report_operating_policies;
 select * into b from app_private.currency_report_operating_batches where batch_key=p_batch_key for update;
 if p_reason is null or p_reason not in ('frozen_reference_superseded','frozen_material_superseded') then raise exception 'explicit supersession reason required'; end if;
 if not c.enabled or not c.review_enabled or c.writer<>'sol' or latest is distinct from p_revision
  or b.policy_revision is distinct from p_revision or b.state not in ('paused','running','cost_unresolved')
  or (b.state='running' and b.lease_until>clock_timestamp()) then
  return jsonb_build_object('superseded',false,'reason','operating_scope_or_lease_changed'); end if;
 if exists(select 1 from app_private.currency_report_runtime_jobs where cost_state='unknown' or state in ('reserved','calling') or actual_nano>reserved_nano) then
  return jsonb_build_object('superseded',false,'reason','unresolved_or_inflight_call'); end if;
 update app_private.currency_report_operating_cases set state='held',
  result=jsonb_build_object('status',p_reason,'previousResult',result,'publicationApproved',false),updated_at=clock_timestamp()
  where batch_key=p_batch_key and state in ('paused','running');
 update app_private.currency_report_operating_batches set state='completed',
  result=jsonb_build_object('status',p_reason,'previousResult',result,'publicationApproved',false),updated_at=clock_timestamp()
  where batch_key=p_batch_key;
 return jsonb_build_object('superseded',true);
end;
$$;
revoke all on function public.supersede_currency_report_operating_batch(text,bigint,text) from public,anon,authenticated;
grant execute on function public.supersede_currency_report_operating_batch(text,bigint,text) to service_role;

-- A response may be committed before the caller loses its acknowledgement.
-- Repeating the identical finalization returns the existing run; never inserts
-- another draft or changes an existing candidate/validation/cost receipt.
alter function app_private.finish_currency_report_runtime(uuid,jsonb,jsonb,jsonb) rename to finish_currency_report_runtime_before_continuation;
revoke all on function app_private.finish_currency_report_runtime_before_continuation(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
create function app_private.finish_currency_report_runtime(p_id uuid,p_candidate jsonb,p_validation jsonb,p_cost jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare j app_private.currency_report_runtime_jobs; r public.currency_report_runs;
begin
 select * into j from app_private.currency_report_runtime_jobs where id=p_id for update;
 if j.state='finished' and j.run_id is not null then
  select * into r from public.currency_report_runs where id=j.run_id;
  if r.candidate is distinct from p_candidate or r.validation is distinct from p_validation then
   raise exception 'finalized candidate changed' using errcode='55000'; end if;
  return j.run_id;
 end if;
 return app_private.finish_currency_report_runtime_before_continuation(p_id,p_candidate,p_validation,p_cost);
end;
$$;
revoke all on function app_private.finish_currency_report_runtime(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function app_private.finish_currency_report_runtime(uuid,jsonb,jsonb,jsonb) to service_role;
-- Replace the SQL wrapper explicitly: its parsed dependency may retain the
-- renamed function's OID on some supported Postgres versions.
create or replace function public.finish_currency_report_runtime(p_id uuid,p_candidate jsonb,p_validation jsonb,p_cost jsonb)
returns uuid language sql security invoker set search_path='' as $$select app_private.finish_currency_report_runtime(p_id,p_candidate,p_validation,p_cost);$$;
revoke all on function public.finish_currency_report_runtime(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finish_currency_report_runtime(uuid,jsonb,jsonb,jsonb) to service_role;
