-- Private review inbox and one administrator digest per KST day. Additive and
-- disabled at the runner by default. No grants to publish, decide or call AI.
create function app_private.currency_report_review_items()
returns table(kind text,id text,version text,currency text,base_date date,title text,summary text,reason text,created_at timestamptz,target_id text)
language sql stable security invoker set search_path='' as $$
 with policy_terms as (
  select p.*,t.status as terms_status,t.hash as terms_hash,t.checked_at as terms_checked_at,t.url as checked_url
  from app_private.currency_report_source_policies p
  left join lateral(select * from app_private.currency_report_source_terms t where t.policy_id=p.id order by checked_at desc limit 1)t on true
 ), findings as (
  select 'report'::text kind,r.id::text id,r.currency,r.base_date,
   left(r.candidate->'content'->>'title',160) title,left(r.candidate->'content'->>'summary',400) summary,
   '새 리포트의 근거·검사 결과를 확인하고 승인 또는 반려해 주세요.'::text reason,
   r.created_at,jsonb_build_array(r.status,r.candidate,r.validation,r.storage_required)::text identity
  from public.currency_report_runs r where r.status='pending_review'
   and coalesce(r.candidate->>'testOnly','false')='false'
   and coalesce(r.candidate->>'historicalReview','false')='false'
  union all
  select 'correction',c.candidate_key,c.currency,(c.record->>'baseDate')::date,
   '공개 리포트 재검토',left(c.record->>'quote',400),left(c.record->>'reason',400),c.created_at,
   jsonb_build_array(c.revision,c.status,c.record,p.run_id)::text
  from app_private.currency_report_correction_candidates c join public.currency_reports p
   on p.currency=c.currency and p.report->>'id'=c.public_id and p.withdrawn_at is null
  where c.status='pending_review' and coalesce(c.record->>'testOnly','false')='false'
  union all
  select 'policy',p.id::text,p.currency,null::date,'매체 이용 범위 검토',left(p.publisher||' · '||p.host||p.path_prefix,400),
   case when p.action='prepare' then '확보한 이용 조건을 검토하고 적용 범위를 결정해 주세요.'
    when p.expires_at<=now() then '매체 기준의 재검토 기한이 지났습니다.' else '이용 조건이 승인 당시와 달라졌습니다.' end,
   p.decided_at,jsonb_build_array(p.revision,p.action,p.terms_url,p.approved_terms_hash,p.terms_hash,
    p.expires_at<=now())::text
  from policy_terms p where p.action in ('prepare','apply') and p.terms_status='available'
   and p.checked_url=p.terms_url and p.terms_checked_at between now()-interval '24 hours' and now()
   and (p.action='prepare' or p.expires_at<=now() or p.approved_terms_hash is distinct from p.terms_hash)
  union all
  select 'source',h.binding,h.currency,null::date,'기사 이용 범위 검토',left(coalesce(p.proof->>'publisher',p.proof->>'host'),400),
   '기존 공통 기준으로 처리되지 않은 기사의 이용 범위를 확인해 주세요.',p.created_at,
   jsonb_build_array(h.url,coalesce(p.proof->>'articleBinding',p.proof->>'captureHash'),p.proof->>'reason')::text
  from app_private.currency_report_source_heads h join app_private.currency_report_source_proofs p on p.binding=h.binding
  left join lateral(select * from app_private.currency_report_source_decisions d where d.currency=h.currency and d.url=h.url order by revision desc limit 1)d on true
  where p.proof->>'status'='hold' and p.proof->>'reason' in ('use_scope_unconfirmed','conflicting_or_third_party_rights','free_access_declaration_missing')
   and (p.proof->>'expiresAt')::timestamptz>now()
   and not exists(select 1 from policy_terms s where s.currency=h.currency and s.host=p.proof->>'host'
    and starts_with(substring(h.url from length('https://'||(p.proof->>'host'))+1),s.path_prefix)
    and s.publisher=p.proof->>'publisher' and p.proof->'articleChecks'->>'ownArticle'='true'
    and p.proof->'articleChecks'->>'freeAccess'='true' and p.proof->'articleChecks'->>'bodyVerified'='true')
   and (d.id is null or d.action='apply' and d.proof_binding<>p.binding
    and coalesce((select coalesce(proof->>'articleBinding',proof->>'captureHash') from app_private.currency_report_source_proofs where binding=d.proof_binding),'')<>coalesce(p.proof->>'articleBinding',p.proof->>'captureHash',''))
  union all
  select 'incident',j.id::text,j.currency,j.base_date,'생성 비용 확인 필요','이전 호출의 비용 또는 예약 한도를 확인해야 합니다.',
   '비용 기록을 확인하기 전까지 새 유료 처리를 보류합니다.',j.created_at,
   jsonb_build_array(j.cost_state,j.reserved_nano,j.actual_nano)::text
  from app_private.currency_report_runtime_jobs j where
   (j.cost_state='unknown' and not app_private.runtime_cost_escrowed(j.id)) or j.actual_nano>j.reserved_nano
 )
 select f.kind,stable.id,encode(sha256(convert_to(f.kind||':'||stable.id||':'||f.identity,'UTF8')),'hex'),f.currency,f.base_date,
  coalesce(f.title,'검토 요청'),coalesce(f.summary,''),f.reason,f.created_at,f.id from findings f
 cross join lateral(select case when f.kind='source' then encode(sha256(convert_to(f.currency||':'||(f.identity::jsonb->>0),'UTF8')),'hex') else f.id end id)stable;
$$;
revoke all on function app_private.currency_report_review_items() from public,anon,authenticated;
grant execute on function app_private.currency_report_review_items() to service_role;

-- The browser gets only the current review metadata. Existing per-kind RPCs
-- still enforce active membership, current source versions and publish checks.
create function app_private.currency_report_review_inbox(p_kind text,p_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare items jsonb; target jsonb; total bigint; latest_mail jsonb;
begin
 if (select auth.uid()) is null or not (select app_private.is_business_plan_admin()) then
  raise exception 'active administrator required' using errcode='42501';end if;
 select count(*) into total from app_private.currency_report_review_items();
 select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at,i.kind,i.id),'[]') into items
 from(select * from app_private.currency_report_review_items() order by created_at,kind,id limit 100)i;
 select to_jsonb(i) into target from app_private.currency_report_review_items() i where i.kind=p_kind and i.id=p_id;
 -- This table is created below before any caller can invoke the function.
 select jsonb_build_object('state',state,'createdAt',created_at,'count',jsonb_array_length(refs)) into latest_mail
 from app_private.admin_review_email_deliveries where recipient=lower(auth.jwt()->>'email') order by created_at desc limit 1;
 return jsonb_build_object('items',items,'target',target,'total',total,'latestMail',latest_mail);
end;$$;
create function public.currency_report_review_inbox(p_kind text default null,p_id text default null) returns jsonb
language sql security invoker set search_path='' as $$select app_private.currency_report_review_inbox(p_kind,p_id);$$;
revoke all on function app_private.currency_report_review_inbox(text,text),public.currency_report_review_inbox(text,text) from public,anon,service_role;
grant execute on function app_private.currency_report_review_inbox(text,text),public.currency_report_review_inbox(text,text) to authenticated;

create function app_private.currency_report_review_target(p_kind text,p_id text,p_version text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item record; run jsonb; correction jsonb;
begin
 if (select auth.uid()) is null or not (select app_private.is_business_plan_admin()) then
  raise exception 'active administrator required' using errcode='42501';end if;
 select * into item from app_private.currency_report_review_items() i where i.kind=p_kind and i.id=p_id;
 if not found then return jsonb_build_object('state','resolved_or_unavailable');end if;
 if item.version is distinct from p_version then return jsonb_build_object('state','changed','item',to_jsonb(item));end if;
 if p_kind='report' then
  select jsonb_build_object('id',r.id,'status',r.status,'candidate',r.candidate,'validation',r.validation,'attempt',r.attempt,
   'created_at',r.created_at,'cost',r.cost,'storage_required',r.storage_required) into run
  from public.currency_report_runs r where r.id::text=item.target_id;
 elsif p_kind='correction' then
  select jsonb_build_object('key',c.candidate_key,'revision',c.revision,'record',c.record,'status',c.status,'createdAt',c.created_at) into correction
  from app_private.currency_report_correction_candidates c where c.candidate_key=item.target_id;
 end if;
 return jsonb_build_object('state','current','item',to_jsonb(item),'run',run,'correction',correction);
end;$$;
create function public.currency_report_review_target(p_kind text,p_id text,p_version text) returns jsonb
language sql security invoker set search_path='' as $$select app_private.currency_report_review_target(p_kind,p_id,p_version);$$;
revoke all on function app_private.currency_report_review_target(text,text,text),public.currency_report_review_target(text,text,text) from public,anon,service_role;
grant execute on function app_private.currency_report_review_target(text,text,text),public.currency_report_review_target(text,text,text) to authenticated;

create function app_private.review_currency_report_request(p_run_id uuid,p_version text,p_decision text,p_reason text,
 p_expected_public_id text,p_revision_kind text,p_report_kind text) returns text
language plpgsql security definer set search_path='' as $$
declare r public.currency_report_runs; current_version text;
begin
 if (select auth.uid()) is null or not (select app_private.is_business_plan_admin()) then
  raise exception 'active administrator required' using errcode='42501';end if;
 select * into r from public.currency_report_runs where id=p_run_id;
 perform pg_advisory_xact_lock(hashtextextended(r.currency||':'||r.base_date::text,0));
 perform 1 from public.currency_report_runs where id=p_run_id for update;
 select version into current_version from app_private.currency_report_review_items() i where i.kind='report' and i.id=p_run_id::text;
 if current_version is null or current_version is distinct from p_version then
  raise exception 'review request target changed; reopen current version' using errcode='55000';end if;
 return app_private.review_currency_report_version(p_run_id,p_decision,p_reason,p_expected_public_id,p_revision_kind,p_report_kind);
end;$$;
create function public.review_currency_report_request(p_run_id uuid,p_version text,p_decision text,p_reason text default null,
 p_expected_public_id text default null,p_revision_kind text default null,p_report_kind text default null) returns text
language sql security invoker set search_path='' as $$select app_private.review_currency_report_request(p_run_id,p_version,p_decision,p_reason,p_expected_public_id,p_revision_kind,p_report_kind);$$;
revoke all on function app_private.review_currency_report_request(uuid,text,text,text,text,text,text),public.review_currency_report_request(uuid,text,text,text,text,text,text) from public,anon,service_role;
grant execute on function app_private.review_currency_report_request(uuid,text,text,text,text,text,text),public.review_currency_report_request(uuid,text,text,text,text,text,text) to authenticated;

create table app_private.admin_review_email_deliveries (
 delivery_key text primary key check(delivery_key~'^[a-f0-9]{64}$'),
 edition_date date not null, recipient text not null,owner_id uuid not null,
 state text not null check(state in ('reserved','sending','accepted','rejected','failed_before_send','unknown','cancelled')),
 refs jsonb not null check(jsonb_typeof(refs)='array' and jsonb_array_length(refs) between 1 and 20),
 payload_json text, payload_hash text, created_at timestamptz not null default now(),lease_until timestamptz not null default now()+interval '10 minutes',
 started_at timestamptz,finished_at timestamptz,outcome jsonb,
 unique(edition_date,recipient)
);
create index admin_review_email_recipient_idx on app_private.admin_review_email_deliveries(recipient,created_at desc);
alter table app_private.admin_review_email_deliveries enable row level security;
revoke all on app_private.admin_review_email_deliveries from public,anon,authenticated,service_role;
grant select,insert,update on app_private.admin_review_email_deliveries to service_role;

create function public.admin_review_email(p_action text,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_recipient text; edition date; owner uuid; selected jsonb; refs jsonb; key text;
 d app_private.admin_review_email_deliveries; payload jsonb; hash text; result jsonb;
begin
 if p_action is null or p_action not in ('preview','claim','freeze','begin','finish') or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>400000 then
  raise exception 'bounded notification action required' using errcode='22023';end if;
 if p_action in ('preview','claim') then
  v_recipient:=lower(trim(p_input->>'recipient'));edition:=(now() at time zone 'Asia/Seoul')::date;
  if v_recipient is null or length(v_recipient)>254 or v_recipient!~'^[^@[:space:]<>;,]+@[^@[:space:]<>;,]+\.[^@[:space:]<>;,]+$' then
   raise exception 'administrator recipient required' using errcode='22023';end if;
  if not exists(select 1 from public.business_plan_admins a where lower(a.email)=v_recipient and a.active) then
   return jsonb_build_object('status','recipient_not_active_admin','items','[]'::jsonb);end if;
  if exists(select 1 from app_private.admin_review_email_deliveries old where old.recipient=v_recipient
   and old.state='rejected' and old.outcome->>'reason'='recipient_rejected' and (old.outcome->>'code')::integer>=500) then
   return jsonb_build_object('status','recipient_suppressed','items','[]'::jsonb);end if;
  if p_action='claim' then
   owner:=(p_input->>'owner')::uuid;
   if owner is null then raise exception 'notification owner required' using errcode='22023';end if;
   perform pg_advisory_xact_lock(hashtextextended('admin-review-email:'||v_recipient,0));
   select * into d from app_private.admin_review_email_deliveries where admin_review_email_deliveries.recipient=v_recipient
    and (edition_date=edition or state='reserved' and lease_until<=now()) order by (edition_date=edition) desc,created_at limit 1 for update;
   if found then
    if d.state='reserved' and d.started_at is null and d.lease_until<=now() then
     update app_private.admin_review_email_deliveries set owner_id=owner,lease_until=now()+interval '10 minutes' where delivery_key=d.delivery_key;
     select jsonb_agg(to_jsonb(i) order by i.created_at,i.kind,i.id) into selected from app_private.currency_report_review_items() i
      where exists(select 1 from jsonb_array_elements(d.refs)r where i.kind=r->>'kind' and i.id=r->>'id' and i.version=r->>'version');
     if coalesce(jsonb_array_length(selected),0)<>jsonb_array_length(d.refs) then
      update app_private.admin_review_email_deliveries set state='cancelled',finished_at=now() where delivery_key=d.delivery_key;
      return jsonb_build_object('status','target_or_access_changed');end if;
     return jsonb_build_object('status','claimed','key',d.delivery_key,'items',selected,'payloadJson',d.payload_json,'payloadHash',d.payload_hash);
    end if;
    return jsonb_build_object('status','already_recorded','state',d.state);
   end if;
  end if;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at,i.kind,i.id),'[]') into selected
  from(select * from app_private.currency_report_review_items() i where not exists(
   select 1 from app_private.admin_review_email_deliveries old cross join lateral jsonb_array_elements(old.refs) r
   where old.recipient=v_recipient and old.state<>'cancelled' and r->>'kind'=i.kind and r->>'id'=i.id and r->>'version'=i.version)
   order by created_at,kind,id limit 20)i;
  if p_action='preview' then return jsonb_build_object('status','plan_only','items',selected);end if;
  if jsonb_array_length(selected)=0 then return jsonb_build_object('status','no_new_items');end if;
  select jsonb_agg(jsonb_build_object('kind',v->>'kind','id',v->>'id','version',v->>'version')) into refs from jsonb_array_elements(selected)v;
  key:=encode(sha256(convert_to('latamfx-admin-review/1:'||edition||':'||v_recipient,'UTF8')),'hex');
  insert into app_private.admin_review_email_deliveries(delivery_key,edition_date,recipient,owner_id,state,refs)
  values(key,edition,v_recipient,owner,'reserved',refs);
  return jsonb_build_object('status','claimed','key',key,'items',selected);
 end if;
 owner:=(p_input->>'owner')::uuid;
 select * into d from app_private.admin_review_email_deliveries where delivery_key=p_input->>'key' for update;
 if d.delivery_key is null or owner is distinct from d.owner_id then raise exception 'notification ownership required' using errcode='55000';end if;
 if p_action='freeze' then
  if d.state<>'reserved' or d.payload_json is not null then raise exception 'notification already frozen' using errcode='55000';end if;
  payload:=(p_input->>'payloadJson')::jsonb;
  if payload->>'version' is distinct from 'admin-review-email/1' or payload->'refs' is distinct from d.refs
   or coalesce(length(payload->>'subject'),0) not between 1 and 120 or payload->>'subject'~E'[\r\n]'
   or coalesce(length(payload->>'text'),0) not between 1 and 30000 or coalesce(length(payload->>'html'),0) not between 1 and 60000
   or (payload-array['version','subject','text','html','refs'])<>'{}'::jsonb then
   raise exception 'bounded review email payload required' using errcode='22023';end if;
  hash:=encode(sha256(convert_to(p_input->>'payloadJson','UTF8')),'hex');
  update app_private.admin_review_email_deliveries set payload_json=p_input->>'payloadJson',payload_hash=hash where delivery_key=d.delivery_key;
  return jsonb_build_object('payloadHash',hash);
 end if;
 if p_action='begin' then
  if d.state<>'reserved' or d.payload_json is null or d.payload_hash is distinct from p_input->>'payloadHash'
   or d.lease_until<=now() then return jsonb_build_object('started',false,'reason','not_dispatchable');end if;
  if not exists(select 1 from public.business_plan_admins a where lower(a.email)=d.recipient and a.active)
   or exists(select 1 from jsonb_array_elements(d.refs) r where not exists(
    select 1 from app_private.currency_report_review_items() i where i.kind=r->>'kind' and i.id=r->>'id' and i.version=r->>'version')) then
   update app_private.admin_review_email_deliveries set state='cancelled',finished_at=now() where delivery_key=d.delivery_key;
   return jsonb_build_object('started',false,'reason','target_or_access_changed');end if;
  update app_private.admin_review_email_deliveries set state='sending',started_at=now() where delivery_key=d.delivery_key;
  return jsonb_build_object('started',true,'payloadJson',d.payload_json);
 end if;
 result:=p_input->'outcome';
 if d.state<>'sending' or d.payload_hash is distinct from p_input->>'payloadHash' or jsonb_typeof(result) is distinct from 'object' or coalesce(result->>'status','') not in ('accepted','rejected','failed_before_send','unknown')
  or (result-array['status','code','reason'])<>'{}'::jsonb then raise exception 'notification result required' using errcode='55000';end if;
 update app_private.admin_review_email_deliveries set state=result->>'status',finished_at=now(),outcome=result where delivery_key=d.delivery_key;
 return jsonb_build_object('recorded',true);
end;$$;
revoke all on function public.admin_review_email(text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_review_email(text,jsonb) to service_role;
notify pgrst,'reload schema';
