// Explicit public-publisher path. Never auto-admits evidence or invokes AI.
import {createHash} from 'node:crypto'
import {fetchLocalSourceDiscovery,LOCAL_SOURCE_REGISTRY} from './local-source-discovery.js'
import {collectOriginal} from './public-research-adapter.js'
import {researchTimeScope} from './research-time-scope.js'
import {validDate} from './core.js'

export async function collectPublisherResearch({packet,fetchImpl=fetch,checkpoint=async()=>{},mode='live',savedCaptures=[],searchDate}) {
  if(packet?.currency!=='CLP') throw new Error('unsupported_publisher_research_currency')
  if(!['saved','live'].includes(mode))throw Error('publisher_research_mode_required')
  let timeScope=researchTimeScope(packet,'market')
  if(searchDate!==undefined){
    if(!validDate(searchDate)||searchDate>packet.baseDate||timeScope.priceSessionDate&&searchDate!==timeScope.anchorDate)
      throw Error('publisher_search_date_not_compatible')
    if(!timeScope.priceSessionDate)timeScope={...timeScope,anchorDate:searchDate,endDate:searchDate,
      startDate:new Date(Date.parse(searchDate+'T00:00:00Z')-86400000).toISOString().slice(0,10),
      dateBasis:'explicit_search_target_not_verified_price_session'}
  }
  const pages=new Map()
  let discovery
  if(mode==='saved'){
    const candidates=[],seen=new Map(),sourceResults=[]
    for(const capture of savedCaptures){
      const u=new URL(capture.url),source=(LOCAL_SOURCE_REGISTRY[packet.currency]??[]).find(s=>s.hostnames.includes(u.hostname)&&s.articlePath.test(u.pathname))
      if(!source||u.protocol!=='https:'||u.username||u.password||u.port)continue
      if(typeof capture.text!=='string'||createHash('sha256').update(capture.text).digest('hex')!==capture.sha256
        ||!Number.isFinite(Date.parse(capture.collectedAt))||!/(Z|[+-]\d{2}:\d{2})$/.test(capture.collectedAt))throw Error('saved_publisher_capture_invalid')
      if(seen.has(capture.url)&&seen.get(capture.url)!==capture.sha256)throw Error('explicit_capture_version_required')
      if(seen.has(capture.url))continue
      seen.set(capture.url,capture.sha256)
      if(capture.httpStatus<200||capture.httpStatus>=300)continue
      const page={kind:'article',url:capture.url,text:capture.text,capturedAt:capture.collectedAt}
      pages.set(capture.url,page);await checkpoint('capture',page)
      candidates.push({id:createHash('sha256').update(capture.url+capture.sha256).digest('hex'),url:capture.url,
        publisher:source.publisher,title:'저장된 등록 출처 후보 · 본문과 날짜는 재검사',source:source.id})
    }
    for(const source of LOCAL_SOURCE_REGISTRY[packet.currency]??[])sourceResults.push({source:source.id,
      status:candidates.some(c=>c.source===source.id)?'saved_captures_pending_extraction':'saved_capture_missing'})
    discovery={status:candidates.length?'collected_for_review':'not_collected',candidates,sourceResults,networkCalls:0,
      discoveryMode:'saved_registered_captures_not_new_discovery',publicationVerified:false}
  }else discovery=await fetchLocalSourceDiscovery({currency:packet.currency,baseDate:timeScope.anchorDate,
    startDate:timeScope.startDate,fetchImpl,onCapture:async capture=>{
      if(capture.kind==='article') pages.set(capture.url,capture)
      await checkpoint('capture',capture)
    }})
  const originals=[]
  for(const candidate of discovery.candidates) {
    const page=pages.get(candidate.url)
    const parsed=await collectOriginal({candidate:{...candidate,questionIds:['market']},currency:packet.currency,
      baseDate:packet.baseDate,timeScope,fetchImpl:async url=>{
        if(String(url)!==candidate.url || !page) throw new Error('original_capture_not_in_cache')
        return new Response(page.text)
      }})
    const row={...parsed,candidateId:candidate.id,title:candidate.title,publisher:candidate.publisher,
      networkCalls:0,captureMode:'same_download_replay',fetchedAt:page?.capturedAt??null,
      capturedTextSha256:page?createHash('sha256').update(page.text).digest('hex'):null,
      originalVerified:false,publicationApproved:false}
    originals.push(row)
    await checkpoint('original',row)
  }
  const extracted=originals.filter(r=>r.status==='collected_pending_review')
  return {version:'publisher-research/1',currency:packet.currency,reportDate:packet.baseDate,timeScope,
    status:extracted.length?extracted.length===originals.length && discovery.status==='collected_for_review'
      ?'originals_pending_review':'partial_pending_review':discovery.status==='failed'?'collection_failed':
      discovery.candidates.length?'original_extraction_failed':'no_candidates_in_attempt',
    discovery,originals,networkCalls:discovery.networkCalls,modelCalls:0,newApiCostUsd:0,
    writingEligibility:{eligible:false,reason:'scope_price_time_attribution_and_reuse_review_required'},
    contentQuality:'not_assessed',publicationApproved:false,
    limitation:'Discovery metadata and extracted bodies are research materials, not approved evidence. Quotes, news text and image reuse rights are not granted by collection.'}
}
