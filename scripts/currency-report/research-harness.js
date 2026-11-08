// Local opt-in research compiler. No network, credentials, publication or source self-approval.
import { createHash } from 'node:crypto'
import { packetBinding } from './rules.js'
import { projectSourceContext } from './source-context.js'
import { researchTimeScope } from './research-time-scope.js'

export const HARNESS_VERSION = 'report-harness/1'
export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const safe = value => !/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|bearer\s+\S+|-----BEGIN .*PRIVATE KEY|<[^>]+>|ignore\s+(previous|all)|system\s*prompt|지시.*무시/i.test(JSON.stringify(value))
const meaningful = v => typeof v === 'string' && v.trim().length >= 10 && v.length <= 1200
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
const marketBinding = p => fingerprint({ currency: p.currency, baseDate: p.baseDate, observedDate: p.observedDate,
  facts: p.facts, series: p.series, observationAt: p.observationAt, marketData: p.marketData })
const countries = { BRL: 'Brasil real', MXN: 'México peso', CLP: 'Chile peso', COP: 'Colombia peso', ARS: 'Argentina peso', PEN: 'Perú sol' }
export const RESEARCH_CURRENCIES = Object.freeze(Object.keys(countries))
const relatedExplanations = (cards, c) => cards.filter(p => p.relation === 'supports' && p.eventKey === c.eventKey && ['local', 'global'].includes(p.questionId))
const sameSpeaker = (parents, c) => parents.filter(p => p.attribution && p.attribution === c.attribution && p.independenceKey === c.independenceKey)
export const QUESTIONS = Object.freeze([
  { id: 'market', required: true, question: '어느 관측·가격 기준에서 무엇이 달라졌나?', terms: 'dólar cierre intradía cotización', purpose: '기사와 저장 환율의 가격·관측 기준을 구분한다.' },
  { id: 'local', required: true, question: '국가별 새 사건과 해당 통화의 연결은 무엇인가?', terms: 'moneda anuncio política mercado analista', purpose: '발표·해석·집행을 분리해 현지 경로를 설명한다.' },
  { id: 'global', required: true, question: '글로벌 달러·금리 환경은 현지 설명을 지지하는가?', terms: 'dólar global tasas moneda', purpose: '현지 요인과 공통 달러 요인의 대비를 확인한다.' },
  { id: 'counter', required: true, question: '설명을 제한하는 조건·반대 압력·다른 가격 기준은?', terms: 'moneda factores contrarios condiciones riesgos', purpose: '조건과 반대 압력을 구분해 보존하며 전문가 대립을 만들어내지 않는다.' },
  { id: 'consumer', required: false, question: '소비·구매력·금융 여건에 관한 별도 공개 근거가 있는가?', terms: 'consumo inflación crédito hogares estadística', purpose: '월간 지표는 영업 환경 맥락이며 당일 환율 원인이 아니다.' },
  { id: 'watch', required: false, question: '무엇을 확인하면 앞선 설명이 지지되거나 약화되는가?', terms: 'moneda calendario ejecución política posiciones', purpose: '전망이나 업무 지시 대신 설명의 확인 조건을 찾는다.' },
])

export function researchPlan(packet) {
  if (!countries[packet.currency] || !date(packet.baseDate)) throw new Error('invalid_research_scope')
  return { version: HARNESS_VERSION, packetHash: packetBinding(packet), currency: packet.currency,
    baseDate: packet.baseDate, questions: QUESTIONS.map(q => ({ ...q, timeScope:researchTimeScope(packet,q.id),
      query: `${countries[packet.currency]} ${researchTimeScope(packet,q.id).anchorDate} ${q.terms}` })),
    limits: { maxRounds: 2, maxQueries: 8, maxCandidates: 24 }, publicationApproved: false }
}

// Review-authored cards bind meaning, source scope and time to immutable evidence.
// Hash validity is NOT proof that the reviewer interpreted the source correctly.
export function evidenceBinding(evidence) { return fingerprint(evidence) }
export function inspectDossier(packet, dossier) {
  const plan = researchPlan(packet), cards = [], rejected = [], seen = new Set()
  if (dossier?.version !== HARNESS_VERSION || dossier.packetHash !== plan.packetHash || !Array.isArray(dossier.cards) || dossier.cards.length > 60)
    throw new Error('stale_or_missing_dossier')
  for (const c of dossier.cards) {
    let context
    const e = packet.evidence.find(e => e.id === c?.evidenceId)
    try { context = e && projectSourceContext(e) } catch { /* Fail closed below, retain rejection. */ }
    let reason = null
    if (!c || !/^[a-z][a-z0-9-]{0,79}$/.test(c.id) || seen.has(c.id)) reason = 'card_identity'
    else if (!e || c.evidenceHash !== evidenceBinding(e) || !context || !['GLOBAL', packet.currency].includes(e.country)) reason = 'source_binding'
    else if (!QUESTIONS.some(q => q.id === c.questionId) || !['fact', 'attributed_interpretation'].includes(c.kind) ||
      !['supports', 'qualifies', 'contradicts'].includes(c.relation) || !['same_day_context', 'earlier_context'].includes(c.timeScope)) reason = 'card_scope'
    else if (!date(e.publishedAt?.slice(0, 10)) || !date(e.eventDate) || e.publishedAt.slice(0, 10) > packet.baseDate || e.eventDate > packet.baseDate ||
      e.eventDate > plan.questions.find(q=>q.id===c.questionId).timeScope.anchorDate ||
      (c.timeScope === 'same_day_context' && e.eventDate !== plan.questions.find(q=>q.id===c.questionId).timeScope.anchorDate)) reason = 'temporal_scope'
    else if (!Array.isArray(c.passageIds) || !c.passageIds.length || c.passageIds.some(id => !context.passages.some(p => p.id === id))) reason = 'passage_missing'
    else if(e.newsNotes && (c.passageIds.length!==1||!e.newsNotes.notes.some(n=>n.id===c.passageIds[0]
      &&n.text===c.statement&&(n.kind==='fact'?'fact':'attributed_interpretation')===c.kind
      &&(n.attribution?`${n.attribution.organization} / ${n.attribution.person}`:null)===(c.attribution??null)))) reason='news_note_claim_mismatch'
    else if (!meaningful(c.statement) || !meaningful(c.allowedUse) || !meaningful(c.limit) || !meaningful(c.review?.reason) ||
      !['agent', 'human'].includes(c.review?.origin) || c.review?.status !== 'checked' || !safe(c) ||
      !/^[a-z0-9-]{2,80}$/.test(c.eventKey) || !/^[a-z0-9-]{2,80}$/.test(c.independenceKey)) reason = 'admission_missing'
    else if (c.kind === 'attributed_interpretation' && !(typeof c.attribution === 'string' && c.attribution.trim().length >= 2)) reason = 'attribution_missing'
    if (reason) { rejected.push({ id: c?.id ?? null, reason }); continue }
    seen.add(c.id)
    const exactTime = value => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
    const temporalRelation = exactTime(packet.observationAt) && exactTime(e.publishedAt)
      ? Date.parse(e.publishedAt) > Date.parse(packet.observationAt) ? 'published_after_observation' : 'published_by_observation'
      : 'observation_or_publication_time_unknown'
    cards.push({ id: c.id, questionId: c.questionId, evidenceId: e.id, passageIds: [...new Set(c.passageIds)],
      statement: c.statement, allowedUse: c.allowedUse, limit: c.limit, kind: c.kind,
      attribution: c.attribution ?? null, eventKey: c.eventKey, independenceKey: c.independenceKey,
      relation: c.relation, timeScope: c.timeScope, temporalRelation, originalSourceType: e.provenance ?? 'unknown',
      reviewOrigin: c.review.origin })
  }
  // Narrow authoring-conflict signal: a same-speaker qualifier labelled as a
  // priority dispute needs review. This is not a finding that the source is false.
  for (const c of cards.filter(c => c.relation === 'qualifies')) {
    if (sameSpeaker(relatedExplanations(cards, c), c).length && /중요도(?:에\s*관한|에\s*대한)?\s*이견|우선순위\s*대립/u.test(c.statement))
      rejected.push({ id: c.id, reason: 'qualification_comparison_review_required' })
  }
  const questions = plan.questions.map(q => {
    const matches = cards.filter(c => c.questionId === q.id)
    // Conflicts require adjudication/new evidence, not an automatic majority vote.
    const status = matches.some(c => c.relation === 'contradicts') ? 'conflict' : matches.length ? 'covered' : 'missing'
    return { ...q, status, cardIds: matches.map(c => c.id), independentVoices: new Set(matches.map(c => c.independenceKey)).size }
  })
  const missing = questions.filter(q => q.required && q.status !== 'covered').map(q => q.id)
  return { version: HARNESS_VERSION, packetHash: plan.packetHash, dossierHash: fingerprint(dossier), cards, rejected, questions,
    status: missing.length || rejected.length ? 'research_needed' : 'ready_for_draft', missing,
    publicationApproved: false, semanticApproval: 'unverified',
    limitations: ['원문 채택표는 검토자의 판단이며 자동 검사는 의미적 지지를 보증하지 않습니다.',
      ...(!packet.observationAt ? ['관측시각 미상: 기사의 장중 사건으로 저장 환율의 직접 원인을 확정하지 않습니다.'] : [])] }
}

// Round trips are bounded by query identity and unanswered questions, not article count.
// Search results are candidates only. This function never turns snippets into admissions.
export async function runResearch({ packet, dossier, search, reviewRound, mode = 'offline_replay', recheckQuestions = [], maxRounds = 2, maxQueries = 8, maxCandidates = 24 }) {
  if (![maxRounds, maxQueries, maxCandidates].every(n => Number.isInteger(n) && n > 0) || maxRounds > 3 || maxQueries > 12 || maxCandidates > 30)
    throw new Error('invalid_research_limits')
  if (!['offline_replay', 'live_public'].includes(mode) || !Array.isArray(recheckQuestions) || recheckQuestions.some(id => !QUESTIONS.some(q => q.id === id)))
    throw new Error('invalid_research_mode_or_questions')
  let coverage = inspectDossier(packet, dossier)
  const queries = [], candidates = [], seen = new Set(), reflections = []
  const marketHash = marketBinding(packet)
  for (let round = 0; round < maxRounds && queries.length < maxQueries && candidates.length < maxCandidates; round++) {
    const gaps = coverage.questions.filter(q => q.status !== 'covered' || recheckQuestions.includes(q.id))
    if (!gaps.length) break
    for (const q of gaps) {
      if (queries.length >= maxQueries || candidates.length >= maxCandidates) break
      const query = round === 0 ? q.query : `${q.query} fuente original comunicado evidencia contraria`
      const queryId = fingerprint({ packetHash: coverage.packetHash, questionId: q.id, query })
      // Public/offline adapters only; paid discovery requires its own budget runner.
      const row = { queryId, questionId: q.id, query, round: round + 1, timeScope:structuredClone(q.timeScope) }
      queries.push(row)
      let results
      try { results = await search(structuredClone(row)) } catch { row.status = 'adapter_error'; continue }
      if (!Array.isArray(results)) { row.status = 'invalid_result'; continue }
      row.status = 'completed'
      for (const item of results) {
        let url
        try { url = new URL(item.url); if (url.protocol !== 'https:' || url.username || url.password) continue } catch { continue }
        url.hash = ''
        for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key)
        const key = url.href
        if (seen.has(key)) {
          const existing = candidates.find(c => c.url === key)
          if (!existing.questionIds.includes(q.id)) existing.questionIds.push(q.id)
          continue
        }
        if (candidates.length >= maxCandidates || !safe({ url: key, title: item.title })) continue
        seen.add(key)
        candidates.push({ questionId: q.id, questionIds: [q.id], url: key, title: String(item.title ?? '').slice(0, 200), status: 'original_review_required' })
      }
    }
    if (reviewRound) {
      const next = await reviewRound({ packet: structuredClone(packet), dossier: structuredClone(dossier), candidates: structuredClone(candidates), round: round + 1 })
      if (next) {
        if (marketBinding(next.packet) !== marketHash)
          throw new Error('research_changed_market_snapshot')
        coverage = inspectDossier(next.packet, next.dossier)
        packet = next.packet; dossier = next.dossier
      }
    }
    reflections.push({ round: round + 1, unresolved: coverage.questions.filter(q => q.status !== 'covered').map(q => q.id), status: coverage.status })
  }
  return { version: HARNESS_VERSION, coverage, queries, candidates, reflections, mode,
    stopReason: coverage.questions.every(q => q.status === 'covered') ? 'coverage_complete' : candidates.length ? 'original_review_required' : 'unresolved_gaps',
    publicationApproved: false }
}

export const replayResearch = options => runResearch({ ...options, mode: 'offline_replay' })

export function compileBrief(packet, dossier) {
  const coverage = inspectDossier(packet, dossier)
  const eventKeys = [...new Set(coverage.cards.filter(c => ['local', 'global'].includes(c.questionId)).map(c => c.eventKey))]
  const storylines = eventKeys.map(eventKey => ({ eventKey,
    explanationCards: coverage.cards.filter(c => c.eventKey === eventKey && ['local', 'global'].includes(c.questionId)).map(c => c.id),
    qualificationCards: coverage.cards.filter(c => c.eventKey === eventKey && c.questionId === 'counter').map(c => c.id),
    observationCards: coverage.cards.filter(c => c.eventKey === eventKey && c.questionId === 'watch').map(c => c.id) }))
  // Metadata identifies a connection, never proves the underlying claim true.
  const qualificationPlacement = coverage.cards.filter(c => c.relation === 'qualifies').map(c => {
    const related = relatedExplanations(coverage.cards, c)
    const sameVoice = sameSpeaker(related, c)
    return { cardId: c.id, kind: sameVoice.length ? 'same_speaker_condition' : 'scope_condition',
      parentCardIds: (sameVoice.length ? sameVoice : related).map(p => p.id),
      placement: related.length ? 'inline_with_parent' : 'context_if_connected_else_omit', authorizesDisagreement: false }
  })
  const outline = ['local', 'global', 'counter', 'consumer', 'watch'].map(id => ({ questionId: id,
    purpose: QUESTIONS.find(q => q.id === id).purpose,
    cards: coverage.cards.filter(c => c.questionId === id),
    instruction: id === 'consumer' ? '별도 소비 근거가 없으면 생략. 고정 환산 설명을 실제 판매 영향으로 확대하지 않는다.' :
      id === 'counter' ? '조건은 연결된 배경에 합친다. 조사 분류만으로 이견이나 별도 배경을 만들지 않는다.' : '새 정보 → 근거가 허용한 연결 → 독자가 이해할 의미. 개수를 채우지 않는다.' }))
  return { version: HARNESS_VERSION, binding: fingerprint({ packetHash: coverage.packetHash, dossierHash: coverage.dossierHash }),
    currency: packet.currency, baseDate: packet.baseDate, status: coverage.status, coverage, outline, storylines, qualificationPlacement,
    unresolved: coverage.questions.filter(q => q.status !== 'covered').map(q => ({ questionId: q.id, status: q.status, required: q.required })),
    instructions: [
      '조사·집필·검토는 별도 단계다. 검색 제목이나 요약은 원문 채택표를 대신하지 않는다.',
      '카드의 allowedUse·limit와 scope의 countercontext는 검토용 경계다. 그대로 본문 경고로 옮기지 말고 연결을 원문·채택 요지와 대조한다.',
      '같은 eventKey를 반복 문단으로 늘리지 않는다. 같은 independenceKey 인용은 독립 확인으로 세지 않는다.',
      'qualificationPlacement는 조건의 배치다. 같은 발언자의 평가는 parentCardIds 배경에 합치며 독립 배경이나 전문가 대립으로 만들지 않는다.',
      'temporalRelation은 자료 순서를 검토하는 필드다. 실제 사건의 선후관계나 기사에 없는 연결을 만들어 주지 않는다.',
      '새 원리나 소비 근거를 상식으로 보충하지 않는다. 새 정보 부족은 보류이지 문체로 해결할 문제가 아니다.',
    ], publicationApproved: false }
}
