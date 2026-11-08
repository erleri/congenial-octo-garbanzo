import { afterEach, describe, expect, it, vi } from 'vitest'
import { planResearchNeeds } from './research-needs.js'
import { bindEvidenceScope } from './evidence-scope.js'
import { createSourceContext } from './source-context.js'
import { syntheticCase } from './rule-fixtures.js'
import { researchPlan } from './research-harness.js'

const scope = (metric = 'retail', subject = 'national_total') => ({ subject, metric, unit: 'percent', comparison: 'year_over_year',
  channel: 'all', priceBasis: 'real', adjustment: 'unadjusted', baseYear: '2018' })
const requirement = (id = 'retail', dimensions = scope()) => ({ id, period: '2026-08', scope: dimensions })
function source(id = 'pay', dimensions = scope('real_pay'), value = '3.4') {
  const evidence = { id, country: 'CLP', period: '2026-08', publishedAt: '2026-10-07', collectedAt: '2026-10-08T10:00:00Z',
    eventDate: '2026-10-07', url: `https://www.ine.gob.cl/synthetic/${id}`, title: '합성 자료이며 실제 경제 통계가 아니다.',
    review: { originalVerified: true, reuse: 'verified', scope: '합성 자료의 범위만 검토한 시험 대역이다.' },
    sourceContext: createSourceContext({ blocks: [{ kind: 'paragraph', text: `Synthetic ${id} index change is ${value}. This is not real economic evidence.` }], selected: [0] }) }
  const draft = { passageIds: ['p0'], scope: dimensions, admittedClaims: [{ id: 'fact', kind: 'source_fact', passageIds: ['p0'], text: '합성 관측을 검증하는 데이터이며 실제 근거가 아니다.' }],
    allowedUse: '합성 통계 범위 적합성 검사에만 사용한다.', countercontext: '실제 소비 증가와 회사 실적의 원인으로 사용하지 않는다.', excludedExpansions: ['기업 매출'], coverageGaps: [], crossSourceClaims: [] }
  return { evidence, card: bindEvidenceScope(evidence, draft, { origin: 'agent', status: 'checked', reason: '실제 의미 검토가 아닌 합성 계약 시험 대역이다.' }) }
}
function fixture() {
  const p = syntheticCase('CLP').packet, first = source()
  const packet = { ...p, purpose: 'economic_update', baseDate: '2026-10-09', evidence: [first.evidence], evidenceScopeCards: [first.card] }
  const pay = requirement('pay', scope('real_pay'))
  return { packet, purpose: 'economic_update', asOf: '2026-10-09T23:00:00Z', topics: ['real_pay', 'retail'],
    requirements: { economic_release: [pay], economic_scope: [pay], consumption: [pay, requirement()], category: [requirement(), requirement('category', scope('retail', 'electronics_household_technology'))] } }
}
function addRetail(x: ReturnType<typeof fixture>, dimensions = scope(), value = '-2.0') {
  const r = source('retail', dimensions, value)
  x.packet.evidence.push(r.evidence); x.packet.evidenceScopeCards.push(r.card)
}
afterEach(() => vi.unstubAllGlobals())

describe('Offline purpose-specific research needs', () => {
  it('allocates consumption gaps before unrelated FX work without IO or mutating the packet', () => {
    const x = fixture(), before = structuredClone(x), network = vi.fn(() => { throw new Error('network forbidden') })
    vi.stubGlobal('fetch', network)
    const p = planResearchNeeds(x)
    expect(p.questions.map(q => q.id)).toEqual(['economic_release', 'economic_scope', 'consumption', 'category'])
    expect(p.discoveryRequests.map(q => [q.needId, q.questionId])).toEqual([['consumption', 'consumer'], ['category', 'consumer']])
    expect(p).toMatchObject({ coreStatus: 'review_required', writingEligibility: 'not_assessed', contentQuality: 'not_assessed', publicationApproved: false, networkCalls: 0, modelCalls: 0 })
    expect(p.questions.find(q => q.id === 'consumption')?.requirements[1].reason).toBe('not_in_verified_inventory')
    expect(x).toEqual(before); expect(network).not.toHaveBeenCalled()
    expect(planResearchNeeds(x)).toEqual(p)
  })
  it('keeps old FX questions unchanged and bounds optional questions for each purpose', () => {
    const x = fixture(), legacyBefore = researchPlan(x.packet)
    const fx = planResearchNeeds({ ...x, packet: { ...x.packet, purpose: 'fx_explanation' }, purpose: 'fx_explanation', topics: ['real_pay','retail','financing'], requirements: {} })
    expect(fx.questions.filter(q => q.required).map(q => q.id)).toEqual(['market','local','global','counter'])
    expect(fx.questions.filter(q => !q.required).map(q => q.id)).toEqual(['consumption'])
    const policy = planResearchNeeds({ ...x, packet: { ...x.packet, purpose: 'policy_update' }, purpose: 'policy_update', requirements: {}, topics: ['financing'] })
    expect(policy.questions.map(q => q.id)).toEqual(['policy_release','policy_scope','financing'])
    expect(researchPlan(x.packet)).toEqual(legacyBefore)
    expect(planResearchNeeds({ ...x, topics: [] , requirements: {} }).questions).toHaveLength(2)
  })
  it('reuses an opposite-direction matching source without granting causal or publication approval', () => {
    const x = fixture(); addRetail(x)
    const p = planResearchNeeds(x), q = p.questions.find(q => q.id === 'consumption')!
    expect(q).toMatchObject({ status: 'available', action: 'reuse_for_content_review' })
    expect(q.requirements.map(r => r.evidenceIds)).toEqual([['pay'], ['retail']])
    expect(p.discoveryRequests.map(q => q.needId)).toEqual(['category'])
    expect(p.publicationApproved).toBe(false)
  })
  it('separates nominal online statistics from real all-channel data and holds an undefined scope', () => {
    const x = fixture(); addRetail(x, { ...scope(), priceBasis: 'nominal', channel: 'online' })
    const q = planResearchNeeds(x).questions.find(q => q.id === 'consumption')!
    expect(q.requirements[1]).toMatchObject({ status: 'review_pending', candidates: [{ evidenceId: 'retail', reason: 'scope_mismatch' }] })
    const unknown = planResearchNeeds({ ...x, requirements: {} })
    expect(unknown.questions.every(q => q.action === 'define_scope')).toBe(true)
    expect(unknown.discoveryRequests).toEqual([])
    expect(unknown.coreStatus).toBe('hold')
  })
  it.each([
    ['period', '2026-07', 'period_mismatch'],
    ['country', 'BRL', 'country_mismatch'],
    ['publishedAt', '2026-10-10', 'after_cutoff'],
    ['publishedAt', '2026-10-09', 'publication_time_unverified'],
    ['collectedAt', '2026-10-11T10:00:00Z', 'historical_version_unverified'],
    ['modifiedAt', '2026-10-11T10:00:00Z', 'historical_version_unverified'],
  ])('distinguishes %s=%s as %s rather than missing or current data', (field, value, reason) => {
    const x = fixture(), r = source('retail', scope())
    Object.assign(r.evidence, { [field]: value })
    // Rebind a synthetic scope intentionally; temporal checks remain independent.
    const { review, ...draft } = r.card
    r.card = bindEvidenceScope(r.evidence, draft, review)
    x.packet.evidence.push(r.evidence); x.packet.evidenceScopeCards.push(r.card)
    expect(planResearchNeeds(x).questions.find(q => q.id === 'consumption')?.requirements[1].candidates[0].reason).toBe(reason)
  })
  it('does not discard matching context just because its publication exceeds the news search window', () => {
    const x = fixture()
    x.packet.evidence[0].publishedAt = '2026-08-18'
    const { review, ...draft } = x.packet.evidenceScopeCards[0]
    x.packet.evidenceScopeCards[0] = bindEvidenceScope(x.packet.evidence[0], draft, review)
    expect(planResearchNeeds(x).questions[0].status).toBe('available')
  })
  it('invalidates changed passages and keeps reuse conditions separate from source matching', () => {
    const x = fixture(); addRetail(x)
    x.packet.evidence[1].sourceContext = createSourceContext({ blocks: [{kind:'paragraph',text:'A revised synthetic body with different original content.'}], selected:[0] })
    expect(planResearchNeeds(x).questions[2].requirements[1].candidates[0].reason).toBe('scope_review_unverified')
    const y = fixture(); addRetail(y); y.packet.evidence[1].review.reuse = 'unverified'
    expect(planResearchNeeds(y).questions[2].requirements[1].candidates[0].reason).toBe('terms_unverified')
  })
  it('reviews already saved but unclassified evidence before scheduling a duplicate search', () => {
    const x = fixture(); addRetail(x)
    x.packet.evidenceScopeCards.pop()
    const p = planResearchNeeds(x)
    expect(p.questions[2].requirements[1].unclassifiedEvidenceIds).toEqual(['retail'])
    expect(p.questions[2]).toMatchObject({ status:'research_needed', action:'review_inventory' })
    expect(p.discoveryRequests).toEqual([])
  })
  it('holds mismatching adjustment or base year and multiple matching source versions', () => {
    const x = fixture(); addRetail(x, { ...scope(), adjustment: 'seasonally_adjusted', baseYear: '2023' })
    expect(planResearchNeeds(x).questions[2].requirements[1].candidates[0].reason).toBe('scope_mismatch')
    const y = fixture(); addRetail(y)
    const revised = source('retail-revised', scope(), '4.0')
    y.packet.evidence.push(revised.evidence); y.packet.evidenceScopeCards.push(revised.card)
    expect(planResearchNeeds(y).questions[2]).toMatchObject({ status: 'conflict', action: 'review_conflict' })
  })
  it('preserves failed attempts but never turns empty results or claimed nonpublication into facts', () => {
    const x = fixture(), attempts = ['access_failed','extraction_failed','not_found_in_attempt','not_yet_released','no_matching_series'].map(status => ({ questionId: 'consumption', status }))
    const q = planResearchNeeds({ ...x, attempts }).questions[2]
    expect(q.status).toBe('research_needed')
    expect(q.attempts.map(a => a.status)).toEqual(attempts.map(a => a.status))
    expect(q.attempts.every(a => !a.verified)).toBe(true)
    expect(q.attempts.at(-1)?.reason).toBe('official_confirmation_required')
  })
  it('reserves only first-round slots and leaves budget-deferred questions unresolved', () => {
    const x = fixture(), p = planResearchNeeds({ ...x, maxQueries: 1 })
    expect(p.discoveryRequests.map(q => q.needId)).toEqual(['consumption'])
    expect(p.deferred).toContainEqual({ id: 'category', reason: 'query_budget' })
    expect(p.limits).toEqual({ maxQueries: 1, reservedQueries: 1, remainingQueries: 0 })
    expect(planResearchNeeds({ ...x, maxQueries: 0 }).discoveryRequests).toEqual([])
    expect(planResearchNeeds({ ...x, topics: ['financing','retail','real_pay'] }).deferred).toContainEqual({id:'financing',reason:'supplement_limit'})
  })
  it('binds plan identity to reviewed scope and rejects malformed selectors instead of guessing', () => {
    const x = fixture(), p = planResearchNeeds(x)
    const changed = structuredClone(x); changed.requirements.consumption[1].scope.baseYear = '2023'
    expect(planResearchNeeds(changed).planId).not.toBe(p.planId)
    expect(() => planResearchNeeds({ ...x, purpose: 'fx_explanation' })).toThrow('invalid_research_needs_input')
    expect(() => planResearchNeeds({ ...x, asOf: '2026-02-30T12:00:00Z' })).toThrow('invalid_research_needs_input')
    expect(() => planResearchNeeds({ ...x, asOf: '2026-10-13T12:00:00Z' })).toThrow('invalid_research_needs_input')
    expect(() => planResearchNeeds({ ...x, requirements: { imaginary: [] } })).toThrow('invalid_requirements')
    expect(() => planResearchNeeds({ ...x, requirements: { consumption: [{ id: 'retail', period: '2026-08', scope: { subject:'retail',metric:'retail',unit:'percent',comparison:'year_over_year' } }] } })).toThrow('statistical_dimensions_required')
    expect(() => planResearchNeeds({ ...x, dossier: { version: 'unknown' } })).toThrow('stale_or_missing_dossier')
  })
  it('requires both sides of a comparison and refuses incompatible or unknown target definitions', () => {
    const x = fixture()
    expect(() => planResearchNeeds({ ...x, requirements: { consumption: [requirement()] } })).toThrow('consumption_baseline_and_retail_required')
    const mismatch = structuredClone(x); mismatch.requirements.category[1].scope.baseYear = '2023'
    expect(() => planResearchNeeds(mismatch)).toThrow('comparison_targets_mismatch')
    const unknown = structuredClone(x); unknown.requirements.category[1].scope.channel = 'unknown'
    expect(() => planResearchNeeds(unknown)).toThrow('statistical_dimensions_required')
    const future = structuredClone(x); future.requirements.economic_release[0] = { ...future.requirements.economic_release[0], period: '2027-01' }
    expect(() => planResearchNeeds(future)).toThrow('future_target_period')
  })
})
