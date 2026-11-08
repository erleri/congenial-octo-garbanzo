// Explicit isolated REST smoke. Provider transport is always synthetic.
// New fixture records are preserved and marked testOnly; existing rows are hashed.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import {createRuntimeStore} from './runtime-store.js'
import {runCurrencyRuntime} from './runtime.js'
import {runtimeFixture,syntheticRuntimeTransport,runtimeTestEnv} from './runtime-fixture.js'
import {fingerprint} from './research-harness.js'

const directory='.local-reports/private/runtime-20261031'
await fs.mkdir(directory,{recursive:true})
const out=await fs.mkdtemp(path.join(directory,'rest-'))
const credentials=JSON.parse(await fs.readFile('.local-reports/private/local-db/connection.json','utf8'))
const store=createRuntimeStore({url:credentials.url,key:credentials.serviceKey,mode:'local'})
const original=await store.control()
assert.equal(original.enabled,false);assert.equal(Number(original.monthly_limit_nano),0)
const service=createClient(credentials.url,credentials.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
const anon=createClient(credentials.url,credentials.anonKey,{auth:{persistSession:false,autoRefreshToken:false}})
const read=async(table)=>{const r=await service.from(table).select('*');assert.equal(r.error,null);return r.data}
const tables=['currency_report_runs','currency_report_reviews','currency_reports']
const before=Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await read(table)).map(row=>({key:row.id??row.run_id,hash:fingerprint(row)}))])))
await fs.writeFile(path.join(out,'preservation-before.json'),JSON.stringify(before))
const sql=text=>{
 const r=spawnSync('docker',['exec','-i','supabase_db_latamfx-2x-isolated','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:text,encoding:'utf8',windowsHide:true})
 if(r.status!==0)throw Error('isolated_runtime_control_failed')
}
let reservationId=null
try {
 sql('update app_private.currency_report_runtime_control set enabled=true,review_enabled=true,monthly_limit_nano=1000000000;')
 const config=await store.control(),key=createHash('sha256').update(randomUUID()).digest('hex')
 const input={taskKey:key,currency:'BRL',baseDate:'2094-01-02',stage:'writer',parentId:null,requestHash:'a'.repeat(64),
  reservedNano:1000,revision:config.revision,context:{writer:'sol',testOnly:true}}
 const pair=await Promise.all([store.reserve(input),store.reserve(input)])
 assert.equal(pair.filter(r=>r.reserved).length,1);assert.equal(pair.filter(r=>r.reason==='duplicate_task').length,1)
 reservationId=pair.find(r=>r.reserved).id
 // Config revision invalidates an unstarted reservation without a provider POST.
 sql('update app_private.currency_report_runtime_control set enabled=true;')
 assert.equal(await store.begin(reservationId,input.requestHash),false)
 const f=runtimeFixture('BRL'),transport=syntheticRuntimeTransport(f.task)
 const staged=await store.stage(f.task)
 const reloaded=await store.input(f.currency,f.task.snapshot.snapshotId)
 assert.ok(staged);assert.deepEqual(reloaded,f.task)
 const result=await runCurrencyRuntime({...f,task:reloaded,env:runtimeTestEnv,store,...transport,testOnly:true,
  send:async args=>({...await transport.send(args),costUsd:0,costSource:'synthetic_no_provider_call',generationCalls:0,simulation:true})})
 assert.equal(result.status,'pending_admin_review');assert.equal(result.modelCalls,2)
 const runs=await read('currency_report_runs'),run=runs.find(r=>r.id===result.runId)
 assert.equal(run.candidate.testOnly,true);assert.equal(run.validation.synthetic,true);assert.equal(run.storage_required,true)
 assert.equal(run.status,'pending_review');assert.equal(run.cost.costUsd,0);assert.equal(run.cost.modelCalls,0)
 assert.equal((await read('currency_reports')).some(r=>r.run_id===result.runId),false)
 const denied=await anon.from('currency_report_runs').select('id');assert.ok(denied.error)
 let preserved=0
 for(const table of tables){const rows=await read(table);for(const row of before[table]){assert.ok(rows.some(r=>(r.id??r.run_id)===row.key&&fingerprint(r)===row.hash));preserved++}}
 const proof={date:'2026-10-31',target:'latamfx-2x-isolated',runtimeInputId:staged,syntheticRunId:result.runId,
  concurrentReservationWinners:1,duplicateReservationLosers:1,privateResponseStages:2,actualModelCalls:0,actualPaidUsd:0,
  reviewDraftStatus:run.status,testOnly:true,oldRecordsPreserved:preserved,publicReportAdded:false,anonymousDraftDenied:true,
  restoration:'disabled and zero budget in finally',productionChanges:0}
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify(proof,null,2))
 console.log(JSON.stringify(proof))
} finally {
 sql('update app_private.currency_report_runtime_control set enabled=false,review_enabled=false,monthly_limit_nano=0;')
 if(reservationId)await store.begin(reservationId,'a'.repeat(64))
 const restored=await store.control();assert.equal(restored.enabled,false);assert.equal(Number(restored.monthly_limit_nano),0)
}
