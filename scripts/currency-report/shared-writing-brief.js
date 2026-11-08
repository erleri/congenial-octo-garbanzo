import {fitsCommentary,periodIdentity} from './news-period.js'
// Review material for the shared dashboard basis, not an executable model
// request. Never fall back to a historical article-price writer to get a quote.
import {fingerprint} from './research-harness.js'
import {SHARED_REPORT_RULE_VERSION,SHARED_REFERENCE_WRITING_GUIDE} from './shared-price-contract.js'
import {REFERENCE_MATERIAL_WRITING_GUIDE} from './reference-materials.js'
import {EDITORIAL_VERSION,EDITORIAL_INSTRUCTIONS} from './editorial.js'
import {writerProfile} from './writer-policy.js'
import {fxMaterialHolds,FX_REPORT_PRIORITY_INSTRUCTIONS} from './fx-report-priority.js'
import {getDashboardDaily,getDashboardPreviousDaily,getDashboardDailyChange} from '../../src/lib/dashboard-price.js'

export const SHARED_WRITING_BRIEF_VERSION='shared-writing-brief/1'
export function prepareSharedWritingBrief({handoff,writer='sol',purpose='market'}) {
 if(!['market','initial_check','periodic_check','context_update'].includes(purpose))throw Error('registered_shared_writing_purpose_required')
 const c=handoff?.materialConnection,s=handoff?.reportPriceSnapshot,{binding,...bound}=c??{}
 if(c?.version!=='reference-materials/2'||fingerprint(bound)!==binding||s?.ruleVersion!==SHARED_REPORT_RULE_VERSION
  ||c.ruleVersion!==s.ruleVersion||c.currency!==s.currency||c.referenceSnapshotId!==s.snapshotId||!Array.isArray(s.series))
  throw new Error('bound_shared_writing_material_required')
 const current=getDashboardDaily(s.series,s.currency,s.baseDate),previous=getDashboardPreviousDaily(s.series,s.currency,s.baseDate)
 const change=getDashboardDailyChange(current,previous),pct=Number.isFinite(change)?change*100:null
 if(fingerprint(current??null)!==fingerprint(s.current)||fingerprint(previous??null)!==fingerprint(s.previous)
  ||pct!==s.changePct)throw new Error('shared_snapshot_numeric_projection_mismatch')
 const before=fingerprint(handoff),profile=writerProfile(writer),items=Object.values(c.sections).flat()
 // Cadence schedules research, never an exception to FX evidence eligibility.
 const holds=[...c.holds,...fxMaterialHolds(c.sections)]
 if(s.numericStatus!=='pass'||s.referenceBasis.status!=='pass')holds.push('shared_reference_snapshot_held')
 if(items.some(r=>r.sourceUses.external_model.status!=='allowed'))holds.push('authored_note_use_not_allowed')
 if(items.some(r=>['market_observation','attributed_fx_explanation','global_context','countercontext'].includes(r.role)
  &&!fitsCommentary({...r,eventDate:r.eventDate??r.sourceSessionDate},c)))holds.push('current_claim_session_mismatch')
 const factId=kind=>`ref-${s.currency.toLowerCase()}-${kind}-${s.snapshotId.slice(0,12)}`
 const sources=[...new Map(items.map(r=>[r.evidenceId,{evidenceId:r.evidenceId,publisher:r.publisher,url:r.sourceUrl,
  publishedAt:r.publishedAt,collectedAt:r.collectedAt,referencePeriod:r.referencePeriod,...(r.marketPeriod?{marketPeriod:periodIdentity(r.marketPeriod)}:{}),credit:r.sourceCredit,
  articlePriceBasis:r.articlePriceBasis,sourceVersion:r.sourceVersion??null,
  ...(r.officialStatistic?{officialStatistic:r.officialStatistic}:{})}])).values()]
 const material=holds.length?null:{version:SHARED_WRITING_BRIEF_VERSION,ruleVersion:s.ruleVersion,editorialVersion:EDITORIAL_VERSION,
  currency:s.currency,referenceSnapshotId:s.snapshotId,referenceDate:s.baseDate,commentaryDate:c.commentaryDate,...(c.commentaryPeriod?{commentaryPeriod:periodIdentity(c.commentaryPeriod)}:{}),
  referencePolicy:{...s.referenceBasis},
  facts:[{factId:factId('current'),kind:'reference_rate',value:current.value,unit:s.unit,date:current.date},
   {factId:factId('previous'),kind:'previous_reference_rate',value:previous.value,unit:s.unit,date:previous.date},
   {factId:factId('change'),kind:'reference_change_pct',value:s.changePct,unit:'percent',date:s.baseDate}],
  // Whitelist the prose contract. Acquisition bodies, judgments, historical
  // drafts/scores, approval and cost journals do not belong in writer input.
  claims:items.map(r=>({claimId:`${r.evidenceId}:${r.claimId}`,evidenceId:r.evidenceId,role:r.role,text:r.text,
   kind:r.kind,...(r.marketPeriod?{marketPeriod:periodIdentity(r.marketPeriod)}:{}),referencePeriod:r.referencePeriod,sourceSessionDate:r.sourceSessionDate,scope:r.scope,
   allowedUse:r.allowedUse,countercontext:r.countercontext,excludedExpansions:r.excludedExpansions,
   coverageGaps:r.coverageGaps,crossSourceClaims:r.crossSourceClaims,attributions:r.attributions,
   writingContext:r.writingContext??null,evidenceBinding:r.evidenceBinding,scopeBinding:r.scopeBinding})),sources,
  writingGuide:[...SHARED_REFERENCE_WRITING_GUIDE,...REFERENCE_MATERIAL_WRITING_GUIDE,EDITORIAL_INSTRUCTIONS,FX_REPORT_PRIORITY_INSTRUCTIONS],
  officialBackgroundCoverage:c.writingSelection?{status:'optional_background_omitted_for_capacity',selection:c.writingSelection}:c.officialBackground?.coverage??null,
  ...(c.writingSelection?{writingSelection:structuredClone(c.writingSelection)}:{}),
  mechanismApplications:'not_inferred_or_newly_approved_from_news_or_currency_name',
  referenceRateCausalityEstablished:false,originalArticleTextIncluded:false}
 const result={version:SHARED_WRITING_BRIEF_VERSION,currency:s.currency,materialBinding:fingerprint(handoff),
  referenceSnapshotBinding:fingerprint(s),status:holds.length?'material_brief_held':'review_brief_prepared_not_executable',
  holds:[...new Set(holds)],material,materialBytes:material?Buffer.byteLength(JSON.stringify(material)):0,writerProfile:profile,
  generationAdapter:'shared_basis_to_existing_generation_and_validation_contract_not_compiled',
  contentReview:'pending_separate_claim_and_mechanism_review',newInformationValue:'not_approved',
  request:null,exactTrialBudgetUsd:null,paidCallAuthorized:false,publicationApproved:false,
  modelCalls:0,networkCalls:0,newPaidCostUsd:0}
 result.binding=fingerprint(result)
 if(before!==fingerprint(handoff))throw new Error('shared_writing_handoff_mutated')
 return result
}
