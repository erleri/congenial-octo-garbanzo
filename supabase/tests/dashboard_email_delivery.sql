-- Protocol/security fixtures only. No SMTP, real recipient or public approval.
begin;
set local search_path=public,extensions,pg_catalog;
select no_plan();
select ok(has_function_privilege('service_role','public.dashboard_email_delivery(text,jsonb)','execute'),'server role can use the mail ledger');
select ok(not has_function_privilege('anon','public.dashboard_email_delivery(text,jsonb)','execute'),'anonymous callers cannot inspect or send mail');
select ok(not has_function_privilege('authenticated','public.dashboard_email_delivery(text,jsonb)','execute'),'ordinary login does not grant server mail access');
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='app_private' and c.relkind='r' and c.relname like 'dashboard_email_%' and c.relrowsecurity),7,'all mail tables have RLS');
select ok(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='app_private' and c.relkind='r' and c.relname like 'dashboard_email_%'
 and (has_table_privilege('anon',c.oid,'select') or has_table_privilege('authenticated',c.oid,'select'))),'mail content and recipient identifiers have no public grants');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where p.proname like 'dashboard_email_%' and n.nspname in ('public','app_private') and p.prosecdef),'mail functions do not bypass access control');

insert into public.currency_report_runs(id,currency,base_date,attempt,rule_version,event_binding,status,packet,candidate,validation,storage_required)
select gen_random_uuid(),c,'2026-10-14',9901,'synthetic-mail-sql/1','synthetic-mail-sql',
 case when c='MXN' then 'pending_review' else 'published' end,'{}',
 jsonb_build_object('id','mail-sql-'||c,'currency',c,'baseDate','2026-10-14','status',case when c='ARS' then 'draft' else 'approved' end,
  'purpose','periodic_check','testOnly',c='COP','comparison',jsonb_build_object('historicalReview',c='PEN'),
  'content',jsonb_build_object('title','Synthetic','summary','Synthetic approved summary',
   'change',jsonb_build_object('title','Synthetic','text','Synthetic','kind','fact','factIds','[]'::jsonb,'evidenceIds','[]'::jsonb),
   'drivers','[]'::jsonb,'implications','[]'::jsonb,'watch','[]'::jsonb,'limitations','[]'::jsonb),
  'facts','[]'::jsonb,'series','[]'::jsonb,'evidence','[]'::jsonb,'limitations','[]'::jsonb),
 '{}'::jsonb,false from unnest(array['BRL','MXN','CLP','COP','ARS','PEN'])c;
insert into public.currency_report_reviews(run_id,decision,reviewer_email)
 select id,'approved','fixture@example.invalid' from public.currency_report_runs where event_binding='synthetic-mail-sql' and currency<>'MXN';
insert into public.currency_reports(currency,base_date,run_id,report,published_at)
 select currency,base_date,id,candidate,case when currency='CLP' then '2026-10-16T00:00:00Z'::timestamptz else '2026-10-14T00:00:00Z'::timestamptz end
 from public.currency_report_runs where event_binding='synthetic-mail-sql';
update public.currency_report_public_states set revision_kind='correction' where public_id='mail-sql-BRL';
set local role service_role;
select set_config('email.preview',public.dashboard_email_delivery('preview',jsonb_build_object('recipientKey',repeat('b',64),
 'cutoff','2026-10-15T00:15:00Z','dataDate','2026-10-14'))::text,true);
select is((select jsonb_agg(value->>'currency') from jsonb_array_elements(current_setting('email.preview')::jsonb->'reports')),
 '["BRL"]'::jsonb,'SQL source selection excludes pending, test, historical, future approval and nonapproved bodies');
select is(jsonb_array_length(current_setting('email.preview')::jsonb->'notices'),0,'a reader who never received a report gets no obsolete notice');
select set_config('email.frame',jsonb_build_object('version','dashboard-email-frame/1','channel','latamfx-daily','editionDate','2026-10-15',
 'dataDate','2026-10-14','cutoff','2026-10-15T00:15:00Z','datasetHash',repeat('d',64),'subject','Synthetic frozen subject',
 'html','<p>Frozen FX</p><!--LATAM_FX_APPROVED_REPORT_DIGEST-->','plainText','Frozen FX')::text,true);
select lives_ok($$select public.dashboard_email_delivery('stage_edition',jsonb_build_object('frameJson',current_setting('email.frame'),'chartBase64','iVBORw0KGgo='))$$,'email stage stores a private frozen edition');
select is((public.dashboard_email_delivery('stage_edition',jsonb_build_object('frameJson',
 jsonb_set(current_setting('email.frame')::jsonb,'{subject}','"ignored later change"')::text,'chartBase64','iVBORw0KGgo='))->>'frameJson')::jsonb->>'subject',
 'Synthetic frozen subject','a rerun cannot change the shared daily snapshot');
select set_config('email.claim',public.dashboard_email_delivery('claim',jsonb_build_object('editionDate','2026-10-15',
 'recipientKey',repeat('b',64),'owner','df000000-0000-0000-0000-000000000001'))::text,true);
select is(current_setting('email.claim')::jsonb->>'claimed','true','new recipient obtains one unsent lease');
select throws_ok($$select public.dashboard_email_delivery('candidates',jsonb_build_object('key',current_setting('email.claim')::jsonb->>'key',
 'owner','df000000-0000-0000-0000-000000000002'))$$,'55000','email lease owner required','a second owner cannot read or dispatch another lease');
select set_config('email.payload',jsonb_build_object('version','dashboard-email-payload/1','subject','Synthetic frozen subject',
 'html','<p>Frozen FX</p>','text','Frozen FX','refs',jsonb_build_array(jsonb_build_object('kind','notice','publicId','mail-sql-BRL',
 'key','notice:mail-sql-BRL:'||(current_setting('email.preview')::jsonb->'reports'->0->>'stateVersion'),
 'stateVersion',current_setting('email.preview')::jsonb->'reports'->0->'stateVersion')),
 'lookupStatus','ready','holds','[]'::jsonb)::text,true);
select set_config('email.frozen',public.dashboard_email_delivery('freeze',jsonb_build_object('key',current_setting('email.claim')::jsonb->>'key',
 'owner','df000000-0000-0000-0000-000000000001','payloadJson',current_setting('email.payload')))::text,true);
select throws_ok($$select public.dashboard_email_delivery('begin',jsonb_build_object('key',current_setting('email.claim')::jsonb->>'key',
 'owner','df000000-0000-0000-0000-000000000001','payloadHash',repeat('f',64)))$$,'55000','frozen email payload binding required','dispatch must bind to the stored bytes');
select is(public.dashboard_email_delivery('begin',jsonb_build_object('key',current_setting('email.claim')::jsonb->>'key',
 'owner','df000000-0000-0000-0000-000000000001','payloadHash',current_setting('email.frozen')::jsonb->>'payloadHash'))->>'started',
 'true','dispatch is committed before the transport is called');
select throws_ok($$select public.dashboard_email_delivery('finish',jsonb_build_object('key',current_setting('email.claim')::jsonb->>'key',
 'owner','df000000-0000-0000-0000-000000000001','payloadHash',current_setting('email.frozen')::jsonb->>'payloadHash',
 'status','accepted','code',550,'reason','smtp_accepted'))$$,'22023','explicit SMTP outcome required','a rejection code cannot become a successful receipt');
select is(public.dashboard_email_delivery('finish',jsonb_build_object('key',current_setting('email.claim')::jsonb->>'key',
 'owner','df000000-0000-0000-0000-000000000001','payloadHash',current_setting('email.frozen')::jsonb->>'payloadHash',
 'status','unknown','code',null,'reason','transport_result_unknown'))->>'state','unknown','missing DATA acknowledgement preserves uncertainty');
select throws_ok($$select public.dashboard_email_delivery('reconcile',jsonb_build_object('key',current_setting('email.claim')::jsonb->>'key',
 'status','accepted','code',250,'reason','smtp_accepted'))$$,'55000','unknown email outcome and operator evidence required','unknown cannot be silently treated as resolved');
select is(public.dashboard_email_delivery('reconcile',jsonb_build_object('key',current_setting('email.claim')::jsonb->>'key',
 'status','accepted','code',250,'reason','smtp_accepted','evidence','synthetic-smtp-receipt-only'))->>'state','accepted','operator evidence can settle the same delivery identity');
select ok(app_private.dashboard_email_introduced(repeat('b',64),'report:mail-sql-BRL'),'a correction notice counts as introduction to that exact corrected version');
select is(public.dashboard_email_delivery('claim',jsonb_build_object('editionDate','2026-10-15','recipientKey',repeat('b',64),
 'owner','df000000-0000-0000-0000-000000000002'))->>'claimed','false','settled identity cannot be claimed for a duplicate send');
reset role;
select ok(exists(select 1 from app_private.dashboard_email_events where delivery_key=current_setting('email.claim')::jsonb->>'key'
 and event='outcome_reconciled' and detail->>'evidence'='synthetic-smtp-receipt-only'),'reconciliation retains an audit reference');
select * from finish();
rollback;
