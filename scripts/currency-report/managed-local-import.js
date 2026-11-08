// Explicit local DB importer; no environment loading or production client.
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {assertLocalApi} from './local-db.js'
import {writeDataBundle,readDataBundle} from './data-ledger.js'
import {projectPublicReport} from './storage.js'
export async function importManagedLocalDraft({connection,report,packet,validation,attempt,root}){
 const url=assertLocalApi(connection.url)
 if(!Number.isInteger(attempt)||attempt<1)throw Error('positive_attempt_required')
 const runId=randomUUID(),bundleId=`db-${runId}`
 const candidate={...report,evidence:projectPublicReport(report).evidence}
 const receipt=await writeDataBundle({root,id:bundleId,kind:'db_draft',currency:report.currency,
  resources:[{id:'original',kind:'manuscript',value:report},{id:'candidate',kind:'approval_candidate',value:candidate},
   {id:'packet',kind:'evidence_packet',value:packet},{id:'validation',kind:'content_review',value:validation}],
  edges:[{from:'original',to:'candidate',role:'source_manuscript'},{from:'packet',to:'candidate',role:'writing_input'},{from:'candidate',to:'validation',role:'content_review'}],
  protection:['pending_review_dependency'],costState:'not_called'})
 const verified=await readDataBundle(bundleId,{root})
 const client=createClient(url,connection.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
 const inserted=await client.from('currency_report_runs').insert({id:runId,currency:report.currency,base_date:report.baseDate,attempt,
  rule_version:'data-lifecycle-design/1',event_binding:receipt.manifestHash,storage_required:true,
  candidate:verified.resources.candidate,packet:verified.resources.packet,validation:verified.resources.validation,cost:{modelCalls:0}})
 if(inserted.error)throw Error('managed_local_draft_insert_failed')
 const sealed=await client.rpc('seal_currency_report_storage',{p_run_id:runId,p_bundle_id:bundleId,p_manifest_hash:receipt.manifestHash})
 if(sealed.error)throw Error(`managed_local_storage_seal_failed_${sealed.error.code??'unknown'}`)
 return {runId,storageReceipt:receipt,publicationApproved:false,modelCalls:0}
}
