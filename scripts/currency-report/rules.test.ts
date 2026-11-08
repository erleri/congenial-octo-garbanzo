import { describe, expect, it } from 'vitest'
import { RULE_VERSION, SEMANTIC_RULES, evaluateRules, selectMechanisms, mechanismEvidence, rankEvidence } from './rules.js'
import { MECHANISMS } from './mechanisms.js'
import { syntheticCase, syntheticReview, syntheticApplication, syntheticLedger } from './rule-fixtures.js'
import { requestBody } from './openrouter.js'

const holds = args => [...new Set(evaluateRules(args).checks.filter(c => c.status === 'hold').map(c => c.ruleId))]

describe('common-rule ledger, mechanism applications and independent review', () => {
  it('ranks period and currency fit before novelty or headline, excluding future and foreign sources', () => {
    const a = syntheticCase()
    a.packet.evidence = [
      { ...a.packet.evidence[0], id: 'old', eventDate: '2025-06-19', title: '충격적인 제목' },
      { ...a.packet.evidence[0], id: 'foreign', country: 'MXN' },
      { ...a.packet.evidence[0], id: 'future', publishedAt: '2025-06-21' },
      { ...a.packet.evidence[0], id: 'same-day' },
    ]
    expect(rankEvidence(a.packet).map(e => e.id)).toEqual(['same-day', 'old'])
  })
  it('treats a rejected individual claim as hold even if aggregate scores pass', () => {
    const a = syntheticCase(), review = syntheticReview(a)
    review.claims[0].status = 'hold'
    expect(evaluateRules({ ...a, review }).semanticStatus).toBe('hold')
  })
  it('does not crash on malformed content or applications and fails closed', () => {
    const a = syntheticCase()
    expect(evaluateRules({ ...a, content: { ...a.content, drivers: [{}] } }).status).toBe('hold')
    expect(selectMechanisms({ ...a.packet, mechanismApplications: [null] }).checks[0].status).toBe('hold')
  })

  it('has six fixed sourced mechanisms, never mutable/model-approved additions', () => {
    expect(MECHANISMS).toHaveLength(6)
    for (const m of MECHANISMS) {
      expect(m.source.url).toMatch(/^https:\/\//)
      expect(m.conditions.length).toBeGreaterThan(0)
      expect(m.counterconditions.length).toBeGreaterThan(0)
      expect(Object.isFrozen(m.conditions)).toBe(true)
    }
  })
  it('requires independent human review of every claim and every semantic rule', () => {
    const a = syntheticCase()
    expect(evaluateRules(a)).toMatchObject({ automaticStatus: 'pass', semanticStatus: 'unverified' })
    const review = syntheticReview(a)
    expect(evaluateRules({ ...a, review }).status).toBe('pass')
    for (const id of SEMANTIC_RULES) {
      const copy = structuredClone(review); delete copy.checks[id]
      expect(evaluateRules({ ...a, review: copy }).status).toBe('unverified')
    }
    review.claims.pop()
    expect(evaluateRules({ ...a, review }).status).toBe('unverified')
  })
  it.each([
    ['content', 'unverified'], ['evidence', 'unverified'], ['series', 'unverified'],
    ['origin', 'unverified'], ['score', 'hold'], ['critical', 'hold'],
  ])('invalidates independent review for changed %s with %s status', (field, expected) => {
    const a = syntheticCase(), review = syntheticReview(a)
    expect(evaluateRules({ ...a, review }).status).toBe('pass')
    if (field === 'content') { a.content.summary += ' 새로운 문장.'; a.ledger = syntheticLedger(a.packet, a.content) }
    if (field === 'evidence') a.packet.evidence[0].summary += 'changed'
    if (field === 'series') a.packet.series.push({ date: '2025-06-20', value: 3 })
    if (field === 'origin') review.origin = 'model'
    if (field === 'score') review.scores = [5, 5, 5, 5, 3]
    if (field === 'critical') review.criticalErrors = 1
    expect(evaluateRules({ ...a, review }).semanticStatus).toBe(expected)
  })

  it.each(['version', 'packetHash', 'registryHash', 'currency', 'baseDate', 'conditions', 'review'])('fails changed application %s before sending a request', field => {
    const a = syntheticCase('CLP')
    const application = syntheticApplication(a.packet)
    a.packet.mechanismApplications = [{ ...application, [field]: field === 'conditions' ? [] : null }]
    expect(selectMechanisms(a.packet).selected).toEqual([])
    expect(() => requestBody(a.packet)).toThrow('invalid_mechanism_applications')
  })
  it('projects only approved applicable principles, never reviewer identity or approval metadata', () => {
    const a = syntheticCase('CLP')
    a.packet.mechanismApplications = [syntheticApplication(a.packet)]
    const input = JSON.parse(requestBody(a.packet, 'openrouter/free').messages[1].content)
    expect(input.ruleVersion).toBe(RULE_VERSION)
    expect(input.applicableMechanisms).toHaveLength(1)
    expect(JSON.stringify(input)).not.toContain('synthetic reviewer')
    expect(JSON.stringify(input)).not.toContain('packetHash')
    Object.assign(a.ledger.claims.at(-1), { kind: 'mechanism', mechanismId: 'commodity-exporter', applicationId: 'test-application' })
    const evidence = mechanismEvidence(a.packet, a.ledger)
    expect(evidence[0]).toMatchObject({ role: 'context', causalStatus: 'contextual', period: '일반 원리 — 당일 사건 아님' })
    expect(a.packet.evidence).toHaveLength(1)
  })
  it('R10 rejects a missing header ledger entry with an otherwise valid baseline', () => {
    const a = syntheticCase()
    expect(evaluateRules(a).automaticStatus).toBe('pass')
    a.ledger.claims = a.ledger.claims.filter(c => c.target !== 'title')
    expect(holds(a)).toEqual(['R10'])
  })
  it('R10 rejects an invented evidence ID without also changing prose', () => {
    const a = syntheticCase()
    expect(evaluateRules(a).automaticStatus).toBe('pass')
    a.ledger.claims.find(c => c.target === 'title').evidenceIds = ['not-real']
    expect(holds(a)).toEqual(['R10'])
  })
  it('R05 detects the same event/path across distinct driver text', () => {
    const a = syntheticCase()
    a.content.drivers.push({ ...a.content.drivers[0], title: '별도의 표현', text: '공개 보도는 같은 정책 사건을 다른 말로 전달했다. 자산 수요로 이어지는 경로는 동일하다.' })
    a.ledger = syntheticLedger(a.packet, a.content)
    expect(evaluateRules(a).automaticStatus).toBe('pass')
    for (const c of a.ledger.claims.filter(c => c.target.startsWith('drivers.1.text'))) c.eventKey = 'drivers-0'
    expect(holds(a)).toEqual(['R05'])
  })
  it('R08 requires a judgment purpose for an actual watch block', () => {
    const a = syntheticCase()
    a.content.watch = [{ ...a.content.drivers[0], title: '기대의 지속 여부', text: '달러 흐름의 후속 반응으로 상대 수익률 설명의 지속 여부를 판단한다.' }]
    a.ledger = syntheticLedger(a.packet, a.content)
    expect(evaluateRules(a).automaticStatus).toBe('pass')
    for (const c of a.ledger.claims.filter(c => c.target === 'watch.0.text')) c.watchPurpose = ''
    expect(holds(a)).toEqual(['R08'])
  })

  it('checks explanation-field presence without equating character count with semantic adequacy', () => {
    const a = syntheticCase()
    const driverRows = a.ledger.claims.filter(c => c.target === 'drivers.0.text')
    for (const c of driverRows) Object.assign(c, { newInformation: '금리', transmission: '달러 수요', currencyConnection: '페소 약세' })
    expect(evaluateRules(a)).toMatchObject({ automaticStatus: 'pass', semanticStatus: 'unverified' })
    for (const c of driverRows) c.currencyConnection = '   '
    expect(holds(a)).toEqual(['R02'])
    for (const c of driverRows) c.currencyConnection = '글로벌 달러의 여러 요인에 관한 매우 긴 일반 설명'
    const review = syntheticReview(a)
    review.readerReview.checks.transmissionSpecificity = { decision: 'rewrite', reason: '현지 통화와의 연결을 본문과 채택 근거에서 확인할 수 없다.' }
    expect(evaluateRules({ ...a, review })).toMatchObject({ automaticStatus: 'pass', semanticStatus: 'hold', publicationApproved: false })
    for (const c of driverRows) c.currencyConnection = '…'
    expect(holds(a)).toEqual(['R02'])
  })


})
