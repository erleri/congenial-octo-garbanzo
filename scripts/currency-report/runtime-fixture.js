// Synthetic integration doubles. These do not establish historical source
// support, writer quality, budget approval, or a real provider connection.
import {randomUUID} from 'node:crypto'
import {sharedWriterFixture,sharedDraftFixture} from './shared-writer-fixture.js'
import {compileSharedWriterOutput} from './shared-writer.js'
import {prepareRuntimeTask} from './runtime.js'
import {fingerprint} from './research-harness.js'
import {encodeCompactReview} from './compact-review.js'

export const runtimeTestEnv={FX_REPORT_GENERATOR:'currency',FX_REPORT_ENABLED:'true',FX_REPORT_PUBLISH_MODE:'review'}
export function runtimeFixture(currency='BRL') {
 const handoff=sharedWriterFixture(currency),s=handoff.reportPriceSnapshot
 const dataset={baseDate:s.baseDate,fetchedAt:s.fetchedAt,dailyRates:structuredClone(s.series)}
 const asOf='2026-10-28T12:00:00Z',calendar={status:'confirmed',expectedReferenceDate:s.baseDate}
 const task=prepareRuntimeTask({dataset,currency,asOf,calendar,handoff})
 return {handoff,dataset,currency,asOf,calendar,task,publications:[]}
}
export function syntheticRuntimeReview(prepared) {
 const reason='합성 계약 시험의 대역이며 실제 경제 주장이나 원문의 지지를 평가한 것이 아닙니다.'
 const claims=prepared.claims.map(c=>{
  const ids=c.evidenceIds.length?c.evidenceIds:[prepared.sources[0].id]
  const anchors=ids.flatMap(id=>{
   const s=prepared.sources.find(s=>s.id===id),p=s?.sourceContext?.passages[0]
   return p?[{evidenceId:s.id,passageId:p.id,passageHash:s.sourceContext.passageHash,quote:p.text}]:[]
  })
  return {id:c.id,claimHash:c.claimHash,support:'supported',decision:'keep',issue:'none',reason,anchors,applicationIds:[],
   subclaims:[{quote:c.quote,support:'supported',reason,anchors,applicationIds:[]}]}
 })
 const writingCoverage=Object.fromEntries((prepared.writingCoverageRequirements??[]).map(r=>{
  const targets=(prepared.sharedClaimLinks??[]).filter(l=>l.materialClaimIds.some(id=>r.materialClaimIds.includes(id))).map(l=>l.target)
  return [r.id,{status:'pass',reason,...(r.policyVersion?{treatment:targets.length?'used':'omitted',targets}:{} )}]
 }))
 return {review:{version:prepared.version,binding:prepared.binding,origin:'agent',reviewer:'synthetic offline review fixture',claims,
  ...(Object.keys(writingCoverage).length?{writingCoverage}:{})},scores:{cause:4,change:4,business:4,readability:4,evidence:4},criticalErrors:0}
}
export function memoryRuntimeStore() {
 const jobs=[],drafts=[]
 const config={enabled:true,review_enabled:true,writer:'sol',monthly_limit_nano:1000000000,per_call_limit_nano:250000000,revision:1}
 return {jobs,drafts,config,
  control:async()=>structuredClone(config),
  job:async key=>{const j=jobs.find(j=>j.taskKey===key);return j?structuredClone({id:j.id,state:j.state,cost_state:j.costState,
   actual_nano:j.actual,reserved_nano:j.reservedNano,request_hash:j.requestHash,context:j.context,response:j.response}):null},
  reserve:async r=>{
   if(jobs.some(j=>j.taskKey===r.taskKey))return {reserved:false,reason:'duplicate_task'}
   if(jobs.some(j=>j.costState==='unknown'||['reserved','calling'].includes(j.state)))return {reserved:false,reason:'unresolved_or_inflight_call'}
   const id=randomUUID();jobs.push({...structuredClone(r),id,state:'reserved',costState:'reserved'});return {reserved:true,id}
  },
  begin:async(id,hash)=>{const j=jobs.find(j=>j.id===id);if(j?.state!=='reserved'||j.requestHash!==hash||!config.enabled)return false;j.state='calling';j.costState='unknown';return true},
  checkpoint:async(id,checkpoint)=>{jobs.find(j=>j.id===id).checkpoint=structuredClone(checkpoint)},
  receive:async(id,response,actual)=>{const j=jobs.find(j=>j.id===id);if(j.state!=='calling')throw Error('immutable_response');Object.assign(j,{state:'received',response:structuredClone(response),actual,costState:actual===null?'unknown':'confirmed'})},
  finish:async(id,candidate,validation,cost)=>{
   const j=jobs.find(j=>j.id===id)
   if(j.state==='finished'&&j.runId){
    const prior=drafts.find(d=>d.runId===j.runId)
    if(fingerprint(prior.candidate)!==fingerprint(candidate)||fingerprint(prior.validation)!==fingerprint(validation))throw Error('finalized_candidate_changed')
    return j.runId
   }
   if(j.state!=='received')throw Error('stored_response_required')
   if(!candidate){j.state='held';return null}
   const runId=randomUUID();drafts.push({runId,candidate:structuredClone(candidate),validation:structuredClone(validation),cost:structuredClone(cost)})
   j.state='finished';j.runId=runId
   const parent=jobs.find(p=>p.id===j.parentId);if(parent){parent.state='finished';parent.runId=runId}
   return runId
  },
 }
}
export function syntheticRuntimeTransport(task) {
 const wire=sharedDraftFixture(task.plan),compiled=compileSharedWriterOutput({plan:task.plan,draft:wire})
 const output=syntheticRuntimeReview(compiled.claimReview)
 return {
  preflight:async(body,profile)=>({model:body.model,route:profile.route,zdr:true,dataCollection:'deny'}),
  send:async({body,checkpoint})=>{
   const reviewer=body.response_format.json_schema.name==='currency_runtime_review'
   const payload=structuredClone(reviewer&&task.reviewTransportVersion?encodeCompactReview(compiled.claimReview,output):reviewer?output:wire);if(reviewer)delete payload.review.reviewer
   const result={valid:true,actualModel:body.model,costUsd:.01,responseId:`gen-synthetic-${reviewer?'review':'writer'}`,
    payload:{choices:[{message:{content:JSON.stringify(payload)}}]},generationCalls:1,retries:0}
   await checkpoint({responseId:result.responseId,phase:'headers'})
   return result
  },
  writerOutput:wire,reviewOutput:output,compiled,
  inputBinding:fingerprint(task),
 }
}
