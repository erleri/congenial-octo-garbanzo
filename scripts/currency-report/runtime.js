// Server-only coordinator. It reuses the existing price, cadence, writer and
// sentence-review contracts. No filesystem, credentials or network at import.
import {inspectFxPriority,fxMaterialHolds,FX_REPORT_PRIORITY_INSTRUCTIONS} from './fx-report-priority.js'
import {encodeReviewInput} from './review-transport.js'
import {COMPACT_REVIEW_VERSION,compactReviewContract,decodeCompactReview} from './compact-review.js'
import {withoutOptionalBackground} from './runtime-material-selection.js'
import {selectRuntimeAttempt,terminalRateLimit} from './runtime-retry.js'
import {publicSourceDelivery} from './public-source-delivery.js'
import {assertRuntimeDocumentCapacity} from './runtime-document.js'
import {RUNTIME_ASSEMBLY_VERSION,DEFAULT_RUNTIME_REVIEWER} from './runtime-assembly.js'
import {applySharedClaimTyping} from './shared-claim-typing.js'
import {randomUUID} from 'node:crypto'
import Ajv from 'ajv'
import {fingerprint} from './research-harness.js'
import {officialMaterialEditions} from './operating-source-cache.js'
import {buildSharedDashboardPriceSnapshot,REPORT_CURRENCIES,SHARED_REPORT_RULE_VERSION,referenceEdition} from './shared-price-contract.js'
import {evaluatePublicationCadence,koreaDate} from './publication-cadence.js'
import {prepareSharedWriter,assertSharedWriterPlan,compileSharedWriterOutput} from './shared-writer.js'
import {composeDraft,draftSchemaForPacket} from './openrouter.js'
import {applyReviewWriterPolicy,assertWriterPolicy,writerReservation} from './writer-policy.js'
import {decodeGenerationOutput,assertGenerationWireRequest} from './generation-wire.js'
import {claimReviewContract,assessClaimReview,prepareClaimReview} from './claim-review.js'
import {projectPublicReport} from './storage.js'

export const RUNTIME_VERSION='currency-report-runtime/1'
const ajv=new Ajv({allErrors:true})
export const runtimeNano=value=>{
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1000)throw Error('invalid_runtime_amount')
 return Math.ceil(value*1e9-1e-6)
}
const sealed=value=>({...value,binding:fingerprint(value)})
const assertSealed=value=>{const {binding,...body}=value??{};if(binding!==fingerprint(body))throw Error('runtime_binding_changed');return body}
const inputEdition=task=>fingerprint({version:'runtime-input-edition/1',reference:referenceEdition(task.snapshot),
 materialEditions:[...(task.materialEditions??[])].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),
 rules:task.snapshot.ruleVersion,...(task.assemblyVersion?{assemblyVersion:task.assemblyVersion}:{}),...(task.reviewTransportVersion?{reviewTransportVersion:task.reviewTransportVersion}:{}),
 ...(task.reviewCoverageGuideVersion?{reviewCoverageGuideVersion:task.reviewCoverageGuideVersion}:{}),...(task.reviewer?{reviewer:task.reviewer}:{}),
 ...(task.executionProfile?{executionProfile:task.executionProfile}:{}),
 ...(task.publicUseProofs?.length?{publicUseProofs:fingerprint(task.publicUseProofs)}:{})})
const safe=value=>{
 const raw=JSON.stringify(value)
 if(Buffer.byteLength(raw)>900000||/sk-or-|bearer\s+\S+|-----BEGIN .*PRIVATE KEY|[?&](?:token|api_?key)=/i.test(raw))throw Error('unsafe_or_oversized_runtime_payload')
 return value
}
export function runtimeMode(env={}) {
 if(env.FX_REPORT_GENERATOR!=='currency')return 'legacy'
 if(env.FX_REPORT_ENABLED!=='true'||env.FX_REPORT_OPERATIONAL_HOLD==='true')return 'disabled'
 if(env.FX_REPORT_PUBLISH_MODE!=='review')return 'review_mode_required'
 return 'currency'
}
function assertPeriodicPlan(plan) {
 assertSealed(plan)
 assertWriterPolicy(plan.body,plan.writerProfile)
 assertGenerationWireRequest(plan.body,plan.outputContract)
 if(plan.requestHash!==fingerprint(plan.body)||!plan.packet.periodicCheck)throw Error('periodic_runtime_plan_changed')
}
export function prepareRuntimeTask({dataset,currency,asOf,publications=[],calendar,handoff,periodicInput,
 writer='sol',reviewer:approvedReviewer,eventCandidateIds=[],correctionReportIds=[],previousChecks=[],openCase=null,claimTypingReview}) {
 const snapshot=buildSharedDashboardPriceSnapshot({dataset,currency,asOf,calendar})
 const cadence=evaluatePublicationCadence({snapshot,asOf,publications,calendar,eventCandidateIds,correctionReportIds,previousChecks,openCase})
 if(cadence.status!=='research_candidate')return {version:RUNTIME_VERSION,status:'held',reason:cadence.status,cadence,modelCalls:0}
 if(cadence.dataHolds.length||cadence.comparisonHolds.length)return {version:RUNTIME_VERSION,status:'held',reason:'reference_data_hold',cadence,modelCalls:0}
 const purpose=cadence.triggers.includes('cumulative')?'market':cadence.triggers.includes('bootstrap')?'initial'
  :cadence.triggers.includes('event_research')?'policy':'periodic'
 const reviewer=approvedReviewer??(writer==='sol'?DEFAULT_RUNTIME_REVIEWER:writer)
 let plan
 if(purpose==='periodic'&&periodicInput)return {version:RUNTIME_VERSION,status:'held',reason:'legacy_periodic_input_requires_shared_fx_adapter',cadence,modelCalls:0}
 {
  if(handoff?.reportPriceSnapshot?.snapshotId!==snapshot.snapshotId||fingerprint(handoff.reportPriceSnapshot)!==fingerprint(snapshot))
   return {version:RUNTIME_VERSION,status:'held',reason:'current_dashboard_material_required',cadence,modelCalls:0}
  const anchor=purpose==='periodic'?publications.find(r=>r.id===cadence.anchorId):purpose==='policy'
   ?[...publications].filter(r=>r.state==='published'&&r.approved&&!r.withdrawn&&r.report&&Date.parse(r.publishedAt)<=Date.parse(asOf))
    .sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))[0]:null
  if(purpose==='periodic'&&!anchor?.report)return {version:RUNTIME_VERSION,status:'held',reason:'published_explanation_snapshot_required',cadence,modelCalls:0}
  const previous=anchor?{id:anchor.id,currency,origin:'published_record',observedDate:anchor.snapshot.current.date,
   value:anchor.snapshot.current.value,publishedAt:anchor.publishedAt,
   explanations:[anchor.report.content?.summary,...(anchor.report.content?.drivers??[]).map(d=>d.text),
    ...(anchor.report.content?.implications??[]).map(d=>d.text)].filter(s=>typeof s==='string').slice(0,8)}:undefined
  const writerPurpose=purpose==='initial'?'initial_check':purpose==='periodic'?'periodic_check':purpose==='policy'?'context_update':'market'
  plan=prepareSharedWriter({handoff,writer,claimTypingReview,purpose:writerPurpose,previous})
  const reviewCapacity=plan.status==='prepared_not_called'?preflightRuntimeReview({plan,writer,reviewer,purpose,reviewTransportVersion:COMPACT_REVIEW_VERSION},{capacity:true}):null
  if(plan.status==='request_budget_hold'||reviewCapacity?.reason==='runtime_review_budget_hold'){
   const smaller=withoutOptionalBackground(applySharedClaimTyping(handoff,claimTypingReview))
   if(smaller)plan=prepareSharedWriter({handoff:smaller,writer,purpose:writerPurpose,previous})
  }
  if(plan.status!=='prepared_not_called')return {version:RUNTIME_VERSION,status:'held',reason:'evidence_or_writer_hold',holds:plan.holds??[],cadence,modelCalls:0}
 }
 const task={version:RUNTIME_VERSION,status:'prepared',currency,baseDate:snapshot.baseDate,purpose,reviewTransportVersion:COMPACT_REVIEW_VERSION,reviewCoverageGuideVersion:'coverage-targets/1',
  materialEditions:[...new Map(Object.values(handoff?.materialConnection?.sections??{}).flat()
   .filter(r=>r.originalCapture?.contentIdentity).map(r=>[r.sourceUrl,{url:r.sourceUrl,identity:r.originalCapture.contentIdentity}])).values(),
   ...officialMaterialEditions(Object.values(handoff?.materialConnection?.sections??{}).flat().filter(r=>r.officialStatistic)
    .map(r=>({...r.officialStatistic,value:r.officialStatistic.fact.value,period:r.referencePeriod,scope:r.scope,publishedAt:r.publishedAt})))],
  checkedOnKst:koreaDate(asOf),snapshot,calendar:structuredClone(calendar),cadence,assemblyVersion:RUNTIME_ASSEMBLY_VERSION,
  historyBinding:fingerprint(publications),writer,reviewer,plan,publicationApproved:false,
  ...(writer!=='sol'?{executionProfile:fingerprint(plan.writerProfile)}:{}),
  publicUseProofs:[...new Map(Object.values(handoff?.materialConnection?.sections??{}).flat()
   .filter(r=>r.sourceUseProof&&plan.packet.evidence.some(e=>e.id===r.evidenceId)).map(r=>[r.evidenceId,r.sourceUseProof])).values()],
  publicUseAllowedIds:[...new Set(Object.values(handoff?.materialConnection?.sections??{}).flat()
   .filter(r=>r.sourceUses?.public_display?.status==='allowed'&&plan.packet.evidence.some(e=>e.id===r.evidenceId)).map(r=>r.evidenceId))],
  sourceUseReview:{externalModel:purpose==='periodic'&&periodicInput?'unverified':'pass',publicDisplay:!(purpose==='periodic'&&periodicInput)&&Object.values(handoff.materialConnection.sections).flat()
   .every(item=>item.sourceUses.public_display?.status==='allowed')?'pass':'unverified'},
  // Same open case cannot be retried by changing its prompt, date or model.
  taskKey:fingerprint({version:RUNTIME_VERSION,currency,caseId:cadence.caseId,purpose,
   ...(eventCandidateIds.length?{eventCandidateIds:[...eventCandidateIds].sort()}:{} )}),modelCalls:0}
 task.legacyTaskKey=task.taskKey
 task.inputEdition=inputEdition(task)
 task.taskKey=fingerprint({version:'runtime-request-identity/2',caseTask:task.legacyTaskKey,inputEdition:task.inputEdition})
 return assertRuntimeDocumentCapacity(sealed(task),'task')
}
export function assertRuntimeTask(task,{dataset,asOf,publications}) {
 assertSealed(assertRuntimeDocumentCapacity(task,'task'))
 if(task.inputEdition&&(task.inputEdition!==inputEdition(task)||task.taskKey!==fingerprint({version:'runtime-request-identity/2',caseTask:task.legacyTaskKey,inputEdition:task.inputEdition})))
  throw Error('runtime_input_edition_changed')
 if(task.version!==RUNTIME_VERSION||task.status!=='prepared'||!REPORT_CURRENCIES.includes(task.currency)
  ||task.checkedOnKst!==koreaDate(asOf)||task.historyBinding!==fingerprint(publications)
  ||fingerprint(buildSharedDashboardPriceSnapshot({dataset,currency:task.currency,asOf,calendar:task.calendar}))!==fingerprint(task.snapshot))throw Error('runtime_input_stale_or_revised')
 if(task.purpose==='periodic'&&!task.plan.packet.sharedReference)assertPeriodicPlan(task.plan);else assertSharedWriterPlan(task.plan)
 if(task.writer!==task.plan.writerProfile.selection||task.plan.maximumUsd!==writerReservation(task.plan.body,task.plan.writerProfile))throw Error('runtime_writer_or_reservation_changed')
 if(task.executionProfile&&task.executionProfile!==fingerprint(task.plan.writerProfile))throw Error('runtime_execution_profile_changed')
 return task
}
function compile(task,response) {
 const draft=JSON.parse(response.payload.choices[0].message.content)
 return task.purpose==='periodic'&&!task.plan.packet.sharedReference?composeDraft(task.plan.packet,decodeGenerationOutput(draft,task.plan.outputContract),true)
  :compileSharedWriterOutput({plan:task.plan,draft})
}
const structurallyValid=c=>c?.validation?.valid===true&&c.rules?.automaticStatus==='pass'&&Array.isArray(c.editorial?.blockers)&&!c.editorial.blockers.length
export function preflightRuntimeReview(task,{capacity=false}={}) {
 // Evidence-only lower bound, not a claim about unseen manuscript length.
 // Stop known oversized inputs before spending on the writer. The exact
 // generated review remains bounded separately; never truncate its sources.
 let content={title:'환율 검토 입력 크기 확인',summary:'비용을 지출하지 않는 검토 입력 사전 점검입니다.',change:'',drivers:[],implications:[],watch:[]}
 if(capacity){
  // A size-only envelope from the actual prose schema, not a synthetic market
  // report or a semantic approval. Distinct strings avoid optimistic dictionary
  // savings. Actual completed requests are still checked before dispatch.
  const schema=draftSchemaForPacket(task.plan.packet,true,true,true).properties
  let seed=0
  const fill=n=>{const start=seed++*500;return Array.from({length:n},(_,i)=>String.fromCodePoint(0xac00+(start+i)%11172)).join('')}
  content={title:fill(schema.title.maxLength),summary:fill(schema.summary.maxLength),change:'',drivers:[],implications:[],watch:[]}
  for(const section of ['drivers','implications','watch']){
   const count=task.plan.outputContract.sections[section]?.max??0
   content[section]=Array.from({length:count},()=>({title:fill(70),text:fill(section==='implications'?180:420),kind:'interpretation',evidenceIds:task.plan.packet.evidence.slice(0,4).map(e=>e.id)}))
  }
 }
 try {
  const claimReview=prepareClaimReview(task.plan.packet,content)
  const selected=prepareRuntimeReview(task,{claimReview})
  return {status:capacity?'bounded_manuscript_fits':'minimum_input_fits',inputBound:selected.inputBound,maximumUsd:selected.maximumUsd,
   finalManuscriptSize:'checked_after_writing',modelCalls:0}
 } catch(error) {return {status:'hold',reason:/^[a-z_]+$/.test(error.message??'')?error.message:'review_preflight_failed',modelCalls:0}}
}
export function prepareRuntimeReview(task,compiled) {
 if(task.reviewTransportVersion&&task.reviewTransportVersion!==COMPACT_REVIEW_VERSION)throw Error('runtime_review_transport_unknown')
 const compact=task.reviewTransportVersion===COMPACT_REVIEW_VERSION
 const contract=compact?compactReviewContract(compiled.claimReview):claimReviewContract(compiled.claimReview)
 // Identity belongs to the execution receipt, not the generated prose.
 delete contract.schema.properties.reviewer
 contract.schema.required=contract.schema.required.filter(k=>k!=='reviewer')
 const score={type:'integer',minimum:1,maximum:5}
 const schema={type:'object',additionalProperties:false,required:['review','scores','criticalErrors'],properties:{review:contract.schema,
  scores:{type:'object',additionalProperties:false,required:['cause','change','business','readability','evidence'],
   properties:{cause:score,change:score,business:score,readability:score,evidence:score}},criticalErrors:{type:'integer',minimum:0,maximum:100}}}
 const messages=contract.messages.map(m=>({...m}))
 const input=JSON.parse(messages[1].content)
 if(task.reviewCoverageGuideVersion==='coverage-targets/1'){
  input.eligibleCoverageTargets=Object.fromEntries((compiled.claimReview.writingCoverageRequirements??[]).map(r=>[r.id,
   compiled.claimReview.sharedClaimLinks?.filter(l=>l.materialClaimIds?.some(id=>r.materialClaimIds?.includes(id))).map(l=>l.target)??[]]))
  messages[0].content+='\nwritingCoverage.targets는 해당 항목의 eligibleCoverageTargets에 있는 위치만 고른다. 같은 출처라도 다른 주장 ID만 연결된 위치를 넣지 않는다. 실제로 사용한 위치만 선택하며 빈틈을 메우려고 연결을 만들지 않는다.'
 }
 messages[1].content=JSON.stringify(encodeReviewInput(compact?{...input,anchorTable:contract.transport.anchors}:input))
 messages[0].content+=compact?'\n입력의 review-text-dictionary/1에서 {textRef:tN}은 strings[tN]의 정확한 문자열이다. 키 이름과 모든 문장·근거·조건은 유지한다.\n'+contract.instructions
  :'\n입력의 review-text-dictionary/1에서 input 안 {textRef:tN}은 strings[tN]의 정확한 문자열이다. 참조를 풀어 모든 문장·근거·조건을 대조하고 anchors.quote는 원래 문자열로 반환한다.'
 messages[0].content+='\n'+FX_REPORT_PRIORITY_INSTRUCTIONS+'\n검토자 신원은 서버가 실행 기록으로 붙인다. review에 reviewer 필드를 만들지 않는다.'
 messages[0].content+='\nscores는 원인 설명·변화 전달·영업 관련성·가독성·근거 충실도를 각각 1~5점으로 평가한다. 영업 관련성은 환율 이해의 실무 유용성이며 영업 문단의 양이 아니다. 선택적 영업 문단이 없어도 감점하지 않는다. 필수 오류와 문체 개선을 구분한다. 별도 요청으로 제공된 문장·카드를 대조한다. 검토 요지를 원문 검증으로 표시하지 않는다. 결과는 review, scores, criticalErrors 객체다.'
 if(task.purpose==='periodic')messages[0].content+='\n정기 점검의 cause 점수는 설명의 재확인·보완·미확인이 명료한지를 평가한다. 새 원인이나 영업 문단의 양을 요구하지 않는다.'
 if(task.purpose==='initial')messages[0].content+='\n첫 환율 점검이다. cause 점수는 해당 통화의 움직임과 시장 해설을 이해할 수 있는지 평가한다. 소비·정책 소개만 있으면 미달이다. 없는 전회 비교나 새로운 원인을 발명하도록 요구하지 않는다. shared_initial_baseline을 별도로 검토한다.'
 if(task.purpose==='policy')messages[0].content+='\n설명 업데이트 후보다. 새 사건이 기존 보고서보다 새롭고 독자에게 유용한 설명을 주는지 검토한다. 이후 뉴스를 이전 기준환율 변화의 원인으로 소급하거나 일반 배경을 당일 시장 반응으로 쓰면 필수 교정이다.'
 const selected=applyReviewWriterPolicy({messages,
  response_format:{type:'json_schema',json_schema:{name:'currency_runtime_review',strict:true,schema}}},task.reviewer??task.writer)
 if(selected.status!=='prepared_not_called')throw Error('runtime_review_budget_hold')
 return {...selected,...(compact?{reviewTransport:contract.transport}:{})}
}
export function assessRuntimeReview(compiled,body,identity) {
 const review=identity?{...body.review,reviewer:`${identity.model} @ ${identity.route}`}:body.review
 const verdict=assessClaimReview(compiled.claimReview,review)
 const priority=compiled.fxPriority??(compiled.claimReview.sharedReference?inspectFxPriority(compiled.candidate,compiled.sourceClaimLinks,compiled.claimReview.sources.flatMap(s=>s.sourceContext?.passages?.map(p=>({claimId:p.materialClaimId,role:p.role}))??[])):null)
 const keys=['cause','change','business','readability','evidence']
 const scores=keys.map(k=>body.scores?.[k])
 const validScores=scores.every(n=>Number.isInteger(n)&&n>=1&&n<=5)&&Object.keys(body.scores??{}).length===5
 const average=validScores?scores.reduce((n,v)=>n+v,0)/5:null
 const pass=verdict.status==='reviewed'&&verdict.requiredCorrections?.length===0&&verdict.verificationPending?.length===0
  &&!priority?.holds.length&&validScores&&average>=4&&body.scores.cause>=4&&body.scores.evidence>=4&&body.criticalErrors===0
 return {verdict,validation:{structureValid:structurallyValid(compiled),contentReview:pass?'passed':'unverified',
  fxPriority:priority,reviewerIdentity:identity??null,criticalErrors:Number.isInteger(body.criticalErrors)&&body.criticalErrors>=0?body.criticalErrors:null,
  qualityAverage:average,evidenceScore:validScores?body.scores.evidence:null,publicationApproved:false,reviewOrigin:'agent'}}
}
function candidate(task,compiled,now,writerJobId) {
 return projectPublicReport({...task.plan.packet,id:`${task.currency}-${task.baseDate}-${Date.parse(now)}${fingerprint({task:task.taskKey,writerJobId}).slice(0,8).split('').map(c=>parseInt(c,16)).join('')}`,
  evidence:task.plan.packet.evidence.map(e=>({...e,summary:e.officialStatistic?.publication?e.summary:
   [...new Set([e.summary,e.sourceCredit?.attribution,e.sourceCredit?.transformation].filter(v=>typeof v==='string'&&v.trim()))].join(' ')})),
  schemaVersion:'currency-report/1',status:'draft',publishedAt:null,generationMode:'ai_enhanced',purpose:['periodic','initial'].includes(task.purpose)?'periodic_check':task.purpose==='policy'?'economic_update':'fx_explanation',content:compiled.candidate})
}
// Store and transport are injected. A test transport never opens a connection.
// Concrete CLI uses the existing one-POST stream transport and service RPCs.
export async function runCurrencyRuntime({task,dataset,asOf,publications,env,store,preflight,send,reconcile=async()=>({costUsd:null}),testOnly=false}) {
 const mode=runtimeMode(env)
 if(mode!=='currency')return {status:mode,modelCalls:0,publicationApproved:false}
 if(testOnly&&store.environment!=='local')throw Error('isolated_runtime_fixture_required')
 assertRuntimeTask(task,{dataset,asOf,publications})
 const notes=task.plan.packet.evidence.flatMap(e=>e.sharedNotes?.claims??[])
 const fxHolds=fxMaterialHolds(Object.fromEntries(['market_observation','attributed_fx_explanation'].map(role=>[role,notes.filter(n=>n.role===role)])))
 if(fxHolds.length)return {status:'fx_material_hold',holds:fxHolds,modelCalls:0,publicationApproved:false}
 if(task.sourceUseReview?.externalModel!=='pass')return {status:'source_use_wait',modelCalls:0,publicationApproved:false}
 let calls=0
 const fixtureKey=testOnly?fingerprint({fixture:task.taskKey,id:randomUUID()}):null
 const perform=async(stage,selected,parentId=null)=>{
  const config=await store.control()
  if(!config.enabled||config.writer!==task.writer||stage==='reviewer'&&!config.review_enabled)return {status:'runtime_disabled'}
  const hash=fingerprint(selected.body)
  const baseTaskKey=stage==='writer'?(fixtureKey??task.taskKey):fingerprint({parentId,stage})
  const attempt=await selectRuntimeAttempt({store,taskKey:baseTaskKey,requestHash:hash,
   enabled:!testOnly&&env.FX_REPORT_RETRY_TRANSIENT==='bounded'})
  if(attempt.hold)return {status:attempt.hold}
  const taskKey=attempt.taskKey
  let prior=attempt.prior
  // Preserve a paid pre-upgrade stage for the identical frozen input. A changed
  // price edition does not alias the old job; it still needs normal case/budget gates.
  if(!prior&&!testOnly&&stage==='writer'&&task.legacyTaskKey&&store.job){
   const legacy=await store.job(task.legacyTaskKey)
   if(legacy&&(legacy.request_hash===hash||!legacy.context?.task||inputEdition(legacy.context.task)===task.inputEdition))prior=legacy
  }
  const unsent=prior?.state==='cancelled'&&prior.actual_nano===0&&prior.checkpoint?.phase==='unsent_released_never_dispatched'
  if(prior&&!unsent){
   if(attempt.policyActive&&prior.cost_state==='confirmed'&&prior.actual_nano<=prior.reserved_nano&&!prior.response?.valid)
    return {status:'response_failed_no_automatic_retry'}
   if(prior.request_hash!==hash||prior.cost_state!=='confirmed'||prior.actual_nano>prior.reserved_nano
    ||!['received','finished'].includes(prior.state)||!prior.response?.valid)return {status:'existing_runtime_call_hold'}
   const response={...prior.response,costUsd:prior.actual_nano/1e9,costSource:'confirmed_runtime_ledger'},correct=response.actualModel===selected.body.model||response.actualModel?.startsWith(selected.body.model+'-20')
   if(!correct||!Number.isSafeInteger(prior.actual_nano)||prior.actual_nano<0)return {status:'existing_runtime_call_hold'}
   return {id:prior.id,response,reservedUsd:prior.reserved_nano/1e9,status:'received',reused:true,candidateTaskKey:prior.context?.task?.taskKey??task.taskKey}
  }
  // No provider metadata is required to finalize exact, already paid responses.
  // Current control, input binding, cost and model checks still precede reuse.
  let verified
  try{verified=await preflight(selected.body,selected.profile??selected.writerProfile)}
  catch{return {status:'runtime_endpoint_preflight_wait'}}
  if(verified.model!==selected.body.model||verified.route!==(selected.profile??selected.writerProfile).route||verified.zdr!==true||verified.dataCollection!=='deny')throw Error('runtime_endpoint_required')
  const reservation=await store.reserve({taskKey,currency:task.currency,baseDate:task.baseDate,stage,
   parentId,requestHash:hash,reservedNano:runtimeNano(selected.maximumUsd),revision:config.revision,
   context:assertRuntimeDocumentCapacity({writer:task.writer,model:selected.body.model,provider:selected.body.provider.only[0],ruleVersion:SHARED_REPORT_RULE_VERSION,packet:task.plan.packet,task,request:selected.body,...attempt.retry,...(testOnly?{testOnly:true}:{})},'context')})
  if(!reservation.reserved)return {status:reservation.reason}
  if(runtimeMode(env)!=='currency'||!await store.begin(reservation.id,hash))return {status:'runtime_stopped_before_call'}
  let response,lastId=null
  try {
   calls++
   response=await send({body:selected.body,timeoutMs:120000,retries:0,checkpoint:async s=>{
    if(s.responseId&&s.responseId!==lastId){await store.checkpoint(reservation.id,{responseId:s.responseId,phase:s.phase});lastId=s.responseId}
   }})
   if(response.costUsd===null&&response.responseId)response={...response,...await reconcile({responseId:response.responseId})}
  } catch {response={valid:false,costUsd:null,errors:['transport_or_checkpoint_failure'],generationCalls:1}}
  // Failure here deliberately leaves a durable unknown reservation. No retry.
  await store.receive(reservation.id,safe(response),typeof response.costUsd==='number'?runtimeNano(response.costUsd):null)
  const costKnown=typeof response.costUsd==='number'&&Number.isFinite(response.costUsd)&&response.costUsd>=0
  const correctModel=response.actualModel===selected.body.model||response.actualModel?.startsWith(selected.body.model+'-20')
  const terminal=attempt.policyActive&&terminalRateLimit({state:'received',response})
  const result={id:reservation.id,response,reservedUsd:selected.maximumUsd,status:!costKnown?'cost_unresolved':response.costUsd>selected.maximumUsd?'cost_exceeded':terminal
   ?attempt.retry.retryAttempt===1?'recovery_retry_exhausted':'recovery_retry_wait':!response.valid||!correctModel?'output_hold':'received'}
  return result
 }
 const readiness=preflightRuntimeReview(task)
 if(readiness.status==='hold')return {status:'review_input_preflight_hold',reason:readiness.reason,modelCalls:0,publicationApproved:false}
 const writing=await perform('writer',task.plan)
 if(writing.status!=='received')return {...writing,response:undefined,modelCalls:calls,publicationApproved:false}
 let compiled
 try{compiled=compile(task,writing.response)}catch{await store.finish(writing.id,null,null,null);return {status:'output_hold',modelCalls:calls,publicationApproved:false}}
 if(!structurallyValid(compiled)){await store.finish(writing.id,null,null,null);return {status:'structure_hold',modelCalls:calls,publicationApproved:false}}
 const report={...candidate({...task,taskKey:writing.candidateTaskKey??task.taskKey},compiled,asOf,writing.id),...(testOnly?{testOnly:true}:{})}
 let validation={structureValid:true,contentReview:'unverified',criticalErrors:null,qualityAverage:null,evidenceScore:null,publicationApproved:false}
 let reviewing={status:'review_not_run'},reviewBody=null
 try {
  const selected=prepareRuntimeReview(task,compiled)
  reviewing=await perform('reviewer',selected,writing.id)
  if(reviewing.status==='received') {
   const decoded=JSON.parse(reviewing.response.payload.choices[0].message.content)
   // Reviewer requests also use the existing wire contract.
   const wireBody=decodeGenerationOutput(decoded,selected.outputContract)
   if(!ajv.validate(selected.localSchema,wireBody))throw Error('runtime_review_schema_hold')
   reviewBody=selected.reviewTransport?decodeCompactReview(compiled.claimReview,wireBody,selected.reviewTransport):wireBody
   validation=assessRuntimeReview(compiled,reviewBody,{model:reviewing.response.actualModel,route:selected.profile.route}).validation
  }
 } catch(error) {reviewing={...reviewing,status:'review_output_hold',reason:/^[a-z_]+$/.test(error.message??'')?error.message:'review_validation_failed'}}
 const reviewReceived=reviewing.id&&reviewing.response
 const unknownCost=Boolean(reviewReceived&&reviewing.response.costUsd===null)
 const confirmedUsd=writing.response.costUsd+(reviewReceived&&typeof reviewing.response.costUsd==='number'?reviewing.response.costUsd:0)
 const cost={costUsd:unknownCost?null:confirmedUsd,confirmedUsd,reservedUsd:unknownCost?reviewing.reservedUsd:0,
  writerCostUsd:writing.response.costUsd,reviewCostUsd:reviewReceived?reviewing.response.costUsd:null,
  reviewStatus:reviewing.status,reviewReason:reviewing.reason??null,modelCalls:testOnly?0:calls,...(testOnly?{simulatedModelInvocations:calls}:{}),unknownCost,
  writerModel:writing.response.actualModel??null,reviewModel:reviewing.response?.actualModel??null}
 // Unknown accounting is not a completed manuscript verdict. Keep the exact
 // stored stages available to the existing verified-cost recovery procedure.
 if(unknownCost)return {status:'cost_unresolved',waitingStage:'accounting',modelCalls:calls,cost,publicationApproved:false}
 // A pre-dispatch wait has no failed manuscript verdict. Keep the writer job
 // received so the exact response can be reused when review becomes available.
 if(/^recovery_/.test(reviewing.status)||['runtime_endpoint_preflight_wait','runtime_disabled','runtime_stopped_before_call','execution_time_budget_wait',
  'monthly_budget_hold','operating_batch_budget_hold','batch_budget_hold','batch_stopped_before_dispatch'].includes(reviewing.status))
  return {status:reviewing.status,waitingStage:'reviewer',modelCalls:calls,cost,publicationApproved:false}
 if(reviewing.status!=='received')validation={...validation,contentReview:'unverified'}
 if(testOnly)validation={...validation,synthetic:true,reviewOrigin:'synthetic'}
 let runId
 try{runId=await store.finish(reviewReceived?reviewing.id:writing.id,report,{...validation,review:reviewBody,
  sourceUseReview:publicSourceDelivery({task,report,evaluatedOn:asOf.slice(0,10)})},cost)}
 catch{return {status:'runtime_finalization_wait',waitingStage:'storage',modelCalls:calls,cost,publicationApproved:false}}
 return {status:validation.contentReview==='passed'?'pending_admin_review':'content_review_hold',runId,modelCalls:calls,cost,
  publicationApproved:false,sourceReview:'bound_fact_and_attributed_note_review_not_original_article_verification'}
}
