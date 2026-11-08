// Actual isolated REST persistence + synthetic transport, not an AI trial.
// Control activation is temporary for this test and restored in finally.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import {createRuntimeStore} from './runtime-store.js'
import {operatingFixture} from './operating-fixture.js'
import {runOperatingCycle} from './operating-cycle.js'
import {operatingPolicyDraft,oneTimeOperatingPolicy} from './operating-policy.js'
import {fingerprint} from './research-harness.js'
import {syntheticDbReport} from './local-db.js'

const directory=await fs.mkdtemp('.local-reports/private/operating-rest-')
const cfg=JSON.parse(await fs.readFile('.local-reports/private/local-db/connection.json','utf8'))
const store=createRuntimeStore({url:cfg.url,key:cfg.serviceKey,mode:'local'})
const control=await store.control(),priorPolicy=await store.operatingPolicy()
assert.equal(control.enabled,false);assert.equal(Number(control.monthly_limit_nano),0)
const docker='C:/Users/접근금지/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
const sql=text=>{
 const r=spawnSync(docker,['exec','-i','supabase_db_latamfx-2x-isolated','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:text,encoding:'utf8',windowsHide:true})
 if(r.status!==0)throw Error('isolated_operating_fixture_sql_failed')
}
const options={auth:{persistSession:false,autoRefreshToken:false}},client=key=>createClient(cfg.url,key,options)
const service=client(cfg.serviceKey),anon=client(cfg.anonKey),admin=client(cfg.anonKey),other=client(cfg.anonKey),reader=client(cfg.anonKey)
const ok=r=>{assert.equal(r.error,null);return r.data}
const tables=['currency_report_runs','currency_report_reviews','currency_reports']
const before=Object.fromEntries(await Promise.all(tables.map(async table=>[table,ok(await service.from(table).select('*')).map(row=>({id:row.id??row.run_id,hash:fingerprint(row)}))])))
await fs.writeFile(path.join(directory,'preservation-before.json'),JSON.stringify(before))
const fixture=await operatingFixture({nonce:randomUUID()}),accounts=JSON.parse(await fs.readFile('.local-reports/private/local-db/accounts.json','utf8'))
let revoked=false
try{
 const policy=process.argv.includes('--trial')?oneTimeOperatingPolicy({config:fixture,datasetBinding:fingerprint(fixture.dataset),
  authorizationReference:'synthetic-trial-only-'+randomUUID(),configuredAt:new Date().toISOString(),
  expiresAt:new Date(Date.now()+3600000).toISOString()}):structuredClone(fixture.state.policy)
 policy.authorizationReference='synthetic-only-'+randomUUID();policy.configuredAt=new Date().toISOString();delete policy.binding;policy.binding=fingerprint(policy)
 await store.configureOperatingPolicy(policy,priorPolicy?.revision??0)
 sql('update app_private.currency_report_runtime_control set enabled=true,review_enabled=true,writer=\'sol\',monthly_limit_nano=7000000000;')
 const result=await runOperatingCycle({...fixture,store,execute:true,
  // The fixture sender compiles the stored task exactly; no real provider path.
  send:async args=>{
   const name=args.body.response_format.json_schema.name
   if(!name.startsWith('original_news_')){
    const currency=name==='shared_currency_brief'?JSON.parse(args.body.messages[1].content).currency:fixture.state.activeCurrency
    if(currency){fixture.state.activeCurrency=currency;fixture.state.inputs.set(currency,await store.input(currency,fixture.state.snapshotIds[currency]))}
   }
   const r=await fixture.send(args);return {...r,costUsd:0,simulation:true,generationCalls:0}
  },
  acquire:async args=>{
   fixture.state.snapshotIds??={};fixture.state.snapshotIds[args.snapshot.currency]=args.snapshot.snapshotId
   return fixture.acquire(args)
  }})
 await fs.writeFile(path.join(directory,'cycle-result.json'),JSON.stringify(result,null,2))
 assert.equal(result.status,'completed_with_country_results',JSON.stringify(result))
 assert.equal(result.rows.filter(r=>r.status==='pending_admin_review').length,6,JSON.stringify(result))
 const repeated=await runOperatingCycle({...fixture,store,execute:true});assert.equal(repeated.status,'completed')
 ok(await admin.auth.signInWithPassword(accounts.admin));ok(await other.auth.signInWithPassword(accounts.admin));ok(await reader.auth.signInWithPassword(accounts.reader))
 assert.ok((await anon.rpc('currency_report_operating_policy')).error)
 assert.ok((await reader.rpc('currency_report_operating_summary')).error)
 const summary=ok(await admin.rpc('currency_report_operating_summary'))
 assert.equal(summary.cases.length,6);assert.ok(!JSON.stringify(summary).includes('serializedOperatingPayload'))
 const occupied=new Set(ok(await service.from('currency_report_runs').select('base_date').eq('currency','CLP').gte('base_date','2098-01-01')).map(r=>r.base_date))
 const date=Array.from({length:365},(_,i)=>new Date(Date.parse('2098-01-01T00:00:00Z')+i*86400000).toISOString().slice(0,10)).find(d=>!occupied.has(d))
 assert.ok(date,'unused synthetic approval date required')
 const existing=ok(await service.from('currency_report_runs').select('attempt').eq('currency','CLP').eq('base_date',date))
 const attempt=Math.max(0,...existing.map(r=>r.attempt))+1,id=randomUUID()
 ok(await service.from('currency_report_runs').insert({id,currency:'CLP',base_date:date,attempt,rule_version:'operating-rest-synthetic/1',event_binding:'synthetic-only',packet:{raw:'PRIVATE-OPERATING-SYNTHETIC'},
  candidate:{...syntheticDbReport('CLP',date,attempt),purpose:'periodic_check'},validation:{structureValid:true,contentReview:'passed',criticalErrors:0,qualityAverage:4,evidenceScore:4,synthetic:true},cost:{costUsd:0,modelCalls:0}}))
 const approvals=await Promise.all([admin,other].map(c=>c.rpc('review_currency_report_version',{p_run_id:id,p_decision:'approved',p_expected_public_id:null,p_revision_kind:null,p_report_kind:'periodic'})))
 await fs.writeFile(path.join(directory,'approval-outcomes.json'),JSON.stringify(approvals.map(r=>({data:r.data,error:r.error?{code:r.error.code,message:r.error.message}:null})),null,2))
 assert.equal(approvals.filter(r=>r.data==='published'&&!r.error).length,1)
 assert.equal(ok(await service.from('currency_report_reviews').select('id').eq('run_id',id)).length,1)
 assert.equal(ok(await anon.from('currency_reports').select('report').eq('run_id',id).single()).report.purpose,'periodic_check')
 ok(await admin.rpc('review_currency_report',{p_run_id:id,p_decision:'withdrawn',p_reason:'Synthetic local approval verification complete.'}))
 ok(await service.from('business_plan_admins').update({active:false}).eq('email',accounts.admin.email));revoked=true
 assert.ok((await admin.rpc('currency_report_operating_summary')).error)
 let preserved=0
 for(const table of tables){const rows=ok(await service.from(table).select('*'));for(const row of before[table]){assert.ok(rows.some(r=>(r.id??r.run_id)===row.id&&fingerprint(r)===row.hash));preserved++}}
 const proof={target:'latamfx-2x-isolated',synthetic:true,simulatedModelStages:fixture.state.posts.length,actualModelCalls:0,actualPaidUsd:0,
  budgetAuthority:policy.state==='trial_configured'?'one_time_only':'synthetic_recurring_configuration',
  sixDraftsStored:true,repeatCalls:0,concurrentApprovalWinners:1,privateSettingsDenied:true,sameSessionRevocationDenied:true,
  oldRecordsPreserved:preserved,approvedFixtureWithdrawn:true,productionChanges:0}
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({...proof,directory}))
}finally{
 if(revoked)ok(await service.from('business_plan_admins').update({active:true}).eq('email',accounts.admin.email))
 sql(`update app_private.currency_report_runtime_control set enabled=false,review_enabled=false,writer='${control.writer}',monthly_limit_nano=0,per_call_limit_nano=${Number(control.per_call_limit_nano)};`)
 const restored=structuredClone(priorPolicy?.policy??operatingPolicyDraft(fixture))
 restored.configuredAt=new Date().toISOString();delete restored.binding;restored.binding=fingerprint(restored)
 const current=await store.operatingPolicy();await store.configureOperatingPolicy(restored,current.revision)
 await Promise.all([admin,other,reader].map(c=>c.auth.signOut()))
 assert.equal((await store.control()).enabled,false)
}
