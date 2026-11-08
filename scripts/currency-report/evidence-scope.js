import { createHash } from 'node:crypto'
import { projectSourceContext } from './source-context.js'
import {projectSharedScopes} from './shared-writing-contract.js'

export const EVIDENCE_SCOPE_VERSION = 'evidence-scope/1'
export const SCOPE_RULE_VERSION = 'economic-scope-review/2'
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const meaningful = value => typeof value === 'string' && value.trim().length >= 10 && value.length <= 480
const description = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 480
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
const safe = value => !/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|-----BEGIN .*PRIVATE KEY|bearer\s+\S+|<[^>]+>|ignore\s+(previous|all)|system\s*prompt|지시.*무시/i.test(JSON.stringify(value))
const list = (values, max, predicate) => Array.isArray(values) && values.length <= max && values.every(predicate)
const refs = values => list(values, 8, id) && values.length > 0 && new Set(values).size === values.length

export const SCOPE_CRITERIA = Object.freeze({
  comparison: '대상·기간·단위·비교 집합이 같은가? 강조를 순위로, 변화율을 기여도로 바꾸지 않았는가?',
  population: '지수 평균을 가구별 부담·전 가구 소득·실제 판매로 확대하지 않았는가?',
  period: '발표 시점과 지표 대상 기간을 구분하고 서로 다른 달의 지표를 합치지 않았는가?',
  availability: '입력 미포함·확인 실패·공식 미발표·실제 부재를 구분하는가?',
  entailment: '제목·요약을 포함한 각 문장의 모든 주장이 원문 또는 승인된 원리 적용으로 지지되는가?',
})
export const SCOPE_INSTRUCTIONS = [
  '근거 카드의 scope·admittedClaims·coverageGaps를 제공된 근거와 함께 읽는다. reviewer_authored_notes는 검토자의 요지이며 원문이 아니다. 제공되지 않은 원문을 조회·복원하지 않는다. 근거끼리 충돌하면 검토를 요구한다.',
  '제목·요약·소제목에도 같은 대상·강도·기간을 적용한다. 원문이 강조한 항목을 가장 큰 항목이나 상승을 주도한 항목으로 승격하지 않는다. 순위에는 완전한 동일 기준 비교표 또는 출처가 명시한 귀속 순위가 필요하다.',
  '분류 가격의 변화율과 전체 지수에 대한 기여도를 구분한다. 같은 지수의 양·음 기여는 상승·상쇄로 설명할 수 있으나 가계 부담의 크기·분포를 관측한 것으로 바꾸지 않는다.',
  '실질보수는 이미 물가 조정된 보수 지표다. 다른 달 CPI를 다시 빼거나 전 가구 소득·판매로 확대하지 않는다. 입력에 없는 조사 모집단을 새로 특정하지 않는다.',
  'coverageGaps의 not_in_packet·not_verified는 조사 상태다. 현실의 미발표·부재 주장이 아니다. 공통 한계에 필요한 만큼만 표시하고 문단마다 반복하지 않는다.',
  '안전한 조건부 설명과 출처에 귀속한 해석은 유지한다. 적용 가능한 승인 원리와 조건이 있을 때만 사용한다. 경고를 늘리거나 개수를 채우는 것이 목표가 아니다.',
  'crossSourceClaims의 관계를 실제 문장에 사용하면 requiredEvidenceIds 전체를 해당 위치의 출처 연결과 본문 블록 evidenceIds 양쪽에 연결한다. 서로 다른 월의 관계도 두 자료의 기간을 각각 확인한다. 사용하지 않은 관계나 단일 자료 설명에 다른 출처를 억지로 붙이지 않는다.',
].join('\n')

export function evidenceScopeBinding(evidence) {
  const context = projectSourceContext(evidence)
  if (!context) throw new Error('scope_original_required')
  return hash({ id: evidence.id, country: evidence.country, url: evidence.url, publishedAt: evidence.publishedAt,
    eventDate: evidence.eventDate, period: evidence.period,
    ...(evidence.newsNotes?{noteHash:context.noteHash}:{bodyHash:evidence.sourceContext.bodyHash}), passageHash: context.passageHash })
}

// Trusted local reviewer explicitly supplies the judgment. Binding is an
// integrity guard, not human authentication or automatic semantic approval.
export function bindEvidenceScope(evidence, draft, review) {
  const fields = ['passageIds', 'scope', 'admittedClaims', 'allowedUse', 'countercontext', 'excludedExpansions', 'coverageGaps', 'crossSourceClaims']
  const card = { version: EVIDENCE_SCOPE_VERSION, evidenceId: evidence.id, sourceBinding: evidenceScopeBinding(evidence),
    period: evidence.period, ...Object.fromEntries(fields.map(key => [key, structuredClone(draft[key] ?? (key === 'crossSourceClaims' ? [] : undefined))])) }
  return { ...card, review: { origin: review.origin, status: review.status, reason: review.reason, binding: hash(card) } }
}

export function projectEvidenceScopes(packet, cards = packet.evidenceScopeCards, { required = false } = {}) {
  if(packet.sharedReference)return projectSharedScopes(packet)
  if (cards === undefined && !required) return []
  if (!Array.isArray(cards) || !cards.length || cards.length > 8 || new Set(cards.map(c => c?.evidenceId)).size !== cards.length)
    throw new Error('scope_cards_required')
  return cards.map(card => {
    if (!card || typeof card !== 'object') throw new Error('unreviewed_or_stale_scope_card')
    const evidence = packet.evidence.find(e => e.id === card?.evidenceId)
    const context = evidence && projectSourceContext(evidence)
    const { review, ...bound } = card
    if (!evidence || !context || card.version !== EVIDENCE_SCOPE_VERSION || card.sourceBinding !== evidenceScopeBinding(evidence)
      || card.period !== evidence.period || !['agent', 'human'].includes(review?.origin) || review.status !== 'checked'
      || !meaningful(review.reason) || review.binding !== hash(bound) || !safe(card) || Buffer.byteLength(JSON.stringify(card)) > 16000
      || !refs(card.passageIds) || card.passageIds.some(p => !context.passages.some(x => x.id === p))
      || !card.scope || !['subject', 'metric', 'unit', 'comparison'].every(k => description(card.scope[k]))
      || Object.keys(card.scope).length > 8 || Object.values(card.scope).some(v => typeof v !== 'string' || v.length > 480)
      || card.scope.rankingStatus !== undefined && !['full_division_ranking_unverified', 'complete_comparison_verified', 'source_attributed_ranking', 'not_applicable'].includes(card.scope.rankingStatus)
      || !meaningful(card.allowedUse) || !meaningful(card.countercontext)
      || !list(card.admittedClaims, 12, c => id(c?.id) && ['source_fact', 'source_interpretation', 'same_index_arithmetic'].includes(c.kind)
        && meaningful(c.text) && refs(c.passageIds) && c.passageIds.every(p => card.passageIds.includes(p))) || !card.admittedClaims.length
      || new Set(card.admittedClaims.map(c => c.id)).size !== card.admittedClaims.length
      || !list(card.excludedExpansions, 12, v => typeof v === 'string' && v.length > 0 && v.length <= 240)
      || !list(card.coverageGaps, 12, g => description(g?.subject) && ['not_in_packet', 'not_verified'].includes(g.status))
      || !list(card.crossSourceClaims, 8, c => description(c?.subject) && refs(c.requiredEvidenceIds)
        && c.requiredEvidenceIds.includes(evidence.id) && c.requiredEvidenceIds.every(ref => packet.evidence.some(e => e.id === ref))))
      throw new Error('unreviewed_or_stale_scope_card')
    // Do not transmit review names, approval flags, private receipts or arbitrary fields.
    return { evidenceId: card.evidenceId, period: card.period, passageIds: [...card.passageIds], scope: { ...card.scope },
      admittedClaims: card.admittedClaims.map(({ id, kind, text, passageIds }) => ({ id, kind, text, passageIds: [...passageIds] })),
      allowedUse: card.allowedUse, countercontext: card.countercontext, excludedExpansions: [...card.excludedExpansions],
      coverageGaps: card.coverageGaps.map(({ subject, status }) => ({ subject, status })),
      crossSourceClaims: card.crossSourceClaims.map(({ subject, requiredEvidenceIds }) => ({ subject, requiredEvidenceIds: [...requiredEvidenceIds] })) }
  })
}

// This checks reference completeness, never whether an original supports prose.
export function claimReferenceIssues(packet, content, claims, ledger, requirements = []) {
  const relationIssues = relationReferenceIssues(packet, content, claims, ledger, requirements)
  if (ledger === undefined) return relationIssues
  if (!Array.isArray(ledger)) return [{ code: 'claim_ledger_required' }]
  const normalize = s => typeof s === 'string' ? s.replace(/\s+/gu, '') : ''
  const issues = []
  for (const claim of claims.filter(c => !c.target.startsWith('change.'))) {
    const matches = ledger.filter(r => r?.target === claim.target && normalize(r.quote) === normalize(claim.quote))
    if (matches.length !== 1) { issues.push({ code: 'claim_mapping', claimId: claim.id }); continue }
    const refs = matches[0].evidenceIds
    if (!Array.isArray(refs) || new Set(refs).size !== refs.length || refs.some(id => !packet.evidence.some(e => e.id === id))) {
      issues.push({ code: 'unknown_claim_reference', claimId: claim.id }); continue
    }
    const [section, index] = claim.target.split('.'), block = content[section]?.[Number(index)]
    const missing = refs.filter(id => block && !block.evidenceIds?.includes(id))
    if (missing.length) issues.push({ code: 'block_source_missing', claimId: claim.id, evidenceIds: missing })
  }
  if (ledger.some(r => !claims.some(c => r?.target === c.target && normalize(r.quote) === normalize(c.quote)))) issues.push({ code: 'extra_claim' })
  return [...issues, ...relationIssues]
}

// A reviewer names the exact relation and necessary sources. We do not infer
// causal/period relations from keywords or attach all packet sources as a fix.
export function relationReferenceIssues(packet, content, claims, ledger, requirements) {
  if (!Array.isArray(requirements)) return [{ code: 'relation_requirements_invalid' }]
  const issues = [], seen = new Set()
  for (const r of requirements) {
    const c = claims.find(c => c.target === r?.target && c.quote === r?.quote)
    if (!c || seen.has(c.id) || !refs(r.evidenceIds) || r.evidenceIds.length < 2 || !meaningful(r.reason) || !safe(r)
      || r.evidenceIds.some(id => !packet.evidence.some(e => e.id === id))) {
      issues.push({ code: 'relation_requirements_invalid' }); continue
    }
    seen.add(c.id)
    const mapped = Array.isArray(ledger) ? ledger.filter(l => l?.target === c.target && l.quote === c.quote) : []
    const [section, index] = c.target.split('.'), block = content[section]?.[Number(index)]
    const missing = r.evidenceIds.filter(id => !c.evidenceIds.includes(id) || mapped.length !== 1 || !mapped[0].evidenceIds?.includes(id) || block && !block.evidenceIds?.includes(id))
    if (missing.length) issues.push({ code: 'relation_source_missing', claimId: c.id, evidenceIds: missing })
  }
  return issues
}

export function reviseClaimReferences(packet, content, claims, ledger, requirements) {
  const issues = relationReferenceIssues(packet, content, claims, ledger, requirements)
  if (issues.some(i => i.code !== 'relation_source_missing')) throw new Error('invalid_reference_revision')
  if (!Array.isArray(ledger)) throw new Error('claim_ledger_required')
  const next = structuredClone(content), nextLedger = structuredClone(ledger)
  for (const r of requirements) {
    const mapped = nextLedger.filter(l => l.target === r.target && l.quote === r.quote)
    if (mapped.length !== 1) throw new Error('claim_mapping_required')
    mapped[0].evidenceIds = [...new Set([...mapped[0].evidenceIds, ...r.evidenceIds])]
    const [section, index] = r.target.split('.'), block = next[section]?.[Number(index)]
    if (block) block.evidenceIds = [...new Set([...block.evidenceIds, ...r.evidenceIds])]
  }
  return { version: 'claim-reference/2', content: next, claimLedger: nextLedger,
    parentContentHash: hash(content), requirements: structuredClone(requirements),
    status: 'requires_recheck', publicationApproved: false }
}
