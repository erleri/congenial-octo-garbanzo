begin;
-- Requeue only the over-broad pre-staging candidate gate. This does not
-- approve a source: the worker rechecks current validity and task dependencies.
create function app_private.source_candidate_scope_recovery_reason(c app_private.currency_report_operating_cases) returns text
language sql stable security invoker set search_path='' as $$
 select case when c.state='held' and c.run_id is null
  and c.result->>'status'='frozen_source_review_revalidation_required'
  and c.result->>'newInputDeferred'='true'
  and jsonb_typeof(c.result->'holds')='array' and jsonb_array_length(c.result->'holds')>0
  and not exists(select 1 from jsonb_array_elements_text(c.result->'holds') h
    where h not in ('original_pipeline_failed','original_support_hold','unrelated'))
  and not exists(select 1 from app_private.currency_report_technical_recoveries r
    where r.case_key=c.case_key and r.repair_version='runtime-source-candidate/1')
  and not exists(select 1 from app_private.currency_report_runtime_jobs j where j.context->>'operatingCaseKey'=c.case_key
    and (j.context->>'purpose' is distinct from 'original_source_review' or j.cost_state<>'confirmed'
      or j.state not in ('received','held','finished') or j.actual_nano>j.reserved_nano))
  then 'candidate_rejection_scope_recheck' end;
$$;
revoke all on function app_private.source_candidate_scope_recovery_reason(app_private.currency_report_operating_cases) from public,anon,authenticated;
grant execute on function app_private.source_candidate_scope_recovery_reason(app_private.currency_report_operating_cases) to service_role;

alter function public.recover_currency_report_operating_technical_holds(bigint) set schema app_private;
alter function app_private.recover_currency_report_operating_technical_holds(bigint) rename to recover_operating_before_candidate_scope;
create function public.recover_currency_report_operating_technical_holds(p_revision bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare prior jsonb; c app_private.currency_report_operating_cases;
 b app_private.currency_report_operating_batches; recovered integer=0;
begin
 -- Existing activation, policy, in-flight and unknown-accounting checks and
 -- locks remain authoritative. Original runtime recovery/audits stay intact.
 prior:=app_private.recover_operating_before_candidate_scope(p_revision);
 if prior ? 'reason' then return prior;end if;
 for b in select * from app_private.currency_report_operating_batches
  where policy_revision=p_revision and state in ('completed','paused') order by created_at for update skip locked loop
  for c in select * from app_private.currency_report_operating_cases
   where batch_key=b.batch_key and state='held' and run_id is null order by currency for update skip locked loop
   if app_private.source_candidate_scope_recovery_reason(c) is null then continue;end if;
   insert into app_private.currency_report_technical_recoveries
    values(c.case_key,'runtime-source-candidate/1',c.state,c.result,b.state,clock_timestamp());
   update app_private.currency_report_operating_cases set state='paused',updated_at=clock_timestamp() where case_key=c.case_key;
   update app_private.currency_report_operating_batches set state='paused',updated_at=clock_timestamp() where batch_key=b.batch_key;
   recovered:=recovered+1;
  end loop;
 end loop;
 return jsonb_build_object('recovered',recovered+coalesce((prior->>'recovered')::integer,0),
  'candidateScopeRecovered',recovered,'repairVersion','runtime-source-candidate/1','modelCalls',0);
end;$$;
revoke all on function public.recover_currency_report_operating_technical_holds(bigint) from public,anon,authenticated;
grant execute on function public.recover_currency_report_operating_technical_holds(bigint) to service_role;

create or replace function public.inspect_currency_report_operating_technical_holds(p_revision bigint) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at,b.batch_key),'[]'::jsonb) from (
  select * from app_private.currency_report_operating_batches b where b.policy_revision=p_revision
   and b.state in ('completed','paused') and exists(select 1 from app_private.currency_report_operating_cases c
    where c.batch_key=b.batch_key and (app_private.runtime_technical_recovery_reason(c) is not null
     or app_private.source_candidate_scope_recovery_reason(c) is not null))
   order by b.created_at,b.batch_key limit 17
 ) b;
$$;
commit;
