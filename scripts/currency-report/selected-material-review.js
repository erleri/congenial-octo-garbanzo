// A collector produces a pending template, never writes its own reviewer verdict.
// Explicit local review projects only independently worded facts/attributed views
// through the existing notes and scope contracts. No source-use/public approval.
import {validateSelectedReviewCard} from './selected-source-collection.js'
import {createReviewedNewsEvidence} from './reviewed-news-notes.js'
import {bindEvidenceScope,projectEvidenceScopes} from './evidence-scope.js'
import {createSourceContext} from './source-context.js'
import {INEGI_REPORT_INDICATORS,inegiDefinitionId,inegiScopeMatches} from './inegi-report-indicators.js'

export function reviewSelectedNewsMaterial({collection,card,receipt}) {
  const {original}=validateSelectedReviewCard(collection,card)
  if(card.materialKind!=='article'||card.reviewAdapter!=='reviewed_news_notes'
    ||receipt?.cardBinding!==card.binding||!Array.isArray(receipt.checkedChecks)
    ||card.requiredChecks.some(check=>!receipt.checkedChecks.includes(check))
    ||!Array.isArray(receipt.supportingReferences)||receipt.supportingReferences.length!==receipt.notes?.length
    ||receipt.source?.country!==collection.currency||receipt.source?.url!==original.url
    ||!original.metadata?.publishedAt||receipt.source?.publishedAt!==original.metadata.publishedAt
    ||receipt.source?.collectedAt!==original.collectedAt)throw new Error('selected_material_review_required')
  const ids=new Set()
  for(const reference of receipt.supportingReferences) {
    if(ids.has(reference.noteId)||!receipt.notes.some(note=>note.id===reference.noteId)
      ||!Array.isArray(reference.blockPositions)||!reference.blockPositions.length||reference.blockPositions.length>8
      ||new Set(reference.blockPositions).size!==reference.blockPositions.length
      ||reference.blockPositions.some(index=>!Number.isInteger(index)||index<0||!original.blocks[index])
      ||typeof reference.reason!=='string'||reference.reason.trim().length<10||reference.reason.length>480)
      throw new Error('note_original_support_review_required')
    ids.add(reference.noteId)
  }
  const evidence=createReviewedNewsEvidence(receipt.source,receipt.notes,receipt.review)
  const scope=bindEvidenceScope(evidence,receipt.scopeDraft,receipt.scopeReview)
  const bundle={evidence:[evidence],evidenceScopeCards:[scope]}
  projectEvidenceScopes(bundle,undefined,{required:true})
  return {version:'selected-material-review/1',currency:collection.currency,originalId:original.id,cardBinding:card.binding,...bundle,
    supportingReferences:structuredClone(receipt.supportingReferences),sourceUseStatus:'not_assessed',
    temporalStatus:card.historicalVersionStatus,independentReview:'not_performed',
    writingEligibility:'not_assessed',publicationApproved:false,networkCalls:0,modelCalls:0,newPaidCostUsd:0}
}

export function reviewSelectedStatisticMaterial({collection,card,receipt}) {
  const {original}=validateSelectedReviewCard(collection,card)
  if(original.definitionId) {
    const definition=INEGI_REPORT_INDICATORS.find(d=>d.indicatorId===original.seriesId)
    if(!definition||original.definitionId!==inegiDefinitionId(definition)||receipt?.definitionId!==original.definitionId
      ||!inegiScopeMatches(receipt.scopeDraft?.scope,definition))throw new Error('inegi_definition_scope_review_required')
  }
  if(card.materialKind!=='statistic'||card.reviewAdapter!=='statistic_scope_and_source_use'
    ||receipt?.cardBinding!==card.binding||!Array.isArray(receipt.checkedChecks)
    ||card.requiredChecks.some(check=>!receipt.checkedChecks.includes(check))
    ||!['agent','human'].includes(receipt.review?.origin)||receipt.review.status!=='checked'
    ||typeof receipt.review.reason!=='string'||receipt.review.reason.trim().length<10||receipt.review.reason.length>480
    ||!/^\d{4}-\d{2}-\d{2}$/.test(receipt.review.checkedOn??'')||receipt.review.checkedOn<original.collectedAt.slice(0,10)
    ||original.unit==='source_rate_unit_pending_review'||receipt.scopeDraft?.scope?.unit!==original.unit
    ||!Array.isArray(receipt.observationIndexes)||!receipt.observationIndexes.length||receipt.observationIndexes.length>8
    ||new Set(receipt.observationIndexes).size!==receipt.observationIndexes.length
    ||receipt.observationIndexes.some(i=>!Number.isInteger(i)||i<0||!Number.isFinite(original.observations[i]?.value)))
    throw new Error('statistic_scope_review_required')
  const rows=receipt.observationIndexes.map(i=>original.observations[i])
  const periods=[...new Set(rows.map(r=>r.period??r.date))]
  if(periods.length!==1||!card.targets.some(t=>t.requestedPeriod===periods[0]))throw new Error('statistic_period_review_required')
  const sourceContext=createSourceContext({blocks:rows.map(row=>({kind:'paragraph',text:JSON.stringify({unit:original.unit,...row})})),
    selected:rows.map((_,i)=>i)})
  const evidence={id:`stat-${original.id.slice(0,24)}`,country:collection.currency,period:periods[0],
    title:`${card.sourceId} · ${periods[0]}`,source:card.sourceId,url:original.url,
    publishedAt:original.publishedAt??null,eventDate:null,collectedAt:original.collectedAt,
    review:{originalVerified:true,reuse:'pending',scope:'Explicit scope review over normalized provider observations; source-use and publication time remain separate.'},
    sourceContext,provenance:{...(original.hashBasis?{projectionSha256:original.sha256,hashBasis:original.hashBasis,
      definitionId:original.definitionId,definitionVersion:original.definitionVersion,definitionSources:original.metadata.definitionSources,
      scope:original.scope}:{rawSha256:original.sha256}),transformation:'Provider JSON normalized into selected observation rows, not an article excerpt.',
      cardBinding:card.binding,checkedOn:receipt.review.checkedOn}}
  const scope=bindEvidenceScope(evidence,receipt.scopeDraft,receipt.review)
  const bundle={evidence:[evidence],evidenceScopeCards:[scope]}
  projectEvidenceScopes(bundle,undefined,{required:true})
  return {version:'selected-material-review/1',currency:collection.currency,originalId:original.id,cardBinding:card.binding,...bundle,
    sourceUseStatus:'not_assessed',temporalStatus:evidence.publishedAt?'publication_pending_review':'publication_unverified',
    independentReview:'not_performed',writingEligibility:'not_assessed',publicationApproved:false,networkCalls:0,modelCalls:0,newPaidCostUsd:0}
}
