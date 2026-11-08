// Real Postgres transactions + saved approved content + mock SMTP only.
// All writes go to a new, explicitly named clone. No operating DB or email.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {randomBytes,randomUUID} from 'node:crypto'
import {parseArgs} from 'node:util'
import {createClient} from '@supabase/supabase-js'
import {captureDashboardEmailFrame,emailRecipientKey,buildApprovedEmailPayload} from './delivery-core.js'
import {createEmailDeliveryStore} from './delivery-store.js'
import {deliverDashboardEmail,planDashboardEmail} from './delivery-worker.js'

const {values}=parseArgs({options:{setup:{type:'boolean'},directory:{type:'string'}},strict:true})
const docker='C:/Users/접근금지/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
const container='supabase_db_latamfx-1x-staging',donor='latamfx_release_20261103_32cfd19eb3f7'
const root=process.cwd(),parent=path.resolve('.local-reports/private/email2-delivery-20261103')
await fs.mkdir(parent,{recursive:true})
const out=values.directory?await fs.realpath(values.directory):await fs.mkdtemp(path.join(parent,'run-'))
if(path.dirname(out)!==parent) throw Error('private_email_verification_directory_required')
if(values.setup&&values.directory) throw Error('new_verification_directory_required')
const command=(args,input)=>{
  const r=spawnSync(docker,args,{input,encoding:'utf8',maxBuffer:12000000,windowsHide:true})
  if(r.status!==0) {const error=new Error('local_email_database_command_failed');error.detail=(r.stderr??'').slice(0,2000);throw error}
  return r.stdout.trim()
}
function sql(db,statement,{write=false}={}) {
  if(![donor,'postgres'].includes(db)&&!/^latamfx_mail_20261103_[a-f0-9]{12}$/.test(db)) throw Error('isolated_email_database_required')
  if(write&&!/^latamfx_mail_20261103_[a-f0-9]{12}$/.test(db)) throw Error('source_database_write_forbidden')
  return command(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],
    (write?'':'set default_transaction_read_only=on;\n')+statement)
}
const quote=value=>"convert_from(decode('"+Buffer.from(JSON.stringify(value)).toString('base64')+"','base64'),'UTF8')::jsonb"
function sourceSnapshot() {
  const names=JSON.parse(sql(donor,"select json_agg(tablename order by tablename) from pg_tables where schemaname='public';"))
  return JSON.stringify(names.map(table=>{
    if(!/^[a-z_]+$/.test(table)) throw Error('known_source_table_required')
    return {table,...JSON.parse(sql(donor,`select json_build_object('rows',count(*),'hash',md5(coalesce(string_agg(v,E'\\n' order by v),''))) from (select to_jsonb(t)::text v from public."${table}" t)x;`))}
  }))
}
let db
if(values.setup) {
  db='latamfx_mail_20261103_'+randomBytes(6).toString('hex')
  // CREATE DATABASE cannot be put in the transactional sql() helper. Both names
  // are fixed/validated here; it never restores over an existing target.
  const before=sourceSnapshot()
  command(['exec',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',
    `create database ${db} template ${donor};`])
  await fs.writeFile(path.join(out,'connection.json'),JSON.stringify({db,container,donor,sourceBefore:before},null,2))
  const migration=await fs.readFile('supabase/migrations/20261103112417_dashboard_email_delivery.sql','utf8')
  sql(db,'begin;\n'+migration+'\ncommit;',{write:true})
  // Read the existing isolated public endpoint. Do not load cloud credentials.
  const cfg=JSON.parse(await fs.readFile('.local-reports/private/local-db/connection.json','utf8'))
  if(cfg.url!=='http://127.0.0.1:56321') throw Error('isolated_public_endpoint_required')
  const publicClient=createClient(cfg.url,cfg.anonKey,{auth:{persistSession:false,autoRefreshToken:false}})
  const originals=[]
  for(const currency of ['BRL','MXN','CLP','COP','ARS','PEN']) {
    const {data,error}=await publicClient.rpc('resolve_currency_report',{p_currency:currency,p_date:'2026-11-02',p_include_test:false})
    if(error||data?.state!=='active'||data.report?.status!=='approved'||data.report.currency!==currency
      ||data.report.testOnly||data.report.historicalReview) throw Error('saved_approved_public_report_required')
    originals.push(data.report)
    const runId=randomUUID(),r=data.report
    // The content is real saved public content. This clone's review identity and
    // mail/publication clock are synthetic replay fixtures, not actual sends.
    const row={id:runId,currency,base_date:r.baseDate,attempt:1,rule_version:'email-local-replay/1',event_binding:'synthetic-email-replay',
      status:'published',packet:{},candidate:r,validation:{},cost:{},created_at:new Date().toISOString(),storage_required:false}
    sql(db,`insert into public.currency_report_runs select (jsonb_populate_record(null::public.currency_report_runs,${quote(row)})).*;
      insert into public.currency_report_reviews(run_id,decision,reviewer_email) values('${runId}','approved','fixture@example.invalid');
      insert into public.currency_reports(currency,base_date,run_id,report,published_at)
      values('${currency}','${r.baseDate}','${runId}',${quote(r)},'2026-11-02T00:30:00Z');`,{write:true})
  }
  await fs.writeFile(path.join(out,'public-source-snapshots.json'),JSON.stringify(originals,null,2))
  assert.equal(sourceSnapshot(),before)
  console.log(JSON.stringify({directory:out,db,savedPublicReports:originals.length,syntheticReviewAndSendClock:true,emailsSent:0}))
  process.exit(0)
}
const config=JSON.parse(await fs.readFile(path.join(out,'connection.json'),'utf8'));db=config.db
if(await fs.stat(path.join(out,'result.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error}))
  throw Error('completed_email_verification_requires_new_run')
const tap=sql(db,await fs.readFile('supabase/tests/dashboard_email_delivery.sql','utf8'),{write:true})
await fs.writeFile(path.join(out,'database-tests.tap'),tap)
const databaseAssertions=Number(/^1\.\.(\d+)$/m.exec(tap)?.[1])
if(!databaseAssertions||/^not ok/m.test(tap)) throw Error('email_database_assertions_failed')
const records=[]
function rpc(action,input) {
  const result=sql(db,`begin;set local role service_role;select public.dashboard_email_delivery('${action}',${quote(input)});commit;`,{write:action!=='preview'&&action!=='inspect'})
  return JSON.parse(result)
}
const client={rpc:(_name,args)=>({abortSignal:async()=>{
  try{return {data:rpc(args.p_action,args.p_input),error:null}}catch(error){return {data:null,error:{code:'LOCAL_SQL',message:error.detail??error.message}}}
}})}
const store=createEmailDeliveryStore({url:'http://127.0.0.1:56321',key:'synthetic-adapter-only-not-a-credential',mode:'local',client})
const dataset=JSON.parse(await fs.readFile('.local-reports/private/operating-readiness-20261103/release-vaxQqu/source/data/fx-full-history.json','utf8'))
const frame1=captureDashboardEmailFrame({dataset,asOf:'2026-11-02T01:00:00Z',workflowRunId:'1000001'})
const frame2=captureDashboardEmailFrame({dataset,asOf:'2026-11-03T01:00:00Z',workflowRunId:'1000002'})
const chartBase64=(await fs.readFile(path.join(parent,'cli/email-chart.png'))).toString('base64')
const chartSnapshot=JSON.parse(await fs.readFile(path.join(parent,'cli/email-chart-meta.json'),'utf8'))
const accepted={status:'accepted',code:250,reason:'smtp_accepted'}
const makeTransport=(value=accepted)=>{const calls=[];return {calls,send:async request=>{calls.push(request);if(value instanceof Error)throw value;return value}}}
const run=async(recipients,{frame=frame1,adapter=store,smtp=makeTransport()}={})=>({
  result:await deliverDashboardEmail({frame,chartBase64,chartSnapshot,recipients,store:adapter,transport:smtp.send}),smtp,
})
const record=(name,detail={})=>records.push({name,passed:true,...detail})
try {
  const before=sql(db,'select count(*) from app_private.dashboard_email_deliveries;')
  const plan=await planDashboardEmail({frame:frame1,recipients:['plan@example.invalid'],store})
  assert.equal(plan.rows[0].reportCount,6);assert.equal(sql(db,'select count(*) from app_private.dashboard_email_deliveries;'),before)
  record('read_only_plan_six_saved_reports',{reportCount:6})

  const first=await run(['one@example.invalid','two@example.invalid','correction@example.invalid'])
  assert.equal(first.result.status,'completed');assert.equal(first.result.transportCalls,3)
  assert.ok(first.result.rows.every(r=>r.reportCount===6&&r.status==='accepted'))
  assert.ok(first.smtp.calls[0].payload.html.includes('?run='));assert.ok(first.smtp.calls[0].payload.text.includes('기준환율'))
  await fs.writeFile(path.join(out,'first-message.html'),first.smtp.calls[0].payload.html)
  record('six_currency_approved_content_to_frozen_email',{mockSmtpCalls:3})

  const repeat=await run(['one@example.invalid','ONE@example.invalid'],{frame:{...frame1,subject:'changed local subject'}})
  assert.equal(repeat.result.transportCalls,0);assert.equal(repeat.result.rows.length,1)
  record('same_day_rerun_and_address_duplicates_blocked')
  const midnight=await run(['one@example.invalid'],{frame:{...frame2,workflowRunId:frame1.workflowRunId}})
  assert.equal(midnight.result.transportCalls,0);assert.equal(midnight.result.rows[0].status,'already_accepted')
  record('same_workflow_rerun_after_midnight_keeps_original_edition')
  const next=await run(['one@example.invalid'],{frame:frame2})
  assert.equal(next.result.rows[0].reportCount,0);assert.equal(next.smtp.calls.length,1)
  const newReader=await run(['new-reader@example.invalid'],{frame:frame2})
  assert.equal(newReader.result.rows[0].reportCount,6)
  record('next_day_no_repeat_introductions_and_new_reader_is_independent')

  const lookup=await run(['lookup-failure@example.invalid'],{adapter:{...store,candidates:async()=>{throw Error('synthetic read outage')}}})
  assert.equal(lookup.result.rows[0].lookupStatus,'unavailable');assert.equal(lookup.smtp.calls.length,1)
  assert.ok(lookup.smtp.calls[0].payload.html.includes('Six-currency KPI summary'))
  const malformed=await run(['bad-projection@example.invalid'],{adapter:{...store,candidates:async()=>({reports:'invalid',notices:[]})}})
  assert.equal(malformed.result.rows[0].lookupStatus,'unavailable');assert.equal(malformed.smtp.calls.length,1)
  const noLedger=await run(['ledger-failure@example.invalid'],{adapter:{...store,stage:async()=>{throw Error('synthetic ledger outage')}}})
  assert.equal(noLedger.result.transportCalls,0)
  record('report_only_failure_keeps_fx_but_unwritable_ledger_blocks_dispatch')

  const uncertain=await run(['unknown@example.invalid'],{smtp:makeTransport(new Error('synthetic lost DATA reply'))})
  assert.equal(uncertain.result.rows[0].status,'unknown')
  const unknownAgain=await run(['unknown@example.invalid']);assert.equal(unknownAgain.result.transportCalls,0)
  const unknownTomorrow=await run(['unknown@example.invalid'],{frame:frame2})
  assert.equal(unknownTomorrow.result.rows[0].reportCount,0)
  record('uncertain_smtp_never_retried_or_reintroduced')

  const refused=await run(['refused@example.invalid','unaffected@example.invalid'],{smtp:{calls:[],send:async request=>request.recipient.startsWith('refused')?
    {status:'rejected',code:550,reason:'recipient_rejected'}:accepted}})
  assert.deepEqual(refused.result.rows.map(r=>r.status),['rejected','accepted'])
  const suppressed=await run(['refused@example.invalid'],{frame:frame2});assert.equal(suppressed.result.rows[0].status,'suppressed');assert.equal(suppressed.result.transportCalls,0)
  await store.unsuppress({recipientKey:emailRecipientKey('refused@example.invalid'),evidence:'synthetic operator checked recipient settings'})
  const allowedAfterReview=await run(['refused@example.invalid'],{frame:frame2})
  assert.equal(allowedAfterReview.result.transportCalls,1)
  record('550_recipient_isolated_and_suppressed_without_deleting_mailing_list')

  const authFailure=await run(['auth-failure@example.invalid'],{smtp:makeTransport({status:'failed_before_send',code:535,reason:'pre_data_failure'})})
  assert.equal(authFailure.result.rows[0].status,'failed_before_send')
  assert.equal((await run(['auth-failure@example.invalid'])).result.transportCalls,0)
  record('known_pre_data_failure_is_not_automatically_retried')

  const inconsistent=await run(['inconsistent-receipt@example.invalid'],{smtp:makeTransport({status:'accepted',code:550,reason:'smtp_accepted'})})
  assert.equal(inconsistent.result.rows[0].status,'unknown')
  record('inconsistent_transport_receipt_cannot_mark_mail_accepted')

  const lostReceipt=await run(['lost-write@example.invalid'],{adapter:{...store,finish:async()=>{throw Error('synthetic lost receipt write')}}})
  assert.equal(lostReceipt.result.rows[0].status,'receipt_unconfirmed')
  assert.equal((await run(['lost-write@example.invalid'])).result.transportCalls,0)
  sql(db,`update app_private.dashboard_email_deliveries set lease_until=clock_timestamp()-interval '1 minute'
    where recipient_key='${emailRecipientKey('lost-write@example.invalid')}';`,{write:true})
  assert.equal((await run(['lost-write@example.invalid'])).result.transportCalls,0)
  record('process_loss_after_dispatch_preserves_uncertainty')

  let release,started
  const gate=new Promise(resolve=>{release=resolve}),called=new Promise(resolve=>{started=resolve})
  const concurrentA=run(['concurrent@example.invalid'],{smtp:{calls:[],send:async()=>{started();await gate;return accepted}}})
  let startTimer
  try {await Promise.race([called,new Promise((_,reject)=>{startTimer=setTimeout(()=>reject(Error('concurrent_test_did_not_reach_dispatch')),15000)})])}
  finally {clearTimeout(startTimer)}
  const concurrentB=await run(['concurrent@example.invalid'])
  release()
  const completedA=await concurrentA
  assert.equal(concurrentB.result.transportCalls,0);assert.equal(completedA.result.transportCalls,1)
  record('concurrent_runners_have_only_one_smtp_dispatch')

  const oldReport=JSON.parse(sql(db,"select report from public.currency_reports where currency='CLP' and base_date='2026-11-02';"))
  let changed=false
  const race=await run(['withdraw-race@example.invalid'],{adapter:{...store,begin:async input=>{
    if(!changed){changed=true;sql(db,"update public.currency_reports set withdrawn_at='2026-11-02T00:55:00Z' where currency='CLP' and base_date='2026-11-02';",{write:true})}
    return store.begin(input)
  }}})
  assert.equal(race.result.rows[0].lookupStatus,'changed_before_send');assert.equal(race.result.rows[0].reportCount,0)
  assert.ok(!race.smtp.calls[0].payload.html.includes(oldReport.content.title))
  const withdrawnNotice=await run(['two@example.invalid'],{frame:frame2})
  assert.equal(withdrawnNotice.result.rows[0].noticeCount,1);assert.ok(withdrawnNotice.smtp.calls[0].payload.html.includes('철회되었습니다'))
  record('withdrawal_before_dispatch_drops_old_text_and_prior_reader_gets_notice')

  const original=JSON.parse(sql(db,"select report from public.currency_reports where currency='MXN' and base_date='2026-11-02';"))
  const newId=original.id+'-correction',newRun=randomUUID(),corrected={...original,id:newId,content:{...original.content,title:'합성 정정 연결 시험 · '+original.content.title}}
  const row={id:newRun,currency:'MXN',base_date:'2026-11-02',attempt:2,rule_version:'synthetic-email-replay/1',event_binding:'synthetic-correction',status:'published',packet:{},candidate:corrected,validation:{},cost:{},created_at:new Date().toISOString(),storage_required:false}
  sql(db,`begin;select set_config('app.fx_report_revision','correction',true);
    insert into public.currency_report_runs select (jsonb_populate_record(null::public.currency_report_runs,${quote(row)})).*;
    insert into public.currency_report_reviews(run_id,decision,reviewer_email) values('${newRun}','approved','fixture@example.invalid');
    update public.currency_reports set run_id='${newRun}',report=${quote(corrected)},published_at='2026-11-03T00:30:00Z'
     where currency='MXN' and base_date='2026-11-02';commit;`,{write:true})
  const correction=await run(['correction@example.invalid'],{frame:frame2})
  assert.equal(correction.result.rows[0].reportCount,1);assert.ok(correction.smtp.calls[0].payload.html.includes('정정'))
  assert.ok(correction.smtp.calls[0].payload.html.includes(encodeURIComponent(newId)))
  const oldResolution=JSON.parse(sql(db,`set role anon;select public.resolve_currency_report('MXN','2026-11-02','${original.id}',false);`))
  assert.equal(oldResolution.state,'superseded');assert.equal(oldResolution.report,null);assert.equal(oldResolution.replacement.id,newId)
  record('corrected_version_reintroduced_once_and_old_link_keeps_its_identity')

  const latestRun=randomUUID(),latest={...original,id:'synthetic-mail-latest-MXN',baseDate:'2026-11-03',observedDate:'2026-11-03',
    content:{...original.content,title:'합성 최신 리포트 연결 시험'}}
  const latestRow={...row,id:latestRun,base_date:'2026-11-03',attempt:1,candidate:latest,event_binding:'synthetic-latest-mail'}
  sql(db,`insert into public.currency_report_runs select (jsonb_populate_record(null::public.currency_report_runs,${quote(latestRow)})).*;
    insert into public.currency_report_reviews(run_id,decision,reviewer_email) values('${latestRun}','approved','fixture@example.invalid');
    insert into public.currency_reports(currency,base_date,run_id,report,published_at)
    values('MXN','2026-11-03','${latestRun}',${quote(latest)},'2026-11-03T00:40:00Z');`,{write:true})
  const source=await store.preview({recipientKey:emailRecipientKey('one@example.invalid'),cutoff:frame2.cutoff,dataDate:'2026-11-03'})
  assert.equal(source.reports.find(r=>r.currency==='MXN').publicId,latest.id)
  assert.ok(source.notices.some(n=>n.publicId===newId&&n.noticeKind==='correction'))
  const previewFrame=captureDashboardEmailFrame({dataset:{...dataset,baseDate:'2026-11-03'},asOf:frame2.cutoff})
  const correctionNotice=buildApprovedEmailPayload(previewFrame,source)
  assert.ok(correctionNotice.html.includes('합성 최신 리포트 연결 시험'))
  assert.ok(correctionNotice.html.includes('정정되었습니다.'))
  record('older_correction_notice_does_not_displace_current_report')

  assert.equal(sourceSnapshot(),config.sourceBefore)
  record('source_database_row_counts_preserved')
  const result={status:'passed',directory:out,database:db,databaseAssertions,cases:records,emailsSent:0,externalSmtpCalls:0,
    modelCalls:0,productionChanges:0,savedContent:true,syntheticReviewAndSendClock:true,
    transport:'injected mock; real Postgres service_role functions',realPostgrestEndpoint:false}
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2),{flag:'wx'})
  console.log(JSON.stringify(result,null,2))
} catch(error) {
  await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({completed:records,error:error.message,detail:error.detail??null},null,2))
  console.error(JSON.stringify({directory:out,completed:records.length,error:error.message,detail:error.detail??null}))
  process.exitCode=1
}
