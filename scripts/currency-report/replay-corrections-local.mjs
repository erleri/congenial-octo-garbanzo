// Existing saved originals and the real common entry. No HTTP except isolated
// DB REST, no model credentials, no new fixture publications or paid calls.
import fs from 'node:fs/promises'
import {createClient} from '@supabase/supabase-js'
import {operatingEntry} from './operating-entry.js'
import {createRuntimeStore} from './runtime-store.js'
import {fingerprint} from './research-harness.js'
const directory=await fs.mkdtemp('.local-reports/private/corrections-replay-')
const cfg=JSON.parse(await fs.readFile('.local-reports/private/local-db/connection.json','utf8'))
const store=createRuntimeStore({url:cfg.url,key:cfg.serviceKey,mode:'local'})
const client=createClient(cfg.url,cfg.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
const read=async()=>{
 const rows={}
 for(const table of ['currency_report_runs','currency_report_reviews','currency_reports']){
  const result=await client.from(table).select('*');if(result.error)throw Error('preservation_snapshot_failed')
  rows[table]=fingerprint(result.data.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))
 }
 return {rows,control:fingerprint(await store.control()),policy:fingerprint(await store.operatingPolicy())}
}
const before=await read(),manifest='.local-reports/private/stages123-20261101/operation-manifest.json'
const result=await operatingEntry({action:'plan',input:manifest,env:{},store,fetchImpl:()=>{throw Error('replay_external_network_forbidden')}})
const after=await read()
if(fingerprint(before)!==fingerprint(after))throw Error('existing_records_or_controls_changed')
if(result.modelCalls!==0||result.collectionResults.some(r=>['correction_storage_failed','correction_input_check_failed','correction_storage_unavailable'].includes(r.correctionCheck?.status)))throw Error('correction_common_entry_replay_failed')
await fs.writeFile(directory+'/result.json',JSON.stringify(result,null,2),{flag:'wx'})
const summary={directory,rows:result.collectionResults.map(r=>({currency:r.currency,correctionCheck:r.correctionCheck})),
 status:result.status,modelCalls:0,costUsd:0,externalSourceRequests:0,existingReportsAndControlsPreserved:true,productionChanges:0}
await fs.writeFile(directory+'/summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary))
