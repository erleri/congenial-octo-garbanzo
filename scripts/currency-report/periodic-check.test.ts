import { expect, it, vi } from 'vitest'
import Ajv from 'ajv'
import { syntheticCase } from './rule-fixtures.js'
import { writerDraft } from './test-support.js'
import { createSourceContext, projectSourceContext } from './source-context.js'
import { preparePeriodicCheck, periodicPlan } from './periodic-check.js'
import { requestBody, composeDraft, generateCandidate } from './openrouter.js'
import { claimReviewContract, assessClaimReview, CLAIM_REVIEW_VERSION } from './claim-review.js'
import { generationWire, decodeGenerationOutput } from './generation-wire.js'
import { prepareEventTrial } from './lifecycle-control.js'
import { PERIODIC_WRITING_VERSION, PERIODIC_SECTION_GUIDANCE, PERIODIC_SHARED_SCOPE_NOTE } from './periodic-editing.js'

function fixture() {
  const original = syntheticCase('CLP')
  const basis = { provider: 'Synthetic provider', seriesId: 'synthetic-series', priceKind: 'average', dateBasis: 'transaction_day', timeZone: 'America/Santiago' }
  const evidence = ['synthetic-policy', 'synthetic-copper'].map(id => ({ ...original.packet.evidence[0], id,
    review: { originalVerified: true }, sourceContext: createSourceContext({
      blocks: [{ kind: 'quote', text: '합성 전문가가 해당 통화와 정책 기대 또는 구리 가격의 연결을 설명했다.' }], selected: [0] }) }))
  const packet = { ...original.packet, evidence, facts: [{ id: 'spot', value: 101, label: '1 USD = 101 CLP' }],
    series: [{ date: '2025-06-05', value: 100 }, { date: '2025-06-20', value: 101 }],
    marketData: { rateType: 'LOCAL_PER_USD', reportPriceBasis: basis } }
  const topics = evidence.map((e, i) => ({ id: ['rates', 'copper'][i], label: ['미국 금리', '구리'][i], relation: 'supports',
    sourceLinks: [{ evidenceId: e.id, passageIds: ['p0'], passageHash: projectSourceContext(e)!.passageHash }],
    review: { origin: 'agent', status: 'checked', reason: '합성 원문과 설명 범위를 연결한 시험용 검토다.', checkedOn: '2025-06-20' } }))
  const previous = { id: 'synthetic-prior', currency: 'CLP', origin: 'simulated', status: 'published',
    publishedAt: '2025-06-05T09:00:00Z', observedDate: '2025-06-05', value: 100, priceBasis: structuredClone(basis),
    topics: topics.map(({ id, label }) => ({ id, label })) }
  return { original, packet, topics, previous, mode: 'saved_replay' }
}
function prepared(kind = 'normal') {
  const f = fixture()
  if (kind === 'update') f.previous.topics = f.previous.topics.slice(0, 1)
  if (kind === 'partial') f.topics = f.topics.slice(0, 1)
  return preparePeriodicCheck(f).packet!
}
function draftFor(packet: ReturnType<typeof prepared>) {
  const x = syntheticCase('CLP')
  const ids = packet.periodicCheck!.selectedTopicIds
  x.content.drivers = ids.map(id => ({ ...x.content.drivers[0], title: id === 'rates' ? '금리 경로를 재확인' : '구리 경로를 재확인',
    text: id === 'rates' ? '합성 보도는 금리와 통화의 연결을 설명했다.' : '합성 보도는 구리와 통화의 연결을 설명했다.',
    evidenceIds: [id === 'rates' ? 'synthetic-policy' : 'synthetic-copper'] }))
  const draft = writerDraft({ ...x, packet })
  for (const row of draft.ruleLedger.claims) if (row.target.startsWith('drivers.')) {
    row.evidenceIds = [...draft.drivers[Number(row.target.split('.')[1])].evidenceIds]
  }
  return draft
}

it.each([
  ['normal', 'normal_check', []],
  ['update', 'explanation_update', []],
  ['partial', 'partial_evidence', ['copper']],
])('selects %s from prior coverage and reviewed current evidence', (kind, scenario, gaps) => {
  const packet = prepared(kind as string)
  expect(periodicPlan(packet)).toMatchObject({ scenario, contentReview: 'unverified', publicationApproved: false })
  expect(packet.periodicCheck!.missingTopics.map(t => t.id)).toEqual(gaps)
  expect(packet.facts.find(f => f.id === 'periodic_change')!.value).toBeCloseTo(1)
})

it('holds invalid publication anchors, price bases and wholly absent current support without changing inputs', () => {
  const f = fixture(), before = structuredClone(f)
  for (const key of ['status', 'date', 'value', 'basis', 'evidence', 'malformed']) {
    const c = structuredClone(f)
    if (key === 'status') c.previous.status = 'pending_review'
    if (key === 'date') c.previous.observedDate = c.packet.observedDate
    if (key === 'value') c.previous.value = 99
    if (key === 'basis') c.previous.priceBasis.seriesId = 'different-series'
    if (key === 'evidence') c.topics = []
    if (key === 'malformed') c.packet.series = []
    expect(preparePeriodicCheck(c)).toMatchObject({ status: 'hold', packet: null, publicationApproved: false })
  }
  expect(f).toEqual(before)
  expect(preparePeriodicCheck({ ...f, mode: 'local' }).holds).toContain('prior_report_not_verified')
})

it('keeps stale, unreviewed, wrong-country or wrong-period topics pending and preserves explicit qualifications', () => {
  for (const kind of ['hash', 'review', 'date', 'country', 'sales']) {
    const f = fixture()
    if (kind === 'hash') f.topics[1].sourceLinks[0].passageHash = 'stale'
    if (kind === 'review') f.topics[1].review.status = 'unverified'
    if (kind === 'date') f.packet.evidence[1].eventDate = '2025-05-01'
    if (kind === 'country') f.packet.evidence[1].country = 'BRL'
    if (kind === 'sales') f.packet.evidence[1].scope = 'sales_context'
    const p = preparePeriodicCheck(f).packet!
    expect(p.periodicCheck).toMatchObject({ scenario: 'partial_evidence', selectedTopicIds: ['rates'] })
    expect(p.periodicCheck!.topics[1].status).toBe('pending')
  }
  const f = fixture(); f.topics[1].relation = 'qualifies'
  expect(preparePeriodicCheck(f).packet!.periodicCheck!.scenario).toBe('explanation_update')
})

it('uses the common writer, fixed-slot decoder, assembly and sentence-review contracts with only selected passages', () => {
  const packet = prepared('partial'), request = requestBody(packet, 'openrouter/free'), input = JSON.parse(request.messages[1].content)
  expect(input.periodicCheck).toMatchObject({ scenario: 'partial_evidence', selectedTopicIds: ['rates'] })
  expect(input.evidence.map((e: { id: string }) => e.id)).toEqual(['synthetic-policy'])
  expect(input).not.toHaveProperty('explanationCards')
  const schema = request.response_format!.json_schema.schema
  expect(schema.properties.drivers).toMatchObject({ minItems: 1, maxItems: 1 })
  const draft = draftFor(packet), wire = generationWire(schema, 'openai/gpt-6.1-sol')
  const slots = { ...draft, drivers: { slot_0: draft.drivers[0] }, implications: {}, watch: { slot_0: null, slot_1: null } }
  expect(new Ajv().compile(wire.schema)(slots)).toBe(true)
  const result = composeDraft(packet, decodeGenerationOutput(slots, wire.contract), true, true)
  expect(result.validation).toEqual({ valid: true, errors: [] })
  expect(result.rules).toMatchObject({ purpose: 'periodic_check', automaticStatus: 'pass', semanticStatus: 'unverified', publicationApproved: false })
  expect(result.candidate!.change.factIds).toEqual(['periodic_change'])
  expect(result.candidate!.limitations.filter(t => t.includes('재확인하지 못한 설명'))).toHaveLength(1)
  expect(result.editorial!.warnings).not.toContain('drivers.0:explanation_needs_review')
  expect(result.claimReview).toMatchObject({ purpose: 'periodic_check', status: 'unverified', publicationApproved: false })
  expect(claimReviewContract(result.claimReview).messages[0].content).toContain('정상은 시장 무변화가 아니며')
  expect(result.candidate!.implications).toEqual([])
})

it('invalidates prepared comparisons when source content, prior topic coverage or prices change', () => {
  for (const kind of ['source', 'previous', 'price']) {
    const p = prepared()
    if (kind === 'source') p.evidence[0].summary += '변경'
    if (kind === 'previous') p.periodicCheck!.previous.topics.pop()
    if (kind === 'price') p.series[0].value = 98
    expect(() => requestBody(p, 'openrouter/free')).toThrow('stale_periodic_plan')
  }
})

it('requires explicit periodic content judgments even when sentence-review test doubles are complete', () => {
  const p = prepared('partial'), result = composeDraft(p, draftFor(p), true, true), preparedReview = result.claimReview
  const source = preparedReview.sources[0], passage = source.sourceContext.passages[0]
  const anchor = { evidenceId: source.id, passageId: passage.id, passageHash: source.sourceContext.passageHash, quote: passage.text }
  const reason = '합성 검토 대역이며 실제 문장의 의미 승인이나 공개 승인이 아니다.'
  const review = { version: CLAIM_REVIEW_VERSION, binding: preparedReview.binding, origin: 'agent', reviewer: 'synthetic review double',
    claims: preparedReview.claims.map(c => ({ id: c.id, claimHash: c.claimHash, support: 'supported', decision: 'keep', issue: 'none', reason,
      anchors: [anchor], applicationIds: [], subclaims: [{ quote: c.quote, support: 'supported', reason, anchors: [anchor], applicationIds: [] }] })),
    periodicChecks: Object.fromEntries(['comparison', 'stateMeaning', 'evidenceScope', 'readerValue'].map(k => [k, { status: 'pass', reason }])) }
  expect(assessClaimReview(preparedReview, review)).toMatchObject({ status: 'reviewed', publicationApproved: false })
  const missing = { ...review, periodicChecks: {} }
  expect(new Ajv().compile(claimReviewContract(preparedReview).schema)(missing)).toBe(false)
  expect(assessClaimReview(preparedReview, missing).status).toBe('unverified')
  review.periodicChecks.stateMeaning.status = 'hold'
  expect(assessClaimReview(preparedReview, review).status).toBe('needs_revision')
})

it('rejects extra blocks and unselected evidence instead of repairing model prose', () => {
  const p = prepared('partial'), draft = draftFor(p)
  const more = structuredClone(draft); more.drivers.push(more.drivers[0])
  expect(composeDraft(p, more, true, true).validation.errors).toContain('draft_schema')
  const wrong = structuredClone(draft); wrong.drivers[0].evidenceIds = ['synthetic-copper']
  expect(composeDraft(p, wrong, true, true).validation.errors).toContain('periodic_source_scope')
  expect(composeDraft(p, draft).validation.errors).toContain('periodic_common_contract_required')
})

it('blocks saved replay generation and legacy event-trial routing before any external call', async () => {
  const p = prepared(), fetchImpl = vi.fn()
  expect(await generateCandidate({ apiKey: 'fake-test-key', packet: p, fetchImpl })).toMatchObject({ attempts: 0, reason: 'periodic_saved_replay_only' })
  expect(prepareEventTrial({ packet: p })).toMatchObject({ status: 'periodic_trial_not_authorized', paidCallAuthorized: false })
  expect(fetchImpl).not.toHaveBeenCalled()
})

it('shares the revised writing policy across all periodic scenarios, output descriptions and review bindings', () => {
  for (const kind of ['normal', 'update', 'partial']) {
    const p = prepared(kind), body = requestBody(p, 'openrouter/free'), input = JSON.parse(body.messages[1].content)
    expect(input.periodicCheck).toMatchObject({ writingVersion: PERIODIC_WRITING_VERSION, sharedScopeNote: PERIODIC_SHARED_SCOPE_NOTE })
    expect(input.periodicCheck.readerTask.length).toBeGreaterThan(10)
    expect(input).not.toHaveProperty('writingExamples')
    expect(body.response_format!.json_schema.schema.properties.title.description).toBe(PERIODIC_SECTION_GUIDANCE.title)
    expect(body.messages[0].content).toContain(PERIODIC_WRITING_VERSION)
    expect(body.messages[0].content).not.toContain('normal_check는 기존 설명 항목을 이번 근거에서도 다룰 수 있다는 뜻')
    const result = composeDraft(p, draftFor(p), true, true)
    expect(result.validation, kind).toEqual({ valid: true, errors: [] })
    expect(result.candidate!.limitations.join(' ')).toContain(PERIODIC_SHARED_SCOPE_NOTE)
    expect(claimReviewContract(result.claimReview).messages[0].content).toContain(PERIODIC_WRITING_VERSION)
    const old = structuredClone(result.claimReview); old.periodicCheck.writingVersion = 'periodic-writing/1'
    expect(() => claimReviewContract(old)).toThrow('obsolete_claim_review_input')
  }
  const ordinary = requestBody(syntheticCase('CLP').packet, 'openrouter/free')
  expect(ordinary.messages[0].content).not.toContain(PERIODIC_WRITING_VERSION)
  const overflow = prepared()
  overflow.limitations = ['1'.repeat(480), '2'.repeat(480), '3'.repeat(480), '4'.repeat(480)]
  expect(() => requestBody(overflow, 'openrouter/free')).toThrow('periodic_limitations_capacity')
})
