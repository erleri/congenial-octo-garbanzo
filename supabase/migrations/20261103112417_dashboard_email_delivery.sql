-- Additive server-only mail ledger. Does not activate or send any email.
create table app_private.dashboard_email_assets (
 asset_hash text primary key check(asset_hash ~ '^[a-f0-9]{64}$'),
 content_base64 text not null check(octet_length(content_base64)<=2800000),
 created_at timestamptz not null default clock_timestamp()
);
create table app_private.dashboard_email_editions (
 edition_date date primary key,
 data_date date not null,
 cutoff_at timestamptz not null,
 frame_json text not null check(octet_length(frame_json)<=1000000),
 asset_hash text not null references app_private.dashboard_email_assets(asset_hash),
 workflow_runs text[] not null default '{}',
 created_at timestamptz not null default clock_timestamp()
);
create index dashboard_email_workflow_runs_idx on app_private.dashboard_email_editions using gin(workflow_runs);
create table app_private.dashboard_email_payloads (
 payload_hash text primary key check(payload_hash ~ '^[a-f0-9]{64}$'),
 payload_json text not null check(octet_length(payload_json)<=1000000),
 created_at timestamptz not null default clock_timestamp()
);
create table app_private.dashboard_email_payload_refs (
 payload_hash text not null references app_private.dashboard_email_payloads(payload_hash),
 announcement_key text not null,
 kind text not null check(kind in ('report','notice')),
 public_id text not null references public.currency_report_public_states(public_id),
 state_version bigint not null,
 primary key(payload_hash,announcement_key)
);
create index dashboard_email_ref_identity on app_private.dashboard_email_payload_refs(announcement_key,payload_hash);
create table app_private.dashboard_email_deliveries (
 delivery_key text primary key check(delivery_key ~ '^[a-f0-9]{64}$'),
 edition_date date not null references app_private.dashboard_email_editions(edition_date),
 recipient_key text not null check(recipient_key ~ '^[a-f0-9]{64}$'),
 owner_id uuid not null,
 lease_until timestamptz not null,
 state text not null default 'reserved' check(state in ('reserved','sending','accepted','rejected','failed_before_send','unknown','cancelled')),
 payload_hash text references app_private.dashboard_email_payloads(payload_hash),
 started_at timestamptz,
 finished_at timestamptz,
 smtp_code integer check(smtp_code between 100 and 599),
 outcome_reason text,
 created_at timestamptz not null default clock_timestamp(),
 unique(edition_date,recipient_key)
);
create index dashboard_email_recipient_state_idx on app_private.dashboard_email_deliveries(recipient_key,state,edition_date);
create table app_private.dashboard_email_recipient_state (
 recipient_key text primary key check(recipient_key ~ '^[a-f0-9]{64}$'),
 suppressed boolean not null,
 smtp_code integer,
 evidence text not null,
 updated_at timestamptz not null default clock_timestamp()
);
create table app_private.dashboard_email_events (
 id bigint generated always as identity primary key,
 delivery_key text references app_private.dashboard_email_deliveries(delivery_key),
 event text not null,
 detail jsonb not null default '{}',
 created_at timestamptz not null default clock_timestamp()
);
alter table app_private.dashboard_email_assets enable row level security;
alter table app_private.dashboard_email_editions enable row level security;
alter table app_private.dashboard_email_payloads enable row level security;
alter table app_private.dashboard_email_payload_refs enable row level security;
alter table app_private.dashboard_email_deliveries enable row level security;
alter table app_private.dashboard_email_recipient_state enable row level security;
alter table app_private.dashboard_email_events enable row level security;
revoke all on app_private.dashboard_email_assets,app_private.dashboard_email_editions,app_private.dashboard_email_payloads,
 app_private.dashboard_email_payload_refs,app_private.dashboard_email_deliveries,app_private.dashboard_email_recipient_state,
 app_private.dashboard_email_events from public,anon,authenticated,service_role;
grant select,insert on app_private.dashboard_email_assets,app_private.dashboard_email_editions,
 app_private.dashboard_email_payloads,app_private.dashboard_email_payload_refs,app_private.dashboard_email_events to service_role;
grant select,insert,update on app_private.dashboard_email_deliveries,app_private.dashboard_email_recipient_state to service_role;
grant update(workflow_runs) on app_private.dashboard_email_editions to service_role;
revoke all on sequence app_private.dashboard_email_events_id_seq from public,anon,authenticated,service_role;
grant usage on sequence app_private.dashboard_email_events_id_seq to service_role;

create function app_private.dashboard_email_introduced(p_recipient text,p_key text) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from app_private.dashboard_email_deliveries d
  join app_private.dashboard_email_payload_refs r on r.payload_hash=d.payload_hash
  where d.recipient_key=p_recipient and d.state in ('sending','accepted','unknown')
   and (r.announcement_key=p_key or r.kind='notice' and p_key='report:'||r.public_id));
$$;
revoke all on function app_private.dashboard_email_introduced(text,text) from public,anon,authenticated;
grant execute on function app_private.dashboard_email_introduced(text,text) to service_role;

create function app_private.dashboard_email_sources(p_recipient text,p_cutoff timestamptz,p_data_date date) returns jsonb
language sql stable security invoker set search_path='' as $$
 with eligible as (
  select p.*,s.public_id,s.state_version,s.revision_kind,s.report_kind,s.test_only,
   case when j.context ? 'serializedRuntimeContext' then (j.context->>'serializedRuntimeContext')::jsonb
    else j.context end as runtime_context
  from public.currency_reports p join public.currency_report_public_states s
   on s.public_id=p.report->>'id' and s.currency=p.currency and s.base_date=p.base_date
  join public.currency_report_runs run on run.id=p.run_id and run.status='published'
  left join app_private.currency_report_runtime_jobs j on j.run_id=p.run_id and j.stage='writer'
  where p.withdrawn_at is null and s.state='active' and not s.test_only
   and coalesce(p.report->>'testOnly','false')='false' and coalesce(p.report->>'historicalReview','false')='false'
   and coalesce(p.report->>'status','')='approved'
   and exists(select 1 from public.currency_report_reviews rv where rv.run_id=p.run_id and rv.decision='approved')
   and p.base_date<=p_data_date and p.published_at<=p_cutoff
 ), chosen as (
  select distinct on (e.currency) e.* from eligible e
  where e.revision_kind is distinct from 'editorial'
   and e.base_date=(select max(x.base_date) from eligible x where x.currency=e.currency)
   and not app_private.dashboard_email_introduced(p_recipient,'report:'||e.public_id)
  order by e.currency,(e.revision_kind='correction') desc nulls last,e.base_date desc,e.published_at desc
 ), reports as (
  select coalesce(jsonb_agg(jsonb_build_object('publicId',public_id,'currency',currency,'baseDate',base_date,
   'state','active','stateVersion',state_version,'publishedAt',published_at,'approved',true,
   'testOnly',false,'historicalReview',false,'revisionKind',revision_kind,'reportKind',report_kind,
   'purpose',report->>'purpose','title',report->'content'->>'title','summary',report->'content'->>'summary',
   'emailSummary',report->'content'->>'emailSummary',
   'cadence',case when runtime_context->'task'->>'currency'=currency then
    jsonb_build_object('currency',currency,'triggers',runtime_context->'task'->'cadence'->'triggers',
     'cumulativePct',runtime_context->'task'->'cadence'->'cumulativePct',
     'thresholdPct',runtime_context->'task'->'cadence'->'thresholdPct','direction',runtime_context->'task'->'cadence'->'direction') end
   ) order by currency),'[]'::jsonb) as value from chosen
 ), active_corrections as (
  -- An older correction must not displace today's new report for that currency.
  -- Notify only readers who were introduced to that report's currency/date.
  select e.public_id,e.currency,e.base_date,'active'::text as state,e.state_version,e.published_at,
   e.published_at as changed_at,'correction'::text as notice_kind,true as approved
  from eligible e where e.revision_kind='correction'
   and not exists(select 1 from chosen c where c.public_id=e.public_id)
   and not app_private.dashboard_email_introduced(p_recipient,'report:'||e.public_id)
   and exists(select 1 from app_private.dashboard_email_deliveries d
    join app_private.dashboard_email_payload_refs r on r.payload_hash=d.payload_hash
    join public.currency_report_public_states old on old.public_id=r.public_id
    where d.recipient_key=p_recipient and d.state in ('sending','accepted','unknown')
     and old.currency=e.currency and old.base_date=e.base_date)
 ), removed as (
  select s.* from public.currency_report_public_states s
   where s.state in ('withdrawn','superseded') and not s.test_only and s.base_date<=p_data_date
    and s.published_at<=p_cutoff and s.changed_at<=p_cutoff
    and app_private.dashboard_email_introduced(p_recipient,'report:'||s.public_id)
    and not app_private.dashboard_email_introduced(p_recipient,'notice:'||s.public_id||':'||s.state_version::text)
    and not exists(select 1 from eligible replacement where replacement.currency=s.currency and replacement.base_date=s.base_date
     and replacement.revision_kind in ('editorial','correction'))
    and not exists(select 1 from public.currency_report_public_states replacement
     where replacement.currency=s.currency and replacement.base_date=s.base_date and replacement.state='active'
      and app_private.dashboard_email_introduced(p_recipient,'report:'||replacement.public_id))
   order by s.changed_at desc,s.public_id limit 6
 ), notice_rows as (
  select public_id,currency,base_date,state,state_version,published_at,changed_at,notice_kind,approved from active_corrections
  union all
  select public_id,currency,base_date,state,state_version,published_at,changed_at,null::text as notice_kind,false as approved from removed
 ), limited_notices as (
  select * from notice_rows order by changed_at desc,public_id limit 6
 ), notices as (
  select coalesce(jsonb_agg(jsonb_build_object('publicId',public_id,'currency',currency,'baseDate',base_date,
   'state',state,'stateVersion',state_version,'publishedAt',published_at,'changedAt',changed_at,
   'testOnly',false,'historicalReview',false,'noticeKind',notice_kind,'approved',approved) order by changed_at desc),'[]'::jsonb) as value from limited_notices
 ) select jsonb_build_object('reports',reports.value,'notices',notices.value) from reports,notices;
$$;
revoke all on function app_private.dashboard_email_sources(text,timestamptz,date) from public,anon,authenticated;
grant execute on function app_private.dashboard_email_sources(text,timestamptz,date) to service_role;

create function public.dashboard_email_delivery(p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 f jsonb; p jsonb; ref jsonb; ed app_private.dashboard_email_editions;
 d app_private.dashboard_email_deliveries; other app_private.dashboard_email_deliveries;
 v_key text:=p_input->>'key'; recipient text:=p_input->>'recipientKey';
 v_owner uuid; edition date; v_hash text; asset text; frozen text; changed boolean;
 outcome text; code integer; reason text; evidence text; workflow_run text;
begin
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'email input required' using errcode='22023'; end if;
 if p_action='stage_edition' then
  frozen:=p_input->>'frameJson'; f:=frozen::jsonb;
  if f->>'version' is distinct from 'dashboard-email-frame/1' or f->>'channel' is distinct from 'latamfx-daily'
   or jsonb_typeof(f->'subject') is distinct from 'string' or (f->>'subject') ~ E'[\r\n]'
   or jsonb_typeof(f->'html') is distinct from 'string' or jsonb_typeof(f->'plainText') is distinct from 'string'
   or coalesce(f->>'datasetHash','') !~ '^[a-f0-9]{64}$'
   or length(f->>'html')-length(replace(f->>'html','<!--LATAM_FX_APPROVED_REPORT_DIGEST-->',''))<>length('<!--LATAM_FX_APPROVED_REPORT_DIGEST-->')
   or (f->>'cutoff')::timestamptz>clock_timestamp()+interval '5 minutes'
   or (f->>'editionDate')::date<>((f->>'cutoff')::timestamptz at time zone 'Asia/Seoul')::date
   or (f->>'dataDate')::date>(f->>'editionDate')::date then
   raise exception 'valid frozen email frame required' using errcode='22023';
  end if;
  edition:=(f->>'editionDate')::date;
  workflow_run:=f->>'workflowRunId';
  if workflow_run is not null then
   if workflow_run !~ '^[1-9][0-9]{0,30}$' then raise exception 'valid workflow run required' using errcode='22023'; end if;
   -- A rerun retains its original edition even after midnight in Korea.
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('email-workflow:'||workflow_run,0));
   select * into ed from app_private.dashboard_email_editions where workflow_runs @> array[workflow_run];
   if ed.edition_date is not null then
    return jsonb_build_object('frameJson',ed.frame_json,'chartBase64',
     (select content_base64 from app_private.dashboard_email_assets where asset_hash=ed.asset_hash));
   end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('email-edition:'||edition::text,0));
  select * into ed from app_private.dashboard_email_editions where edition_date=edition;
  if ed.edition_date is null then
   asset:=p_input->>'chartBase64';
   if asset is null or length(asset)=0 or octet_length(asset)>2800000 then raise exception 'email chart required' using errcode='22023'; end if;
   v_hash:=encode(sha256(decode(asset,'base64')),'hex');
   insert into app_private.dashboard_email_assets(asset_hash,content_base64) values(v_hash,asset) on conflict do nothing;
   insert into app_private.dashboard_email_editions(edition_date,data_date,cutoff_at,frame_json,asset_hash)
    values(edition,(f->>'dataDate')::date,(f->>'cutoff')::timestamptz,frozen,v_hash) returning * into ed;
  end if;
  if workflow_run is not null and not ed.workflow_runs @> array[workflow_run] then
   update app_private.dashboard_email_editions set workflow_runs=array_append(workflow_runs,workflow_run)
    where edition_date=edition;
  end if;
  return jsonb_build_object('frameJson',ed.frame_json,'chartBase64',
   (select content_base64 from app_private.dashboard_email_assets where asset_hash=ed.asset_hash));
 elsif p_action='preview' then
  if coalesce(recipient,'') !~ '^[a-f0-9]{64}$' or (p_input->>'cutoff')::timestamptz>clock_timestamp()+interval '5 minutes' then
   raise exception 'valid email preview required' using errcode='22023'; end if;
  return app_private.dashboard_email_sources(recipient,(p_input->>'cutoff')::timestamptz,(p_input->>'dataDate')::date);
 elsif p_action='claim' then
  if coalesce(recipient,'') !~ '^[a-f0-9]{64}$' then raise exception 'recipient key required' using errcode='22023'; end if;
  edition:=(p_input->>'editionDate')::date; v_owner:=(p_input->>'owner')::uuid;
  if v_owner is null or edition is null then raise exception 'email claim identity required' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('email-recipient:'||recipient,0));
  if exists(select 1 from app_private.dashboard_email_recipient_state where recipient_key=recipient and suppressed) then
   return jsonb_build_object('claimed',false,'state','suppressed'); end if;
  select * into ed from app_private.dashboard_email_editions where edition_date=edition;
  if ed.edition_date is null then raise exception 'staged edition required' using errcode='55000'; end if;
  -- A dispatch without an acknowledgement remains uncertain after a process loss.
  for other in select * from app_private.dashboard_email_deliveries
   where recipient_key=recipient and state in ('reserved','sending') and lease_until<=clock_timestamp() for update loop
   if other.state='sending' then
    update app_private.dashboard_email_deliveries set state='unknown',outcome_reason='transport_result_unknown' where delivery_key=other.delivery_key;
    insert into app_private.dashboard_email_events(delivery_key,event) values(other.delivery_key,'expired_dispatch_unknown');
   elsif other.edition_date<>edition then
    update app_private.dashboard_email_deliveries set state='cancelled',outcome_reason='expired_proven_unsent',finished_at=clock_timestamp() where delivery_key=other.delivery_key;
    insert into app_private.dashboard_email_events(delivery_key,event) values(other.delivery_key,'expired_unsent_cancelled');
   end if;
  end loop;
  v_key:=encode(sha256(convert_to('latamfx-daily:'||edition::text||':'||recipient,'UTF8')),'hex');
  select * into d from app_private.dashboard_email_deliveries where delivery_key=v_key for update;
  if d.delivery_key is not null and d.state<>'reserved' then return jsonb_build_object('claimed',false,'state',d.state,'key',v_key); end if;
  if exists(select 1 from app_private.dashboard_email_deliveries where recipient_key=recipient
    and state in ('reserved','sending') and lease_until>clock_timestamp() and (delivery_key<>v_key or owner_id<>v_owner)) then
   return jsonb_build_object('claimed',false,'state','busy'); end if;
  if d.delivery_key is null then
   insert into app_private.dashboard_email_deliveries(delivery_key,edition_date,recipient_key,owner_id,lease_until)
    values(v_key,edition,recipient,v_owner,clock_timestamp()+interval '5 minutes') returning * into d;
  else
   update app_private.dashboard_email_deliveries set owner_id=v_owner,lease_until=clock_timestamp()+interval '5 minutes'
    where delivery_key=v_key returning * into d;
  end if;
  insert into app_private.dashboard_email_events(delivery_key,event) values(v_key,'claimed');
  return jsonb_build_object('claimed',true,'state','reserved','key',v_key,'payloadHash',d.payload_hash,
   'payloadJson',(select payload_json from app_private.dashboard_email_payloads where payload_hash=d.payload_hash));
 elsif p_action='inspect' then
  select * into d from app_private.dashboard_email_deliveries where delivery_key=v_key;
  return jsonb_build_object('state',d.state,'payloadHash',d.payload_hash,'smtpCode',d.smtp_code,'reason',d.outcome_reason);
 elsif p_action='unsuppress' then
  evidence:=p_input->>'evidence';
  if coalesce(recipient,'') !~ '^[a-f0-9]{64}$' or evidence is null or length(trim(evidence))<8 or length(evidence)>500 then
   raise exception 'operator recipient resolution reference required' using errcode='22023'; end if;
  update app_private.dashboard_email_recipient_state set suppressed=false,evidence=p_input->>'evidence',updated_at=clock_timestamp() where recipient_key=recipient;
  insert into app_private.dashboard_email_events(event,detail) values('recipient_unsuppressed',jsonb_build_object('recipientKey',recipient,'evidence',evidence));
  return jsonb_build_object('state','unsuppressed');
 end if;
 if coalesce(v_key,'') !~ '^[a-f0-9]{64}$' then raise exception 'email delivery key required' using errcode='22023'; end if;
 select * into d from app_private.dashboard_email_deliveries where delivery_key=v_key for update;
 if d.delivery_key is null then raise exception 'email delivery not found' using errcode='P0002'; end if;
 select * into ed from app_private.dashboard_email_editions where edition_date=d.edition_date;
 v_owner:=(p_input->>'owner')::uuid;
 if p_action<>'reconcile' and (v_owner is null or v_owner<>d.owner_id) then raise exception 'email lease owner required' using errcode='55000'; end if;
 if p_action in ('candidates','freeze','begin') and (d.state<>'reserved' or d.lease_until<=clock_timestamp()) then
  raise exception 'live unsent email lease required' using errcode='55000'; end if;
 if p_action='candidates' then
  return app_private.dashboard_email_sources(d.recipient_key,ed.cutoff_at,ed.data_date);
 elsif p_action='freeze' then
  if d.payload_hash is not null and coalesce(p_input->>'replaceUnsent','false')<>'true' then
   return jsonb_build_object('payloadHash',d.payload_hash,'payloadJson',
    (select payload_json from app_private.dashboard_email_payloads where payload_hash=d.payload_hash)); end if;
  frozen:=p_input->>'payloadJson'; p:=frozen::jsonb;
  if p->>'version' is distinct from 'dashboard-email-payload/1' or p->>'subject' is distinct from ed.frame_json::jsonb->>'subject'
   or jsonb_typeof(p->'html') is distinct from 'string' or jsonb_typeof(p->'text') is distinct from 'string'
   or jsonb_typeof(p->'refs') is distinct from 'array' or jsonb_array_length(p->'refs')>12
   or p->>'lookupStatus' not in ('ready','unavailable','changed_before_send') then
   raise exception 'frozen public email payload required' using errcode='22023'; end if;
  v_hash:=encode(sha256(convert_to(frozen,'UTF8')),'hex');
  insert into app_private.dashboard_email_payloads(payload_hash,payload_json) values(v_hash,frozen) on conflict do nothing;
  for ref in select value from jsonb_array_elements(p->'refs') loop
   if ref->>'kind' not in ('report','notice') or ref->>'publicId' is null or (ref->>'stateVersion')::bigint<=0
    or ref->>'key' is distinct from (case when ref->>'kind'='report' then 'report:'||(ref->>'publicId')
     else 'notice:'||(ref->>'publicId')||':'||(ref->>'stateVersion') end) then
    raise exception 'email reference identity required' using errcode='22023'; end if;
   insert into app_private.dashboard_email_payload_refs(payload_hash,announcement_key,kind,public_id,state_version)
    values(v_hash,ref->>'key',ref->>'kind',ref->>'publicId',(ref->>'stateVersion')::bigint) on conflict do nothing;
  end loop;
  update app_private.dashboard_email_deliveries set payload_hash=v_hash where delivery_key=v_key;
  insert into app_private.dashboard_email_events(delivery_key,event,detail) values(v_key,'payload_frozen',jsonb_build_object('payloadHash',v_hash));
  return jsonb_build_object('payloadHash',v_hash,'payloadJson',frozen);
 elsif p_action='begin' then
  if d.payload_hash is null or d.payload_hash is distinct from p_input->>'payloadHash' then
   raise exception 'frozen email payload binding required' using errcode='55000'; end if;
  select exists(select 1 from app_private.dashboard_email_payload_refs r
   left join public.currency_report_public_states s on s.public_id=r.public_id
   where r.payload_hash=d.payload_hash and (s.public_id is null or s.state_version<>r.state_version
    or s.test_only or (r.kind='report' and (s.state<>'active' or not exists(
      select 1 from public.currency_reports p join public.currency_report_runs run on run.id=p.run_id and run.status='published'
       where p.report->>'id'=s.public_id and p.withdrawn_at is null and p.published_at<=ed.cutoff_at
        and coalesce(p.report->>'testOnly','false')='false' and coalesce(p.report->>'historicalReview','false')='false'
        and exists(select 1 from public.currency_report_reviews rv where rv.run_id=p.run_id and rv.decision='approved'))))
    or (r.kind='notice' and s.state not in ('withdrawn','superseded') and not coalesce(
      (s.state='active' and s.revision_kind='correction' and exists(
       select 1 from public.currency_reports current_report join public.currency_report_runs run
        on run.id=current_report.run_id and run.status='published'
       where current_report.report->>'id'=s.public_id and current_report.withdrawn_at is null
        and current_report.published_at<=ed.cutoff_at and not s.test_only
        and coalesce(current_report.report->>'testOnly','false')='false'
        and coalesce(current_report.report->>'historicalReview','false')='false'
        and exists(select 1 from public.currency_report_reviews rv where rv.run_id=current_report.run_id and rv.decision='approved'))),false)))) into changed;
  if changed then
   insert into app_private.dashboard_email_events(delivery_key,event) values(v_key,'public_state_changed_before_dispatch');
   return jsonb_build_object('started',false,'reason','public_state_changed'); end if;
  update app_private.dashboard_email_deliveries set state='sending',started_at=clock_timestamp() where delivery_key=v_key;
  insert into app_private.dashboard_email_events(delivery_key,event) values(v_key,'dispatch_started');
  return jsonb_build_object('started',true);
 elsif p_action in ('finish','reconcile') then
  outcome:=p_input->>'status'; code:=(p_input->>'code')::integer; reason:=p_input->>'reason';
  if outcome is null or outcome not in ('accepted','rejected','failed_before_send','unknown')
   or reason is null or reason not in ('smtp_accepted','recipient_rejected','message_rejected','pre_data_failure','transport_result_unknown')
   or (outcome='accepted' and (reason<>'smtp_accepted' or code is distinct from 250))
   or (outcome='rejected' and (reason not in ('recipient_rejected','message_rejected') or code is null or code<400))
   or (outcome='failed_before_send' and reason<>'pre_data_failure')
   or (outcome='unknown' and (reason<>'transport_result_unknown' or code is not null)) then
   raise exception 'explicit SMTP outcome required' using errcode='22023'; end if;
  if p_action='reconcile' then
   evidence:=p_input->>'evidence';
   if d.state not in ('sending','unknown') or evidence is null or length(trim(evidence))<8 or length(evidence)>500 then
    raise exception 'unknown email outcome and operator evidence required' using errcode='55000'; end if;
  elsif d.payload_hash is distinct from p_input->>'payloadHash' then raise exception 'email outcome binding required' using errcode='55000';
  elsif d.state not in ('sending','unknown') then
   if d.state=outcome and d.smtp_code is not distinct from code and d.outcome_reason=reason then return jsonb_build_object('state',d.state); end if;
   raise exception 'email outcome already settled' using errcode='55000';
  end if;
  update app_private.dashboard_email_deliveries set state=outcome,smtp_code=code,outcome_reason=reason,finished_at=clock_timestamp() where delivery_key=v_key;
  insert into app_private.dashboard_email_events(delivery_key,event,detail) values(v_key,
   case when p_action='reconcile' then 'outcome_reconciled' else 'outcome_recorded' end,
   jsonb_build_object('state',outcome,'code',code,'reason',reason,'evidence',evidence));
  if outcome='rejected' and reason='recipient_rejected' and code between 500 and 599 then
   insert into app_private.dashboard_email_recipient_state(recipient_key,suppressed,smtp_code,evidence)
    values(d.recipient_key,true,code,v_key) on conflict(recipient_key) do update
     set suppressed=true,smtp_code=excluded.smtp_code,evidence=excluded.evidence,updated_at=clock_timestamp();
  end if;
  return jsonb_build_object('state',outcome);
 end if;
 raise exception 'unsupported email ledger action' using errcode='22023';
end;
$$;
revoke all on function public.dashboard_email_delivery(text,jsonb) from public,anon,authenticated;
grant execute on function public.dashboard_email_delivery(text,jsonb) to service_role;
notify pgrst,'reload schema';
