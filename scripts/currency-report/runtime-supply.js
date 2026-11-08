// Automatic acquisition/review -> the existing writer queue. No credentials,
// network or model calls at import. A successful fetch is never evidence approval.
import {fingerprint} from './research-harness.js'
import {buildSharedDashboardPriceSnapshot,REPORT_CURRENCIES} from './shared-price-contract.js'
import {evaluatePublicationCadence,koreaDate} from './publication-cadence.js'
import {compileResearchSourceCatalog,planResearchSourceSelection,countryNewsCollectionSources} from './research-source-selection.js'
import {collectSelectedResearch,collectionAtReviewCutoff} from './selected-source-collection.js'
import {prepareCountryNewsPool,partitionReviewedNewsBatch} from './country-news-pool.js'
import {prepareRuntimeTask} from './runtime.js'
import {assertStagedRuntimeInput} from './runtime-store.js'
import {validDate} from './core.js'
import {referenceMaterialHolds} from './reference-material-state.js'
import {applySharedClaimTyping} from './shared-claim-typing.js'
import {restrictCachedHandoff} from './material-processing.js'
import {marketCalendarDate} from './market-calendar.js'
import {acquireOfficialBackground} from './runtime-official-supply.js'
import {attachOfficialBackground,reviewOfficialStatistics} from './official-statistic-admission.js'
import {fitsCommentary,validMarketPeriod} from './news-period.js'
import {sourceContinuation} from './research-continuation.js'
import {MAX_RESEARCH_PERIODS_PER_QUESTION} from './research-limits.js'
import {materialRecipe} from './registered-material-adapters.js'
import {LOCAL_SOURCE_REGISTRY} from './local-source-discovery.js'
import {sourceAttemptMinimum,automaticSupplementalRequestLimit} from './source-request-budget.js'

export const RUNTIME_SUPPLY_VERSION='currency-runtime-supply/1'
const marketRoles=['market_observation','attributed_fx_explanation','global_context','countercontext']
const seal=value=>({...value,binding:fingerprint(value)})
const reason=error=>/^[a-z0-9_]+$/.test(error?.message??'')?error.message:'supply_adapter_failed'
const safe=value=>{
 const s=JSON.stringify(value)
 if(Buffer.byteLength(s)>5000000||/sk-or-|bearer\s+\S+|-----BEGIN .*PRIVATE KEY|[?&](?:token|api_?key)=/i.test(s))throw Error('unsafe_supply_payload')
 return value
}

// A search date is a planning target, not proof of an open market or an article's
// event date. Holidays/market timing are checked on returned evidence separately.
export function previousWeekdayTarget(referenceDate) {
 if(!validDate(referenceDate))throw Error('reference_date_required')
 const d=new Date(referenceDate+'T00:00:00Z')
 do{d.setUTCDate(d.getUTCDate()-1)}while([0,6].includes(d.getUTCDay()))
 return {date:d.toISOString().slice(0,10),basis:'previous_weekday_search_target_not_verified_trading_day'}
}
export function emptySupplyCache({snapshot,commentaryTarget,asOf}) {
 const sections=Object.fromEntries(['market_observation','attributed_fx_explanation','global_context','countercontext',
  'consumer_background','policy_background','watch_context'].map(role=>[role,[]]))
 const connection={version:'reference-materials/2',ruleVersion:snapshot.ruleVersion,currency:snapshot.currency,
  referenceSnapshotId:snapshot.snapshotId,referenceDate:snapshot.baseDate,referencePolicyVersion:snapshot.referenceBasis.version,
  commentaryDate:commentaryTarget.date,asOf,sections,archive:[],held:[],excluded:[],sourceUseSummary:[],externalSourceAttributions:[],
  holds:referenceMaterialHolds({sections,held:[],priceHeld:snapshot.numericStatus!=='pass'}),
  contentReview:{status:'pending_independent_shared_context_review',publicationApproved:false},
  sourceCaseDate:snapshot.baseDate,sourceCaseSessionDate:commentaryTarget.date,writingGuide:[],publicationApproved:false}
 return {reportPriceSnapshot:snapshot,materialConnection:seal(connection),publicationApproved:false,request:null}
}
export function runtimeResearchInput({snapshot,asOf,commentaryTarget}) {
 if(!validDate(commentaryTarget?.date)||commentaryTarget.date>marketCalendarDate(asOf,snapshot.currency)||!commentaryTarget.basis
  ||!Number.isFinite(Date.parse(asOf)))throw Error('explicit_commentary_search_target_required')
 const scope={subject:`${snapshot.currency}_market`,metric:'market_context',unit:'qualitative',comparison:'source_reported_session'}
 return {packet:{currency:snapshot.currency,baseDate:asOf.slice(0,10),observedDate:commentaryTarget.date,
  purpose:'fx_explanation',evidence:[],evidenceScopeCards:[]},purpose:'fx_explanation',asOf,priority:'core_first',topics:[],
  requirements:Object.fromEntries(['market','local','global','counter'].map(id=>[id,[{id:'market-session',period:commentaryTarget.date,scope}]]))}
}

export function runtimeResearchDates(snapshot,asOf) {
 const end=marketCalendarDate(asOf,snapshot.currency)
 // Cover the preceding five weekday search targets, including their intervening
 // weekend releases. These are not certified market holidays/trading sessions.
 let start=snapshot.baseDate
 for(let i=0;i<5;i++)start=previousWeekdayTarget(start).date
 // Logical coverage is independent of the bounded physical request budget.
 // Fail explicitly on oversized/stale windows; never silently cut off dates.
 if(!end||end<start||snapshot.baseDate>koreaDate(asOf))throw Error('research_window_invalid')
 if((Date.parse(end)-Date.parse(start))/86400000+1>MAX_RESEARCH_PERIODS_PER_QUESTION)
  throw Error('research_window_capacity_hold')
 const dates=[]
 for(let d=end;d>=start;d=new Date(Date.parse(d+'T00:00:00Z')-86400000).toISOString().slice(0,10))dates.unshift(d)
 return {dates,requestedStart:start,checkedStart:dates[0],end,coverageLimited:false}
}
// A newer quote or global story must not evict the most recent supported local
// explanation. Dates are retained, never combined into a synthetic session.
export function latestReviewedMarketSession({materialInputs=[],currency,asOf,requestedDates=[]}) {
 const sessions=new Map(),end=marketCalendarDate(asOf,currency)
 for(const material of materialInputs)for(const {record} of material.input?.materials??[]){
  if(record.marketPeriod)continue
  const date=record?.sessionDate
  if(!validDate(date)||date>end||!requestedDates.includes(date))continue
  if(!sessions.has(date))sessions.set(date,new Set())
  for(const role of Object.values(record.claimRoles??{}))sessions.get(date).add(role)
 }
 return [...sessions].filter(([,roles])=>roles.has('market_observation')&&roles.has('attributed_fx_explanation'))
  .map(([date])=>date).sort().at(-1)??null
}
// A matched retrospective period is a different explanation target, never a
// fabricated market session. Daily evidence remains preferred when available.
export function latestReviewedMarketPeriod({materialInputs=[],asOf,requestedDates=[],allowed=false}) {
 if(!allowed)return null
 const groups=new Map()
 for(const material of materialInputs)for(const {record} of material.input?.materials??[]){
  const p=record.marketPeriod
  if(!validMarketPeriod(p)||p.end>asOf.slice(0,10)||!requestedDates.includes(p.end)||record.sessionDate!==null)continue
  const unspecifiedBasis=!record.priceBasis||/not_stated|mixed|not_applicable/.test(record.priceBasis)
  if(unspecifiedBasis&&!record.evidenceId)continue
  const key=fingerprint({kind:p.kind,start:p.start,end:p.end,priceBasis:record.priceBasis,
   ...(unspecifiedBasis?{singleEvidence:record.evidenceId}:{})})
  if(!groups.has(key))groups.set(key,{period:p,roles:new Set()})
  for(const role of Object.values(record.claimRoles??{}))groups.get(key).roles.add(role)
 }
 return [...groups.values()].filter(g=>g.roles.has('market_observation')&&g.roles.has('attributed_fx_explanation'))
  .sort((a,b)=>b.period.end.localeCompare(a.period.end)||b.period.start.localeCompare(a.period.start))[0]?.period??null
}
export function latestCollectedCommentaryTarget(collection,fallback,asOf) {
 const dates=collection.originals.filter(o=>o.kind==='article'&&o.metadata?.publishedAt
  &&Date.parse(o.metadata.publishedAt)<=Date.parse(asOf)).map(o=>marketCalendarDate(o.metadata.publishedAt,collection.currency)).filter(Boolean).sort()
 return dates.length?{date:dates.at(-1),basis:'article_publication_day_for_review_not_verified_market_session'}:fallback
}

// Reuse immutable reviewed claims, not an old price or an old model approval.
// Old market-session claims go to the archive; this never relabels their date.
export function recontextualizeSupplyCache({handoff,snapshot,commentaryTarget,asOf}) {
 const c=handoff?.materialConnection,{binding,...body}=c??{}
 if(!c||fingerprint(body)!==binding||c.currency!==snapshot.currency||handoff.reportPriceSnapshot?.snapshotId!==c.referenceSnapshotId)
  throw Error('bound_supply_cache_required')
 const next=structuredClone(c)
 next.referenceSnapshotId=snapshot.snapshotId;next.referenceDate=snapshot.baseDate
 next.commentaryDate=commentaryTarget.date;next.asOf=asOf
 delete next.commentaryPeriod
 if(commentaryTarget.period)next.commentaryPeriod=structuredClone(commentaryTarget.period)
 next.contentReview={status:'pending_independent_shared_context_review',savedSupport:'cached_bound_reviews_not_new_original_verification',publicationApproved:false}
 delete next.preparationReview
 for(const role of marketRoles){
  const keep=[]
  for(const item of next.sections[role]){
   if(!fitsCommentary(item,next)){
    next.archive.push({...item,reason:'different_market_session_not_current_commentary'})
   }else keep.push(item)
  }
  next.sections[role]=keep
 }
 // The archive remains in its immutable prior bundle. Carry references rather
 // than letting old sessions consume the eight-source current writer budget.
 next.cacheProjection={originalConnectionBinding:binding,archivedClaimBindings:next.archive.map(item=>fingerprint(item))}
 next.archive=[]
 for(const item of Object.values(next.sections).flat()){
  if(!validDate(item.referencePeriod?.slice(0,10))&&!/^\d{4}-(?:\d{2}|Q[1-4])$/.test(item.referencePeriod??''))throw Error('cached_period_required')
  if(item.collectedAt>asOf||item.publishedAt>asOf||item.sourceVersion?.bodyAvailableBy>asOf)throw Error('cached_material_after_cutoff')
 }
 // Never delete pre-existing permission/support holds while rebinding a price.
 next.holds=referenceMaterialHolds({sections:next.sections,held:next.held,priorHolds:c.holds,
  priceHeld:snapshot.numericStatus!=='pass'||snapshot.referenceBasis.status!=='pass'})
 next.status=next.holds.length?'materials_connected_with_gaps':'materials_prepared_for_content_review'
 delete next.binding
 next.binding=fingerprint(next)
 return {...structuredClone(handoff),reportPriceSnapshot:structuredClone(snapshot),materialConnection:next,
  request:null,paidCallAuthorized:false,publicationApproved:false}
}

export async function acquireRuntimeResearch({snapshot,asOf,commentaryTarget,sourcePlan,sourceRegister,
 mode='saved',captures=[],fetchImpl=fetch,checkpoint=async()=>{},now=()=>new Date().toISOString(),maxNetworkRequests,
 inegiCaptures=[],pdfCaptures=[],officialDocuments=[],officialTerms,officialInputLoader,researchNeeds}) {
 const input=runtimeResearchInput({snapshot,asOf,commentaryTarget})
 const window=runtimeResearchDates(snapshot,asOf)
 for(const rows of Object.values(input.requirements)){
  const template=rows[0]
  rows.splice(0,rows.length,...[...window.dates].reverse().map((period,i)=>({...template,id:`market-window-${i}`,period})))
 }
 const catalog=compileResearchSourceCatalog(sourcePlan,sourceRegister)
 const selection=planResearchSourceSelection({input,sourcePlan,sourceRegister})
 const sources=countryNewsCollectionSources(selection,catalog)
 if(maxNetworkRequests===undefined&&sources.length)maxNetworkRequests=automaticSupplementalRequestLimit(sources.map(sourceId=>
  sourceAttemptMinimum(materialRecipe(selection.sourceRequests.find(r=>r.sourceId===sourceId),catalog,sourceRegister),
   (LOCAL_SOURCE_REGISTRY[snapshot.currency]??[]).length)),sources.map(id=>Boolean(catalog.sources.find(s=>s.id===id)?.admission)))
 let officialInputs={inegiCaptures,officialDocuments,officialTerms},officialInputState=null
 if(officialInputLoader)try{
  const loaded=await officialInputLoader({currency:snapshot.currency,asOf,mode,fetchImpl,now})
  officialInputs={...officialInputs,...loaded};officialInputState=loaded.inputState??null
 }catch{officialInputState='official_input_acquisition_failed'}
 const officialAsOf=mode==='live'&&Date.parse(now())>Date.parse(asOf)?now():asOf
 const officialBackground=await acquireOfficialBackground({snapshot,asOf:officialAsOf,sourcePlan,sourceRegister,mode,captures,fetchImpl,checkpoint,now,pdfCaptures,...officialInputs})
 officialBackground.inputState=officialInputState
 officialBackground.inputIssues=officialInputs.inputIssues??[]
 officialBackground.cache=officialInputs.officialCache??null
 officialBackground.releaseLookups=officialInputs.releaseLookups??[]
 // Existing admin supply summaries accept source IDs and bounded status codes,
 // not bodies. Expose current lookup/cache failure without leaking raw proof.
 for(const state of officialBackground.states)for(const source of [...(state.sourceStates??[])]){
  if(!officialBackground.registeredSourceIds.includes(source.sourceId))continue
  for(const status of [officialInputState,...officialBackground.inputIssues,officialBackground.cache?.status&&`official_cache_${officialBackground.cache.status}`]
   .filter(s=>typeof s==='string'&&/^[a-z_]{1,100}$/.test(s)).slice(0,5)){
   if(!state.sourceStates.some(s=>s.sourceId===source.sourceId&&s.status===status))state.sourceStates.push({sourceId:source.sourceId,status})
  }
 }
 officialBackground.networkCalls+=officialInputs.inputNetworkCalls??0
 if(!sources.length)return {collection:null,reason:'no_enabled_country_news_route',sources:[],networkCalls:officialBackground.networkCalls,officialBackground}
 const collection=await collectSelectedResearch({input,sourcePlan,sourceRegister,
  requestIds:selection.sourceRequests.filter(r=>sources.includes(r.sourceId)).map(r=>r.requestId),
  mode,captures,fetchImpl,maxNetworkRequests,fairSourceBudgets:true,checkpoint,now,discoveryFeedback:researchNeeds})
 return {collection,sources,networkCalls:collection.networkCalls+officialBackground.networkCalls,officialBackground,completedAt:now(),researchWindow:window,
  researchFeedback:researchNeeds??null,
  commentaryTarget:latestCollectedCommentaryTarget(collection,commentaryTarget,now())}
}

// The review callback must run the existing original-bound review contracts and
// return receipts + material inputs. Missing access/use/reviewer => hold, never
// user-assigned manual selection. Cached judgments retain their original scope.
export async function supplyRuntimeInput({dataset,currency,asOf,calendar,commentaryTarget,publications=[],
 handoff,claimTypingReview,sourcePlan,sourceRegister,acquire,review,store,writer='sol',periodicInput,
 eventCandidateIds=[],correctionReportIds=[],previousChecks=[],openCase=null,connect=prepareCountryNewsPool,processingRules}) {
 if(!REPORT_CURRENCIES.includes(currency))throw Error('registered_supply_currency_required')
 const snapshot=buildSharedDashboardPriceSnapshot({dataset,currency,asOf,calendar})
 const cadence=evaluatePublicationCadence({snapshot,asOf,publications,calendar,eventCandidateIds,correctionReportIds,previousChecks,openCase})
 const log=[],result={version:RUNTIME_SUPPLY_VERSION,currency,baseDate:snapshot.baseDate,referenceSnapshotId:snapshot.snapshotId,
  commentaryTarget,asOf,cadence,status:'held',holds:[],networkCalls:0,modelCalls:0,newPaidCostUsd:0,
  manualUserTasks:[],publicationApproved:false,staged:false}
 const finish=async()=>{
  result.stages=log
  result.researchAssessment={newsAbsenceEstablished:false,writingEligible:result.staged,
   issues:[...(result.collectionIssues??[]),...(result.sourceReviewIssues??[])].map(i=>({sourceId:i.sourceId,
    status:i.status,reason:i.reason??null,holds:i.holds??[],category:sourceContinuation(i).category})),
   meaning:'Collection coverage, review validity and missing explanation are separate; none proves no news exists.'}
  if(store?.check)await store.check({key:fingerprint({version:RUNTIME_SUPPLY_VERSION,currency,asOf,status:result.status,holds:result.holds}),currency,
   checkedAt:asOf,result:{status:result.status,baseDate:result.baseDate,dataStatus:result.staged?'reference_bound':'supply_held',qualityStatus:'unverified'}})
  return safe(seal(result))
 }
 if(cadence.status!=='research_candidate'||cadence.dataHolds.length||cadence.comparisonHolds.length){
  result.status='cadence_hold';result.holds=[cadence.status,...cadence.dataHolds,...cadence.comparisonHolds];return finish()
 }
 handoff=handoff??emptySupplyCache({snapshot,commentaryTarget,asOf})
 let current
 try{current=recontextualizeSupplyCache({handoff:applySharedClaimTyping(handoff,claimTypingReview),snapshot,commentaryTarget,asOf})}
 catch(error){result.status='cache_validation_hold';result.holds=[reason(error)];return finish()}
 if(processingRules)current=restrictCachedHandoff(current,processingRules,asOf.slice(0,10))
 // Existing exact cache is an optimization; acquisition is still attempted so
 // revisions and source exclusions can invalidate it before writing.
 const batches=[];let officialAdmission=null
 if(acquire){
  try{
   const acquired=await acquire({snapshot,asOf,commentaryTarget,sourcePlan,sourceRegister})
   result.networkCalls+=acquired.networkCalls??0
   officialAdmission=acquired.officialBackground?.admission??null
   // A live fetch finishes after planning began. Move only the analysis cutoff,
   // never publication/event/price timestamps, to the completed acquisition.
   if(acquired.completedAt){
    if(!Number.isFinite(Date.parse(acquired.completedAt))||Date.parse(acquired.completedAt)<Date.parse(asOf))throw Error('invalid_acquisition_completion_time')
    asOf=acquired.completedAt;result.asOf=asOf
    current=recontextualizeSupplyCache({handoff:current,snapshot,commentaryTarget,asOf})
   }
   log.push({stage:'collection',status:acquired.collection?'returned':'unavailable',sources:acquired.sources??[],reason:acquired.reason??null})
   if(acquired.collection){
    const reviewCollection=collectionAtReviewCutoff({collection:acquired.collection,asOf})
    result.collectionIssues=[...new Map((reviewCollection.outcomes??[]).flatMap(o=>[
     ...(!['collected_pending_review'].includes(o.status)?[{sourceId:o.sourceId,status:o.status,reason:o.reason??null}]:[]),
     ...(o.issues??[]).map(i=>({sourceId:o.sourceId,status:i.status,reason:i.reason??null}))]).map(i=>[JSON.stringify(i),i])).values()]
    let reviewed={receipts:[],newsResponses:[],materialInputs:[],modelCalls:0,newPaidCostUsd:0,status:'automatic_review_unavailable'}
    if(review)reviewed=await review({collection:reviewCollection,asOf})
    if(!(reviewed.modelCalls===null&&reviewed.newPaidCostUsd===null)&&(!Number.isInteger(reviewed.modelCalls)||reviewed.modelCalls<0)||reviewed.newPaidCostUsd!==null
     &&(!Number.isFinite(reviewed.newPaidCostUsd)||reviewed.newPaidCostUsd<0))throw Error('source_review_cost_receipt_required')
    result.modelCalls=reviewed.modelCalls===null?null:result.modelCalls+reviewed.modelCalls
    result.newPaidCostUsd=reviewed.newPaidCostUsd===null?null:result.newPaidCostUsd===null?null:result.newPaidCostUsd+reviewed.newPaidCostUsd
    result.sourceReviewIssues=(reviewed.items??[]).map(i=>({sourceId:reviewCollection.reviewQueue.find(c=>c.binding===i.cardBinding)?.sourceId??null,
     status:i.status,reason:i.reason??null,continuation:i.continuation??null,
     holds:[...new Set([...(i.holds??[]),...(i.reason?[i.reason]:[])])]}))
    log.push({stage:'source_review',status:reviewed.status??'returned',modelCalls:reviewed.modelCalls,costUsd:reviewed.newPaidCostUsd})
    const reviewedSession=latestReviewedMarketSession({materialInputs:reviewed.materialInputs,currency,asOf,
     requestedDates:[...new Set(reviewCollection.reviewQueue.flatMap(c=>c.targets.map(t=>t.requestedPeriod)))]})
    if(reviewedSession){
     commentaryTarget={date:reviewedSession,basis:'separately_reviewed_article_event_date_not_dashboard_session'}
     result.commentaryTarget=commentaryTarget
     current=recontextualizeSupplyCache({handoff:current,snapshot,commentaryTarget,asOf})
    }else{
     const period=latestReviewedMarketPeriod({materialInputs:reviewed.materialInputs,asOf,
      requestedDates:[...new Set(reviewCollection.reviewQueue.flatMap(c=>c.targets.map(t=>t.requestedPeriod)))],
      allowed:cadence.triggers.some(t=>['bootstrap','periodic','cumulative'].includes(t))})
     if(period){commentaryTarget={date:period.end,period,basis:'reviewed_period_end_not_market_session'}
      result.commentaryTarget=commentaryTarget
      current=recontextualizeSupplyCache({handoff:current,snapshot,commentaryTarget,asOf})}
    }
    batches.push(...partitionReviewedNewsBatch({collection:reviewCollection,receipts:reviewed.receipts??[],newsResponses:reviewed.newsResponses??[],materialInputs:reviewed.materialInputs??[]}))
    if(reviewed.newPaidCostUsd===null){result.status='source_cost_unresolved';result.holds=['retain_reservation_no_writer_call'];return finish()}
   }
  }catch(error){result.status='collection_or_review_hold';result.holds=[reason(error)];return finish()}
 }
 // This also rechecks the complete current outlet catalog, duplicate original
 // editions, original hashes, review roles and note-use constraints.
 if(officialAdmission){
  try{current=attachOfficialBackground(current,officialAdmission);result.officialBackground=current.materialConnection.officialBackground}
  catch{
   current=attachOfficialBackground(current,reviewOfficialStatistics({currency,asOf}))
   result.officialBackground={status:'official_admission_binding_hold',admitted:0,publicationApproved:false}
  }
 }
 let pool
 try{pool=connect({handoff:current,sourcePlan,sourceRegister,batches,asOf})}
 catch(error){result.status='material_connection_hold';result.holds=[reason(error)];return finish()}
 current=pool.handoff
 // Newly projected statistics and newly connected notes obey current source
 // restrictions too; the earlier cache check alone cannot cover new rows.
 if(processingRules)current=restrictCachedHandoff(current,processingRules,asOf.slice(0,10))
 result.sources=pool.summary.sources.map(s=>({sourceId:s.sourceId,collectionState:s.collectionState,
  acceptedEvidenceIds:s.acceptedEvidenceIds,pendingArticles:s.articles.filter(a=>a.status==='pending_content_review').length}))
 result.pendingArticles=pool.summary.pendingArticles
 result.cachedClaimsReused=Object.values(current.materialConnection.sections).flat().length
 let task
 try{task=prepareRuntimeTask({dataset,currency,asOf,calendar,publications,handoff:current,writer,periodicInput,
  eventCandidateIds,correctionReportIds,previousChecks,openCase})}
 catch(error){result.status='writer_preparation_hold';result.holds=[reason(error)];return finish()}
 if(task.status!=='prepared'){
  const issues=result.sourceReviewIssues??[]
  // An unusable outlet does not suppress a prepared alternative. Individual
  // holds remain visible; this status describes the next viable action.
  result.status=issues.some(i=>i.status==='source_review_budget_required')?'source_review_wait'
   :issues.some(i=>i.status==='source_request_budget_hold')?'source_request_budget_wait'
   :issues.some(i=>['original_use_or_input_hold','processing_restricted'].includes(i.status))?'source_use_wait'
    :issues.some(i=>['analysis_context_hold','source_metadata_hold'].includes(i.status))?'analysis_context_wait':'writing_input_hold'
  result.holds=[...new Set([task.reason,...(task.holds??[]),...current.materialConnection.holds,
   ...(result.sourceReviewIssues??[]).flatMap(i=>i.holds)])];return finish()
 }
 assertStagedRuntimeInput(task)
 if(!store?.stage)throw Error('durable_runtime_input_store_required')
 const registered=store.input?await store.input(currency,task.snapshot.snapshotId):null
 if(registered&&registered.binding===task.binding){
  assertStagedRuntimeInput(registered)
  result.inputId=null;result.registrationReused=true
 }else result.inputId=await store.stage(task)
 result.status='input_staged';result.staged=true
 result.requestHash=task.plan.requestHash;result.writerMaximumUsd=task.plan.maximumUsd
 result.sourceBinding=fingerprint({snapshot:task.snapshot.snapshotId,material:current.materialConnection.binding,batches:batches.map(b=>fingerprint(b.collection))})
 log.push({stage:'registration',status:'private_exact_snapshot_input_staged'})
 return {...await finish(),task}
}
