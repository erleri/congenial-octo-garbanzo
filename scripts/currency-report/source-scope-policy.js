// Reusable, administrator-reviewed scope. It never substitutes for per-article
// identity, access, third-party-rights or content review.
import {candidateUrl} from './source-candidates.js'
import {sourceStateBinding} from './source-state-binding.js'
import {readCandidatePage} from './source-candidate-probe.js'
import {inspectRobots,publisherAccessBarrier} from './news-publisher-access.js'
import {sourceRefreshBudget} from './source-refresh-budget.js'

export const SOURCE_TERMS_MAX_AGE_MS=86400000
export const SOURCE_POLICY_MAX_AGE_MS=90*86400000
const time=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))
export function validSourceScope(policy) {
 try {
  const url=new URL(policy.termsUrl)
  return candidateUrl(policy.termsUrl)&&url.hostname===policy.host
   &&typeof policy.pathPrefix==='string'&&/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(policy.pathPrefix)
   &&policy.pathPrefix.length<=160&&typeof policy.publisher==='string'&&policy.publisher.length>=2
   &&['BRL','MXN','COP','PEN','CLP','ARS'].includes(policy.currency)
 } catch{return false}
}
export function sourceScopeDecision({proof,policies=[],terms=[],asOf}) {
 const url=new URL(proof.url)
 const matched=policies.filter(p=>validSourceScope(p)&&p.currency===proof.currency&&p.host===proof.host&&url.pathname.startsWith(p.pathPrefix))
  .sort((a,b)=>b.pathPrefix.length-a.pathPrefix.length)
 const policy=matched[0]
 if(!policy)return null
 const base={policyId:policy.id,policyRevision:policy.revision,state:'hold',reason:'source_scope_not_active'}
 if(policy.action==='exclude')return {...base,state:'exclude',reason:'operator_excluded_scope'}
 if(policy.action!=='apply')return base
 if(!time(asOf)||!time(policy.decidedAt)||!time(policy.expiresAt)||Date.parse(policy.decidedAt)>Date.parse(asOf)
  ||Date.parse(policy.expiresAt)<=Date.parse(asOf)||Date.parse(policy.expiresAt)-Date.parse(policy.decidedAt)>SOURCE_POLICY_MAX_AGE_MS)
  return {...base,reason:'source_scope_review_expired'}
 const check=terms.find(t=>t.policyId===policy.id)
 if(!check||check.url!==policy.termsUrl||check.status!=='available'||!time(check.checkedAt)||Date.parse(check.checkedAt)>Date.parse(asOf)
  ||Date.parse(asOf)-Date.parse(check.checkedAt)>=SOURCE_TERMS_MAX_AGE_MS)return {...base,reason:'source_terms_check_pending'}
 if(check.hash!==policy.approvedTermsHash)return {...base,reason:'source_terms_changed'}
 if(proof.publisher!==policy.publisher||proof.articleChecks?.ownArticle!==true||proof.articleChecks?.freeAccess!==true
  ||proof.articleChecks?.bodyVerified!==true)return {...base,reason:'article_outside_reviewed_scope'}
 if(!['eligible','hold'].includes(proof.status)||!['explicit_article_license_matches_policy','use_scope_unconfirmed','conflicting_or_third_party_rights'].includes(proof.reason))
  return {...base,reason:'article_conditions_not_satisfied'}
 return {...base,state:'active',reason:'reviewed_publisher_scope',scopes:policy.scopes,
  evidenceUrl:policy.termsUrl,termsHash:check.hash,expiresAt:policy.expiresAt}
}

export function sourceTermsContent(text) {
 const clean=text.replace(/<(script|style|nav)\b[^>]*>[\s\S]*?<\/\1>/gi,' ')
  .replace(/<[^>]+>/g,' ').replace(/&(?:nbsp|#160);/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim()
 if(clean.length<120||clean.length>300000||publisherAccessBarrier(text))throw Error('source_terms_content_unconfirmed')
 return {hash:sourceStateBinding(clean),excerpt:clean.slice(0,400)}
}

// At most eight due scopes per country, two bounded free requests per scope. Failed
// refresh is stored as a failure, never mistaken for unchanged conditions.
export async function refreshSourceTerms({state,store,asOf,mode='saved',capturesByCurrency={},read=readCandidatePage,budget=sourceRefreshBudget()}) {
 const next=structuredClone(state),terms=[...(state.terms??[])],results=[],used=new Map(),pages=new Map()
 const sorted=[...(state.policies??[])].sort((a,b)=>{
  const at=terms.find(t=>t.policyId===a.id)?.checkedAt??'',bt=terms.find(t=>t.policyId===b.id)?.checkedAt??''
  return at.localeCompare(bt)||String(a.id).localeCompare(String(b.id))
 })
 // Interleave countries, rotating equal-age work each day so one slow host
 // cannot always monopolize the first optional check.
 const day=Math.floor(Date.parse(asOf)/86400000),currencies=['BRL','MXN','COP','PEN','CLP','ARS']
 const order=[...currencies.slice(day%6),...currencies.slice(0,day%6)]
 const queues=order.map(currency=>{
  const rows=sorted.filter(p=>p.currency===currency),ages=new Map()
  for(const p of rows){const age=terms.find(t=>t.policyId===p.id)?.checkedAt??'';if(!ages.has(age))ages.set(age,[]);ages.get(age).push(p)}
  return [...ages.values()].flatMap(group=>{const offset=day%group.length;return [...group.slice(offset),...group.slice(0,offset)]})
 })
 const policies=[]
 while(queues.some(q=>q.length))for(const queue of queues)if(queue.length)policies.push(queue.shift())
 for(const p of policies){
  const prev=terms.find(t=>t.policyId===p.id)
  if(!validSourceScope(p)||!['prepare','apply'].includes(p.action)||(used.get(p.currency)??0)>=8
   ||prev&&time(prev.checkedAt)&&Date.parse(asOf)-Date.parse(prev.checkedAt)<SOURCE_TERMS_MAX_AGE_MS)continue
  if(budget.remaining()<=0){results.push({policyId:p.id,currency:p.currency,status:'deferred',reason:'source_refresh_time_budget',networkCalls:0});continue}
  used.set(p.currency,(used.get(p.currency)??0)+1);let calls=0,result={policyId:p.id,url:p.termsUrl,checkedAt:asOf,status:'unavailable',hash:null,excerpt:null}
  const get=async(url,maxBytes)=>{
   const key=`${mode==='saved'?p.currency:''}:${url}`
   if(pages.has(key))return pages.get(key)
   const pending=budget.run(async(signal,remaining)=>{
   if(mode==='live'){calls++;return read(url,{maxBytes,timeoutMs:Math.min(6000,remaining()),signal})}
   if(mode!=='saved')throw Error('source_terms_mode_invalid')
   const rows=(capturesByCurrency[p.currency]??[]).filter(c=>c.url===url&&c.httpStatus===200&&typeof c.text==='string'
    &&time(c.collectedAt)&&Date.parse(c.collectedAt)<=Date.parse(asOf)&&Date.parse(asOf)-Date.parse(c.collectedAt)<SOURCE_TERMS_MAX_AGE_MS)
    .sort((a,b)=>b.collectedAt.localeCompare(a.collectedAt))
   const c=rows[0]
   if(!c||Buffer.byteLength(c.text)>maxBytes)throw Error('source_terms_capture_missing')
   const {createHash}=await import('node:crypto')
   if(createHash('sha256').update(c.text).digest('hex')!==c.sha256
    ||rows.some(r=>r.collectedAt===c.collectedAt&&r.sha256!==c.sha256))throw Error('source_terms_capture_conflict')
   return {status:200,text:c.text}
   })
   pages.set(key,pending);return pending
  }
  try {
   const robots=await get(new URL('/robots.txt',p.termsUrl).href,200000)
   const access=inspectRobots(robots.text,p.termsUrl)
   if(robots.status!==200||!access.allowed||access.crawlDelaySeconds>0)throw Error('source_terms_access_restricted')
   const page=await get(p.termsUrl,500000)
   if(page.status!==200)throw Error('source_terms_access_failed')
   result={...result,...sourceTermsContent(page.text),status:'available'}
  }catch{/* A failed check holds this scope, not registered country sources. */}
  if(budget.remaining()<=0){results.push({policyId:p.id,currency:p.currency,status:'deferred',reason:'source_refresh_time_budget',networkCalls:calls});continue}
  if(!store.saveSourceTerms)result={...result,status:'unavailable',hash:null,excerpt:null}
  else try{if(await budget.run(signal=>store.saveSourceTerms(result,{signal}))===false)throw Error('source_terms_stale')}
   catch{result={...result,status:'unavailable',hash:null,excerpt:null}}
  if(budget.remaining()<=0){results.push({policyId:p.id,currency:p.currency,status:'deferred',reason:'source_refresh_time_budget',networkCalls:calls});continue}
  const index=terms.findIndex(t=>t.policyId===p.id);if(index<0)terms.push(result);else terms[index]=result
  results.push({policyId:p.id,currency:p.currency,status:result.status,networkCalls:calls})
 }
 return {state:{...next,terms},results}
}
