import {fingerprint} from './research-harness.js'
import {sourceAdmissionHash,inspectSourceAdmission} from './source-admission.js'
import {candidateUrl} from './source-candidates.js'
import {readCandidatePage} from './source-candidate-probe.js'
import {inspectRobots,publisherAccessBarrier,articleOriginHints} from './news-publisher-access.js'
import {extractPublicArticle,publicationMetadata} from './public-research-adapter.js'

// Uses the same bounded HTTPS/DNS transport as candidate inspection. No redirect,
// search expansion, credential access, retry or model call is introduced here.
export async function collectAdmittedArticle({source,mode,captures=[],asOf,read=readCandidatePage,now=()=>new Date().toISOString()}) {
 const a=source?.admission,url=a?.url
 let calls=0
 const fail=reason=>({status:'not_collected',reason,networkCalls:calls})
 if(!a||!candidateUrl(url)||Date.parse(a.expiresAt)<=Date.parse(asOf))return fail('source_admission_expired')
 if(!a.scopes.collect||!a.scopes.analyze||!a.scopes.publishNotes)return fail('source_scope_not_for_report_analysis')
 const readOne=async(target,maxBytes)=>{
  if(mode==='saved'){
   const rows=captures.filter(c=>c.url===target&&c.httpStatus===200&&Date.parse(c.collectedAt)<=Date.parse(asOf)
    &&sourceAdmissionHash(c.text)===c.sha256&&Buffer.byteLength(c.text)<=maxBytes)
   if(!rows.length)throw Error('admitted_source_capture_missing')
   const capture=rows.sort((x,y)=>y.collectedAt.localeCompare(x.collectedAt))[0]
   if(rows.some(c=>c.collectedAt===capture.collectedAt&&c.sha256!==capture.sha256))throw Error('admitted_source_revision_conflict')
   return {status:200,text:capture.text,collectedAt:capture.collectedAt}
  }
  if(mode!=='live')throw Error('invalid_admission_collection_mode')
  calls++;const value=await read(target,{maxBytes});return {...value,collectedAt:now()}
 }
 try{
  const robots=await readOne(new URL('/robots.txt',url).href,200000)
  if(robots.status!==200)return fail('admitted_source_robots_unavailable')
  const policy=inspectRobots(robots.text,url)
  if(!policy.allowed||policy.crawlDelaySeconds>0)return fail('admitted_source_access_restricted')
  const page=await readOne(url,2000000)
  if(page.status!==200||publisherAccessBarrier(page.text))return fail('admitted_source_access_restricted')
  const actualCaptureHash=sourceAdmissionHash(page.text)
  const fresh=inspectSourceAdmission({currency:source.currency,url,html:page.text,robotsText:robots.text,collectedAt:page.collectedAt,
   asOf:new Date(Math.max(Date.parse(asOf),Date.parse(page.collectedAt))).toISOString()})
  if(fresh.status==='exclude'||(a.articleBinding?fresh.articleBinding!==a.articleBinding:actualCaptureHash!==a.captureHash))return fail('admitted_source_conditions_changed')
  const article=extractPublicArticle(url,page.text),metadata=publicationMetadata(page.text,url)
  if(!metadata.publishedAt)return fail('admitted_source_date_unconfirmed')
  return {status:'collected_pending_review',networkCalls:calls,
   record:{kind:'article',url,sha256:actualCaptureHash,collectedAt:page.collectedAt,metadata,
    ...article,originHints:articleOriginHints(url,article.blocks),sourceVersion:'current_page_not_archived',
    sourceAdmission:{...structuredClone(a),actualCaptureHash,binding:fingerprint(a)},originalVerified:false,publicationApproved:false}}
 }catch(error){return fail(/^[a-z_]+$/.test(error.message??'')?error.message:'admitted_source_collection_failed')}
}
