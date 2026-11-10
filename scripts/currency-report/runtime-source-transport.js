// Durable, separately budgeted source-review transport. The existing DB stages
// writer/reviewer represent extraction/comparison here; context.purpose keeps
// these expenses distinct. Source jobs can never create a report candidate.
import {fingerprint} from './research-harness.js'
import {prepareOriginalComparison} from './original-news-pipeline.js'
import {inspectNewsModelEndpoint} from './news-model-review.js'
import {endpointDiagnostic} from './endpoint-metadata.js'
import {runtimeNano,runtimeMode} from './runtime.js'
import {selectRuntimeAttempt} from './runtime-retry.js'

export function runtimeSourceTransport({store,env,approval,preflight,send,reconcile=async()=>({costUsd:null})}) {
 let calls=0,committed=0,stopped=false
 const parents=new Map()
 const before=message=>{const error=Error(message);error.beforeDispatch=true;throw error}
 const knownFailure=(message,cost)=>{const error=Error(message);error.recordedCostUsd=cost;error.recordedGenerationCalls=1;throw error}
 const invoke=async(request,plan)=>{
  if(stopped||runtimeMode(env)!=='currency')before('source_runtime_stopped')
  if(!approval||approval.version!=='runtime-source-approval/1'||!approval.planBindings?.includes(plan.binding)
   ||!Number.isInteger(approval.maxCalls)||approval.maxCalls<0||!Number.isFinite(approval.budgetUsd))before('source_budget_not_approved')
  if(plan.holds?.length||request.requestHash!==fingerprint(request.body))before('source_request_binding_changed')
  const parent=parents.get(plan.binding)
  if(request.stage==='extract'&&(parent||request.requestHash!==plan.extraction.requestHash)
   ||request.stage==='compare'&&(!parent||fingerprint(request)!==fingerprint(prepareOriginalComparison(plan,parent.output))))
   before('source_stage_order_or_binding_changed')
  const baseTaskKey=fingerprint({purpose:'original_source_review',plan:plan.binding,stage:request.stage})
  const {taskKey,prior:cached,retry}=await selectRuntimeAttempt({store,taskKey:baseTaskKey,requestHash:request.requestHash,
   enabled:env.FX_REPORT_RETRY_TRANSIENT==='bounded'})
  const reuse=cached?.state==='received'||cached?.state==='held'
  const unsent=cached?.state==='cancelled'&&cached.actual_nano===0&&cached.checkpoint?.phase==='unsent_released_never_dispatched'
  if(cached&&!unsent){
   if(!reuse||cached.cost_state!=='confirmed'||cached.actual_nano>cached.reserved_nano
    ||cached.request_hash!==request.requestHash||cached.context.planBinding!==plan.binding
    ||cached.context.purpose!=='original_source_review'||!cached.response?.valid)before('existing_source_call_not_reusable')
   const response=cached.response
   if(response.actualModel!==request.body.model&&!response.actualModel?.startsWith(request.body.model+'-20'))before('source_cached_model_changed')
   let output
   try{output=JSON.parse(response.payload.choices[0].message.content)}catch{before('source_cached_json_hold')}
   if(request.stage==='extract')parents.set(plan.binding,{id:cached.id,output})
   return {output,requestHash:request.requestHash,responseId:response.responseId,costUsd:0,generationCalls:0,
    reused:true,originalCostUsd:cached.actual_nano/1e9}
  }
  // Completed exact stages cost no new calls. Only an actual dispatch consumes
  // the current allowance; resuming comparison must not repurchase extraction.
  if(calls>=approval.maxCalls||committed+request.maximumUsd>approval.budgetUsd)before('source_budget_not_approved')
  const config=await store.control()
  if(!config.enabled||!config.review_enabled||!['sol','sol-us'].includes(config.writer))before('source_runtime_disabled')
  let metadata
  try{
   metadata=await preflight(request)
   inspectNewsModelEndpoint(request,metadata.catalog,metadata.zdr)
  }catch(error){const failure=Error(error.endpointCategory?`source_endpoint_${error.endpointCategory}`:'source_endpoint_metadata_unavailable');failure.beforeDispatch=true;failure.diagnostic=endpointDiagnostic(error,request,metadata);throw failure}
  const reservation=await store.reserve({taskKey,
   currency:plan.currency,baseDate:plan.job.time.asOf.slice(0,10),stage:request.stage==='extract'?'writer':'reviewer',
   parentId:parent?.id??null,requestHash:request.requestHash,reservedNano:runtimeNano(request.maximumUsd),revision:config.revision,
   // Do not store the original request text in the runtime DB.
   context:{writer:config.writer,purpose:'original_source_review',sourceStage:request.stage,planBinding:plan.binding,
    originalId:plan.originalId,originalBinding:plan.originalBinding,requestHash:request.requestHash,
    model:request.body.model,provider:request.body.provider.only[0],...retry}})
  if(!reservation.reserved)before(reservation.reason)
  if(!await store.begin(reservation.id,request.requestHash))before('source_runtime_stopped_before_post')
  calls++
  let response
  try{
   response=await send({body:request.body,timeoutMs:120000,retries:0,checkpoint:async point=>{
    if(point.responseId)await store.checkpoint(reservation.id,{responseId:point.responseId,phase:point.phase})
   }})
   if(response.costUsd===null&&response.responseId)response={...response,...await reconcile({responseId:response.responseId})}
  }catch{response={valid:false,costUsd:null,generationCalls:1,errors:['source_transport_or_storage_checkpoint_failure']}}
  await store.receive(reservation.id,response,typeof response.costUsd==='number'?runtimeNano(response.costUsd):null)
  if(typeof response.costUsd!=='number'||response.costUsd<0){stopped=true;committed+=request.maximumUsd;throw Error('source_cost_unresolved')}
  committed+=response.costUsd
  if(response.costUsd>request.maximumUsd||!response.valid||response.actualModel!==request.body.model
   &&!response.actualModel?.startsWith(request.body.model+'-20')){stopped=true;knownFailure('source_response_or_cost_hold',response.costUsd)}
  let output
  try{output=JSON.parse(response.payload.choices[0].message.content)}catch{stopped=true;knownFailure('source_json_hold',response.costUsd)}
  if(request.stage==='extract')parents.set(plan.binding,{id:reservation.id,output})
  else await store.finish(reservation.id,null,null,null)
  return {output,requestHash:request.requestHash,responseId:response.responseId,costUsd:response.costUsd,generationCalls:1}
 }
 return {extract:invoke,compare:invoke,accounting:()=>({calls,committedUsd:committed,stopped})}
}
