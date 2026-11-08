-- Private operational configuration. No publisher licence or report approval.
create table app_private.currency_report_source_proofs (
 binding text primary key check(binding ~ '^[a-f0-9]{64}$'),
 currency text not null check(currency in ('BRL','MXN','COP','PEN','CLP','ARS')),
 url text not null, checked_at timestamptz not null, proof jsonb not null,
 created_at timestamptz not null default now()
);
create table app_private.currency_report_source_heads (
 currency text not null, url text not null, binding text not null references app_private.currency_report_source_proofs(binding),
 primary key(currency,url)
);
create table app_private.currency_report_source_decisions (
 id bigint generated always as identity primary key,
 currency text not null, url text not null, revision integer not null check(revision>0),
 proof_binding text not null references app_private.currency_report_source_proofs(binding),
 action text not null check(action in ('apply','hold','exclude')), scopes jsonb not null, basis jsonb,
 actor uuid not null, decided_at timestamptz not null default now(),
 unique(currency,url,revision)
);
alter table app_private.currency_report_source_proofs enable row level security;
alter table app_private.currency_report_source_heads enable row level security;
alter table app_private.currency_report_source_decisions enable row level security;
revoke all on app_private.currency_report_source_proofs,app_private.currency_report_source_heads,app_private.currency_report_source_decisions from public,anon,authenticated,service_role;
grant select,insert on app_private.currency_report_source_proofs to service_role;
grant select,insert,update,delete on app_private.currency_report_source_heads to service_role;
grant select on app_private.currency_report_source_decisions to service_role;

create function public.save_currency_report_source_proof(p_proof jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare stamp timestamptz; current_stamp timestamptz;
begin
 if jsonb_typeof(p_proof) is distinct from 'object' or octet_length(p_proof::text)>5000
  or p_proof->>'version' is distinct from 'source-admission/1'
  or coalesce(p_proof->>'currency','') not in ('BRL','MXN','COP','PEN','CLP','ARS')
  or coalesce(p_proof->>'binding','') !~ '^[a-f0-9]{64}$' or coalesce(p_proof->>'captureHash','') !~ '^[a-f0-9]{64}$'
  or coalesce(p_proof->>'policyBinding','') !~ '^[a-f0-9]{64}$'
  or length(p_proof->>'url')>400 or coalesce(p_proof->>'url','') !~ '^https://([a-z0-9-]+\.)+[a-z]{2,}/[^?#@[:space:]]*$'
  or (p_proof->>'url') ~* '(\.(local|localhost|internal|test|invalid)/|%40|sk-or-|bearer|token|api[_-]?key|password|secret)'
  or p_proof->>'host' is distinct from split_part(p_proof->>'url','/',3)
  or p_proof->>'evidenceUrl' is distinct from p_proof->>'url'
  or coalesce(p_proof->>'status','') not in ('eligible','hold','exclude')
  or coalesce(p_proof->>'reason','') !~ '^[a-z_]{1,80}$'
  or p_proof->'rawPublicDisplay' is distinct from 'false'::jsonb
  or p_proof->'publicationApproved' is distinct from 'false'::jsonb
  or p_proof->'licenseGranted' is distinct from 'false'::jsonb
  or jsonb_typeof(p_proof->'scopes') is distinct from 'object'
  or (select count(*) from jsonb_object_keys(p_proof->'scopes'))<>4
  or exists(select 1 from unnest(array['discover','collect','analyze','publishNotes']) k where jsonb_typeof(p_proof->'scopes'->k) is distinct from 'boolean')
  or exists(select 1 from jsonb_object_keys(p_proof) k where k not in ('version','currency','url','host','capturedAt','checkedAt','captureHash','policyBinding','scopes','profile','evidenceUrl','licenseUrl','publisher','publicationAt','expiresAt','rawPublicDisplay','publicationApproved','licenseGranted','status','reason','binding','articleChecks','articleBinding','credit'))
 then raise exception 'safe source proof required' using errcode='22023'; end if;
 stamp=(p_proof->>'checkedAt')::timestamptz;
 if stamp is null or stamp>now()+interval '5 minutes' or p_proof->>'capturedAt' is null or p_proof->>'expiresAt' is null or (p_proof->>'capturedAt')::timestamptz>stamp
  or (p_proof->>'expiresAt')::timestamptz is distinct from (p_proof->>'capturedAt')::timestamptz+interval '7 days'
  or p_proof->>'status'='eligible' and (
    coalesce(p_proof->>'profile','') not in ('article_cc_by_4','article_cc0_1')
    or p_proof->>'licenseUrl' is distinct from case p_proof->>'profile' when 'article_cc_by_4' then 'https://creativecommons.org/licenses/by/4.0/' else 'https://creativecommons.org/publicdomain/zero/1.0/' end
    or p_proof->'scopes' <> '{"discover":true,"collect":true,"analyze":true,"publishNotes":true}'::jsonb)
 then raise exception 'source proof conditions invalid' using errcode='22023'; end if;
 -- Serializes capacity and head updates, including simultaneous first inserts.
 perform pg_advisory_xact_lock(hashtextextended('source-admission:'||(p_proof->>'currency'),0));
 -- Expired working-set pointers may leave the queue; immutable proofs and all
 -- decisions remain available for audit. Capacity cannot fill forever with old URLs.
 delete from app_private.currency_report_source_heads h using app_private.currency_report_source_proofs p
 where h.binding=p.binding and h.currency=p_proof->>'currency' and (p.proof->>'expiresAt')::timestamptz<=now();
 select p.checked_at into current_stamp from app_private.currency_report_source_heads h
 join app_private.currency_report_source_proofs p on p.binding=h.binding
 where h.currency=p_proof->>'currency' and h.url=p_proof->>'url';
 if current_stamp>stamp then return false; end if;
 if current_stamp is null and (select count(*) from app_private.currency_report_source_heads where currency=p_proof->>'currency')>=32 then return false; end if;
 insert into app_private.currency_report_source_proofs(binding,currency,url,checked_at,proof)
 values(p_proof->>'binding',p_proof->>'currency',p_proof->>'url',stamp,p_proof) on conflict do nothing;
 if not exists(select 1 from app_private.currency_report_source_proofs where binding=p_proof->>'binding' and proof=p_proof) then
 raise exception 'source proof binding conflict' using errcode='22023'; end if;
 insert into app_private.currency_report_source_heads(currency,url,binding) values(p_proof->>'currency',p_proof->>'url',p_proof->>'binding')
 on conflict(currency,url) do update set binding=excluded.binding;
 return true;
end; $$;
revoke all on function public.save_currency_report_source_proof(jsonb) from public,anon,authenticated;
grant execute on function public.save_currency_report_source_proof(jsonb) to service_role;

create function public.load_currency_report_source_admissions() returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('proofs',coalesce((select jsonb_agg(p.proof order by p.currency,p.url)
 from app_private.currency_report_source_heads h join app_private.currency_report_source_proofs p on h.binding=p.binding),'[]'::jsonb),
 'decisions',coalesce((select jsonb_agg(jsonb_build_object('currency',d.currency,'url',d.url,'revision',d.revision,
 'proofBinding',d.proof_binding,'captureHash',p.proof->>'captureHash','articleBinding',p.proof->>'articleBinding','action',d.action,'scopes',d.scopes,'basis',d.basis,'decidedAt',d.decided_at))
 from (select distinct on(d.currency,d.url) d.* from app_private.currency_report_source_decisions d
 join app_private.currency_report_source_heads h on h.currency=d.currency and h.url=d.url order by d.currency,d.url,d.revision desc) d
 join app_private.currency_report_source_proofs p on p.binding=d.proof_binding),'[]'::jsonb));
$$;
revoke all on function public.load_currency_report_source_admissions() from public,anon,authenticated;
grant execute on function public.load_currency_report_source_admissions() to service_role;

create function app_private.currency_report_source_admission_summary() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or not (select app_private.is_business_plan_admin()) then
 raise exception 'active administrator required' using errcode='42501'; end if;
 return public.load_currency_report_source_admissions();
end; $$;
revoke all on function app_private.currency_report_source_admission_summary() from public,anon,service_role;
grant execute on function app_private.currency_report_source_admission_summary() to authenticated;
create function public.currency_report_source_admission_summary() returns jsonb
language sql security invoker set search_path='' as $$ select app_private.currency_report_source_admission_summary(); $$;
revoke all on function public.currency_report_source_admission_summary() from public,anon,service_role;
grant execute on function public.currency_report_source_admission_summary() to authenticated;

create function app_private.decide_currency_report_source(p_binding text,p_revision integer,p_action text,p_scopes jsonb,p_evidence_url text,p_reason text) returns integer
language plpgsql security definer set search_path='' as $$
declare p jsonb; last_revision integer; basis jsonb;
begin
 if (select auth.uid()) is null or not (select app_private.is_business_plan_admin()) then
 raise exception 'active administrator required' using errcode='42501'; end if;
 select proof into p from app_private.currency_report_source_proofs where binding=p_binding;
 if p is null then raise exception 'source proof missing' using errcode='22023'; end if;
 perform 1 from app_private.currency_report_source_heads where currency=p->>'currency' and url=p->>'url' and binding=p_binding for update;
 if not found then raise exception 'source proof changed; reload' using errcode='40001'; end if;
 select coalesce(max(revision),0) into last_revision from app_private.currency_report_source_decisions where currency=p->>'currency' and url=p->>'url';
 if p_revision is distinct from last_revision then raise exception 'source decision changed; reload' using errcode='40001'; end if;
 if p_action not in ('apply','hold','exclude') or p_action is null
  or jsonb_typeof(p_scopes) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_scopes))<>4
  or exists(select 1 from unnest(array['discover','collect','analyze','publishNotes']) k where jsonb_typeof(p_scopes->k) is distinct from 'boolean')
  or p_scopes->>'collect'='true' and p_scopes->>'discover'<>'true'
  or p_scopes->>'analyze'='true' and p_scopes->>'collect'<>'true'
  or p_scopes->>'publishNotes'='true' and p_scopes->>'analyze'<>'true'
 then raise exception 'valid source action and scopes required' using errcode='22023'; end if;
 if p_action='apply' then
  if p->>'status'='exclude' or (p->>'expiresAt')::timestamptz<=now() then
   raise exception 'restricted or expired source cannot be applied' using errcode='22023'; end if;
  if p->>'status'<>'eligible' then
   if p->>'reason' not in ('use_scope_unconfirmed','conflicting_or_third_party_rights','free_access_declaration_missing')
    or coalesce(p_evidence_url,'') !~ '^https://([a-z0-9-]+\.)+[a-z]{2,}/[^?#@[:space:]]*$' or length(p_evidence_url)>400
    or p_evidence_url ~* '(\.(local|localhost|internal|test|invalid)/|%40|sk-or-|bearer|token|api[_-]?key|password|secret)'
    or length(trim(coalesce(p_reason,'')))<20 or length(p_reason)>480
    or p_reason ~* '(sk-or-|bearer[[:space:]]|[<>]|PRIVATE KEY|ignore.*instructions|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2})'
   then raise exception 'documented source scope review required' using errcode='22023'; end if;
   basis=jsonb_build_object('kind','operator_documented_scope','evidenceUrl',p_evidence_url,'reason',p_reason,'checkedAt',now());
  end if;
 end if;
 insert into app_private.currency_report_source_decisions(currency,url,revision,proof_binding,action,scopes,basis,actor)
 values(p->>'currency',p->>'url',last_revision+1,p_binding,p_action,p_scopes,basis,(select auth.uid()));
 return last_revision+1;
end; $$;
revoke all on function app_private.decide_currency_report_source(text,integer,text,jsonb,text,text) from public,anon,service_role;
grant execute on function app_private.decide_currency_report_source(text,integer,text,jsonb,text,text) to authenticated;
create function public.decide_currency_report_source(p_binding text,p_revision integer,p_action text,p_scopes jsonb,p_evidence_url text default null,p_reason text default null) returns integer
language sql security invoker set search_path='' as $$ select app_private.decide_currency_report_source(p_binding,p_revision,p_action,p_scopes,p_evidence_url,p_reason); $$;
revoke all on function public.decide_currency_report_source(text,integer,text,jsonb,text,text) from public,anon,service_role;
grant execute on function public.decide_currency_report_source(text,integer,text,jsonb,text,text) to authenticated;

-- A scope covers only this publisher's own freely accessible articles under an
-- exact host/path. Preparing a scope does not enable it. A separate administrator
-- decision binds the current safely collected terms hash and a 90-day review.
create table app_private.currency_report_source_policies (
 id uuid primary key default gen_random_uuid(), currency text not null,
 host text not null,path_prefix text not null,publisher text not null,terms_url text not null,
 action text not null check(action in ('prepare','apply','hold','exclude')),revision integer not null,
 scopes jsonb not null,approved_terms_hash text,reason text,decided_at timestamptz not null default now(),expires_at timestamptz,
 unique(currency,host,path_prefix)
);
create table app_private.currency_report_source_policy_history (
 policy_id uuid not null references app_private.currency_report_source_policies(id),revision integer not null,
 state jsonb not null,actor uuid not null,decided_at timestamptz not null default now(),primary key(policy_id,revision)
);
create table app_private.currency_report_source_terms (
 policy_id uuid not null references app_private.currency_report_source_policies(id),checked_at timestamptz not null,
 url text not null,status text not null check(status in ('available','unavailable')),hash text,excerpt text,
 primary key(policy_id,checked_at)
);
alter table app_private.currency_report_source_policies enable row level security;
alter table app_private.currency_report_source_policy_history enable row level security;
alter table app_private.currency_report_source_terms enable row level security;
revoke all on app_private.currency_report_source_policies,app_private.currency_report_source_policy_history,app_private.currency_report_source_terms from public,anon,authenticated,service_role;
grant select on app_private.currency_report_source_policies to service_role;
grant select,insert on app_private.currency_report_source_terms to service_role;

create function public.save_currency_report_source_terms(p_check jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare p app_private.currency_report_source_policies; stamp timestamptz;
begin
 if jsonb_typeof(p_check) is distinct from 'object' or octet_length(p_check::text)>2500
  or exists(select 1 from jsonb_object_keys(p_check) k where k not in ('policyId','url','checkedAt','status','hash','excerpt'))
  or coalesce(p_check->>'status','') not in ('available','unavailable') then
  raise exception 'bounded terms check required' using errcode='22023'; end if;
 select * into p from app_private.currency_report_source_policies where id=(p_check->>'policyId')::uuid;
 stamp=(p_check->>'checkedAt')::timestamptz;
 if p.id is null or p.terms_url is distinct from p_check->>'url' or stamp is null or stamp>now()+interval '5 minutes'
  or p_check->>'status'='available' and (coalesce(p_check->>'hash','') !~ '^[a-f0-9]{64}$' or length(coalesce(p_check->>'excerpt','')) not between 1 and 400)
  or p_check->>'status'='unavailable' and (p_check->>'hash' is not null or p_check->>'excerpt' is not null)
 then raise exception 'terms check conditions invalid' using errcode='22023'; end if;
 if exists(select 1 from app_private.currency_report_source_terms where policy_id=p.id and checked_at>stamp) then return false; end if;
 insert into app_private.currency_report_source_terms(policy_id,checked_at,url,status,hash,excerpt)
 values(p.id,stamp,p.terms_url,p_check->>'status',p_check->>'hash',p_check->>'excerpt') on conflict do nothing;
 if not exists(select 1 from app_private.currency_report_source_terms where policy_id=p.id and checked_at=stamp
  and status=p_check->>'status' and hash is not distinct from p_check->>'hash' and excerpt is not distinct from p_check->>'excerpt') then
  raise exception 'terms check conflict' using errcode='40001'; end if;
 return true;
end; $$;
revoke all on function public.save_currency_report_source_terms(jsonb) from public,anon,authenticated;
grant execute on function public.save_currency_report_source_terms(jsonb) to service_role;

create function app_private.prepare_currency_report_source_policy(p_binding text,p_prefix text,p_terms_url text,p_revision integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare proof jsonb; p app_private.currency_report_source_policies;
begin
 if (select auth.uid()) is null or not (select app_private.is_business_plan_admin()) then
 raise exception 'active administrator required' using errcode='42501'; end if;
 select s.proof into proof from app_private.currency_report_source_heads h join app_private.currency_report_source_proofs s on s.binding=h.binding where h.binding=p_binding;
 if proof is null or proof->>'publisher' is null or proof->>'status'='exclude' or (proof->>'expiresAt')::timestamptz<=now()
  or proof->'articleChecks'->>'ownArticle' is distinct from 'true' or proof->'articleChecks'->>'freeAccess' is distinct from 'true'
  or proof->'articleChecks'->>'bodyVerified' is distinct from 'true'
  or coalesce(p_prefix,'') !~ '^/([a-zA-Z0-9_-]+/)*$' or length(p_prefix)>160
  or strpos(proof->>'url','https://'||(proof->>'host')||p_prefix)<>1
  or coalesce(p_terms_url,'') !~ '^https://([a-z0-9-]+\.)+[a-z]{2,}/[^?#@[:space:]]*$' or length(p_terms_url)>400
  or split_part(p_terms_url,'/',3) is distinct from proof->>'host'
  or p_terms_url ~* '(\.(local|localhost|internal|test|invalid)/|%40|sk-or-|bearer|token|api[_-]?key|password|secret)'
 then raise exception 'verified own-article scope required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('source-scope:'||(proof->>'currency'),0));
 select * into p from app_private.currency_report_source_policies where currency=proof->>'currency' and host=proof->>'host' and path_prefix=p_prefix for update;
 if p_revision is distinct from coalesce(p.revision,0) then raise exception 'source scope changed; reload' using errcode='40001'; end if;
 if p.id is null and (select count(*) from app_private.currency_report_source_policies where currency=proof->>'currency')>=24 then
 raise exception 'source scope capacity reached' using errcode='22023'; end if;
 insert into app_private.currency_report_source_policies(currency,host,path_prefix,publisher,terms_url,action,revision,scopes)
 values(proof->>'currency',proof->>'host',p_prefix,proof->>'publisher',p_terms_url,'prepare',1,'{"discover":false,"collect":false,"analyze":false,"publishNotes":false}')
 on conflict(currency,host,path_prefix) do update set publisher=excluded.publisher,terms_url=excluded.terms_url,action='prepare',revision=app_private.currency_report_source_policies.revision+1,
 scopes=excluded.scopes,approved_terms_hash=null,reason=null,expires_at=null,decided_at=now() returning * into p;
 insert into app_private.currency_report_source_policy_history(policy_id,revision,state,actor) values(p.id,p.revision,to_jsonb(p),(select auth.uid()));
 return p.id;
end; $$;
revoke all on function app_private.prepare_currency_report_source_policy(text,text,text,integer) from public,anon,service_role;
grant execute on function app_private.prepare_currency_report_source_policy(text,text,text,integer) to authenticated;
create function public.prepare_currency_report_source_policy(p_binding text,p_prefix text,p_terms_url text,p_revision integer default 0) returns uuid
language sql security invoker set search_path='' as $$ select app_private.prepare_currency_report_source_policy(p_binding,p_prefix,p_terms_url,p_revision); $$;
revoke all on function public.prepare_currency_report_source_policy(text,text,text,integer) from public,anon,service_role;
grant execute on function public.prepare_currency_report_source_policy(text,text,text,integer) to authenticated;

create function app_private.decide_currency_report_source_policy(p_id uuid,p_revision integer,p_action text,p_scopes jsonb,p_terms_hash text,p_reason text) returns integer
language plpgsql security definer set search_path='' as $$
declare p app_private.currency_report_source_policies; t app_private.currency_report_source_terms;
begin
 if (select auth.uid()) is null or not (select app_private.is_business_plan_admin()) then
 raise exception 'active administrator required' using errcode='42501'; end if;
 select * into p from app_private.currency_report_source_policies where id=p_id for update;
 if p.id is null or p.revision is distinct from p_revision then raise exception 'source scope changed; reload' using errcode='40001'; end if;
 if coalesce(p_action,'') not in ('apply','hold','exclude') or jsonb_typeof(p_scopes) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(p_scopes))<>4
  or exists(select 1 from unnest(array['discover','collect','analyze','publishNotes']) k where jsonb_typeof(p_scopes->k) is distinct from 'boolean')
  or p_scopes->>'collect'='true' and p_scopes->>'discover'<>'true' or p_scopes->>'analyze'='true' and p_scopes->>'collect'<>'true'
  or p_scopes->>'publishNotes'='true' and p_scopes->>'analyze'<>'true'
  or length(trim(coalesce(p_reason,'')))<20 or length(p_reason)>480
  or p_reason ~* '(sk-or-|bearer[[:space:]]|[<>]|PRIVATE KEY|ignore.*instructions|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2})'
 then raise exception 'documented scope decision required' using errcode='22023'; end if;
 if p_action='apply' then
  select * into t from app_private.currency_report_source_terms where policy_id=p.id and url=p.terms_url order by checked_at desc limit 1;
  if t.status is distinct from 'available' or t.checked_at<=now()-interval '1 day' or t.hash is distinct from p_terms_hash then
  raise exception 'current terms check required' using errcode='40001'; end if;
 end if;
 update app_private.currency_report_source_policies set action=p_action,revision=revision+1,scopes=p_scopes,approved_terms_hash=case when p_action='apply' then t.hash else null end,
 reason=p_reason,decided_at=now(),expires_at=case when p_action='apply' then now()+interval '90 days' else null end where id=p.id returning * into p;
 insert into app_private.currency_report_source_policy_history(policy_id,revision,state,actor) values(p.id,p.revision,to_jsonb(p),(select auth.uid()));
 return p.revision;
end; $$;
revoke all on function app_private.decide_currency_report_source_policy(uuid,integer,text,jsonb,text,text) from public,anon,service_role;
grant execute on function app_private.decide_currency_report_source_policy(uuid,integer,text,jsonb,text,text) to authenticated;
create function public.decide_currency_report_source_policy(p_id uuid,p_revision integer,p_action text,p_scopes jsonb,p_terms_hash text,p_reason text) returns integer
language sql security invoker set search_path='' as $$ select app_private.decide_currency_report_source_policy(p_id,p_revision,p_action,p_scopes,p_terms_hash,p_reason); $$;
revoke all on function public.decide_currency_report_source_policy(uuid,integer,text,jsonb,text,text) from public,anon,service_role;
grant execute on function public.decide_currency_report_source_policy(uuid,integer,text,jsonb,text,text) to authenticated;

alter function public.load_currency_report_source_admissions() rename to load_currency_report_source_article_admissions;
create function public.load_currency_report_source_admissions() returns jsonb
language sql security invoker set search_path='' as $$
 select public.load_currency_report_source_article_admissions() || jsonb_build_object(
 'policies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'currency',currency,'host',host,'pathPrefix',path_prefix,'publisher',publisher,'termsUrl',terms_url,
 'action',action,'revision',revision,'scopes',scopes,'approvedTermsHash',approved_terms_hash,'reason',reason,'decidedAt',decided_at,'expiresAt',expires_at)) from app_private.currency_report_source_policies),'[]'::jsonb),
 'terms',coalesce((select jsonb_agg(jsonb_build_object('policyId',t.policy_id,'url',t.url,'checkedAt',t.checked_at,'status',t.status,'hash',t.hash,'excerpt',t.excerpt))
 from (select distinct on(policy_id) * from app_private.currency_report_source_terms order by policy_id,checked_at desc) t),'[]'::jsonb));
$$;
revoke all on function public.load_currency_report_source_admissions() from public,anon,authenticated;
grant execute on function public.load_currency_report_source_admissions() to service_role;
create or replace function app_private.currency_report_source_admission_summary() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or not (select app_private.is_business_plan_admin()) then raise exception 'active administrator required' using errcode='42501'; end if;
 return public.load_currency_report_source_admissions() || jsonb_build_object('history',coalesce((select jsonb_agg(v) from (
 select jsonb_build_object('currency',currency,'url',url,'action',action,'revision',revision,'decidedAt',decided_at,'reason',basis->>'reason') v
 from app_private.currency_report_source_decisions order by decided_at desc,id desc limit 100) d),'[]'::jsonb),
 'policyHistory',coalesce((select jsonb_agg(v) from (select jsonb_build_object('id',policy_id,'revision',revision,'action',state->>'action','reason',state->>'reason','decidedAt',decided_at) v
 from app_private.currency_report_source_policy_history order by decided_at desc,revision desc limit 100) h),'[]'::jsonb));
end; $$;
