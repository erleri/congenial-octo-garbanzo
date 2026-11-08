import {compileResearchSourceCatalog,registeredNewsSourceForUrl} from './research-source-selection.js'
import {resolveSourceAdmission,sourceDecisionForProof,SOURCE_ADMISSION_POLICY} from './source-admission.js'
import {sourceStateBinding} from './source-state-binding.js'

// Expand only a server-loaded snapshot; the recurring base catalogue and spending
// authorization remain unchanged. Freeze this snapshot with the execution input.
export function admittedSourceCatalog({sourcePlan,sourceRegister,state={proofs:[],decisions:[]},asOf}) {
 if(!Array.isArray(state.proofs)||!Array.isArray(state.decisions)||state.proofs.length>192||state.decisions.length>192)
  throw Error('bounded_source_admissions_required')
 if(state.policies&&(!Array.isArray(state.policies)||state.policies.length>144)||state.terms&&(!Array.isArray(state.terms)||state.terms.length>144))
  throw Error('bounded_source_policies_required')
 const base=compileResearchSourceCatalog(sourcePlan,sourceRegister),plan=structuredClone(sourcePlan),register=structuredClone(sourceRegister)
 const resolutions=[],counts=new Map(),seen=new Set()
 for(const proof of state.proofs){
  const identity=`${proof.currency}:${proof.url}`
  if(seen.has(identity))throw Error('duplicate_source_admission_proof')
  seen.add(identity)
  let resolution
  try{resolution=resolveSourceAdmission({proof,decision:sourceDecisionForProof(state.decisions,proof),policies:state.policies,terms:state.terms,asOf})}
  catch{resolutions.push({currency:proof.currency,state:'hold',reason:'invalid_source_admission_record'});continue}
  if(registeredNewsSourceForUrl({catalog:base,currency:proof.currency,url:proof.url})){
   resolutions.push({...resolution,state:'existing_registered_source',reason:'existing_source_policy_preserved'});continue
  }
  if(resolution.state!=='active'||!resolution.scopes.discover){resolutions.push(resolution);continue}
  const used=counts.get(proof.currency)??0
  if(used>=SOURCE_ADMISSION_POLICY.maxActivePerCountry){resolutions.push({...resolution,state:'hold',reason:'source_admission_capacity'});continue}
  counts.set(proof.currency,used+1)
  const admission={proofBinding:proof.binding,url:proof.url,captureHash:proof.captureHash,expiresAt:proof.expiresAt,
   scopes:resolution.scopes,reason:resolution.reason,articleBinding:proof.articleBinding??null,credit:proof.credit??null,
   ...(resolution.policyId?{policyId:resolution.policyId,policyRevision:resolution.policyRevision,termsHash:resolution.termsHash,scopeEvidenceUrl:resolution.scopeEvidenceUrl}:{})}
  register.newsRoutes.push({id:resolution.sourceId,currency:proof.currency,listingUrl:proof.url,
   verification:'server_scoped_article_pending_content_review',admission,
   discovery:{tier:'supplemental',mode:'existing_adapter',domains:[proof.host],terms:['dólar','cambio'],
    reason:'Bound article-only processing scope; no publisher-wide permission or content approval.'}})
  plan.countryPlans.find(c=>c.currency===proof.currency).newsRefs.push(resolution.sourceId)
  resolutions.push(resolution)
 }
 return {sourcePlan:plan,sourceRegister:register,baseCatalogId:base.catalogId,
  resolutions,binding:sourceStateBinding({state,baseCatalogId:base.catalogId,asOf}),state:structuredClone(state)}
}

export async function currentSourceAdmissionHold({country,store,sourcePlan,sourceRegister,asOf}) {
 const admitted=country.collection.originals.filter(o=>o.sourceAdmission)
 if(!admitted.length)return null
 if(!store.sourceAdmissions)return 'source_admission_settings_unavailable'
 let active
 try{active=admittedSourceCatalog({sourcePlan,sourceRegister,state:await store.sourceAdmissions(),asOf})}
 catch{return 'source_admission_settings_unavailable'}
 const authorization=a=>sourceStateBinding({scopes:a.scopes,reason:a.reason,policyId:a.policyId??null,policyRevision:a.policyRevision??null,termsHash:a.termsHash??null})
 return admitted.some(o=>!active.sourceRegister.newsRoutes.some(s=>s.id===o.sourceId
  &&s.admission&&(s.admission.articleBinding?s.admission.articleBinding===o.sourceAdmission.articleBinding:s.admission.captureHash===o.sha256)
  &&s.admission.scopes.analyze&&s.admission.scopes.publishNotes&&authorization(s.admission)===authorization(o.sourceAdmission)))
  ?'source_admission_changed_before_dispatch':null
}
