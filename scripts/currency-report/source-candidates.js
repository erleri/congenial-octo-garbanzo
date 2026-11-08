// Discovery metadata only. Neither a link nor a successful technical check
// registers a publisher, grants reuse rights, or supplies writer evidence.
import {sourceStateBinding} from './source-state-binding.js'
import {registeredNewsSourceForUrl} from './research-source-selection.js'
import {publisherAccessBarrier} from './news-publisher-access.js'
import {publicationMetadata} from './public-research-adapter.js'
import {createHash} from 'node:crypto'

export const SOURCE_MONITOR_VERSION='source-monitor/1'
export const SOURCE_CANDIDATE_LIMIT=32
const day=stamp=>stamp.slice(0,10)
const safeId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value)
export function candidateUrl(value,base) {
 try{
  const u=new URL(value,base)
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.href.length>400
   ||!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(u.hostname)||/\.(?:local|localhost|internal|test|invalid)$/.test(u.hostname)
   ||/(?:@|%40|sk-or-|bearer|token|api[_-]?key|password|secret)/i.test(u.pathname))return null
  return u.href
 }catch{return null}
}
export function discoverSourceCandidates({text,url,sourceId,currency,catalog}) {
 const from=candidateUrl(url)
 if(!from||!safeId(sourceId)||typeof text!=='string')return []
 const result=new Map()
 for(const match of text.matchAll(/<a\b[^>]*href\s*=\s*(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi)){
  const label=match[3].replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()
  if(label.length<18||label.length>300||!/(?:d[oó]lar|dollar|peso|c[aâ]mbio|tipo.de.cambio)/i.test(label))continue
  const target=candidateUrl(match[2].replaceAll('&amp;','&'),from)
  if(!target||new URL(target).hostname===new URL(from).hostname
   ||registeredNewsSourceForUrl({catalog,currency,url:target}))continue
  const domain=new URL(target).hostname.replace(/^www\./,'')
  if(!result.has(domain))result.set(domain,{domain,sampleUrl:target,discoveredFrom:from,discoveredSourceId:sourceId,
   discoveryBasis:'economic_link_not_verified_publisher',writingEligible:false})
  if(result.size===SOURCE_CANDIDATE_LIMIT)break
 }
 return [...result.values()]
}
function capturedCheck(candidate,captures,asOf) {
 const matches=captures.filter(c=>c.url===candidate.sampleUrl&&Date.parse(c.collectedAt)<=Date.parse(asOf)&&c.httpStatus>=200&&c.httpStatus<600
  &&typeof c.text==='string'&&Buffer.byteLength(c.text)<=2_000_000&&createHash('sha256').update(c.text).digest('hex')===c.sha256)
 const capture=matches.sort((a,b)=>b.collectedAt.localeCompare(a.collectedAt))[0]
 if(!capture)return null
 const barrier=publisherAccessBarrier(capture.text)
 let metadata=null
 try{metadata=publicationMetadata(capture.text,capture.url)}catch{/* A layout failure is not evidence. */}
 return {hash:capture.sha256,access:capture.httpStatus>=200&&capture.httpStatus<300&&!barrier?'public_capture':'access_failed',
  extraction:metadata?.publishedAt?'dated_metadata_present':'metadata_missing',
  reason:barrier?'access_restricted':capture.httpStatus>=200&&capture.httpStatus<300?'use_scope_unconfirmed':'http_failure'}
}
export function updateSourceMonitor({currency,collection,catalog,previous=null,asOf,captures=[],researchFeedback=null}) {
 if(!catalog.countries.some(c=>c.currency===currency)||!Number.isFinite(Date.parse(asOf))
  ||previous&&(previous.version!==SOURCE_MONITOR_VERSION||previous.currency!==currency||!Number.isFinite(Date.parse(previous.checkedAt))||Date.parse(previous.checkedAt)>Date.parse(asOf)))
  throw Error('source_monitor_state_invalid')
 asOf=new Date(asOf).toISOString()
 if(previous){const {binding,...body}=previous;if(binding!==sourceStateBinding(body)||previous.candidates.length>32||previous.sources.length>32)throw Error('source_monitor_state_invalid')}
 const before=previous??{candidates:[],sources:[]},candidates=new Map(),sources=new Map(),seen=new Map()
 for(const c of before.candidates??[])if(candidateUrl(c.sampleUrl)&&candidateUrl(c.discoveredFrom)
  &&!registeredNewsSourceForUrl({catalog,currency,url:c.sampleUrl}))candidates.set(c.domain,structuredClone(c))
 const discovered=[...(collection.sourceCandidates??[])]
 for(const o of collection.originals??[]){
  const source=registeredNewsSourceForUrl({catalog,currency,url:o.url})
  if(!source){const url=candidateUrl(o.url);if(url)discovered.push({domain:new URL(url).hostname.replace(/^www\./,''),
   sampleUrl:url,discoveredFrom:url,discoveredSourceId:'unregistered',discoveryBasis:'unregistered_capture_not_evidence'})}
 }
 let omitted=0
 for(const raw of discovered){
  const url=candidateUrl(raw.sampleUrl),from=candidateUrl(raw.discoveredFrom)
  if(!url||!from||!safeId(raw.discoveredSourceId)||registeredNewsSourceForUrl({catalog,currency,url}))continue
  const domain=new URL(url).hostname.replace(/^www\./,'')
  if(!candidates.has(domain)){
   if(candidates.size>=SOURCE_CANDIDATE_LIMIT){omitted++;continue}
   candidates.set(domain,{domain,sampleUrl:url,discoveredFrom:from,discoveredSourceId:raw.discoveredSourceId,
    firstSeenAt:asOf,lastSeenAt:asOf,status:'candidate_only',access:'not_checked',extraction:'not_checked',
    useScope:'unconfirmed',lastCheckedAt:null,nextCheckAt:null,checkHash:null,attempts:0})
  }
  const current=candidates.get(domain)
  if(current.sampleUrl!==url){
   // One publisher can produce a new article after the first candidate. Do not
   // keep probing the first URL forever or transfer its check to another body.
   Object.assign(current,{sampleUrl:url,discoveredFrom:from,discoveredSourceId:raw.discoveredSourceId,
    status:'candidate_only',access:'not_checked',extraction:'not_checked',useScope:'unconfirmed',
    lastCheckedAt:null,nextCheckAt:null,checkHash:null,attempts:0})
  }
  current.lastSeenAt=asOf
 }
 for(const s of before.sources??[])if(safeId(s.sourceId)&&catalog.sources.some(r=>r.id===s.sourceId&&r.currency===currency))sources.set(s.sourceId,structuredClone(s))
 for(const o of collection.outcomes??[]){
  if(!safeId(o.sourceId)||!catalog.sources.some(s=>s.id===o.sourceId&&s.kind==='news'&&s.currency===currency))continue
  const record=seen.get(o.sourceId)??{ok:false,failed:false}
  record.ok||=!!o.originalIds?.length
  record.failed||=['access_failed','extraction_failed','discovery_incomplete'].includes(o.status)
  seen.set(o.sourceId,record)
 }
 for(const [sourceId,observed] of seen){
  const prior=sources.get(sourceId),failed=observed.failed&&!observed.ok
  const streak=observed.ok?0:failed?(prior?.failureDays??0)+Number(prior?.lastFailureDay!==day(asOf)):prior?.failureDays??0
  sources.set(sourceId,{sourceId,failureDays:streak,lastFailureDay:failed?day(asOf):prior?.lastFailureDay??null,
   status:observed.ok?'collected_pending_review':failed?'lookup_failed':'not_confirmed',
   repeatedFailure:streak>=3,lastSuccessAt:observed.ok?asOf:prior?.lastSuccessAt??null})
 }
 const registeredOriginals=(collection.originals??[]).filter(o=>{
  const s=registeredNewsSourceForUrl({catalog,currency,url:o.url});return s&&s.discovery?.mode!=='excluded'&&s.id===o.sourceId
 })
 // This is a collection gap, never a semantic sufficiency or important-event judgement.
 const gaps=[]
 if(!registeredOriginals.length)gaps.push('no_registered_capture')
 if([...sources.values()].some(s=>s.repeatedFailure))gaps.push('repeated_source_failure')
 if(registeredOriginals.length>1&&new Set(registeredOriginals.map(o=>o.sha256)).size===1)gaps.push('identical_capture_only')
 const origins=registeredOriginals.map(o=>o.originHints?.creditedOrigins??[])
 if(origins.length>1&&origins.every(o=>o.length===1&&o[0]===origins[0][0]))gaps.push('shared_credited_origin_only')
 if(researchFeedback?.preferAlternativeIndex)gaps.push('reviewed_explanation_gap')
 let checked=0
 if(gaps.length)for(const c of candidates.values()){
  if(checked>=2)break
  const observation=capturedCheck(c,captures,asOf)
  if(!observation||observation.hash===c.checkHash||c.nextCheckAt&&c.nextCheckAt>asOf)continue
  checked++;c.attempts=Math.min(1000,c.attempts+1);c.checkHash=observation.hash;c.lastCheckedAt=asOf
  c.access=observation.access;c.extraction=observation.extraction
  c.status=observation.reason==='access_restricted'?'processing_excluded':observation.reason==='http_failure'?'temporary_failure':'conditions_unconfirmed'
  c.nextCheckAt=new Date(Date.parse(asOf)+[1,3,7,30][Math.min(c.attempts-1,3)]*86400000).toISOString()
 }
 const body={version:SOURCE_MONITOR_VERSION,currency,checkedAt:asOf,candidates:[...candidates.values()],sources:[...sources.values()],
  gaps,omittedCandidates:omitted,technicalChecks:checked,networkCalls:0,modelCalls:0,
  attentionRequired:gaps.length>0&&(candidates.size>0||[...sources.values()].some(s=>s.repeatedFailure)),
  writingEligible:false,publicationApproved:false}
 return {...body,binding:sourceStateBinding(body)}
}
