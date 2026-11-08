import {validMarketPeriod,samePeriod} from './news-period.js'
// Saved material -> common writer handoff. No acquisition, keys, model, DB,
// publication decision or automatic semantic/source-use approval.
import {validDate,referencePeriodStart} from './core.js'
import {fingerprint} from './research-harness.js'
import {projectEvidenceScopes} from './evidence-scope.js'
import {inspectSourceUses} from './source-use.js'
import {projectReviewedNewsNotes} from './reviewed-news-notes.js'
import {assessFxCauseInput} from './fx-cause-input.js'
import {writerProfile} from './writer-policy.js'
import {prepareCountryPriceConnection} from './country-price-connection.js'
import {projectSourceAttributions} from './source-attributions.js'
import {selectCountryMaterialInput} from './material-selection.js'

export const COUNTRY_MATERIAL_VERSION='country-material-preparation/1'
export const PREPARATION_CURRENCIES=Object.freeze(['BRL','COP','PEN','ARS','CLP','MXN'])
const roles=['market_observation','attributed_fx_explanation','global_context','consumer_background','policy_background','countercontext']
const text=v=>typeof v==='string'&&v.trim().length>=10&&v.length<=480
const stamp=v=>typeof v==='string'&&validDate(v.slice(0,10))&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))
const unsafe=v=>/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|bearer\s+\S+|-----BEGIN .*PRIVATE KEY|<[^>]+>|ignore\s+(previous|all)|system\s*prompt|지시.*무시|[?&](?:token|apikey|api_key)=/i.test(JSON.stringify(v))
export const materialRoleBinding=(evidence,record)=>fingerprint({evidence,record})

export function prepareCountryMaterials(input) {
 const {selection,...original}=input
 if(selection===undefined)return prepareUnselectedCountryMaterials(original)
 // Validate even omitted resources first: exclusion cannot hide malformed or
 // unreviewed records. Holds are allowed; invalid bindings are not.
 const baseline=prepareUnselectedCountryMaterials(original)
 const selected=selectCountryMaterialInput(original,selection)
 const result=prepareUnselectedCountryMaterials(selected.input)
 if(selected.record.contentReviewRequired) {
  result.holds=[...new Set([...result.holds,'selected_packet_content_review_required'])]
  result.status='materials_prepared_writer_held'
 }
 return {...result,materialSelection:selected.record,originalInputBinding:baseline.inputBinding}
}

function prepareUnselectedCountryMaterials({currency,baseDate,asOf,packet,materials,sourceUse,attempts=[],causeContext=null,priceInput=null,writer}) {
 if(!PREPARATION_CURRENCIES.includes(currency)||!validDate(baseDate)||!stamp(asOf)||baseDate>asOf.slice(0,10)
  ||packet?.currency!==currency||packet.baseDate!==baseDate||!Array.isArray(packet.evidence)||packet.evidence.length>8
  ||!Array.isArray(materials)||materials.length!==packet.evidence.length||!materials.length
  ||new Set(materials.map(m=>m?.record?.evidenceId)).size!==materials.length
  ||!Array.isArray(attempts)||attempts.length>80)throw new Error('country_material_input_required')
 if(unsafe({materials,attempts})||attempts.some(a=>!a||typeof a.sourceId!=='string'||!/^[a-z0-9_-]{1,100}$/i.test(a.sourceId)
  ||typeof a.status!=='string'||!/^[a-z_]{1,80}$/.test(a.status)||a.reason!=null&&(typeof a.reason!=='string'||a.reason.length>480)))throw new Error('unsafe_material_record')
 const before=fingerprint({packet,materials,sourceUse,attempts,causeContext,priceInput})
 const sessionDate=packet.observedDate??baseDate
 if(!validDate(sessionDate)||sessionDate>baseDate)throw new Error('material_session_required')
 let priceConnection=null
 if(priceInput) {
  const e=packet.evidence.find(e=>e.id===priceInput.articleReview?.evidenceId)
  const original=materials.find(m=>m.record.evidenceId===e?.id)?.record.provenance
  if(priceInput.currency!==currency||priceInput.sessionDate!==sessionDate||priceInput.asOf!==asOf
   ||!e||e.url!==priceInput.articleCapture?.url||original?.mode!=='saved_capture'
   ||!original.locator.includes(`sha256:${priceInput.articleCapture.sha256}`))throw new Error('country_price_material_binding_required')
  priceConnection=prepareCountryPriceConnection(priceInput)
 }
 const scopes=projectEvidenceScopes(packet,undefined,{required:true})
 const externalSourceAttributions=projectSourceAttributions(packet.evidence,sourceUse.attributionNotes)
 const uses=inspectSourceUses({resources:packet.evidence,reviews:sourceUse.reviews,evaluatedOn:sourceUse.evaluatedOn,
  renderings:{external_model:externalSourceAttributions}})
 if(sourceUse.evaluatedOn>asOf.slice(0,10))throw new Error('future_material_use_review')
 const sections=Object.fromEntries(roles.map(role=>[role,[]])),outcomes=[]
 for(const material of materials) {
  const r=material.record,e=packet.evidence.find(e=>e.id===r?.evidenceId),scope=scopes.find(s=>s.evidenceId===e?.id)
  if(!e||!scope||!r.claimRoles||typeof r.claimRoles!=='object'||Array.isArray(r.claimRoles)
   ||!['agent','human'].includes(r.review?.origin)||r.review.status!=='checked'||!text(r.review.reason)
   ||material.binding!==materialRoleBinding(e,r)||!Object.keys(r.claimRoles).length
   ||Object.entries(r.claimRoles).some(([id,role])=>!roles.includes(role)||!scope.admittedClaims.some(c=>c.id===id))
   ||!['saved_capture','manual_official_page','saved_review'].includes(r.provenance?.mode)
   ||!text(r.provenance.locator)||!(r.marketPeriod?r.sessionDate===null&&validMarketPeriod(r.marketPeriod)&&samePeriod(r.marketPeriod,e.marketPeriod)&&r.marketPeriod.end<=asOf.slice(0,10):validDate(r.sessionDate)&&r.sessionDate<=baseDate)
   ||e.country!==currency&&e.country!=='GLOBAL')throw new Error('unreviewed_country_material_role')
  if(e.newsNotes)projectReviewedNewsNotes(e)
  const holds=[],use=uses.items.find(u=>u.resourceId===e.id)
  if(use.uses.local_analysis.status!=='allowed')holds.push('local_source_use_pending')
  if(!e.publishedAt)holds.push('publication_not_verified')
  else if(!(validDate(e.publishedAt)||stamp(e.publishedAt))||Date.parse(e.publishedAt)>Date.parse(asOf))holds.push('published_after_cutoff')
  // Period is separate from publication: August statistics may inform an
  // October background, but cannot become that day's market observation.
  const periodStart=referencePeriodStart(e.period)
  if(!periodStart)holds.push('reference_period_unverified')
  if(periodStart>baseDate||e.eventDate>baseDate)holds.push('future_reference_period')
  const assignedRoles=[...new Set(Object.values(r.claimRoles))]
  if(assignedRoles.some(role=>['market_observation','attributed_fx_explanation'].includes(role))) {
   if(!r.marketPeriod&&(r.sessionDate!==sessionDate||e.eventDate!==sessionDate))holds.push('market_session_mismatch')
   if(!text(r.priceBasis))holds.push('market_price_basis_unverified')
  }
  if(assignedRoles.includes('attributed_fx_explanation')&&(!e.newsNotes||!Object.keys(r.claimRoles).filter(id=>r.claimRoles[id]==='attributed_fx_explanation').every(id=>{
   const claim=scope.admittedClaims.find(c=>c.id===id)
   return claim.kind==='source_interpretation'&&claim.passageIds.every(pid=>e.newsNotes.notes.some(n=>n.id===pid&&n.kind==='attributed_view'))
  })))holds.push('explicit_attributed_connection_required')
  // A revised close cannot inherit the initial morning publication timestamp.
  if(r.bodyAvailableAt&&(!stamp(r.bodyAvailableAt)||Date.parse(r.bodyAvailableAt)>Date.parse(asOf)))holds.push('body_version_after_cutoff')
  if(r.historicalAvailability==='unverified')holds.push('historical_body_availability_unverified')
  for(const role of assignedRoles) {
  const claims=scope.admittedClaims.filter(c=>r.claimRoles[c.id]===role)
  if(!holds.length)sections[role].push({evidenceId:e.id,url:e.url,publisher:e.publisher??e.source,
   publishedAt:e.publishedAt,bodyAvailableAt:r.bodyAvailableAt??null,referencePeriod:e.period,eventDate:e.eventDate,
   sessionDate:r.sessionDate,priceBasis:r.priceBasis??null,claims,scope:scope.scope,
   allowedUse:scope.allowedUse,countercontext:scope.countercontext,excludedExpansions:scope.excludedExpansions,
   ...(e.newsNotes?{attributions:e.newsNotes.notes.filter(n=>claims.some(c=>c.passageIds.includes(n.id))).map(n=>({id:n.id,attribution:n.attribution}))}:{})})
  }
  outcomes.push({evidenceId:e.id,roles:assignedRoles,status:holds.length?'held':'local_reviewed_material',holds,
   externalModel:use.uses.external_model.status,publicDisplay:use.uses.public_display.status,
   acquisition:r.provenance.mode,semanticReview:'recorded_agent_or_human_judgment_not_independent'})
 }
 const writerHolds=[]
 if(!sections.market_observation.length)writerHolds.push('reviewed_market_observation_missing')
 if(!sections.attributed_fx_explanation.length)writerHolds.push('attributed_currency_explanation_missing')
 if(priceConnection)writerHolds.push(...priceConnection.holds.map(h=>`price_connection:${h}`))
 // Existing writers project the whole supplied packet. Held background cannot
 // ride along merely because the main market section is otherwise ready.
 for(const o of outcomes)for(const hold of o.holds)writerHolds.push(`material_hold:${o.evidenceId}:${hold}`)
 let causeAssessment=null
 if(causeContext) {
  if(Object.keys(causeContext).some(k=>!['packet','dossier','review','sourceUse'].includes(k))
   ||causeContext.packet.currency!==currency||causeContext.packet.baseDate!==baseDate
   ||fingerprint(causeContext.packet.evidence)!==fingerprint(packet.evidence))throw new Error('country_cause_context_mismatch')
  causeAssessment=assessFxCauseInput(causeContext)
  writerHolds.push(...causeAssessment.holds)
 } else writerHolds.push('verified_price_pair_and_fx_cause_review_required')
 // This handoff deliberately does not project its held sources into a request.
 // The existing purpose-specific writer compiler remains the only next step.
 for(const o of outcomes.filter(o=>o.status!=='held'))if(o.externalModel!=='allowed')writerHolds.push(`external_source_use_pending:${o.evidenceId}`)
 const holds=[...new Set(writerHolds)]
 const result={version:COUNTRY_MATERIAL_VERSION,currency,baseDate,sessionDate,asOf,caseMode:'saved_material_preparation_not_current_publication',
  inputBinding:before,status:holds.length?'materials_prepared_writer_held':'materials_ready_for_existing_writer_compiler',
  writerProfile:writerProfile(writer),sections,outcomes,holds,causeAssessment,priceConnection,externalSourceAttributions,
  attempts:attempts.map(a=>({sourceId:a.sourceId,status:a.status,reason:a.reason??null})),
  request:null,publicationDecision:null,publicationApproved:false,paidCallAuthorized:false,
  modelCalls:0,networkCalls:0,newPaidCostUsd:0,semanticQuality:'not_model_tested'}
 if(before!==fingerprint({packet,materials,sourceUse,attempts,causeContext,priceInput}))throw new Error('country_material_input_mutated')
 return result
}
