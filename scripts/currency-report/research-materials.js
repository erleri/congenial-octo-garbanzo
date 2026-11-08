// Local collection-output handoff. Reuses the existing dossier, scope, temporal
// and needs checks. This does not call a writer or approve a report.
import {inspectDossier,fingerprint,HARNESS_VERSION} from './research-harness.js'
import {packetBinding} from './rules.js'
import {projectEvidenceScopes} from './evidence-scope.js'
import {projectSourceContext} from './source-context.js'
import {researchSourceTimeIssue} from './research-needs.js'
import {planChileConsumptionNeeds} from './chile-consumption-scopes.js'
import {inspectSourceUses} from './source-use.js'

export const RESEARCH_MATERIALS_VERSION='research-materials/1'
export function priceUseResource(packet) {
  return {id:'official-price',currency:packet.currency,baseDate:packet.baseDate,observedDate:packet.observedDate,
    marketData:packet.marketData,facts:packet.facts,series:packet.series}
}

export function prepareResearchMaterials({prepared,monthlyBundles=[],sourceUse,asOf,consumerPeriod}) {
  const official=prepared?.version==='bcch-report-input/1'&&prepared.sourceAdapter==='bcch-bde-api/1'
  if(!(prepared?.version==='publisher-admission/1'||official) || !Array.isArray(monthlyBundles) || monthlyBundles.length>2
    || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(asOf??'') || !Number.isFinite(Date.parse(asOf))
    || asOf.slice(0,10)!==prepared.packet?.baseDate || !sourceUse) throw new Error('invalid_material_handoff')
  const frozen=fingerprint({prepared,monthlyBundles,sourceUse}),packet=structuredClone(prepared.packet)
  if(official&&(packet.evidence?.length||packet.evidenceScopeCards?.length)) throw new Error('official_price_contains_unreviewed_evidence')
  const coverage=inspectDossier(packet,prepared.dossier??{version:HARNESS_VERSION,packetHash:packetBinding(packet),cards:[]})
  if(coverage.rejected.length) throw new Error('invalid_material_dossier')
  // Scope projection enforces unchanged source passages and reviewer records.
  if(packet.evidence.length) projectEvidenceScopes(packet,undefined,{required:true})
  else packet.evidenceScopeCards=[]
  for(const b of monthlyBundles) {
    if(b?.version!=='chile-monthly-evidence/1' || !Array.isArray(b.evidence) || !b.evidence.length
      || b.evidence.some(e=>e.country!==packet.currency) || b.sourceReview!=='explicit_reviewer_checked')
      throw new Error('invalid_monthly_materials')
    projectEvidenceScopes(b,undefined,{required:true})
    packet.evidence.push(...structuredClone(b.evidence))
    packet.evidenceScopeCards.push(...structuredClone(b.evidenceScopeCards))
  }
  if(new Set(packet.evidence.map(e=>e.id)).size!==packet.evidence.length) throw new Error('duplicate_material_identity')
  const scopes=packet.evidence.length?projectEvidenceScopes(packet,undefined,{required:true}):[]
  const resources=[priceUseResource(packet),...packet.evidence]
  const use=inspectSourceUses({resources,reviews:sourceUse.reviews,evaluatedOn:sourceUse.evaluatedOn})
  const items=packet.evidence.map(e=>{
    const temporal=researchSourceTimeIssue(e,asOf),uses=use.items.find(i=>i.resourceId===e.id).uses
    return {evidenceId:e.id,period:e.period,publicationDate:e.publishedAt,collectedAt:e.collectedAt,
      sourceUse:uses,temporalIssue:temporal,
      usableForContentReview:!temporal&&uses.external_model.status==='allowed',
      // A day/period or rights check never establishes real-world claim support.
      semanticReview:'recorded_scope_judgment_only',directCauseAllowed:false}
  })
  const questions=coverage.questions.map(q=>{
    const cards=coverage.cards.filter(c=>c.questionId===q.id)
    const candidateIds=[...new Set(cards.map(c=>c.evidenceId))]
    const blocked=candidateIds.filter(id=>!items.find(i=>i.evidenceId===id).usableForContentReview)
    const status=q.status==='conflict'?'conflict':!cards.length?'evidence_pending':blocked.length?'material_review_required':'usable_for_content_review'
    return {id:q.id,question:q.question,required:q.required,status,evidenceIds:candidateIds,blockedEvidenceIds:blocked,
      nextAction:status==='conflict'?'review_conflict':status==='evidence_pending'?'collect_and_review_original'
        :status==='material_review_required'?'resolve_source_use_or_time':'review_claim_support_and_novelty'}
  })
  const consumer=consumerPeriod===undefined?null:planChileConsumptionNeeds({
    packet:{...packet,purpose:'economic_update'},purpose:'economic_update',asOf,period:consumerPeriod,maxQueries:0,
    sourceUse:{evaluatedOn:sourceUse.evaluatedOn,reviews:sourceUse.reviews.filter(r=>packet.evidence.some(e=>e.id===r.resourceId))},
  })
  const consumerQuestions=consumer?.questions.filter(q=>!q.required)??[]
  const effectiveQuestions=questions.map(q=>q.id==='consumer'&&consumerQuestions.length?{
    ...q,status:consumerQuestions.every(q=>q.status==='available')?'usable_for_content_review':'material_review_required',
    coverageType:'targeted_monthly_background',period:consumerPeriod,latestness:'not_assessed',
    evidenceIds:[...new Set(consumerQuestions.flatMap(q=>q.requirements.flatMap(r=>r.evidenceIds)))],
    nextAction:consumerQuestions.every(q=>q.status==='available')?'review_claim_support_and_novelty':'resolve_consumer_requirements',
  }:q)
  const price=use.items.find(i=>i.resourceId==='official-price')
  const basis=packet.marketData?.reportPriceBasis
  const contentReviewPrice=price.uses.external_model.status==='allowed'?{
    currency:packet.currency,baseDate:packet.baseDate,observedDate:packet.observedDate,
    facts:packet.facts?.map(({id,value,label})=>({id,value,label})),series:packet.series?.map(({date,value})=>({date,value})),
    priceBasis:basis?{provider:basis.provider,seriesId:basis.seriesId,priceKind:basis.priceKind,dateBasis:basis.dateBasis,
      timeZone:basis.timeZone,attribution:basis.attribution?{source:basis.attribution.source,seriesId:basis.attribution.seriesId,
        termsUrl:basis.attribution.termsUrl,adaptationResponsibility:basis.attribution.adaptationResponsibility}:null,
      observations:basis.observations.map(({effectiveDate,localSessionDate,observedAt,publishedAt,observationWindow})=>({
        effectiveDate,localSessionDate,observedAt,publishedAt,
        observationWindow:observationWindow?{startAt:observationWindow.startAt,endAt:observationWindow.endAt}:null}))}:null,
    directCauseAllowed:false}:null
  // This is a bounded projection for inspection, not a dispatch-ready prompt.
  // No private receipts, raw responses, reviewer data or arbitrary provenance.
  const materials=packet.evidence.filter(e=>items.find(i=>i.evidenceId===e.id).usableForContentReview).map(e=>({
    id:e.id,title:e.title,source:e.source,url:e.url,publishedAt:e.publishedAt,eventDate:e.eventDate,period:e.period,
    sourceContext:projectSourceContext(e),scope:scopes.find(c=>c.evidenceId===e.id),
    attribution:e.provenance?.attribution??e.source,license:e.provenance?.license??null,
    licenseUrl:e.provenance?.licenseUrl??null,transformation:e.provenance?.transformation??null,
    directCauseAllowed:false,
  }))
  if(fingerprint({prepared,monthlyBundles,sourceUse})!==frozen) throw new Error('material_input_mutated')
  return {version:RESEARCH_MATERIALS_VERSION,mode:'saved_inputs_only',currency:packet.currency,baseDate:packet.baseDate,
    observedDate:packet.observedDate,asOf,evaluatedOn:sourceUse.evaluatedOn,
    binding:fingerprint({input:frozen,asOf,consumerPeriod:consumerPeriod??null}),
    price:{resourceId:price.resourceId,uses:price.uses,dataValidation:'existing_prepared_price_contract',directCauseAllowed:false},
    items,questions:effectiveQuestions,consumerNeeds:consumer,
    materialStatus:price.uses.external_model.status==='allowed'&&effectiveQuestions.filter(q=>q.required).every(q=>q.status==='usable_for_content_review')
      ?'ready_for_content_review':'incomplete',
    contentReviewPrice,contentReviewMaterials:materials,
    missingQuestions:[...effectiveQuestions.filter(q=>q.status!=='usable_for_content_review'),
      ...(consumer?.questions.filter(q=>!q.required&&q.status!=='available')??[])],
    writingEligibility:{eligible:false,reasons:['independent_content_review_required','novelty_not_assessed','publication_not_approved']},
    contentQuality:'not_assessed',publicationApproved:false,networkCalls:0,modelCalls:0,newApiCostUsd:0,
    limitations:['사용 범위 기록은 검토자의 판단이다. 해시는 이용 권한이나 의미적 지지를 증명하지 않는다.',
      '소비 대상 월은 명시적으로 선택한 배경이다. 최신 지표 확인 또는 당일 환율 원인으로 취급하지 않는다.',
      '이 결과는 수집·입력 검토용이며 집필·게시 명령에 자동 전달하지 않는다.']}
}
