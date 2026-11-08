// Entirely synthetic, reviewer decisions below are test doubles, not approved market reports.
import { RULE_VERSION, SEMANTIC_RULES, evaluateRules, proseTargets, ruleHash, packetBinding, registryHash } from './rules.js'
import { MECHANISMS, MECHANISM_VERSION } from './mechanisms.js'
import { EDITORIAL_VERSION, READER_CRITERIA } from './editorial.js'

export function syntheticLedger(packet, content) {
  return { ruleVersion: RULE_VERSION, mechanismVersion: MECHANISM_VERSION, currency: packet.currency, baseDate: packet.baseDate,
    claims: Object.entries(proseTargets(content)).flatMap(([target, text]) => (text.match(/[^.!?。！？]+[.!?。！？]?/gu) ?? []).map(quote => ({
      target, quote: quote.trim(), kind: 'interpretation', factIds: [], evidenceIds: [packet.evidence[0].id],
      mechanismId: '', applicationId: '', eventKey: target.split('.').slice(0, 2).join('-'), pathwayKey: 'relative-returns',
      newInformation: '공개 보도에서 정책 기대 재평가를 전했다.', transmission: '상대 수익률 기대를 통해 자산 수요에 연결된다.',
      currencyConnection: '해당 통화와 달러를 비교하는 자산 선택의 경로다.', watchPurpose: '기대 변화가 되돌려지면 상대 수익률 설명이 약해진다.',
    }))) }
}
export function syntheticCase(currency = 'BRL') {
  const packet = { currency, baseDate: '2025-06-20', observedDate: '2025-06-20',
    facts: ['spot', 'day', 'five', 'mtd'].map((id, i) => ({ id, value: i + 1, label: '코드가 계산한 공개 수치' })), series: [],
    evidence: [{ id: 'synthetic-policy', country: currency, title: '합성 정책 보도', summary: '기대 재평가와 자산 수요 경로를 설명하는 합성 근거.',
      url: 'https://example.org/synthetic', publisher: '합성 출처 — 실제 보도 아님', eventDate: '2025-06-20',
      publishedAt: '2025-06-20T09:00:00Z', period: '2025-06-20', scope: 'country', role: 'context', causalStatus: 'source_attributed' }],
    limitations: ['합성 검사 자료이며 실제 시장 분석이 아닙니다.'], assessment: { publishDecision: { eligible: true, reason: 'review_required' } } }
  const content = { title: '정책 기대를 다시 평가한 시장', summary: '보도는 상대 수익률 기대의 재평가를 전했다.',
    change: { title: '코드 관측값', text: '{{spot}}', kind: 'fact', factIds: ['spot'], evidenceIds: [] },
    drivers: [{ title: '기대 변화와 자산 수요', text: '보도는 정책 기대가 바뀌었다고 전했다. 상대 수익률 기대를 통해 해당 통화 자산 수요에 연결될 수 있다는 해석이다.', kind: 'interpretation', factIds: [], evidenceIds: ['synthetic-policy'] }],
    implications: [], watch: [], limitations: packet.limitations }
  return { packet, content, ledger: syntheticLedger(packet, content), safety: { valid: true, errors: [] } }
}
export function syntheticReaderReview() {
  return { version: EDITORIAL_VERSION, origin: 'human', checks: Object.fromEntries(Object.keys(READER_CRITERIA).map(key =>
    [key, { decision: 'keep', reason: '합성 사례의 독자 관점 검토를 대역으로 표시한다. 실제 원고 승인이 아니다.' }])) }
}
export function syntheticReview(args) {
  return { ruleVersion: RULE_VERSION, origin: 'human', reviewer: 'synthetic reviewer test double',
    readerReview: syntheticReaderReview(),
    binding: evaluateRules(args).binding, scores: [4, 4, 4, 4, 4], criticalErrors: 0,
    claims: args.ledger.claims.map(c => ({ claimHash: ruleHash(c), status: 'pass', reason: '합성 근거 문장이 해당 합성 설명 경로를 직접 지지한다.' })),
    checks: Object.fromEntries(SEMANTIC_RULES.map(id => [id, { status: 'pass', reason: '합성 고정 사례의 허용 범위와 문장을 대조한 테스트 판단이다.' }])) }
}
export function syntheticApplication(packet, mechanismId = 'commodity-exporter') {
  const m = MECHANISMS.find(m => m.id === mechanismId)
  return { id: 'test-application', mechanismId, version: MECHANISM_VERSION, registryHash, packetHash: packetBinding(packet),
    currency: packet.currency, baseDate: packet.baseDate, review: { origin: 'human', status: 'pass', reason: '합성 원문에 대해 적용 조건을 확인한 테스트 기록이다.' },
    conditions: m.conditions.map(condition => ({ condition, support: '합성 원문에서 해당 조건의 범위를 확인했다.', evidenceIds: [packet.evidence[0].id] })),
    counterevidence: '합성 사례의 반대 요인도 검토했고 실제 시장 판단은 아니다.' }
}
export function syntheticUsdApplication(packet) {
  const app = syntheticApplication(packet, 'usd-payment-conversion')
  app.conditions = app.conditions.map((c, i) => ({ ...c, evidenceIds: [], basis: i === 0 ?
    { type: 'facts', convention: 'LOCAL_PER_USD', factIds: packet.facts.map(f => f.id) } :
    { type: 'conditional', assumptions: ['equal_usd_amount', 'unhedged'], exceptions: ['hedging', 'prepayment', 'fixed_contract_rate'] } }))
  return app
}
const reviewed = (currency, mutate = () => {}) => { const a = syntheticCase(currency); mutate(a); a.review = syntheticReview(a); return a }
export const fixedRuleCases = [
  { id: 'brl-common-dollar', topic: '공통 달러', expected: 'pass', make: () => reviewed('BRL') },
  { id: 'mxn-local-policy', topic: '국가 요인', expected: 'pass', make: () => reviewed('MXN') },
  { id: 'clp-commodity', topic: '원자재', expected: 'pass', make: () => reviewed('CLP', a => {
    a.packet.mechanismApplications = [syntheticApplication(a.packet)]
    Object.assign(a.ledger.claims.at(-1), { kind: 'mechanism', mechanismId: 'commodity-exporter', applicationId: 'test-application' })
  }) },
  { id: 'brl-consumption', topic: '소비 맥락', expected: 'pass', make: () => reviewed('BRL', a => {
    a.packet.mechanismApplications = [syntheticApplication(a.packet, 'inflation-purchasing-power')]
    a.content.implications = [{ title: '소득 조건과 구매력', text: '소득이 물가를 따라가지 못한다면 구매력에는 부담이 된다.', kind: 'mechanism', factIds: [], evidenceIds: ['synthetic-policy'] }]
    a.ledger = syntheticLedger(a.packet, a.content)
    Object.assign(a.ledger.claims.at(-1), { kind: 'mechanism', mechanismId: 'inflation-purchasing-power', applicationId: 'test-application' })
  }) },
  { id: 'mxn-countervailing-risk', topic: '반대 요인 보존', expected: 'pass', make: () => reviewed('MXN', a => {
    a.content.drivers[0].text += ' 다만 정치 위험에 대한 보도의 반대 해석도 함께 남긴다.'
    a.ledger = syntheticLedger(a.packet, a.content)
  }) },
  { id: 'clp-period-mismatch', topic: '미래 발표 근거', expected: 'hold', make: () => reviewed('CLP', a => { a.packet.evidence[0].publishedAt = '2025-07-01' }) },
  { id: 'brl-wrong-country', topic: '통화 불일치', expected: 'hold', make: () => reviewed('BRL', a => { a.packet.evidence[0].country = 'MXN' }) },
  { id: 'mxn-no-evidence', topic: '근거 부족', expected: 'hold', make: () => reviewed('MXN', a => { a.packet.evidence = [] }) },
  { id: 'clp-no-new-info', topic: '변화 없음', expected: 'hold', make: () => reviewed('CLP', a => { a.packet.assessment.publishDecision = { eligible: false, reason: 'no_material_change' } }) },
  { id: 'clp-missing-application', topic: '원리는 타당해도 당일 조건 누락', expected: 'hold', make: () => reviewed('CLP', a => { Object.assign(a.ledger.claims.at(-1), { kind: 'mechanism', mechanismId: 'commodity-exporter', applicationId: 'invented' }) }) },
  { id: 'brl-human-review-missing', topic: '자동 검사만 통과', expected: 'unverified', make: () => syntheticCase('BRL') },
  { id: 'mxn-self-scoring', topic: '모델 자기 승인 금지', expected: 'unverified', make: () => { const a = reviewed('MXN'); a.review.origin = 'model'; return a } },
  { id: 'clp-unsupported-priority', topic: '근거 없는 효과 우선순위', expected: 'hold', make: () => {
    const a = reviewed('CLP', a => { a.content.summary = '소비 여건은 환율보다 수요에 먼저 나타난다.'; a.ledger = syntheticLedger(a.packet, a.content) })
    a.review.checks.R06 = { status: 'hold', reason: '합성 출처는 상대 효과의 크기나 시차를 뒷받침하지 않는다.' }; return a
  } },
  { id: 'brl-header-overclaim', topic: '제목의 확정적 인과', expected: 'hold', make: () => { const a = reviewed('BRL'); a.review.checks.R10 = { status: 'hold', reason: '제목의 확정적인 인과는 조건부 원문에 의해 지지되지 않는다.' }; return a } },
  { id: 'mxn-repeated-warning', topic: '반복 경고', expected: 'hold', make: () => {
    const a = reviewed('MXN', a => { a.content.drivers[0].text = '단정할 수 없다. 유일한 원인은 아니다. 전체를 설명할 수 없다.'; a.ledger = syntheticLedger(a.packet, a.content) })
    a.review.checks.R07 = { status: 'hold', reason: '반대 근거가 아닌 같은 면책을 되풀이하여 설명 지면을 소모한다.' }; return a
  } },
  { id: 'clp-title-restatement', topic: '제목 재진술', expected: 'hold', make: () => {
    const a = reviewed('CLP', a => { a.content.drivers[0].text = a.content.drivers[0].title + '.'; a.ledger = syntheticLedger(a.packet, a.content) })
    a.review.checks.R02 = { status: 'hold', reason: '제목을 되풀이할 뿐 새 사실이나 전달 경로를 설명하지 않는다.' }; return a
  } },
].map(c => ({ ...c, provenance: 'synthetic', historicalVerification: false }))
