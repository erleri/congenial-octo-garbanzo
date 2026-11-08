// Saved-response evaluation only. No environment loading, credentials,
// transport, database, manuscript editing or publication.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {inspectExtractedNews} from './original-news-pipeline.js'
import {compileSharedWriterOutput} from './shared-writer.js'
import {prepareRuntimeReview,preflightRuntimeReview} from './runtime.js'
import {encodeReviewInput,decodeReviewInput} from './review-transport.js'
import {FX_REPORT_PRIORITY_VERSION} from './fx-report-priority.js'
import {fingerprint} from './research-harness.js'

const privatePath=p=>{
 const root=path.resolve('.local-reports/private'),resolved=path.resolve(p)
 if(!resolved.startsWith(root+path.sep))throw Error('private_replay_path_required')
 return resolved
}
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'))
async function hashes(root){
 const result={}
 for(const file of (await fs.readdir(root,{recursive:true})).sort()){
  const full=path.join(root,file);if(!(await fs.stat(full)).isFile())continue
  result[file]=createHash('sha256').update(await fs.readFile(full)).digest('hex')
 }
 return result
}
export async function replayFxPriority({input,output}) {
 const source=privatePath(input),destination=privatePath(output)
 if(destination.startsWith(source+path.sep)||destination===source)throw Error('separate_replay_output_required')
 const before=await hashes(source),jobs=await read(path.join(source,'jobs.json'))
 const batch=await read(path.join(source,'frozen-batch.json'))
 const frozen=JSON.parse(batch.payload.serializedOperatingPayload)
 const decode=j=>JSON.parse(j.response.payload.choices[0].message.content)
 const sourceRows=jobs.filter(j=>j.purpose==='original_source_review'&&j.stage==='writer').map(job=>{
  const plan=frozen.prepared.sourcePlans.find(p=>p.binding===job.planBinding)
  let outcome
  try{outcome=inspectExtractedNews(plan.job,decode(job))}catch(error){outcome={status:'hold',reason:error.message}}
  return {currency:job.currency,jobId:job.id,outcome,approved:false,
   meaning:'unchanged_old_extraction_not_new_original_review'}
 })
 const rows=jobs.filter(j=>j.purpose!=='original_source_review'&&j.stage==='writer').map(job=>{
  const compiled=compileSharedWriterOutput({plan:job.context.task.plan,draft:decode(job)})
  const review=jobs.find(j=>j.parentId===job.id),rawReview=review?decode(review):null
  let request
  try{const p=prepareRuntimeReview(job.context.task,compiled);request={status:p.status,inputBound:p.inputBound,maximumUsd:p.maximumUsd,ceilingUsd:p.profile.perCallUsd}}
  catch(error){request={status:'hold',reason:error.message}}
  const encoded=encodeReviewInput(compiled.claimReview)
  if(fingerprint(decodeReviewInput(encoded))!==fingerprint(compiled.claimReview))throw Error('review_transport_not_lossless')
  return {currency:job.currency,originalJobId:job.id,fxPriority:compiled.fxPriority,
   reviewerNameShape:rawReview?{legacyMinimum:10,actualLength:rawReview.review.reviewer.length,
    newIdentityOwner:'verified_execution_receipt_not_generated_name'}:null,
   savedRequiredCorrections:(rawReview?.review.claims??[]).filter(c=>c.decision==='rewrite').map(c=>({id:c.id,issue:c.issue,support:c.support})),
   reviewPreflight:preflightRuntimeReview(job.context.task),reviewRequest:request,
   reviewTransportLossless:true,oldScoresAdopted:false,publicationApproved:false}
 })
 const after=await hashes(source)
 if(fingerprint(before)!==fingerprint(after))throw Error('saved_trial_changed')
 const result={version:FX_REPORT_PRIORITY_VERSION,kind:'saved_real_response_replay',
  sourceRows,rows,originalFilesPreserved:Object.keys(before).length,originalFingerprint:fingerprint(before),
  modelCalls:0,newPaidCostUsd:0,networkCalls:0,databaseWrites:0,manualDraftEdits:0,
  limitation:'New extraction fields and changed prompts still require a separately budgeted live test. No old response was repaired, rebound or approved.'}
 await fs.mkdir(path.dirname(destination),{recursive:true})
 await fs.writeFile(destination,JSON.stringify(result,null,2)+'\n',{flag:'wx'})
 return result
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2)
 if(args.length!==4||args[0]!=='--input'||args[2]!=='--output')throw Error('input_and_output_required')
 const result=await replayFxPriority({input:args[1],output:args[3]})
 console.log(JSON.stringify({rows:result.rows,sources:result.sourceRows.reduce((n,r)=>{const key=r.outcome.reason??r.outcome.status;n[key]=(n[key]??0)+1;return n},{}),
  preserved:result.originalFilesPreserved,modelCalls:0,newPaidCostUsd:0},null,2))
}
