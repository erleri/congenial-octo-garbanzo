// Server-owned source admission. This is an operational processing decision,
// never a publisher licence, a claim-support review or publication approval.
import {createHash} from 'node:crypto'
import {candidateUrl} from './source-candidates.js'
import {fingerprint,RESEARCH_CURRENCIES} from './research-harness.js'
import {publisherAccessBarrier,inspectRobots,articleOriginHints} from './news-publisher-access.js'
import {publicationMetadata} from './public-research-adapter.js'
import {unsafeSourceText} from './source-text-safety.js'
import {sourceStateBinding} from './source-state-binding.js'
import {sourceScopeDecision} from './source-scope-policy.js'

export const SOURCE_ADMISSION_VERSION='source-admission/1'
export const SOURCE_SCOPES=['discover','collect','analyze','publishNotes']
export const SOURCE_ADMISSION_POLICY=Object.freeze({version:'source-admission-policy/1',
 automaticProfiles:['article_cc_by_4','article_cc0_1'],articleOnly:true,proofMaxAgeDays:7,
 maxAutomaticChecksPerCountry:1,maxActivePerCountry:8,rawPublicDisplay:false})
export const sourceAdmissionHash=text=>createHash('sha256').update(text).digest('hex')
const stamp=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(s)&&Number.isFinite(Date.parse(s))
const scopesNone=()=>Object.fromEntries(SOURCE_SCOPES.map(k=>[k,false]))
const seal=body=>({...body,binding:sourceStateBinding(body)})
const exactKeys=(v,keys)=>v&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))
const licenses=new Map([
 ['https://creativecommons.org/licenses/by/4.0/','article_cc_by_4'],
 ['https://creativecommons.org/publicdomain/zero/1.0/','article_cc0_1'],
])
function articleEntities(html){
 const entities=[]
 for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  let json;try{json=JSON.parse(m[1])}catch{continue}
  const queue=Array.isArray(json)?[...json]:[json]
  while(queue.length){const v=queue.shift();if(!v||typeof v!=='object')continue
   if(Array.isArray(v['@graph']))queue.push(...v['@graph'])
   if([v['@type']].flat().some(t=>['Article','NewsArticle','ReportageNewsArticle'].includes(t)))entities.push(v)
   if(entities.length>8||queue.length>64)throw Error('ambiguous_article_entities')
  }
 }
 return entities
}

// Deterministic declaration check, not an LLM's legal judgement. A website-wide
// footer licence cannot grant article rights; ambiguous/third-party notices hold.
export function inspectSourceAdmission({currency,url,html,robotsText,collectedAt,asOf,restrictions=[]}) {
 if(!RESEARCH_CURRENCIES.includes(currency)||!candidateUrl(url)||typeof html!=='string'||Buffer.byteLength(html)>2_000_000
  ||!stamp(asOf)||!stamp(collectedAt)||Date.parse(collectedAt)>Date.parse(asOf))throw Error('source_admission_input_invalid')
 const base={version:SOURCE_ADMISSION_VERSION,currency,url,host:new URL(url).hostname,
  capturedAt:collectedAt,checkedAt:asOf,captureHash:sourceAdmissionHash(html),
  policyBinding:fingerprint(SOURCE_ADMISSION_POLICY),scopes:scopesNone(),profile:null,
  evidenceUrl:url,licenseUrl:null,publisher:null,publicationAt:null,
  expiresAt:new Date(Date.parse(collectedAt)+7*86400000).toISOString(),
  rawPublicDisplay:false,publicationApproved:false,licenseGranted:false}
 const result=(status,reason,extra={})=>seal({...base,status,reason,...extra})
 if(Date.parse(base.expiresAt)<=Date.parse(asOf))return result('hold','source_evidence_expired')
 if(restrictions.length)return result('exclude','recorded_processing_restriction')
 if(publisherAccessBarrier(html))return result('exclude','access_restricted')
 if(/<meta\b[^>]*content=["'][^"']*\bnoai\b[^"']*["'][^>]*>/i.test(html))return result('exclude','explicit_analysis_restricted')
 let robots;try{robots=inspectRobots(robotsText,url)}catch{return result('hold','robots_unconfirmed')}
 if(!robots.allowed||robots.crawlDelaySeconds>0)return result('exclude','automated_access_restricted')
 let entities;try{entities=articleEntities(html)}catch{return result('hold','ambiguous_article_entities')}
 const identity=v=>v.url??(typeof v.mainEntityOfPage==='string'?v.mainEntityOfPage:v.mainEntityOfPage?.['@id'])
 const matches=entities.filter(v=>identity(v)===url)
 if(matches.length!==1)return result('hold','article_identity_unconfirmed')
 const article=matches[0],publisher=article.publisher
 if(!publisher||typeof publisher.name!=='string'||publisher.name.length<2||publisher.name.length>160
  ||unsafeSourceText(publisher.name)||!candidateUrl(publisher.url)||new URL(publisher.url).hostname!==base.host)
  return result('hold','publisher_identity_unconfirmed')
 let metadata;try{metadata=publicationMetadata(html,url)}catch{return result('hold','publication_metadata_unconfirmed')}
 if(!stamp(metadata?.publishedAt)||Date.parse(metadata.publishedAt)>Date.parse(asOf))return result('hold','publication_metadata_unconfirmed')
 const creditedOrigins=articleOriginHints(url,[{text:typeof article.articleBody==='string'?article.articleBody:''}]).creditedOrigins
 const ownArticle=!article.provider&&creditedOrigins.length===0&&(!article.copyrightHolder||article.copyrightHolder.name===publisher.name)
 const bodyVerified=typeof article.articleBody==='string'&&article.articleBody.trim().length>=120&&!unsafeSourceText(article.articleBody)
 const creditValues=[article.author].flat().filter(Boolean).map(a=>typeof a==='string'?a:a.name)
 const authors=creditValues.filter(a=>typeof a==='string'&&a.length<=160&&!unsafeSourceText(a)).slice(0,8)
 const credit={publisher:publisher.name,authors,title:typeof article.headline==='string'&&article.headline.length<=300&&!unsafeSourceText(article.headline)?article.headline:null,
  notice:typeof article.copyrightNotice==='string'&&article.copyrightNotice.length<=400&&!unsafeSourceText(article.copyrightNotice)?article.copyrightNotice:null,
  licenseUrl:licenses.has(article.license)?article.license:null,sourceUrl:url,modified:true}
 const articleChecks={ownArticle,freeAccess:article.isAccessibleForFree===true,bodyVerified}
 const articleBinding=sourceStateBinding({article,rightsNotice:/(?:all rights reserved|todos los derechos reservados|todos os direitos reservados)/i.test(html)})
 const shared={publisher:publisher.name,publicationAt:metadata.publishedAt,articleChecks,articleBinding,credit}
 if(article.isAccessibleForFree!==true)return result('hold','free_access_declaration_missing',shared)
 if(!bodyVerified)
  return result('hold','structured_article_body_unconfirmed',shared)
 if(creditValues.length!==authors.length||article.copyrightNotice&&!credit.notice||article.headline&&!credit.title)
  return result('hold','attribution_metadata_unconfirmed',shared)
 // Credited providers and conflicting rights need an operator-reviewed scope.
 if(!ownArticle
  ||/(?:all rights reserved|todos los derechos reservados|todos os direitos reservados)/i.test(html))
  return result('hold','conflicting_or_third_party_rights',shared)
 const profile=licenses.get(article.license)
 if(!profile)return result('hold','use_scope_unconfirmed',shared)
 return result('eligible','explicit_article_license_matches_policy',{...shared,profile,licenseUrl:article.license,
  scopes:Object.fromEntries(SOURCE_SCOPES.map(k=>[k,true]))})
}

export function assertAdmissionProof(proof,asOf) {
 const {binding,...body}=proof??{}
 if(proof?.version!==SOURCE_ADMISSION_VERSION||binding!==sourceStateBinding(body)
  ||proof.policyBinding!==fingerprint(SOURCE_ADMISSION_POLICY)||!RESEARCH_CURRENCIES.includes(proof.currency)
  ||!candidateUrl(proof.url)||new URL(proof.url).hostname!==proof.host||proof.evidenceUrl!==proof.url
  ||!/^[a-f0-9]{64}$/.test(proof.captureHash)||!stamp(proof.checkedAt)||!stamp(proof.capturedAt)||!stamp(proof.expiresAt)
  ||!stamp(asOf)||Date.parse(proof.checkedAt)>Date.parse(asOf)||Date.parse(proof.capturedAt)>Date.parse(proof.checkedAt)
  ||Date.parse(proof.expiresAt)!==Date.parse(proof.capturedAt)+7*86400000
  ||!['eligible','hold','exclude'].includes(proof.status)||proof.rawPublicDisplay!==false||proof.publicationApproved!==false
  ||proof.licenseGranted!==false||!exactKeys(proof.scopes,SOURCE_SCOPES)||SOURCE_SCOPES.some(k=>typeof proof.scopes[k]!=='boolean'))
  throw Error('bound_source_admission_proof_required')
 if(proof.status==='eligible'&&(!SOURCE_ADMISSION_POLICY.automaticProfiles.includes(proof.profile)
  ||licenses.get(proof.licenseUrl)!==proof.profile||SOURCE_SCOPES.some(k=>proof.scopes[k]!==true)))
  throw Error('source_admission_profile_mismatch')
 return proof
}

// Decisions are persisted by a privileged service or an active administrator.
// The caller supplies the current proof from the DB, never a browser-supplied one.
export function resolveSourceAdmission({proof,decision=null,policies=[],terms=[],asOf}) {
 assertAdmissionProof(proof,asOf)
 const result=(state,reason,scopes=scopesNone())=>({state,reason,scopes,proofBinding:proof.binding,
  currency:proof.currency,url:proof.url,sourceId:`${proof.currency.toLowerCase()}-admitted-${fingerprint(proof.url).slice(0,16)}`,
  rawPublicDisplay:false,publicationApproved:false})
 if(decision){
  if(!['apply','hold','exclude'].includes(decision.action)||decision.proofBinding!==proof.binding
   ||!exactKeys(decision.scopes,SOURCE_SCOPES)||SOURCE_SCOPES.some(k=>typeof decision.scopes[k]!=='boolean')
   ||!Number.isInteger(decision.revision)||decision.revision<1)throw Error('bound_source_admission_decision_required')
  if(decision.action!=='apply')return result(decision.action,decision.action==='exclude'?'operator_excluded':'operator_deferred')
 }
 if(Date.parse(proof.expiresAt)<=Date.parse(asOf))return result('hold','source_evidence_expired')
 if(proof.status==='exclude')return result('exclude','source_conditions_not_satisfied')
 const scope=sourceScopeDecision({proof,policies,terms,asOf})
 if(scope&&(!decision||decision.action==='apply')){
  if(scope.state!=='active')return result(scope.state,scope.reason)
  const selected=decision?.scopes??scope.scopes
  if(!exactKeys(selected,SOURCE_SCOPES)||SOURCE_SCOPES.some(k=>typeof selected[k]!=='boolean'||selected[k]&&!scope.scopes[k])
   ||selected.collect&&!selected.discover||selected.analyze&&!selected.collect||selected.publishNotes&&!selected.analyze)
   throw Error('source_scope_escalation')
  return {...result('active',scope.reason,structuredClone(selected)),policyId:scope.policyId,policyRevision:scope.policyRevision,
   termsHash:scope.termsHash,scopeEvidenceUrl:scope.evidenceUrl}
 }
 // An active administrator may document a source-specific use review. This is
 // not a licence grant and cannot override a technical or recorded prohibition.
 const manual=decision?.basis?.kind==='operator_documented_scope'
  &&candidateUrl(decision.basis.evidenceUrl)&&typeof decision.basis.reason==='string'
  &&decision.basis.reason.trim().length>=20&&decision.basis.reason.length<=480
  &&!unsafeSourceText(decision.basis.reason)&&stamp(decision.basis.checkedAt)
  &&Date.parse(decision.basis.checkedAt)<=Date.parse(asOf)
  &&['use_scope_unconfirmed','conflicting_or_third_party_rights','free_access_declaration_missing'].includes(proof.reason)
 if(proof.status!=='eligible'&&!manual)return result('hold','source_conditions_not_satisfied')
 const scopes=decision?.scopes??proof.scopes
 if(!manual&&SOURCE_SCOPES.some(k=>scopes[k]&&!proof.scopes[k])||scopes.collect&&!scopes.discover
  ||scopes.analyze&&!scopes.collect||scopes.publishNotes&&!scopes.analyze)throw Error('source_scope_escalation')
 return result('active',manual?'operator_documented_scope':decision?'operator_applied_existing_policy':'automatic_existing_policy',structuredClone(scopes))
}

// A decision on one article never registers a whole hostname. Exclusions and
// deferrals survive changed captures; positive decisions require fresh proof.
export function sourceDecisionForProof(decisions,proof) {
 const rows=decisions.filter(d=>d.currency===proof.currency&&d.url===proof.url).sort((a,b)=>b.revision-a.revision)
 const latest=rows[0]
 if(!latest)return null
 if(latest.action==='apply'&&latest.proofBinding!==proof.binding&&latest.captureHash!==proof.captureHash
  &&(!proof.articleBinding||latest.articleBinding!==proof.articleBinding))return {...latest,proofBinding:proof.binding,action:'hold',scopes:scopesNone()}
 return {...latest,proofBinding:proof.binding}
}
