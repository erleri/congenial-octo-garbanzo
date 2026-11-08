import { describe, expect, it } from 'vitest'
import { chileStatisticScopes, planChileRetailNeeds } from './chile-statistic-scopes.js'
import { syntheticCase } from './rule-fixtures.js'
import { planResearchNeeds } from './research-needs.js'

function input(period = '2026-08') {
  return { period, packet: { ...syntheticCase('CLP').packet, purpose: 'economic_update',
    baseDate: '2026-10-09', evidence: [], evidenceScopeCards: [] }, purpose: 'economic_update',
    asOf: '2026-10-09T23:00:00Z' }
}

describe('Chile official definition registry, not evidence approval', () => {
  it('keeps four different universes and nominal online apart from real original IACM', () => {
    const r = chileStatisticScopes()
    expect(r.definitions.map(d => d.scope.subject)).toEqual(['cl_iacm_total', 'cl_iacm_electronics_home_technology', 'cl_iac_division47', 'cl_icem_division47'])
    expect(r.definitions[3].scope).toMatchObject({ channel: 'online', priceBasis: 'nominal' })
    expect(r.definitions.slice(0, 2).map(d => d.scope)).toEqual([
      expect.objectContaining({ metric: 'retail', channel: 'all', priceBasis: 'real', adjustment: 'unadjusted', baseYear: '2018', comparison: 'year_over_year' }),
      expect.objectContaining({ metric: 'retail', channel: 'all', priceBasis: 'real', adjustment: 'unadjusted', baseYear: '2018', comparison: 'year_over_year' }),
    ])
    expect(r.definitions[1].excludedInference).toContain('TV')
    expect(r.terms.status).not.toBe('verified')
    expect(r.definitionSource).toMatchObject({ publicationTime: null, retrievedVersion: 'current_file_not_archived', provisional: true })
  })
  it('reuses the planner and routes one scoped consumer request without inventing evidence or core/pay readiness', () => {
    const x = input(), before = structuredClone(x), p = planChileRetailNeeds(x)
    expect(p.questions.map(q => [q.id, q.action])).toEqual([
      ['economic_release', 'define_scope'], ['economic_scope', 'define_scope'], ['category', 'discover'],
    ])
    expect(p.discoveryRequests).toHaveLength(1)
    expect(p.discoveryRequests[0]).toMatchObject({ questionId: 'consumer', status: 'planned_not_executed', maxQueries: 1,
      sourceTargets: [expect.objectContaining({ period: '2026-08' }), expect.objectContaining({ period: '2026-08' })] })
    expect(p.discoveryRequests[0].query).toContain('2026-08')
    expect(p).toMatchObject({ publicationApproved: false, writingEligibility: 'not_assessed', coreStatus: 'hold', networkCalls: 0, modelCalls: 0 })
    expect(p.statisticRegistry).toMatchObject({ sourceAvailability: 'not_assessed', historicalVintage: 'not_assessed' })
    expect(x).toEqual(before)
    expect(planChileRetailNeeds(x)).toEqual(p)
    expect(p.planId).not.toBe(planResearchNeeds({ ...x, topics: ['retail'] }).planId)
  })
  it('requires a definition review for other periods instead of applying an August bulletin or fabricating absence', () => {
    const p = planChileRetailNeeds(input('2026-09'))
    expect(p.questions.find(q => q.id === 'category')).toMatchObject({ status: 'review_pending', action: 'define_scope' })
    expect(p.discoveryRequests).toEqual([])
    expect(p.statisticRegistry.targets.every(t => t.locator.pages.length === 0 && !t.locator.url.endsWith('.pdf'))).toBe(true)
    expect(p.statisticRegistry.status).toBe('review_required')
  })
  it('retains unclassified local originals for review rather than marking the registry as a fact or searching again', () => {
    const x = input()
    const packet = { ...x.packet, evidence: [{ id: 'saved-unclassified', country: 'CLP', period: '2026-08' }] }
    const p = planChileRetailNeeds({ ...x, packet })
    expect(p.questions.find(q => q.id === 'category')).toMatchObject({ action: 'review_inventory', status: 'research_needed' })
    expect(p.discoveryRequests).toEqual([])
    expect(packet.evidence).toEqual([{ id: 'saved-unclassified', country: 'CLP', period: '2026-08' }])
  })
  it('preserves explicit core requirements and query budgets; does not overwrite caller category scope', () => {
    const x = input(), r = chileStatisticScopes().definitions[0]
    const core = [{ id: 'core', period: x.period, scope: r.scope }]
    const p = planChileRetailNeeds({ ...x, requirements: { economic_release: core }, maxQueries: 0 })
    expect(p.questions[0].requirements[0].scope).toEqual(r.scope)
    expect(p.deferred).toContainEqual({ id: 'category', reason: 'query_budget' })
    expect(p.discoveryRequests).toEqual([])
    expect(() => planChileRetailNeeds({ ...x, requirements: { category: [] } })).toThrow('category_scope_already_defined')
  })
  it('does not silently change reviewer interests or bypass country/period/cutoff validation', () => {
    expect(() => planChileRetailNeeds({ ...input(), topics: ['real_pay'] })).toThrow('category_question_not_selected')
    expect(() => planChileRetailNeeds({ ...input(), packet: { ...input().packet, currency: 'BRL' } })).toThrow('invalid_chile_statistic_scope')
    expect(() => planChileRetailNeeds(input('2026-13'))).toThrow('invalid_chile_statistic_scope')
    expect(() => planChileRetailNeeds(input('2026-11'))).toThrow('future_target_period')
    expect(() => planChileRetailNeeds({ ...input(), asOf: '2026-10-10T01:00:00Z' })).toThrow('invalid_research_needs_input')
  })
  it('isolates returned definitions so a caller cannot alter future plans or evidence bindings', () => {
    const before = planChileRetailNeeds(input()), registry = chileStatisticScopes()
    registry.definitions[0].scope.priceBasis = 'nominal'
    registry.verifiedDefinitionPeriods.push('2026-09')
    registry.terms.status = 'verified'
    expect(planChileRetailNeeds(input())).toEqual(before)
    expect(planChileRetailNeeds(input('2026-09')).statisticRegistry.status).toBe('review_required')
  })
})
