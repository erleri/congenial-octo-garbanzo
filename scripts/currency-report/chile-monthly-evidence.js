// Offline, opt-in evidence admission from an explicitly reviewed PDF snapshot.
// Hashes prove identity, not truth. A trusted local reviewer must read the pages
// and attest the value/series correspondence (including tables and 'respectively').
import { createHash } from 'node:crypto'
import { chileConsumptionScopes } from './chile-consumption-scopes.js'
import { createSourceContext } from './source-context.js'
import { bindEvidenceScope, projectEvidenceScopes } from './evidence-scope.js'

export const MONTHLY_PDF_REVIEW_VERSION = 'monthly-pdf-review/1'
export const monthlyHash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
const compact = value => value.replace(/\s+/gu, ' ').trim()
const hashPattern = /^[a-f0-9]{64}$/
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const timestamp = value => typeof value === 'string' && day(value.slice(0, 10)) && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const safe = value => !/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|bearer\s+\S+|-----BEGIN .*PRIVATE KEY|<[^>]+>|ignore\s+(previous|all)|system\s*prompt|지시.*무시/i.test(JSON.stringify(value))
const checks = ['page_visual_checked','series_and_value','period_and_comparison','population_and_unit','adjustment_and_base','qualifiers_and_countercontext']

export function monthlyOriginalBinding(original) {
  return monthlyHash({ url: original.url, sha256: original.sha256, bytes: original.bytes,
    collectedAt: original.collectedAt, period: original.period, sourceVersion: original.sourceVersion })
}

export function validateMonthlyExtraction(original, extraction) {
  const url = new URL(original.url)
  if (url.protocol !== 'https:' || url.hostname !== 'www.ine.gob.cl' || url.username || url.password || url.port
    || !/^\/docs\/default-source\/(actividad-mensual-del-comercio|sueldos-y-salarios)\/boletines\//.test(url.pathname)
    || !url.pathname.endsWith('.pdf') || !hashPattern.test(original.sha256) || !timestamp(original.collectedAt)
    || original.sourceVersion !== 'current_file_not_archived' || !Number.isInteger(original.bytes) || original.bytes < 1 || original.bytes > 2000000
    || !/^\d{4}-(0[1-9]|1[0-2])$/.test(original.period)) throw new Error('invalid_monthly_original')
  if (extraction?.version !== 'monthly-pdf-text/1' || extraction.sha256 !== original.sha256 || extraction.bytes !== original.bytes
    || !/^pypdf\/[\d.]+$/.test(extraction.extractor) || !Array.isArray(extraction.pages) || !extraction.pages.length || extraction.pages.length > 24
    || extraction.pages.some((p,i) => p.page !== i + 1 || typeof p.text !== 'string' || p.text.length > 40000 || p.textHash !== monthlyHash(p.text)))
    throw new Error('stale_monthly_extraction')
  return { originalBinding: monthlyOriginalBinding(original), extractionHash: monthlyHash(extraction) }
}

function excerpt(extraction, locator) {
  const page = extraction.pages.find(p => p.page === locator?.page)
  if (!page || typeof locator.text !== 'string' || compact(locator.text).length < 10 || locator.text.length > 7000
    || !compact(page.text).includes(compact(locator.text))) throw new Error('pdf_excerpt_not_found')
  return { page: locator.page, text: compact(locator.text), offset: compact(page.text).indexOf(compact(locator.text)) }
}

function attest(review) {
  if (!['agent','human'].includes(review?.origin) || review.status !== 'checked' || !day(review.reviewedOn)
    || typeof review.reason !== 'string' || review.reason.trim().length < 10 || review.reason.length > 480
    || !Array.isArray(review.checks) || checks.some(c => !review.checks.includes(c))) throw new Error('explicit_pdf_review_required')
}

export function admitChileMonthlyEvidence({ original, extraction, receipt }) {
  const identity = validateMonthlyExtraction(original, extraction), registry = chileConsumptionScopes()
  if (receipt?.version !== MONTHLY_PDF_REVIEW_VERSION || receipt.originalBinding !== identity.originalBinding
    || receipt.extractionHash !== identity.extractionHash || receipt.registryHash !== monthlyHash(registry)
    || receipt.period !== original.period || !registry.verifiedDefinitionPeriods.includes(receipt.period)
    || !safe(receipt) || Buffer.byteLength(JSON.stringify(receipt)) > 64000) throw new Error('stale_monthly_review')
  attest(receipt.review)
  const [year, month] = receipt.period.split('-'), monthName = months[Number(month)-1]
  const periodText = excerpt(extraction, receipt.periodLocator)
  if (!new RegExp(`\\b${monthName}(?: de)? ${year}\\b`, 'i').test(periodText.text)) throw new Error('pdf_period_mismatch')
  if (!day(receipt.publicationDate) || receipt.publicationDate < `${receipt.period}-01`
    || receipt.publicationDate > original.collectedAt.slice(0, 10) || receipt.review.reviewedOn < original.collectedAt.slice(0,10)) throw new Error('invalid_pdf_publication_date')
  const [pubYear, pubMonth, pubDay] = receipt.publicationDate.split('-')
  const publication = excerpt(extraction, receipt.publicationLocator)
  if (!new RegExp(`\\b${Number(pubDay)} de ${months[Number(pubMonth)-1]} de ${pubYear}\\b`, 'i').test(publication.text)) throw new Error('pdf_publication_mismatch')
  const provisional = excerpt(extraction, receipt.provisionalLocator)
  if (!/provisionales/i.test(provisional.text)) throw new Error('pdf_provisional_required')
  // Terms remain a separate gate: review of the numeric source is not a licence.
  if (!['verified','unverified'].includes(receipt.reuse?.status) || receipt.reuse.url !== registry.terms.url
    || typeof receipt.reuse.reason !== 'string' || receipt.reuse.reason.length < 10) throw new Error('pdf_reuse_review_required')
  if (!Array.isArray(receipt.facts) || !receipt.facts.length || receipt.facts.length > 3
    || new Set(receipt.facts.map(f => f.definitionId)).size !== receipt.facts.length) throw new Error('invalid_pdf_facts')
  const definitions = [registry.pay, ...registry.retailRegistry.definitions.slice(0,2)]
  const evidence = [], evidenceScopeCards = [], facts = []
  for (const fact of receipt.facts) {
    const definition = definitions.find(d => d.id === fact.definitionId)
    if (!definition || (definition.id === registry.pay.id) !== original.url.includes('/sueldos-y-salarios/')) throw new Error('pdf_series_mismatch')
    attest(fact.review)
    if (fact.review.reviewedOn < original.collectedAt.slice(0,10)) throw new Error('invalid_pdf_review_date')
    const base = excerpt(extraction, fact.baseLocator)
    if (!new RegExp(`\\b${definition.scope.baseYear}\\s*=\\s*100\\b`).test(base.text)) throw new Error('pdf_base_mismatch')
    if (!Number.isFinite(fact.value) || typeof fact.numberText !== 'string' || !/^-?\d{1,3}(?:,\d+)?%$/.test(fact.numberText)
      || Number(fact.numberText.slice(0,-1).replace(',','.')) !== fact.value) throw new Error('pdf_numeric_value_or_unit_mismatch')
    const value = excerpt(extraction, fact.valueLocator)
    const escaped = fact.numberText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!new RegExp(`(?<![\\d,.-])${escaped}(?![\\d])`).test(value.text)) throw new Error('pdf_value_not_in_excerpt')
    if (!Array.isArray(fact.definitionLocators) || !fact.definitionLocators.length || fact.definitionLocators.length > 3
      || !Array.isArray(fact.qualificationLocators) || !fact.qualificationLocators.length || fact.qualificationLocators.length > 3) throw new Error('pdf_context_required')
    const supporting = [value, ...fact.definitionLocators.map(l => excerpt(extraction,l)), ...fact.qualificationLocators.map(l => excerpt(extraction,l))]
    const selected = [periodText, publication, provisional, base, ...supporting]
    const unique = [...new Map(selected.map(l => [`${l.page}:${l.offset}:${l.text}`,l])).values()].sort((a,b) => a.page-b.page || a.offset-b.offset)
    if (unique.length > 12) throw new Error('pdf_context_too_large')
    const context = createSourceContext({ blocks: unique.map(l => ({kind:'paragraph',text:l.text})), selected:unique.map((_,i) => i) })
    const id = `${definition.id}-${receipt.period}-${original.sha256.slice(0,12)}`
    const claim = `${receipt.period} ${definition.label}: 전년 동월 대비 ${fact.value > 0 ? '+' : ''}${fact.value}%. 실질·계절조정 전 지표.`
    const e = { id, country:'CLP', period:receipt.period, title:`INE ${definition.label} · ${receipt.period}`,
      source:'INE Chile', url:original.url, publishedAt:receipt.publicationDate, publicationTime:null,
      eventDate:receipt.publicationDate, collectedAt:original.collectedAt, summary:claim,
      review:{ originalVerified:true, reuse:receipt.reuse.status, scope:definition.excludedInference }, sourceContext:context,
      provenance:{ documentId:`pdf-${original.sha256}`, independenceKey:`pdf-${original.sha256}`,
        pdfHash:original.sha256, extractionHash:identity.extractionHash, receiptHash:monthlyHash(receipt),
        provisional:true, manuallyReviewed:true, sourceVersion:'current_file_not_archived',
        passagePages:unique.map((l,i) => ({passageId:`p${i}`,page:l.page})),
        attribution:'Instituto Nacional de Estadísticas, Chile', license:registry.terms.license,
        licenseUrl:registry.terms.licenseUrl, transformation:'원문 발췌·지표 분리·한국어 요약. INE의 보증이나 승인이 아님.' } }
    // Metadata excerpts remain in sourceContext; only the value, definition and
    // material qualifiers are claim references (existing scope limit: 8 refs).
    const passageIds = unique.flatMap((l,i) => supporting.some(s => s.page === l.page && s.offset === l.offset && s.text === l.text) ? [`p${i}`] : [])
    const card = bindEvidenceScope(e, { passageIds, scope:definition.scope,
      admittedClaims:[{id:`${definition.id}-value`,kind:'source_fact',text:claim,passageIds}],
      allowedUse:`${receipt.period}의 동일 기간 소비 환경을 검토하는 맥락 자료로만 사용한다.`,
      countercontext:definition.id === registry.pay.id ? registry.pay.qualification : registry.comparisonLimit,
      excludedExpansions:[definition.excludedInference, '당일 환율 변동의 직접 원인 또는 개별 기업의 매출·판매량으로 확대하지 않는다.'],
      coverageGaps:[{subject:'TV 단독 판매량·소비자신용·기업별 셀아웃',status:'not_in_packet'}], crossSourceClaims:[] }, fact.review)
    evidence.push(e); evidenceScopeCards.push(card)
    facts.push({id:`${id}-value`,evidenceId:id,value:fact.value,period:receipt.period,scope:definition.scope,
      locator:{page:value.page,text:value.text},documentId:e.provenance.documentId})
  }
  projectEvidenceScopes({evidence,evidenceScopeCards}, undefined, {required:true})
  return { version:'chile-monthly-evidence/1', identity, evidence, evidenceScopeCards, facts,
    sourceReview:'explicit_reviewer_checked', writingEligibility:'not_assessed', contentQuality:'not_assessed',
    publicationApproved:false, networkCalls:0, modelCalls:0, costUsd:0 }
}
