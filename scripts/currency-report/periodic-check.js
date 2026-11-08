// Offline purpose adapter. It consumes reviewed evidence; it never discovers
// causal relations, grants source-use rights, calls a model or publishes.
import { createHash } from 'node:crypto'
import { projectSourceContext } from './source-context.js'
import { PERIODIC_WRITING_VERSION, PERIODIC_PROSE_INSTRUCTIONS, PERIODIC_PROSE_REVIEW_INSTRUCTIONS, PERIODIC_SHARED_SCOPE_NOTE, periodicLimitations } from './periodic-editing.js'

export const PERIODIC_CHECK_VERSION = 'periodic-check/1'
export const PERIODIC_REVIEW_CHECKS = Object.freeze({
  comparison: '전회 가격·설명과 이번 자료의 비교 기준을 지켰는가?',
  stateMeaning: '재확인·보완·미확인을 시장 무변화·원인 교체·영향 소멸로 바꾸지 않았는가?',
  evidenceScope: '각 문장의 귀속·기간·통화 연결이 선택한 구절 범위 안인가?',
  readerValue: '제목·요약이 확인한 대상과 결론을 전달하고, 각 문장이 새로운 설명이나 중요한 조건을 더하는가? 과정 안내·범용 경고 반복을 구체적으로 대조했는가?',
})
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const day = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
const text = v => typeof v === 'string' && v.trim().length > 0
const label = v => text(v) && v.length <= 70 && !/[\d{}<>@]|https?:/i.test(v)
const safe = v => !/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|bearer\s+\S+|<[^>]+>|ignore\s+(previous|all)|system\s*prompt|지시.*무시/i.test(JSON.stringify(v))
const basisKeys = ['provider', 'seriesId', 'priceKind', 'dateBasis', 'timeZone']
const basisOf = p => Object.fromEntries(basisKeys.map(k => [k, p.marketData?.reportPriceBasis?.[k]]))
const packetData = p => ({ currency: p.currency, baseDate: p.baseDate, observedDate: p.observedDate,
  facts: p.facts, series: p.series, marketData: p.marketData, evidence: p.evidence })
const currentBinding = p => hash(packetData(p))
const unique = list => new Set(list).size === list.length

export const PERIODIC_WRITER_INSTRUCTIONS = [
  `## 정기 점검 목적 ${PERIODIC_CHECK_VERSION}`,
  '독자는 전회 이후 무엇을 확인했고 기존 설명을 어떻게 읽을지 알고 싶다. periodicCheck.readerTask와 선택된 topics의 이번 근거로 답한다.',
  PERIODIC_PROSE_INSTRUCTIONS,
  'drivers는 선택된 설명 항목이다. topics의 sourceLinks로 이번 설명을 뒷받침하며, 전회 기록은 비교 대상의 역할로만 사용한다.',
  'periodicCheck.selectedTopicIds 순서대로 한 항목씩 작성한다. 최대 두 개이며 중요도 순위가 아니다. 개수를 채우거나 선택 밖 근거·누락 원인을 보충하지 않는다.',
  '본문 약 삼백~육백 자는 읽기 길이의 참고이며 최솟값·통과 조건이 아니다. 수치·날짜·방향은 코드가 비교 기준과 함께 조립한다.',
  'scopeGuardrails는 주장 선별용이다. 공통 범위 문구는 sharedScopeNote로 코드가 별도 표시하므로 제목·요약·매 설명 뒤에 다시 쓰지 않는다.',
  'watch는 선택 사항이다. 확인된 일정이 제공되지 않았다면 일정·발표일을 만들지 않는다. 앞선 설명의 다음 확인 질문이면 편집상 질문으로 표시한다.',
].join('\n')

export const PERIODIC_REVIEW_INSTRUCTIONS = [
  `## 정기 점검 검토 ${PERIODIC_CHECK_VERSION}`,
  '새 사건 유무나 당일 원인 설명량으로 정기 점검을 평가하지 않는다. 전회 기준 가격·설명, 이번 확인 결과, 다음 확인 목적이 독자에게 명확한지 검토한다.',
  '정상은 시장 무변화가 아니며 보완은 실제 원인 전환이 아니다. 누락 근거는 영향 소멸이 아니다. 전회 메모·모의 기록을 현재 시장 근거로 인용하지 않는다.',
  'topics의 sourceLinks에 연결된 구절이 각 설명의 모든 주장을 지지하는지 확인한다. checked는 사전 검토 기록이며 이번 원고의 내용 승인으로 상속하지 않는다.',
  '해석을 귀속하고 당일 기사 설명을 전회 이후 전체 변화의 원인으로 확대하지 않는다. 시각·공식성·범위·수치·근거 오류는 필수 교정이다.',
  '자료 부족이 코드의 확인 범위에 표시됐다면 본문마다 경고를 요구하지 않는다. 짧음·추상적 제목·반복은 문체 검토이고 근거 오류와 분리한다.',
  '전회 대비 변화 전달·점검의 유용성·가독성·근거 충실도를 평가한다. 영업 문단이나 관찰 항목을 채우기 위해 새 주장을 요구하지 않는다. 게시 승인은 별도다.',
  'periodicChecks의 comparison·stateMeaning·evidenceScope·readerValue마다 pass/hold/unverified와 구체적 이유를 기록한다. 자료만 연결됐다는 이유로 pass하지 않는다. 문체만의 아쉬움은 문장별 style/refine으로 남긴다.',
  PERIODIC_PROSE_REVIEW_INSTRUCTIONS,
].join('\n')

// Topic IDs and relations are supplied by an explicit scope review, never a
// keyword guess. A missing/stale review becomes pending; it is not "unchanged".
export function preparePeriodicCheck({ packet, previous, topics, mode = 'local' }) {
  const holds = []
  if (!['local', 'saved_replay'].includes(mode) || !packet || !safe({ previous, topics })) throw new Error('invalid_periodic_input')
  if (packet.periodicCheck) throw new Error('periodic_already_prepared')
  if (!Array.isArray(packet.series) || !Array.isArray(packet.facts) || !Array.isArray(packet.evidence) ||
    packet.series.some(r => !r || !day(r.date)) || packet.facts.some(f => !f || !text(f.id)) || packet.evidence.some(e => !e || !text(e.id)))
    return { version: PERIODIC_CHECK_VERSION, status: 'hold', holds: ['invalid_packet_shape'], packet: null, publicationApproved: false }
  if (!previous || !text(previous.id) || previous.currency !== packet.currency ||
    !day(previous.observedDate) || !day(previous.publishedAt?.slice(0, 10)) ||
    previous.observedDate > previous.publishedAt.slice(0, 10) || previous.observedDate >= packet.observedDate ||
    previous.publishedAt.slice(0, 10) > packet.baseDate || !day(packet.observedDate) || !day(packet.baseDate) ||
    packet.observedDate !== packet.baseDate || previous.status !== 'published' ||
    !['published_record', 'simulated'].includes(previous.origin) || previous.origin === 'simulated' && mode !== 'saved_replay') holds.push('prior_report_not_verified')
  const oldTopics = previous?.topics
  if (!Array.isArray(oldTopics) || !oldTopics.length || oldTopics.length > 8 || oldTopics.some(t => !t || !text(t.id) || !label(t.label)) || !unique(oldTopics.map(t => t.id)) ||
    !Array.isArray(topics) || topics.length > 8 || topics.some(t => !t || !text(t.id) || !label(t.label)) || !unique(topics.map(t => t.id))) holds.push('invalid_explanation_topics')
  const basis = basisOf(packet)
  if (!basisKeys.every(k => text(basis[k]) && previous?.priceBasis?.[k] === basis[k]) ||
    packet.marketData?.rateType !== 'LOCAL_PER_USD') holds.push('incompatible_price_basis')
  const priorPoint = packet.series?.find(r => r.date === previous?.observedDate)
  const now = packet.series?.find(r => r.date === packet.observedDate)
  const spot = packet.facts?.find(f => f.id === 'spot')
  if (!priorPoint || priorPoint.value !== previous?.value || !now || now.value !== spot?.value ||
    ![priorPoint?.value, now?.value].every(n => Number.isFinite(n) && n > 0) ||
    packet.series.filter(r => r.date === previous?.observedDate).length !== 1 ||
    packet.series.filter(r => r.date === packet.observedDate).length !== 1) holds.push('price_anchor_missing_or_mismatched')
  if (holds.length) return { version: PERIODIC_CHECK_VERSION, status: 'hold', holds, packet: null, publicationApproved: false }
  const rows = topics.map(t => {
    const reasons = []
    if (!text(t.id) || !text(t.label) || !['supports', 'qualifies'].includes(t.relation) ||
      !['agent', 'human'].includes(t.review?.origin) || t.review?.status !== 'checked' ||
      !text(t.review?.reason) || t.review.reason.trim().length < 10 || !day(t.review?.checkedOn) ||
      t.review.checkedOn < packet.baseDate) reasons.push('scope_review_required')
    const links = Array.isArray(t.sourceLinks) ? t.sourceLinks : []
    if (!links.length || links.length > 4) reasons.push('source_links_missing')
    for (const link of links) {
      if (!link || typeof link !== 'object') { reasons.push('unverified_current_source'); continue }
      const e = packet.evidence.find(e => e.id === link.evidenceId)
      let context
      try { context = e && projectSourceContext(e) } catch { reasons.push('stale_source_context') }
      if (!e || ![packet.currency, 'GLOBAL'].includes(e.country) || e.scope === 'sales_context' ||
        e.eventDate !== packet.observedDate || !day(e.publishedAt?.slice(0, 10)) ||
        e.publishedAt.slice(0, 10) > packet.baseDate || !context || context.passageHash !== link.passageHash ||
        !Array.isArray(link.passageIds) || !link.passageIds.length || !unique(link.passageIds) ||
        link.passageIds.some(id => !context?.passages.some(p => p.id === id))) reasons.push('unverified_current_source')
    }
    return { id: t.id, label: t.label, relation: t.relation,
      status: reasons.length ? 'pending' : 'ready', reasons: [...new Set(reasons)],
      sourceLinks: structuredClone(links), review: structuredClone(t.review ?? null),
      comparison: oldTopics.some(old => old.id === t.id) ? t.relation === 'qualifies' ? 'qualification' : 'rechecked' : 'added' }
  })
  const ready = rows.filter(t => t.status === 'ready')
  const missing = oldTopics.filter(t => !ready.some(r => r.id === t.id)).map(t => ({ id: t.id, label: t.label }))
  if (!ready.length) return { version: PERIODIC_CHECK_VERSION, status: 'hold', holds: ['no_confirmed_explanation'], topics: rows, missingTopics: missing, packet: null, publicationApproved: false }
  const pending = rows.filter(t => t.status === 'pending').map(t => ({ id: t.id, label: t.label }))
  const gaps = [...new Map([...missing, ...pending].map(t => [t.id, t])).values()]
  const scenario = gaps.length ? 'partial_evidence' : ready.some(t => t.comparison !== 'rechecked') ? 'explanation_update' : 'normal_check'
  // Previous topics first; stable input order for new topics. Not an importance ranking.
  const selected = [...oldTopics.flatMap(t => ready.filter(r => r.id === t.id)), ...ready.filter(t => !oldTopics.some(old => old.id === t.id))].slice(0, 2)
  const comparison = { previousDate: previous.observedDate, previousValue: priorPoint.value,
    observedDate: packet.observedDate, currentValue: now.value,
    changePct: (now.value / priorPoint.value - 1) * 100, unit: 'LOCAL_PER_USD', priceBasis: basis }
  if (packet.facts.some(f => f.id === 'periodic_change')) throw new Error('reserved_periodic_fact')
  const nextPacket = { ...structuredClone(packet), facts: [...structuredClone(packet.facts), comparisonFact(comparison, packet.currency)] }
  const plan = { version: PERIODIC_CHECK_VERSION, purpose: 'periodic_check', mode, scenario,
    previous: structuredClone(previous), comparison, topics: rows, missingTopics: gaps,
    selectedTopicIds: selected.map(t => t.id), omittedTopicIds: ready.filter(t => !selected.includes(t)).map(t => t.id),
    status: 'ready_for_local_draft', dataStatus: gaps.length ? 'partial' : 'available',
    contentReview: 'unverified', publicationApproved: false, packetBinding: currentBinding(nextPacket) }
  plan.binding = hash(plan)
  return { version: PERIODIC_CHECK_VERSION, status: plan.status, holds: [],
    packet: { ...nextPacket, periodicCheck: plan }, publicationApproved: false }
}

export function periodicPlan(packet) {
  const p = packet.periodicCheck
  if (!p) return null
  const { binding, ...rest } = p
  if (p.version !== PERIODIC_CHECK_VERSION || binding !== hash(rest) || p.packetBinding !== currentBinding(packet) ||
    p.status !== 'ready_for_local_draft' || p.publicationApproved !== false) throw new Error('stale_periodic_plan')
  return p
}

export function periodicWriterInput(packet) {
  const plan = periodicPlan(packet)
  if (!plan) return null
  const readerTasks = {
    normal_check: '이번 근거가 확인한 기존 설명의 구체적 경로와 의미를 결론으로 전달한다.',
    explanation_update: '기존 설명에 새로 보완된 경로나 중요한 조건을 결론으로 전달한다.',
    partial_evidence: '확인된 부분의 결론을 전달하고 나머지 항목은 코드의 확인 범위에 남긴다.',
  }
  return { version: plan.version, writingVersion: PERIODIC_WRITING_VERSION, purpose: plan.purpose, mode: plan.mode, scenario: plan.scenario,
    binding: plan.binding, previous: { id: plan.previous.id, origin: plan.previous.origin,
      observedDate: plan.previous.observedDate, topics: plan.previous.topics },
    readerTask: readerTasks[plan.scenario],
    scopeGuardrails: { recheckIsNotMarketContinuity: true, additionIsNotCauseReplacement: true,
      missingIsNotAbsentEffect: true, attributionRequired: true, contributionRankingRequiresEvidence: true },
    sharedScopeNote: PERIODIC_SHARED_SCOPE_NOTE,
    comparison: plan.comparison, topics: plan.topics.filter(t => plan.selectedTopicIds.includes(t.id)),
    selectedTopicIds: plan.selectedTopicIds, missingTopics: plan.missingTopics,
    codeOwnedSections: ['change', 'missingTopics', 'sharedScopeNote'], contentReview: 'unverified', publicationApproved: false }
}

// Insert numeric comparison and coverage ONCE, not per AI-written paragraph.
function comparisonFact(c, currency) {
  return { id: 'periodic_change', value: c.changePct,
    label: `비교 기준 ${c.previousDate} ${c.previousValue} → 관측일 ${c.observedDate} ${c.currentValue} ${currency}/USD, 전회 기준 대비 ${c.changePct >= 0 ? '+' : ''}${c.changePct.toFixed(2)}% · ${c.changePct > 0 ? '현지통화 약세 방향' : c.changePct < 0 ? '현지통화 강세 방향' : '같은 가격'}` }
}
export function periodicOwnedContent(packet) {
  const plan = periodicPlan(packet)
  if (!plan) return null
  const fact = comparisonFact(plan.comparison, packet.currency)
  const gap = plan.missingTopics.length ? `이번 점검에서 재확인하지 못한 설명: ${plan.missingTopics.map(t => t.label).join('·')}. 해당 영향의 소멸이나 무변화를 뜻하지 않습니다.` : null
  return { fact, change: { title: '전회 기준과 이번 관측값', text: '{{periodic_change}}', kind: 'fact', factIds: ['periodic_change'], evidenceIds: [] }, gap,
    limitations: periodicLimitations(packet.limitations, gap) }
}

export function periodicDraftIssues(packet, draft) {
  const plan = periodicPlan(packet)
  if (!plan) return []
  const issues = []
  if (draft.drivers?.length !== plan.selectedTopicIds.length) issues.push('periodic_topic_coverage')
  for (const [index, block] of (draft.drivers ?? []).entries()) {
    const t = plan.topics.find(t => t.id === plan.selectedTopicIds[index])
    const allowed = t?.sourceLinks.map(l => l.evidenceId) ?? []
    if (!block.evidenceIds?.length || block.evidenceIds.some(id => !allowed.includes(id))) issues.push('periodic_source_scope')
  }
  const allowed = new Set(plan.topics.filter(t => plan.selectedTopicIds.includes(t.id)).flatMap(t => t.sourceLinks.map(l => l.evidenceId)))
  if ([...(draft.watch ?? []), ...(draft.ruleLedger?.claims ?? [])].some(row => row.evidenceIds?.some(id => !allowed.has(id)))) issues.push('periodic_source_scope')
  return [...new Set(issues)]
}
