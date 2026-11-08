// Saved actual responses only. No network, credentials, DB, model adapter or
// writes to the supplied trial. Missing responses remain missing, not mocks.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {restoreOperatingPayload} from './runtime-store.js'
import {fingerprint} from './research-harness.js'
import {prepareOriginalNewsCase,inspectExtractedNews,completeOriginalNewsReview,ORIGINAL_NEWS_PIPELINE_VERSION} from './original-news-pipeline.js'
import {applyMaterialProcessing} from './material-processing.js'
import {admitRuntimeNotes} from './runtime-note-material.js'
import {supplyRuntimeInput} from './runtime-supply.js'
import {inspectNewsPreselection} from './news-preselection.js'
import {operatingCheckpoint} from './operating-checkpoint.js'
import {operatingResultState} from './operating-result.js'
import {sourceContinuation} from './research-continuation.js'

const input=process.argv[2]
if(!input)throw Error('saved_analysis_directory_required')
const read=p=>fs.readFile(p,'utf8').then(JSON.parse)
const dir=path.resolve(input),files=await fs.readdir(dir)
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await fs.readFile(path.join(dir,f))).digest('hex')])))
const before=await hashes(),batch=await read(path.join(dir,'frozen-batch.json')),jobs=await read(path.join(dir,'jobs.json'))
const frozen=restoreOperatingPayload(batch.payload),prepared=frozen.prepared
// This captured trial had no prior published anchor. Do not fabricate an empty
// publication history when someone points this runner at another kind of run.
if(prepared.rows.some(r=>r.purpose!=='initial_check'))throw Error('saved_publication_history_required_for_noninitial_replay')
const config={sourcePlan:await read('docs/2.0/six-currency-explanation-sources-20261027.json'),
 sourceRegister:await read('docs/2.0/six-currency-source-register-20261027.json'),
 registry:await read('docs/2.0/original-news-source-policy-20261028.json'),
 processingRules:await read('docs/2.0/material-processing-rules.json')}
const out=await fs.mkdtemp('.local-reports/private/operating-record-replay-')
const write=(name,value)=>fs.writeFile(path.join(out,name+'.json'),JSON.stringify(value,null,2),{flag:'wx'})
const countries=[],sources=[],consumed=new Set(),inputs=[]
for(const country of prepared.privateCountries){
 const collection=country.collection,asOf=prepared.asOf
 const sourceUse=applyMaterialProcessing({collection,legacyRegistry:config.registry,rules:config.processingRules,evaluatedOn:asOf.slice(0,10)})
 const reviewed={receipts:[],materialInputs:[],newsResponses:[],items:[],status:'saved_response_reevaluation',modelCalls:0,newPaidCostUsd:0}
 for(const card of collection.reviewQueue){
  const original=collection.originals.find(o=>o.id===card.originalId)
  const plan=prepared.sourcePlans.find(p=>p.cardBinding===card.binding)
  const routing=inspectNewsPreselection(original,card,country.currency)
  const row={currency:country.currency,url:original.url,cardBinding:card.binding,routing,
   status:'no_new_response_in_trial',publicationApproved:false}
  const extract=plan&&jobs.find(j=>j.planBinding===plan.binding&&j.stage==='writer')
  const compare=extract&&jobs.find(j=>j.planBinding===plan.binding&&j.stage==='reviewer'&&j.parentId===extract.id)
  if(extract)consumed.add(extract.id)
  if(compare)consumed.add(compare.id)
  try{
   if(!extract)throw Error('saved_original_response_unavailable')
   if(extract.requestHash!==plan.extraction.requestHash||plan.extraction.requestHash!==fingerprint(plan.extraction.body))throw Error('saved_request_hash_mismatch')
   // Verify the old prompt stays byte-bound; reevaluation is a new record, not
   // a new provider response under the new prompt/version.
   const legacy=prepareOriginalNewsCase({collection,card,sourceUse,version:plan.version})
   if(legacy.binding!==plan.binding)throw Error('saved_legacy_plan_changed')
   row.originalVersion=plan.version;row.reevaluationVersion=ORIGINAL_NEWS_PIPELINE_VERSION
   const candidate=JSON.parse(extract.response.partialText)
   const extracted=inspectExtractedNews(plan.job,candidate)
   row.extraction=extracted.status
   if(extracted.status!=='candidate_requires_original_comparison'){row.status=extracted.status}
   else if(!compare){row.status='saved_comparison_unavailable'}
   else{
    const comparison=JSON.parse(compare.response.partialText)
    const {prepareOriginalComparison}=await import('./original-news-pipeline.js')
    if(compare.requestHash!==prepareOriginalComparison(plan,candidate).requestHash||compare.responseId===extract.responseId)throw Error('saved_comparison_binding_mismatch')
    const result=completeOriginalNewsReview({collection,card,sourceUse,plan,candidate,comparison,checkedOn:asOf.slice(0,10)})
    row.status=result.status;row.reason=result.reason;row.contextReview=result.contextReview;row.assessment=result.assessment
    if(result.status==='source_card_prepared'&&routing.status!=='excluded'){
     const material=admitRuntimeNotes({collection,card,reviewed:result,asOf,registry:config.processingRules})
     reviewed.receipts.push(result.receipt)
     if(material)reviewed.materialInputs.push({cardBinding:card.binding,input:material})
     row.status=material?'reviewed_note_ready_for_material_validation':'note_use_or_role_hold'
    }
   }
  }catch(e){row.status='saved_replay_hold';row.reason=e.message}
  if(routing.status==='excluded')row.currentSelection='exclude_before_paid_call'
  reviewed.items.push({...row,continuation:sourceContinuation(row)});sources.push(row)
 }
 const supply=await supplyRuntimeInput({...config,dataset:frozen.dataset,currency:country.currency,asOf,calendar:country.calendar,
  commentaryTarget:country.commentaryTarget,publications:[],handoff:country.handoff,eventCandidateIds:country.eventCandidateIds??[],writer:'sol',
  acquire:async()=>({collection,officialBackground:country.officialBackground,networkCalls:0}),review:async()=>reviewed,
  store:{stage:async task=>{inputs.push(task);return 'offline_memory_only'},input:async()=>null}})
 countries.push({currency:country.currency,status:supply.status,holds:supply.holds,staged:!!supply.staged,
  commentaryTarget:supply.commentaryTarget,sourceResults:reviewed.items.map(({url,status,reason})=>({url,status,reason})),publicationApproved:false})
 await write(country.currency+'-supply',supply)
}
const actual=await read(path.join(dir,'reconstructed-final-outcome.json')),checkpoint=operatingCheckpoint(actual,batch.batch_key)
if(JSON.stringify(operatingResultState(actual))!==JSON.stringify(operatingResultState(checkpoint)))throw Error('checkpoint_outcome_changed')
if(consumed.size!==jobs.length)throw Error('unmapped_saved_responses')
if(fingerprint(before)!==fingerprint(await hashes()))throw Error('trial_files_changed')
await write('checkpoint',checkpoint);await write('sources',sources);await write('preserved-hashes',before)
await write('summary',{mode:'actual_saved_response_reevaluation_not_new_generation',countries,originalResponses:jobs.length,
 consumedResponses:consumed.size,originalCostUsd:jobs.reduce((n,j)=>n+j.actualNano,0)/1e9,newModelCalls:0,newCostUsd:0,
 oldCheckpointBytes:Buffer.byteLength(JSON.stringify(actual)),newCheckpointBytes:Buffer.byteLength(JSON.stringify(checkpoint)),
 trialFilesPreserved:true,originalReportsPreserved:true,productionChanges:0,publicationApproved:false,
 stagedInMemoryOnly:inputs.length,notes:'BRL lacks a saved comparison; remaining evidence gaps are not fabricated. No stored review validity is overwritten.'})
console.log(JSON.stringify({directory:out,countries:countries.map(({currency,status,holds})=>({currency,status,holds})),responses:consumed.size,newModelCalls:0},null,2))
