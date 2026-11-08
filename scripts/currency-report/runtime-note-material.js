// Deterministic bridge for notes that passed the two original-backed stages.
// An explicit, versioned note-use policy is mandatory; raw-text permission is
// not copied here, and the model cannot approve its own use policy.
import {fingerprint} from './research-harness.js'
import {sourceUseBinding,inspectSourceUses} from './source-use.js'
import {connectSourceAttributionConditions} from './source-attributions.js'
import {materialRoleBinding} from './country-material-preparation.js'
import {validateSelectedReviewCard} from './selected-source-collection.js'
import {MATERIAL_PROCESSING_VERSION,assertProcessingRules,commonAuthoredNotePolicy,assertIndependentNoteText} from './material-processing.js'
import {articleOriginHints} from './news-publisher-access.js'

export function admitRuntimeNotes({collection,card,reviewed,asOf,registry}) {
 const {original}=validateSelectedReviewCard(collection,card)
 if(reviewed.status!=='source_card_prepared'||reviewed.originalComparisonPerformed!==true
  ||reviewed.evidence?.cardBinding!==card.binding)throw Error('completed_original_comparison_required')
 const e=reviewed.evidence.evidence[0],scope=reviewed.evidence.evidenceScopeCards[0]
 assertIndependentNoteText(original,e)
 let template
 if(registry?.version===MATERIAL_PROCESSING_VERSION){
  assertProcessingRules(registry)
  template=commonAuthoredNotePolicy({evidence:e,rules:registry,evaluatedOn:asOf.slice(0,10)})
 }else{
 const matches=(registry?.policies??[]).filter(p=>p.sourceId===card.sourceId&&p.currency===collection.currency
  &&p.origin===new URL(original.url).origin&&new URL(original.url).pathname.startsWith(p.pathPrefix))
 if(registry?.version!=='runtime-note-use-policies/1'||matches.length!==1)return null
 const {binding,...p}=matches[0]
 if(binding!==fingerprint(p)||p.materialKind!=='independently_authored_facts_and_attributed_views'
  ||p.status!=='reviewed'||!p.checkedOn||p.checkedOn>asOf.slice(0,10)||!p.reviewedUse)return null
 if(p.reviewedUse.resourceId!==undefined||p.reviewedUse.resourceBinding!==undefined)throw Error('note_policy_must_not_bind_old_resource')
 template=p.reviewedUse
 }
 const use={...structuredClone(template),resourceId:e.id,resourceBinding:sourceUseBinding(e)}
 const origins=[...new Set([...(original.originHints?.creditedOrigins??[]),...articleOriginHints(original.url,original.blocks).creditedOrigins])]
 const note={version:'source-attribution/1',resourceId:e.id,resourceBinding:sourceUseBinding(e),sourceUrl:e.url,
  publisher:e.publisher,publishedAt:e.publishedAt,referencePeriod:e.period,
  attribution:`출처: ${e.publisher} · ${e.url}${origins.length?' · 기사에 표기된 제공 출처: '+origins.join(', '):''}`,
  transformation:'원문 대조를 거쳐 독립 작성한 사실·귀속 견해의 종합 분석이며 기사 원문·번역·대체물이 아니다.'}
 const sourceUse=connectSourceAttributionConditions({resources:[e],sourceUse:{evaluatedOn:asOf.slice(0,10),reviews:[use]},attributionNotes:[note]})
 const checked=inspectSourceUses({resources:[e],reviews:sourceUse.reviews,evaluatedOn:sourceUse.evaluatedOn,
  renderings:{external_model:[Object.fromEntries(Object.entries(note).filter(([k])=>k!=='version'))]}})
 if(checked.items[0].uses.local_analysis.status!=='allowed'||checked.items[0].uses.external_model.status!=='allowed')return null
 const role=reviewed.assessment.role
 const roleFor=claim=>role==='market_explanation'?claim.kind==='source_interpretation'
  ?claim.passageIds.every(id=>reviewed.assessment.claimScopes?.some(s=>s.noteId===id&&s.causalScope==='local'))?'attributed_fx_explanation'
   :claim.passageIds.every(id=>reviewed.assessment.claimScopes?.some(s=>s.noteId===id&&s.causalScope==='global'))?'global_context':null
  :'market_observation'
  :role==='price_only'?'market_observation':role==='global_context'?'global_context'
   :role==='consumer_background'?'consumer_background':role==='policy_context'?'policy_background':null
 if(scope.admittedClaims.some(c=>!roleFor(c)))return null
 const record={evidenceId:e.id,claimRoles:Object.fromEntries(scope.admittedClaims.map(c=>[c.id,roleFor(c)])),
  sessionDate:reviewed.assessment.marketPeriod?null:reviewed.assessment.eventDate,
  ...(reviewed.assessment.marketPeriod?{marketPeriod:structuredClone(reviewed.assessment.marketPeriod)}:{}),
  priceBasis:`Source article price kind: ${reviewed.assessment.priceKind}; supplementary context, never the dashboard reference.`,
  bodyAvailableAt:original.collectedAt,
  review:{origin:'agent',status:'checked',reason:'Roles follow the separate original comparison; notes retain their attribution, date, scope and conditions.'},
  provenance:{mode:'saved_capture',locator:`${original.url} sha256:${original.sha256}`}}
 return {currency:collection.currency,baseDate:collection.baseDate,asOf,
  packet:{currency:collection.currency,baseDate:collection.baseDate,observedDate:reviewed.assessment.marketPeriod?null:reviewed.assessment.eventDate,
   evidence:[e],evidenceScopeCards:[scope]},materials:[{record,binding:materialRoleBinding(e,record)}],sourceUse}
}
