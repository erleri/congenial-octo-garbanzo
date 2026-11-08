import { describe, expect, it, vi } from 'vitest'
import { syntheticCase } from './rule-fixtures.js'
import { createSourceContext } from './source-context.js'
import { packetBinding } from './rules.js'
import { HARNESS_VERSION, QUESTIONS, evidenceBinding, inspectDossier, replayResearch, researchPlan, compileBrief } from './research-harness.js'
import { harnessRequest, auditHarnessReport } from './report-harness.js'
import { generateCandidate } from './openrouter.js'

function fixture(currency = 'CLP') {
  const a = syntheticCase(currency)
  Object.assign(a.packet.evidence[0], { review: { originalVerified: true, scope: '합성 원문의 정책 기대와 통화 연결만 설명한다.' },
    sourceContext: createSourceContext({ blocks: [{ kind: 'paragraph', text: '합성 원문은 정책 기대와 통화의 연결 및 반대 조건을 설명한다. 실제 보도가 아니다.' }], selected: [0] }) })
  const e = a.packet.evidence[0]
  const dossier = { version: HARNESS_VERSION, packetHash: packetBinding(a.packet), cards: QUESTIONS.map(q => ({
    id: `synthetic-${q.id}`, questionId: q.id, evidenceId: e.id, evidenceHash: evidenceBinding(e), passageIds: ['p0'],
    kind: 'attributed_interpretation', attribution: '합성 분석가', relation: 'supports', timeScope: 'same_day_context',
    eventKey: 'synthetic-policy', independenceKey: 'one-analyst', statement: '합성 원문이 질문에 답한다는 검토 대역이다.',
    allowedUse: '합성 근거의 조건부 설명 범위로 한정한다.', limit: '실제 시장 조사 또는 의미 검토 승인으로 사용하지 않는다.',
    review: { origin: 'agent', status: 'checked', reason: '상태 전환을 검사하는 합성 검토 대역이며 실제 검증이 아니다.' },
  })) }
  return { ...a, dossier }
}

describe('Question-led research compiler (synthetic, offline)', () => {
  it('places same-speaker qualifications inside their explanation without promoting them to cross-expert opposition',()=>{
    const a=fixture(),counter=a.dossier.cards.find(c=>c.questionId==='counter')!
    counter.relation='qualifies'
    const before=structuredClone(a)
    const brief=compileBrief(a.packet,a.dossier)
    expect(brief.qualificationPlacement).toEqual([{cardId:'synthetic-counter',kind:'same_speaker_condition',
      parentCardIds:['synthetic-local','synthetic-global'],placement:'inline_with_parent',authorizesDisagreement:false}])
    const sent=JSON.parse(harnessRequest(a.packet,a.dossier).request!.messages[1].content)
    expect(sent.researchBrief.qualificationPlacement).toEqual(brief.qualificationPlacement)
    counter.independenceKey='another-voice'
    expect(compileBrief(a.packet,a.dossier).qualificationPlacement[0]).toMatchObject({kind:'scope_condition',authorizesDisagreement:false})
    expect(before.dossier.cards.find(c=>c.questionId==='counter')!.relation).toBe('qualifies')
    expect(a.packet).toEqual(before.packet)
  })
  it('requests review for a same-speaker condition labelled as a priority dispute and retains a neutral condition',()=>{
    const a=fixture(),counter=a.dossier.cards.find(c=>c.questionId==='counter')!
    counter.relation='qualifies'
    counter.statement='이는 구리 하락만으로 정리하기 어렵다는 중요도에 관한 이견이다.'
    const before=counter.statement
    expect(inspectDossier(a.packet,a.dossier).rejected).toContainEqual({id:'synthetic-counter',reason:'qualification_comparison_review_required'})
    expect(harnessRequest(a.packet,a.dossier).request).toBeNull()
    expect(counter.statement).toBe(before)
    counter.statement='같은 전문가는 구리 영향도 인정하면서 금리를 더 중요한 압력으로 평가했다.'
    expect(inspectDossier(a.packet,a.dossier).rejected).toEqual([])
    expect(harnessRequest(a.packet,a.dossier).status).toBe('prepared_not_called')
  })
  it('builds date-bound reader questions for BRL, MXN and CLP without Chile-specific sources', () => {
    const plans = ['BRL', 'MXN', 'CLP'].map(c => researchPlan(fixture(c).packet))
    expect(plans.map(p => p.questions.length)).toEqual([6, 6, 6])
    expect(plans.map(p => p.questions[0].query)).toEqual([
      'Brasil real 2025-06-20 dólar cierre intradía cotización',
      'México peso 2025-06-20 dólar cierre intradía cotización',
      'Chile peso 2025-06-20 dólar cierre intradía cotización',
    ])
  })
  it('cannot replace an unanswered perspective with many cards answering one question', async () => {
    const a = fixture()
    a.dossier.cards = a.dossier.cards.map((c, i) => ({ ...c, id: `duplicate-topic-${i}`, questionId: 'local' }))
    const result = inspectDossier(a.packet, a.dossier)
    expect(result.missing).toEqual(['market', 'global', 'counter'])
    expect(result.questions.find(q => q.id === 'local')?.independentVoices).toBe(1)
    expect(harnessRequest(a.packet, a.dossier).request).toBeNull()
    const fetchImpl = vi.fn()
    await expect(generateCandidate({ apiKey: 'synthetic-key', packet: a.packet, researchDossier: a.dossier, fetchImpl })).rejects.toThrow('research_coverage_or_privacy_required')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('admits Friday event cards for a Monday official-price report and prevents later events disguised as earlier context', () => {
    const a=fixture(),e=a.packet.evidence[0]
    a.packet.baseDate='2025-06-23'
    Object.assign(a.packet,{marketData:{reportPriceBasis:{seriesId:'F073.TCO.PRE.Z.D',dateBasis:'underlying_local_transaction_day',
      timeZone:'America/Santiago',priceKind:'official_transaction_weighted_average',
      observations:[{localSessionDate:'2025-06-19'},{localSessionDate:'2025-06-20'}]}}})
    a.dossier.cards=a.dossier.cards.filter(c=>['market','local','global','counter'].includes(c.questionId))
    a.dossier.packetHash=packetBinding(a.packet)
    expect(inspectDossier(a.packet,a.dossier).cards).toHaveLength(4)
    e.eventDate='2025-06-23'
    a.dossier.cards.forEach(c=>{c.timeScope='earlier_context';c.evidenceHash=evidenceBinding(e)})
    a.dossier.packetHash=packetBinding(a.packet)
    expect(inspectDossier(a.packet,a.dossier).rejected.map(r=>r.reason)).toEqual(Array(4).fill('temporal_scope'))
  })
  it('requires re-admission when original evidence changes even if the packet binding is updated', () => {
    const a = fixture()
    a.packet.evidence[0].summary = '변경된 근거를 이전 카드 승인으로 통과시키면 안 된다.'
    a.dossier.packetHash = packetBinding(a.packet)
    expect(inspectDossier(a.packet, a.dossier).rejected.map(r => r.reason)).toEqual(Array(6).fill('source_binding'))
  })
  it('retains conflicting evidence as an unresolved question instead of voting it away', () => {
    const a = fixture()
    a.dossier.cards[1].relation = 'contradicts'
    const result = inspectDossier(a.packet, a.dossier)
    expect(result.questions[1].status).toBe('conflict')
    expect(result.cards.some(c => c.relation === 'contradicts')).toBe(true)
    expect(result.status).toBe('research_needed')
  })
  it('leaves a missing optional consumption section empty without blocking a supported market brief', () => {
    const a = fixture(); a.dossier.cards = a.dossier.cards.filter(c => c.questionId !== 'consumer')
    const prepared = harnessRequest(a.packet, a.dossier)
    expect(prepared.status).toBe('prepared_not_called')
    expect(prepared.brief.outline.find(s => s.questionId === 'consumer')?.cards).toEqual([])
    const input = JSON.parse(prepared.request!.messages[1].content)
    expect(input.writingExamples).toBeUndefined()
    expect(input.researchBrief.unresolved).toEqual([{ questionId: 'consumer', status: 'missing', required: false }])
    expect(input.researchBrief.storylines).toEqual([{ eventKey: 'synthetic-policy',
      explanationCards: ['synthetic-local', 'synthetic-global'], qualificationCards: ['synthetic-counter'], observationCards: ['synthetic-watch'] }])
    expect(prepared.request!.provider).toMatchObject({ zdr: true, data_collection: 'deny', allow_fallbacks: false })
    expect(prepared.brief.coverage.cards[0].temporalRelation).toBe('observation_or_publication_time_unknown')
  })
  it('does not admit future articles for a historical report after a valid rebind', () => {
    const a = fixture(); a.packet.evidence[0].publishedAt = '2025-06-21'
    a.dossier.packetHash = packetBinding(a.packet)
    a.dossier.cards.forEach(c => { c.evidenceHash = evidenceBinding(a.packet.evidence[0]) })
    expect(inspectDossier(a.packet, a.dossier).rejected.every(r => r.reason === 'temporal_scope')).toBe(true)
  })
  it('cannot use a search snippet as a verified original even with fresh source hashes', () => {
    const a = fixture(); a.packet.evidence[0].review.originalVerified = false
    a.dossier.packetHash = packetBinding(a.packet)
    a.dossier.cards.forEach(c => { c.evidenceHash = evidenceBinding(a.packet.evidence[0]) })
    expect(inspectDossier(a.packet, a.dossier).cards).toEqual([])
  })
  it('retains an unresolved gap after query exhaustion and deduplicates tracked candidate URLs', async () => {
    const a = fixture(); a.dossier.cards = []
    const search = vi.fn().mockResolvedValue([
      { title: '기사', url: 'https://example.org/a?utm_source=x' }, { title: '동일 기사', url: 'https://example.org/a#section' },
    ])
    const r = await replayResearch({ ...a, search, maxQueries: 2 })
    expect(search).toHaveBeenCalledTimes(2)
    expect(r.candidates).toHaveLength(1)
    expect(r.candidates[0].questionIds).toEqual(['market', 'local'])
    expect(r.candidates[0].status).toBe('original_review_required')
    expect(r.coverage.status).toBe('research_needed')
    expect(r.stopReason).not.toBe('coverage_complete')
  })
  it('rechecks gaps after independent original review and stops when all questions are covered', async () => {
    const a = fixture(), incomplete = structuredClone(a.dossier)
    incomplete.cards = incomplete.cards.filter(c => c.questionId !== 'global')
    const search = vi.fn().mockResolvedValue([])
    const r = await replayResearch({ packet: a.packet, dossier: incomplete, search,
      reviewRound: async () => ({ packet: a.packet, dossier: a.dossier }) })
    expect(search).toHaveBeenCalledTimes(1)
    expect(r.reflections[0].unresolved).toEqual([])
    expect(r.stopReason).toBe('coverage_complete')
  })
  it('blocks a research callback from silently changing the frozen market snapshot', async () => {
    const a = fixture(), revised = structuredClone(a.packet); revised.facts[0].value = 999
    a.dossier.cards = []
    await expect(replayResearch({ ...a, search: async () => [],
      reviewRound: async () => ({ packet: revised, dossier: a.dossier }) })).rejects.toThrow('research_changed_market_snapshot')
  })
  it('records adapter failure separately from absence of evidence, without retrying beyond bounds', async () => {
    const a = fixture(); a.dossier.cards = []
    const r = await replayResearch({ ...a, maxQueries: 1, search: async () => { throw new Error('offline replay unavailable') } })
    expect(r.queries[0].status).toBe('adapter_error')
    expect(r.coverage.missing).toEqual(['market', 'local', 'global', 'counter'])
  })
})

describe('Complete-denominator report audit', () => {
  it('keeps every sentence unverified when no review is supplied rather than reporting a success rate on survivors', () => {
    const a = fixture(), audit = auditHarnessReport(a)
    expect(audit.metrics.totalSentences).toBe(5)
    expect(audit.metrics.unverified).toBe(5)
    expect(audit.metrics.supportedShareOfAllSentences).toBe(0)
    expect(audit.publicationApproved).toBe(false)
  })
  it('does not inherit all packet citations for an unmapped title or silently split a paragraph ledger', () => {
    const a = fixture()
    a.ledger.claims = a.ledger.claims.filter(c => c.target !== 'title' && c.target !== 'drivers.0.text')
    a.ledger.claims.push({ ...a.ledger.claims[0], target: 'drivers.0.text', quote: a.content.drivers[0].text })
    const audit = auditHarnessReport(a)
    expect(audit.metrics.unmapped).toBe(3)
    expect(audit.sentences.find(s => s.id === 'title:0')?.referenceIds).toEqual([])
    expect(audit.metrics.totalSentences).toBe(5)
  })
  it('distinguishes an explicit uncited claim from a nonexistent reference', () => {
    const a = fixture()
    a.ledger.claims[0].evidenceIds = []
    a.ledger.claims[1].evidenceIds = ['nonexistent']
    const audit = auditHarnessReport(a)
    expect(audit.metrics.uncited).toBe(1)
    expect(audit.metrics.invalidReferences).toBe(1)
    expect(audit.readerReview.status).toBe('unverified')
  })
})
