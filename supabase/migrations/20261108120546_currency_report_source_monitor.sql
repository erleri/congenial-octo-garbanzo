-- Bounded working queue, not an evidence/permission registry. Six mutable
-- summaries; no bodies, tokens, automatic activation or publication rights.
create table app_private.currency_report_source_monitors (
 currency text primary key check(currency in ('BRL','MXN','COP','PEN','CLP','ARS')),
 checked_at timestamptz not null,
 binding text not null check(binding ~ '^[a-f0-9]{64}$'),
 state jsonb not null check(octet_length(state::text)<=64000)
);
alter table app_private.currency_report_source_monitors enable row level security;
revoke all on app_private.currency_report_source_monitors from public,anon,authenticated;
grant select,insert,update on app_private.currency_report_source_monitors to service_role;

create function public.load_currency_report_source_monitor(p_currency text) returns jsonb
language sql security invoker set search_path='' as $$
 select state from app_private.currency_report_source_monitors where currency=p_currency;
$$;
revoke all on function public.load_currency_report_source_monitor(text) from public,anon,authenticated;
grant execute on function public.load_currency_report_source_monitor(text) to service_role;

create function public.save_currency_report_source_monitor(p_state jsonb,p_previous_binding text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare c jsonb; s jsonb; changed integer; stamp timestamptz;
begin
 if jsonb_typeof(p_state) is distinct from 'object' or octet_length(p_state::text)>64000
  or p_state->>'version' is distinct from 'source-monitor/1'
  or coalesce(p_state->>'currency','') not in ('BRL','MXN','COP','PEN','CLP','ARS')
  or coalesce(p_state->>'binding','') !~ '^[a-f0-9]{64}$'
  or p_state->'writingEligible' is distinct from 'false'::jsonb or p_state->'publicationApproved' is distinct from 'false'::jsonb
  or coalesce(p_state->>'networkCalls','') !~ '^[0-2]$' or p_state->'modelCalls' is distinct from '0'::jsonb
  or exists(select 1 from jsonb_object_keys(p_state) k where k not in
   ('version','currency','checkedAt','candidates','sources','gaps','omittedCandidates','technicalChecks','networkCalls','modelCalls','attentionRequired','writingEligible','publicationApproved','binding'))
  or jsonb_typeof(p_state->'candidates') is distinct from 'array' or jsonb_typeof(p_state->'sources') is distinct from 'array'
  or jsonb_typeof(p_state->'gaps') is distinct from 'array' then
  raise exception 'safe source monitor required' using errcode='22023'; end if;
 if jsonb_array_length(p_state->'candidates')>32 or jsonb_array_length(p_state->'sources')>32
  or jsonb_array_length(p_state->'gaps')>5 or exists(select 1 from jsonb_array_elements_text(p_state->'gaps') g
   where g not in ('no_registered_capture','repeated_source_failure','identical_capture_only','shared_credited_origin_only','reviewed_explanation_gap'))
  or coalesce(p_state->>'omittedCandidates','') !~ '^[0-9]{1,6}$'
  or coalesce(p_state->>'technicalChecks','') !~ '^[0-2]$'
  or jsonb_typeof(p_state->'attentionRequired') is distinct from 'boolean' then
  raise exception 'bounded source monitor required' using errcode='22023'; end if;
 stamp:=(p_state->>'checkedAt')::timestamptz;
 if stamp is null or stamp>clock_timestamp()+interval '5 minutes' then
  raise exception 'valid source monitor clock required' using errcode='22023'; end if;
 for c in select * from jsonb_array_elements(p_state->'candidates') loop
  if jsonb_typeof(c) is distinct from 'object' or coalesce(c->>'domain','') !~ '^([a-z0-9-]+\.)+[a-z]{2,}$'
   or coalesce(c->>'domain','') ~ '\.(local|localhost|internal|test|invalid)$'
   or length(c->>'sampleUrl')>400 or length(c->>'discoveredFrom')>400
   or coalesce(c->>'sampleUrl','') !~ '^https://([a-z0-9-]+\.)+[a-z]{2,}/[^?#@[:space:]]*$'
   or regexp_replace(split_part(c->>'sampleUrl','/',3),'^www\.','') is distinct from c->>'domain'
   or coalesce(c->>'discoveredFrom','') !~ '^https://([a-z0-9-]+\.)+[a-z]{2,}/[^?#@[:space:]]*$'
   or (c->>'sampleUrl') ~* '(%40|sk-or-|bearer|token|api[_-]?key|password|secret)'
   or (c->>'discoveredFrom') ~* '(%40|sk-or-|bearer|token|api[_-]?key|password|secret)'
   or coalesce(c->>'discoveredSourceId','') !~ '^[a-zA-Z0-9_-]{1,100}$'
   or coalesce(c->>'status','') not in ('candidate_only','conditions_unconfirmed','temporary_failure','processing_excluded')
   or coalesce(c->>'access','') not in ('not_checked','public_capture','access_failed')
   or coalesce(c->>'extraction','') not in ('not_checked','dated_metadata_present','metadata_missing')
   or c->>'useScope' is distinct from 'unconfirmed'
   or coalesce(c->>'attempts','') !~ '^(0|[1-9][0-9]{0,2}|1000)$'
   or coalesce(c->>'firstSeenAt','') !~ '^\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?$'
   or coalesce(c->>'lastSeenAt','') !~ '^\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?$'
   or c->>'lastCheckedAt' is not null and c->>'lastCheckedAt' !~ '^\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?$'
   or c->>'nextCheckAt' is not null and c->>'nextCheckAt' !~ '^\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?$'
   or c->>'checkHash' is not null and c->>'checkHash' !~ '^[a-f0-9]{64}$'
   or exists(select 1 from jsonb_object_keys(c) k where k not in ('domain','sampleUrl','discoveredFrom','discoveredSourceId','firstSeenAt','lastSeenAt','status','access','extraction','useScope','lastCheckedAt','nextCheckAt','checkHash','attempts')) then
   raise exception 'safe source candidate required' using errcode='22023'; end if;
 end loop;
 for s in select * from jsonb_array_elements(p_state->'sources') loop
  if jsonb_typeof(s) is distinct from 'object' or coalesce(s->>'sourceId','') !~ '^[a-zA-Z0-9_-]{1,100}$'
   or coalesce(s->>'status','') not in ('collected_pending_review','lookup_failed','not_confirmed')
   or coalesce(s->>'failureDays','') !~ '^[0-9]{1,6}$'
   or jsonb_typeof(s->'repeatedFailure') is distinct from 'boolean'
   or s->>'lastFailureDay' is not null and s->>'lastFailureDay' !~ '^\d{4}-\d{2}-\d{2}$'
   or s->>'lastSuccessAt' is not null and s->>'lastSuccessAt' !~ '^\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?$'
   or exists(select 1 from jsonb_object_keys(s) k where k not in ('sourceId','failureDays','lastFailureDay','status','repeatedFailure','lastSuccessAt')) then
   raise exception 'safe registered source status required' using errcode='22023'; end if;
 end loop;
 if p_previous_binding is null then
  insert into app_private.currency_report_source_monitors(currency,checked_at,binding,state)
  values(p_state->>'currency',stamp,p_state->>'binding',p_state) on conflict do nothing;
 else
  update app_private.currency_report_source_monitors set checked_at=stamp,binding=p_state->>'binding',state=p_state
  where currency=p_state->>'currency' and binding=p_previous_binding and checked_at<=stamp;
 end if;
 get diagnostics changed=row_count;
 return changed=1;
end;
$$;
revoke all on function public.save_currency_report_source_monitor(jsonb,text) from public,anon,authenticated;
grant execute on function public.save_currency_report_source_monitor(jsonb,text) to service_role;

create function app_private.currency_report_source_monitor_summary() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if (select auth.uid()) is null or not (select app_private.is_business_plan_admin()) then
  raise exception 'active administrator required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'checkedAt',checked_at,
  'gaps',state->'gaps','attentionRequired',state->'attentionRequired','omittedCandidates',state->'omittedCandidates',
  'sources',state->'sources','candidates',state->'candidates') order by currency),'[]') into result
 from app_private.currency_report_source_monitors;
 return result;
end;
$$;
revoke all on function app_private.currency_report_source_monitor_summary() from public,anon,service_role;
grant execute on function app_private.currency_report_source_monitor_summary() to authenticated;
create function public.currency_report_source_monitor_summary() returns jsonb
language sql security invoker set search_path='' as $$select app_private.currency_report_source_monitor_summary();$$;
revoke all on function public.currency_report_source_monitor_summary() from public,anon,service_role;
grant execute on function public.currency_report_source_monitor_summary() to authenticated;
