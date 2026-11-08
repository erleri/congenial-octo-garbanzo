import {rankNewsCandidates,newsCandidateComparator,dateHint,explanationHint} from './news-selection-policy.js'
// Explicit source-selection -> bounded collection -> private review queue.
// No writer, env keys, DB, report overwrite, implicit retries or approval.
import {createHash} from 'node:crypto'
import {planResearchSourceSelection,compileResearchSourceCatalog} from './research-source-selection.js'
import {fingerprint} from './research-harness.js'
import {readPublicText,collectOriginal,marketCalendarDate,publicationMetadata} from './public-research-adapter.js'
import {CHILE_MONTHLY_SOURCES,discoverMonthlyPdfs,readMonthlyPdf,monthlyPdfUrl} from './chile-monthly-originals.js'
import {collectPublisherResearch} from './publisher-research.js'
import {SCOPE_CRITERIA} from './evidence-scope.js'
import {materialRecipe,savedMaterialUrlMatches,parseRegisteredStatistic,discoverRegisteredNews,discoverRegisteredSitemap} from './registered-material-adapters.js'
import {INEGI_REPORT_INDICATORS,inegiScopeMatches,inegiStatistic,verifyInegiReportSeries} from './inegi-report-indicators.js'
import {inspectRobots,publisherAccessBarrier} from './news-publisher-access.js'
import {validDate} from './core.js'
import {LOCAL_SOURCE_REGISTRY} from './local-source-discovery.js'
import {MAX_RESEARCH_PERIODS_PER_QUESTION} from './research-limits.js'

export const SELECTED_COLLECTION_VERSION='selected-source-collection/1'
const MAX_SELECTED_LOGICAL_REQUESTS=30*MAX_RESEARCH_PERIODS_PER_QUESTION*4 // routes × periods × core questions; not HTTP allowance
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const stamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))
  &&new Date(v.slice(0,10)).toISOString().slice(0,10)===v.slice(0,10)
const bounded=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max
const safeUrl=value=>{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash
  ||[...u.searchParams.keys()].some(k=>/^(?:token|api[_-]?key|key|password|secret|auth|authorization)$/i.test(k)))throw new Error('unsafe_capture_url');return u.href}

function validateCapture(capture) {
  if(!capture||typeof capture.sourceId!=='string'||!stamp(capture.collectedAt)||typeof capture.text!=='string'
    ||Buffer.byteLength(capture.text)>2_000_000||!Number.isInteger(capture.httpStatus)||capture.httpStatus<100||capture.httpStatus>599
    ||hash(capture.text)!==capture.sha256)throw new Error('invalid_saved_material')
  safeUrl(capture.url)
}
const actualPeriod=row=>row.period??row.date
const matchesPeriod=(row,period)=>period.length===7?actualPeriod(row)?.startsWith(period):actualPeriod(row)===period

// A new analysis can reuse exact captures without pretending it ran before
// they were collected. Publication, event and capture timestamps stay intact.
// The old analysis cutoff is preserved as provenance, not silently overwritten.
export function collectionAtReviewCutoff({collection,asOf}) {
 if(collection?.version!==SELECTED_COLLECTION_VERSION||!stamp(asOf)||!stamp(collection.asOf)
  ||Date.parse(asOf)<Date.parse(collection.asOf)||!Array.isArray(collection.originals)
  ||collection.originals.some(o=>!stamp(o.collectedAt)||Date.parse(o.collectedAt)>Date.parse(asOf)))
  throw Error('source_review_cutoff_before_available_capture')
 const next=structuredClone(collection)
 next.asOf=asOf
 next.reviewCutoff={originalAnalysisAt:collection.reviewCutoff?.originalAnalysisAt??collection.asOf,
  currentAnalysisAt:asOf,captureTimesUnchanged:true}
 return next
}

// Shared binding for collected records and exact saved-capture replay. This
// queues a pending review only; it does not verify meaning or source rights.
export function bindSelectedOriginalReview({request,record,adapter,requestIds,targets,currency,asOf}) {
 const id=fingerprint({sourceId:request.sourceId,url:record.url,sha256:record.sha256,period:request.period})
 const original={id,sourceId:request.sourceId,requestIds,...record,originalVerified:false,publicationApproved:false}
 const card={id:`review-${id.slice(0,20)}`,originalId:id,sourceId:request.sourceId,currency,url:record.url,
  sha256:record.sha256,collectedAt:record.collectedAt,materialKind:record.kind,targets,
  actualPeriods:[...new Set((record.observations??[]).map(actualPeriod))],metadata:record.metadata??{publishedAt:record.publishedAt??null},
  requestedPeriodMatch:record.kind==='article'?record.metadata?.publishedAt
   ?marketCalendarDate(record.metadata.publishedAt,currency)===request.period?'same_publication_day':'different_publication_day'
   :'publication_unverified':record.observations?record.observations.some(row=>matchesPeriod(row,request.period))?'observed_period_present':'requested_period_missing'
   :'pdf_body_period_unverified',
  reviewAdapter:adapter,publicationStatus:record.metadata?.publishedAt||record.publishedAt?'publisher_metadata_pending_review':'unverified',
  historicalVersionStatus:Date.parse(record.collectedAt)>Date.parse(asOf)?'collected_after_report_cutoff':'version_pending_review',
  requiredChecks:[...Object.keys(SCOPE_CRITERIA),'source_use','revision','price_basis_and_attribution'],
  status:'pending',sourceUseStatus:'not_assessed',writingEligible:false,publicationApproved:false}
 const bound={...card,originalHash:fingerprint(original)}
 return {original,review:{...bound,binding:fingerprint(bound),decision:null,reviewer:null,notes:[],supportingReferences:[]}}
}

export async function collectSelectedResearch({input,sourcePlan,sourceRegister,requestIds,articleUrls=[],captures=[],pdfCaptures=[],inegiCaptures=[],mode='saved',fetchImpl,
  maxNetworkRequests=8,fairSourceBudgets=false,timeoutMs=15000,now=()=>new Date().toISOString(),checkpoint=async()=>{},discoveryFeedback}) {
  if(!['saved','live'].includes(mode)||mode==='live'&&typeof fetchImpl!=='function'||!bounded(maxNetworkRequests,1,16)
    ||typeof fairSourceBudgets!=='boolean'||!bounded(timeoutMs,1,20000)||!Array.isArray(captures)||captures.length>32||!Array.isArray(pdfCaptures)||pdfCaptures.length>8)throw new Error('invalid_selected_collection_options')
  captures.forEach(validateCapture)
  if(!Array.isArray(inegiCaptures)||inegiCaptures.length>3||new Set(inegiCaptures.map(c=>c.seriesId)).size!==inegiCaptures.length)
    throw new Error('invalid_inegi_captures')
  for(const capture of inegiCaptures) {
    verifyInegiReportSeries(capture)
    if(!stamp(capture.checkedAt)||Date.parse(capture.checkedAt)>Date.parse(now()))throw new Error('invalid_inegi_capture_clock')
  }
  for(const pdf of pdfCaptures) {
    const raw=Buffer.from(pdf.rawBase64??'','base64')
    if(!['cl-retail','cl-pay'].includes(pdf.sourceId)||!stamp(pdf.collectedAt)||raw.length>2_000_000||raw.length!==pdf.bytes
      ||hash(raw)!==pdf.sha256||!raw.subarray(0,5).equals(Buffer.from('%PDF-'))||!raw.subarray(-2048).includes(Buffer.from('%%EOF')))
      throw new Error('invalid_saved_pdf')
    monthlyPdfUrl(pdf.url,pdf.sourceId)
  }
  const before=fingerprint({input,sourcePlan,sourceRegister,captures,pdfCaptures,articleUrls}),startedAt=now()
  if(!stamp(startedAt))throw new Error('invalid_collection_clock')
  if([...captures,...pdfCaptures].some(c=>Date.parse(c.collectedAt)>Date.parse(startedAt)))throw new Error('future_saved_capture')
  const selection=planResearchSourceSelection({input,sourcePlan,sourceRegister}),catalog=compileResearchSourceCatalog(sourcePlan,sourceRegister)
  // Research dates multiply logical question routes, not network calls.
  // Keep transport/capture budgets unchanged and deduplicate physical articles.
  if(!Array.isArray(requestIds)||!requestIds.length||requestIds.length>MAX_SELECTED_LOGICAL_REQUESTS||new Set(requestIds).size!==requestIds.length
    ||requestIds.some(id=>!selection.sourceRequests.some(r=>r.requestId===id)))throw new Error('explicit_selected_requests_required')
  const chosen=selection.sourceRequests.filter(r=>requestIds.includes(r.requestId)),outcomes=[],originals=[],reviewQueue=[],receipts=[],cache=new Map(),publisherCache=new Map(),transportCache=new Map(),network=[]
  const sourceIds=[...new Set(chosen.map(r=>r.sourceId))]
  const weights=sourceIds.map(sourceId=>materialRecipe(chosen.find(r=>r.sourceId===sourceId),catalog,sourceRegister).kind==='existing_chile_publisher'
    ?Math.max(1,(LOCAL_SOURCE_REGISTRY[selection.currency]??[]).length):1)
  const totalWeight=weights.reduce((sum,n)=>sum+n,0),limits=weights.map(n=>Math.floor(maxNetworkRequests*n/totalWeight))
  for(let n=maxNetworkRequests-limits.reduce((sum,n)=>sum+n,0),i=0;n>0;n--,i++)limits[i%limits.length]++
  const sourceLimits=new Map(sourceIds.map((id,index)=>[id,fairSourceBudgets?limits[index]:maxNetworkRequests]))
  let activeSource=null
  const sourceSpent=id=>network.filter(r=>r.sourceId===id).length
  if(!Array.isArray(articleUrls)||articleUrls.length>8||new Set(articleUrls.map(a=>a.sourceId)).size!==articleUrls.length)
    throw new Error('invalid_explicit_article_urls')
  for(const a of articleUrls){
    const request=chosen.find(r=>r.sourceId===a.sourceId),recipe=request&&materialRecipe(request,catalog,sourceRegister)
    const url=new URL(safeUrl(a.url))
    if(recipe?.kind!=='news_listing'||url.hostname!==new URL(recipe.url).hostname||url.search
      ||recipe.access&&!recipe.access.path.test(url.pathname)
      ||!recipe.access&&!url.pathname.startsWith(new URL(recipe.url).pathname.replace(/\/?$/,'/'))
      ||url.pathname===new URL(recipe.url).pathname)
      throw new Error('explicit_article_source_or_path_mismatch')
  }
  const checkedFetch=async(url,options)=>{
    if(mode!=='live')throw new Error('saved_mode_network_forbidden')
    const key=safeUrl(String(url)),prior=transportCache.get(key)
    if(prior?.error)throw prior.error
    if(prior?.response)return prior.response.clone()
    if(network.length>=maxNetworkRequests)throw new Error('local_request_limit')
    if(fairSourceBudgets&&sourceSpent(activeSource)>=sourceLimits.get(activeSource))throw new Error('local_source_request_limit')
    const row={url:safeUrl(String(url)),status:'started',...(fairSourceBudgets?{sourceId:activeSource}:{})};network.push(row)
    try {
      const response=await fetchImpl(url,options)
      if(response.redirected||response.url&&response.url!==String(url))throw new Error('redirect_not_allowed')
      row.status=`http_${response.status}`;transportCache.set(key,{response:response.clone()});return response
    }catch{row.status='transport_failed';const error=new Error('selected_transport_failed');transportCache.set(key,{error});throw error}
  }
  async function read(sourceId,url,recipe,period) {
    if(cache.has(url))return cache.get(url)
    const saved=captures.filter(c=>c.sourceId===sourceId&&savedMaterialUrlMatches(c.url,recipe,period))
    // Do not silently choose between revisions of an existing capture.
    const remember=result=>{cache.set(url,result);return result}
    if(new Set(saved.map(c=>c.sha256)).size>1)return remember({status:'revision_conflict',reason:'explicit_capture_version_required'})
    if(saved.length) {
      const c=saved[0],r=c.httpStatus>=200&&c.httpStatus<300?{status:'ok',text:c.text,fetchedAt:c.collectedAt,
        sha256:c.sha256,url:c.url,captureMode:'saved_response'}:{status:'failed',reason:`http_${c.httpStatus}`,captureMode:'saved_response'}
      cache.set(url,r);return r
    }
    if(mode==='saved')return remember({status:'not_attempted',reason:'saved_capture_missing'})
    if(network.length>=maxNetworkRequests)return remember({status:'not_attempted',reason:'request_budget'})
    if(fairSourceBudgets&&sourceSpent(sourceId)>=sourceLimits.get(sourceId))return remember({status:'not_attempted',reason:'source_request_budget'})
    const result=await readPublicText(url,{fetchImpl:checkedFetch,timeoutMs})
    if(result.status!=='ok')return remember(result)
    const c={sourceId,url,collectedAt:now(),httpStatus:Number(network.findLast(r=>r.url===url).status.slice(5)),text:result.text,sha256:hash(result.text)}
    validateCapture(c);receipts.push(c);await checkpoint('capture',c)
    const r={...result,url,sha256:c.sha256,fetchedAt:c.collectedAt,captureMode:'public_get'};cache.set(url,r);return r
  }
  function addOriginal(request,record,adapter) {
    const same=record.kind==='article'&&originals.find(o=>o.sourceId===request.sourceId&&o.url===record.url&&o.sha256===record.sha256&&o.kind===record.kind)
    if(same)return same.id
    const id=fingerprint({sourceId:request.sourceId,url:record.url,sha256:record.sha256,period:request.period})
    if(originals.some(o=>o.id===id))return id
    const requestIds=chosen.filter(r=>r.sourceId===request.sourceId&&(record.kind==='article'||r.period===request.period)).map(r=>r.requestId)
    const targets=selection.questions.flatMap(q=>q.targets.filter(t=>t.sources.some(s=>requestIds.includes(s.requestId))
      &&(!record.scope||inegiScopeMatches(t.scope,{scope:record.scope})))
      .map(t=>({needId:q.needId,requirementId:t.requirementId,requestedScope:t.scope,requestedPeriod:t.period})))
    const {original,review}=bindSelectedOriginalReview({request,record,adapter,requestIds,targets,currency:selection.currency,asOf:selection.asOf})
    originals.push(original)
    reviewQueue.push(review);return id
  }
  for(const request of chosen) {
    activeSource=request.sourceId
    let recipe=materialRecipe(request,catalog,sourceRegister)
    const row={requestId:request.requestId,sourceId:request.sourceId,
      needIds:request.needIds,period:request.period,adapter:recipe.kind,status:'not_attempted',reason:null,originalIds:[],absenceVerified:false}
    outcomes.push(row)
    // Defensive guard: excluded sources are normally removed by the planner.
    if(recipe.kind==='excluded')throw new Error('excluded_source_not_collectable')
    if(request.sourceId==='mxn-consumer'&&inegiCaptures.length) {
      row.adapter='inegi_report_projection';row.issues=[]
      const targets=selection.questions.flatMap(q=>q.targets.filter(t=>t.sources.some(s=>s.requestId===request.requestId)))
      const definitions=INEGI_REPORT_INDICATORS.filter(d=>targets.some(t=>inegiScopeMatches(t.scope,d)))
      if(!definitions.length){row.status='configuration_required';row.reason='exact_inegi_scope_required';continue}
      if(targets.some(t=>!definitions.some(d=>inegiScopeMatches(t.scope,d))))row.issues.push('unsupported_requested_scope')
      for(const definition of definitions) {
        const capture=inegiCaptures.find(c=>c.seriesId===definition.indicatorId)
        if(!capture){row.issues.push('saved_indicator_capture_missing');continue}
        const checked=verifyInegiReportSeries(capture)
        if(checked.status!=='ok'){row.issues.push(checked.status);continue}
        const scopes=[...new Map(targets.filter(t=>inegiScopeMatches(t.scope,definition)).map(t=>[fingerprint(t.scope),t.scope])).values()]
        for(const scope of scopes) {
          const statistic=inegiStatistic(checked,scope),matching=statistic.observations.filter(o=>matchesPeriod(o,request.period))
          row.originalIds.push(addOriginal(request,{...statistic,requestedPeriod:request.period},'statistic_scope_and_source_use'))
          if(!matching.length)row.issues.push('requested_period_not_in_observations')
          else if(!matching.some(o=>o.value!==null))row.issues.push('null_not_zero')
        }
      }
      row.status=row.originalIds.length?row.issues.length?'partial_pending_review':'collected_pending_review'
        :row.issues.every(i=>i==='saved_indicator_capture_missing')?'not_attempted'
        :row.issues.includes('missing_or_invalid_credentials')?'configuration_required'
        :row.issues.some(i=>['definition_mismatch','schema_changed','invalid_json'].includes(i))?'extraction_failed'
        :row.issues.includes('values_missing')?'values_missing':row.issues.includes('empty_result')?'empty_result':'access_failed'
      if(row.originalIds.length&&row.issues.length&&row.issues.every(i=>i==='requested_period_not_in_observations'))row.status='period_mismatch'
      if(row.originalIds.length&&row.issues.length&&row.issues.every(i=>i==='null_not_zero'))row.status='values_missing'
      row.reason=row.issues[0]??null;continue
    }
    if(recipe.kind==='unconfigured'){row.status='configuration_required';row.reason=recipe.reason;continue}
    let robots
    if(recipe.access){
      robots=await read(request.sourceId,recipe.access.robotsUrl,{kind:'robots',url:recipe.access.robotsUrl},request.period)
      if(robots.status!=='ok'){
        row.status=robots.status==='not_attempted'?'not_attempted':'access_failed';row.reason='robots_unavailable';continue
      }
      let policy
      try{policy=inspectRobots(robots.text,articleUrls.find(a=>a.sourceId===request.sourceId)?.url??recipe.url)}catch{row.status='access_failed';row.reason='robots_invalid';continue}
      row.access={version:recipe.access.version,robotsSha256:robots.sha256,checkedAt:robots.fetchedAt,
        localAcquisitionOnly:true,externalModelUse:'pending',publicDisplayUse:'pending'}
      if(!policy.allowed||policy.crawlDelaySeconds>0){row.status='access_failed';row.reason=!policy.allowed?'robots_disallowed':'publisher_delay_requires_scheduler';continue}
    }
    if(recipe.kind==='chile_monthly') {
      const existing=pdfCaptures.filter(pdf=>pdf.sourceId===recipe.sourceId&&pdf.period===request.period)
      if(new Set(existing.map(p=>p.sha256)).size>1){row.status='revision_conflict';row.reason='explicit_capture_version_required';continue}
      if(existing.length) {
        const pdf=existing[0]
        row.originalIds.push(addOriginal(request,{...pdf,kind:'official_pdf',captureMode:'saved_response'},'chile_monthly_evidence'))
        row.status='collected_pending_review';continue
      }
    }
    if(recipe.kind==='existing_chile_publisher') {
      const key=`${request.sourceId}:${request.period}`
      if(!publisherCache.has(key)){
        const captured=[]
        const result=await collectPublisherResearch({packet:input.packet,mode,searchDate:validDate(request.period)?request.period:undefined,
          savedCaptures:captures.filter(c=>c.sourceId===request.sourceId),fetchImpl:async(url,options)=>{
          const saved=captures.filter(c=>c.sourceId===request.sourceId&&c.url===String(url))
          if(new Set(saved.map(c=>c.sha256)).size>1)throw new Error('explicit_capture_version_required')
          if(saved.length)return new Response(saved[0].text,{status:saved[0].httpStatus})
          return checkedFetch(url,options)
        },checkpoint:async(kind,value)=>{
          if(kind==='capture'&&value.kind==='article'&&typeof value.text==='string')captured.push(value)
        }})
        publisherCache.set(key,{captured,result})
      }
      const {captured,result}=publisherCache.get(key)
      row.publisherAttempts=result.discovery.sourceResults.map(s=>({sourceId:s.source,
        status:s.status,reason:s.reason??null}))
      for(const record of result.originals.filter(o=>o.status==='collected_pending_review')) {
        const raw=captured.find(c=>c.url===record.url)
        if(!raw)continue
        const prior=captures.find(c=>c.sourceId===request.sourceId&&c.url===record.url&&c.sha256===hash(raw.text))
        const receipt={sourceId:request.sourceId,url:record.url,text:raw.text,collectedAt:prior?.collectedAt??raw.capturedAt,httpStatus:200,sha256:hash(raw.text)}
        validateCapture(receipt)
        if(!receipts.some(r=>r.sourceId===receipt.sourceId&&r.url===receipt.url&&r.sha256===receipt.sha256)){
          receipts.push(receipt);await checkpoint('capture',receipt)
        }
        row.originalIds.push(addOriginal(request,{...record,kind:'article',sha256:receipt.sha256,collectedAt:receipt.collectedAt},'reviewed_news_notes'))
      }
      row.status=row.originalIds.length?'collected_pending_review':result.status==='collection_failed'?'access_failed':'discovery_incomplete'
      row.reason=result.status;continue
    }
    const explicitArticle=articleUrls.find(a=>a.sourceId===request.sourceId)
    let readResult=explicitArticle?{status:'ok',explicitArticle:true}:await read(request.sourceId,recipe.url,recipe,request.period)
    // One registered official alternative, not a retry or arbitrary URL. A
    // revision conflict must be resolved explicitly rather than bypassed.
    if(!['ok','revision_conflict'].includes(readResult.status)&&recipe.alternate) {
      row.attempts=[{url:recipe.url,status:readResult.status,reason:readResult.reason??null}]
      recipe=recipe.alternate
      readResult=await read(request.sourceId,recipe.url,recipe,request.period)
      row.attempts.push({url:recipe.url,status:readResult.status,reason:readResult.reason??null})
      row.adapter=recipe.kind
    }
    if(readResult.status!=='ok') {
      row.status=readResult.status==='not_attempted'?'not_attempted':readResult.status==='revision_conflict'?'revision_conflict':'access_failed'
      row.reason=readResult.reason;continue
    }
    if(recipe.kind==='news_listing') {
      const discoveryOptions={sourceId:request.sourceId,period:request.period,limit:recipe.access?3:2,
        deprioritizeUrls:discoveryFeedback?.deprioritizeUrls??[]}
      let found=explicitArticle?{candidates:[{url:explicitArticle.url,title:'User-supplied URL; article title not verified'}]}
        :discoverRegisteredNews(readResult.text,recipe.url,selection.currency,discoveryOptions)
      if(explicitArticle)row.discoveryMode='explicit_url_not_publisher_listing'
      const targetHint=c=>validDate(request.period)&&(dateHint(c.url,request.period)||c.discoveryDateHint===request.period)
      // A rolling listing can lose yesterday's link. Reuse explicit saved
      // registered URLs as discovery candidates, never as publication proof.
      if(!explicitArticle&&recipe.access&&validDate(request.period)){
        const cached=captures.filter(c=>c.sourceId===request.sourceId&&c.httpStatus>=200&&c.httpStatus<300
          &&new URL(c.url).hostname===new URL(recipe.url).hostname&&recipe.access.path.test(new URL(c.url).pathname))
          .map(c=>{let day=null;try{day=marketCalendarDate(publicationMetadata(c.text,c.url).publishedAt,selection.currency)}catch{/* Discovery only; normal parsing still reports the failure. */}
            return {...c,discoveryDateHint:day}}).filter(targetHint)
          .map(c=>({url:c.url,title:'Saved registered candidate; publication and content still require review',
            discoveryDateHint:c.discoveryDateHint,discoveryLabelBasis:'saved_registered_url_not_verified_title'}))
        if(cached.length){
          found={...found,candidates:[...cached,...found.candidates]
            .filter((c,index,all)=>all.findIndex(other=>other.url===c.url)===index)
            .sort(newsCandidateComparator(selection.currency,discoveryOptions))
            .slice(0,discoveryOptions.limit)}
          row.discoveryMode='registered_listing_and_explicit_saved_candidates'
        }
      }
      if(!explicitArticle&&(!found.candidates.length||validDate(request.period)&&!found.candidates.some(targetHint)
        ||discoveryFeedback?.preferAlternativeIndex===true)&&recipe.access?.indexUrl){
        row.discoveryAttempts=[{url:recipe.url,status:discoveryFeedback?.preferAlternativeIndex===true
          ?'review_feedback_alternative_lookup':found.candidates.length?'no_target_day_discovery_hint':'no_matching_candidate'}]
        if(inspectRobots(robots.text,recipe.access.indexUrl).allowed){
          const index=await read(request.sourceId,recipe.access.indexUrl,{kind:'news_index',url:recipe.access.indexUrl},request.period)
          row.discoveryAttempts.push({url:recipe.access.indexUrl,status:index.status,reason:index.reason??null})
          if(index.status==='ok'){
            const indexed=discoverRegisteredNews(index.text,recipe.access.indexUrl,selection.currency,discoveryOptions)
            const combined=[...indexed.candidates,...found.candidates]
              .filter((candidate,index,all)=>all.findIndex(c=>c.url===candidate.url)===index)
              .sort(newsCandidateComparator(selection.currency,discoveryOptions))
            found={...indexed,candidates:combined.slice(0,discoveryOptions.limit)}
          }
        }else row.discoveryAttempts.push({url:recipe.access.indexUrl,status:'robots_disallowed'})
      }
      if(found.feedCoverage)row.feedCoverage=found.feedCoverage
      if((!found.candidates.length||discoveryFeedback?.preferAlternativeIndex===true&&!found.candidates.some(explanationHint))&&recipe.access?.sitemapUrl){
        row.discoveryAttempts??=[]
        if(inspectRobots(robots.text,recipe.access.sitemapUrl).allowed){
          const index=await read(request.sourceId,recipe.access.sitemapUrl,{kind:'news_index',url:recipe.access.sitemapUrl},request.period)
          row.discoveryAttempts.push({url:recipe.access.sitemapUrl,status:index.status,reason:index.reason??null})
          const child=index.status==='ok'?discoverRegisteredSitemap(index.text,recipe.url,selection.currency,{sourceId:request.sourceId}):null
          if(child&&inspectRobots(robots.text,child.url).allowed){
            const page=await read(request.sourceId,child.url,{kind:'news_index',url:child.url},request.period)
            row.discoveryAttempts.push({url:child.url,status:page.status,reason:page.reason??null})
            if(page.status==='ok'){
              const extra=discoverRegisteredNews(page.text,child.url,selection.currency,discoveryOptions)
              found={...extra,candidates:rankNewsCandidates([...new Map([...found.candidates,...extra.candidates].map(c=>[c.url,c])).values()],selection.currency,discoveryOptions).slice(0,discoveryOptions.limit)}
            }
          }
        }else row.discoveryAttempts.push({url:recipe.access.sitemapUrl,status:'robots_disallowed'})
      }
      row.candidates=found.candidates.map(c=>({url:c.url,title:c.title,publicationVerified:false,
        ...(c.discoveryLabelBasis?{discoveryLabelBasis:c.discoveryLabelBasis}:{})}));row.issues=[]
      let followedRelated=false
      for(const candidate of found.candidates) {
        if(robots&&!inspectRobots(robots.text,candidate.url).allowed){row.issues.push({status:'access_failed',reason:'robots_disallowed'});continue}
        const page=await read(request.sourceId,candidate.url,{kind:'article',url:candidate.url},request.period)
        if(page.status!=='ok'){row.issues.push({status:page.status==='not_attempted'?'not_attempted':'access_failed',reason:page.reason});continue}
        const barrier=publisherAccessBarrier(page.text)
        if(barrier){row.issues.push({status:'access_failed',reason:barrier});continue}
        const article=await collectOriginal({candidate,currency:selection.currency,baseDate:selection.baseDate,
          fetchImpl:async()=>new Response(page.text),robotsText:robots?.text})
        if(article.status!=='collected_pending_review'){row.issues.push({status:'extraction_failed',reason:article.reason});continue}
        if(!explicitArticle&&!followedRelated&&validDate(request.period)&&article.metadata?.publishedAt
          &&(discoveryFeedback?.preferAlternativeIndex===true||marketCalendarDate(article.metadata.publishedAt,selection.currency)!==request.period)){
          // Discovery only: same registered host/article paths, one hop, the
          // existing candidate and physical request budgets. The next page's
          // date/body/use are checked afresh; link labels are never evidence.
          const generic=discoveryFeedback?.preferAlternativeIndex===true
            ?discoverRegisteredNews(page.text,candidate.url,selection.currency,discoveryOptions).candidates:[]
          const related=rankNewsCandidates([...new Map([...(article.relatedArticles??[]),...generic].map(r=>[r.url,r])).values()],selection.currency,discoveryOptions)
            .filter(r=>!found.candidates.some(c=>c.url===r.url)).slice(0,discoveryFeedback?.preferAlternativeIndex===true?discoveryOptions.limit:1)
          if(related.length){
            followedRelated=true
            for(const link of related){found.candidates.push({...link,questionIds:['market']})
              row.candidates.push({...link,discoveryMode:generic.some(candidate=>candidate.url===link.url)
                ?'registered_article_link_one_hop':'related_body_link_one_hop'})}
          }
        }
        row.originalIds.push(addOriginal(request,{...article,...(row.access?{acquisitionPolicy:row.access}:{}),kind:'article',sha256:page.sha256,collectedAt:page.fetchedAt,fetchedAt:page.fetchedAt,networkCalls:0,
          captureMode:page.captureMode,requestedPeriod:request.period},'reviewed_news_notes'))
      }
      row.status=row.originalIds.length?row.issues.length?'partial_pending_review':'collected_pending_review'
        :row.issues.length?row.issues[0].status:'no_candidates_in_listing'
      row.reason=!found.candidates.length?'listing_did_not_identify_matching_article':null
      if(!found.candidates.length&&row.discoveryAttempts?.some(a=>a.status!=='ok'&&a.status!=='no_matching_candidate')){
        row.status='discovery_incomplete';row.reason='alternative_index_unavailable'
      }else if(!found.candidates.length&&row.feedCoverage&&validDate(request.period)
        &&marketCalendarDate(row.feedCoverage.latestItemPublishedAt,selection.currency)<request.period){
        row.status='discovery_incomplete';row.reason='available_feed_older_than_requested_period'
      }
      continue
    }
    if(recipe.kind==='chile_monthly') {
      const definition=CHILE_MONTHLY_SOURCES.find(s=>s.id===recipe.sourceId)
      const discovery=discoverMonthlyPdfs(readResult.text,definition.id,request.period);row.issues=[]
      if(mode==='saved'){row.status='discovery_incomplete';row.reason='pdf_bytes_require_existing_monthly_capture';continue}
      for(const candidate of discovery.candidates) {
        if(network.length>=maxNetworkRequests){row.issues.push('request_budget');continue}
        const pdf=await readMonthlyPdf(candidate.url,definition.id,{fetchImpl:checkedFetch,timeoutMs})
        if(pdf.status!=='collected_pending_review'){row.issues.push(pdf.reason);continue}
        const {raw,...metadata}=pdf
        await checkpoint('pdf',{sourceId:definition.id,url:candidate.url,period:request.period,raw,...metadata})
        row.originalIds.push(addOriginal(request,{...metadata,url:candidate.url,collectedAt:metadata.collectedAt,
          kind:'official_pdf',sourceId:definition.id,period:request.period,rawBase64:raw.toString('base64')},'chile_monthly_evidence'))
      }
      row.status=row.originalIds.length?row.issues.length?'partial_pending_review':'collected_pending_review'
        :row.issues.length?row.issues.every(issue=>issue==='request_budget')?'not_attempted':'access_failed':'no_candidates_in_index'
      row.reason=row.originalIds.length?null:row.status==='not_attempted'?'request_budget':discovery.status;continue
    }
    let statistic
    try { statistic=parseRegisteredStatistic(recipe,readResult.text,selection.asOf.slice(0,10)) }
    catch {row.status='extraction_failed';row.reason='source_json_or_schema_changed';continue}
    const matching=statistic.observations.filter(o=>matchesPeriod(o,request.period))
    const valid=matching.filter(o=>o.value!==null)
    if(!statistic.observations.length){row.status='empty_result';row.reason='no_rows_in_checked_query';continue}
    row.originalIds.push(addOriginal(request,{...statistic,url:readResult.url,sha256:readResult.sha256,
      collectedAt:readResult.fetchedAt,captureMode:readResult.captureMode,requestedPeriod:request.period},'statistic_scope_and_source_use'))
    row.status=!matching.length?'period_mismatch':!valid.length?'values_missing':'collected_pending_review'
    row.reason=row.status==='period_mismatch'?'requested_period_not_in_observations':row.status==='values_missing'?'null_not_zero':null
  }
  if(fingerprint({input,sourcePlan,sourceRegister,captures,pdfCaptures,articleUrls})!==before)throw new Error('collection_input_mutated')
  const result={version:SELECTED_COLLECTION_VERSION,mode,currency:selection.currency,baseDate:selection.baseDate,asOf:selection.asOf,
    startedAt,selectionId:selection.selectionId,catalogId:catalog.catalogId,outcomes,originals,reviewQueue,receipts,network,
    ...(fairSourceBudgets?{sourceRequestBudgets:sourceIds.map(sourceId=>({sourceId,limit:sourceLimits.get(sourceId),spent:sourceSpent(sourceId)}))}:{}),
    networkCalls:network.length,modelCalls:0,newPaidCostUsd:0,retries:0,writingEligibility:'not_assessed',publicationApproved:false}
  await checkpoint('result',result);return result
}

// Pending cards are inspection contracts, not evidence. Verify before review so
// a changed original, note target or source version cannot inherit a receipt.
export function validateSelectedReviewCard(collection,card) {
  const {binding,decision,reviewer,notes,supportingReferences,...bound}=card
  const original=collection.originals.find(o=>o.id===card.originalId)
  if(collection.version!==SELECTED_COLLECTION_VERSION||!original||binding!==fingerprint(bound)
    ||bound.originalHash!==fingerprint(original)||!collection.reviewQueue.some(q=>q.id===card.id&&q.binding===binding)
    ||decision!==null||reviewer!==null||!Array.isArray(notes)||notes.length||!Array.isArray(supportingReferences)||supportingReferences.length)
    throw new Error('unreviewed_or_stale_selected_card')
  return {original,reviewAdapter:card.reviewAdapter,requiredChecks:[...card.requiredChecks],publicationApproved:false}
}
