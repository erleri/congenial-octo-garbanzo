import { describe, expect, it } from 'vitest'
import { replayResearchCollection } from './research-collection.js'
import { researchReplayFixture } from './research-collection-fixtures.js'
import { planResearchNeeds } from './research-needs.js'
import { createSourceContext } from './source-context.js'
import { bindEvidenceScope } from './evidence-scope.js'
import { questionSearchUrl } from './public-research-adapter.js'

describe('Question plan to offline collection handoff', () => {
  it('routes registered core and supplementary needs to INE once per source, without mutating inputs or approving evidence', async () => {
    const fixture = researchReplayFixture('official'), before = structuredClone(fixture)
    const result = await replayResearchCollection(fixture)
    expect(result.searches).toEqual([])
    expect(result.originals).toHaveLength(2)
    expect(result.simulatedRequests).toBe(4) // two indexes, two PDFs, not four questions x four requests
    expect(result.outcomes.map(o => [o.needId, o.originalIds.length, o.status])).toEqual([
      ['economic_release', 1, 'originals_pending_review'], ['economic_scope', 1, 'originals_pending_review'],
      ['consumption', 2, 'originals_pending_review'], ['category', 1, 'originals_pending_review'],
    ])
    expect(result.originals.every(o => o.evidenceReady === false && o.periodVerified === false)).toBe(true)
    expect(result).toMatchObject({ mode: 'offline_replay', status: 'review_required', networkCalls: 0, modelCalls: 0,
      apiCostUsd: 0, writingEligibility: 'not_assessed', contentQuality: 'not_assessed', publicationApproved: false })
    expect(fixture).toEqual(before)
    expect((await replayResearchCollection(fixture)).collectionId).toBe(result.collectionId)
  })

  it('shares broad news search and original capture while keeping each precise question unresolved until review', async () => {
    const result = await replayResearchCollection(researchReplayFixture('news'))
    expect(result.searches).toHaveLength(1)
    expect(result.searches[0].needIds).toEqual(['economic_release', 'economic_scope'])
    expect(result.originals).toHaveLength(1)
    expect(result.originals[0].needIds).toEqual(['economic_release', 'economic_scope'])
    expect(result.simulatedRequests).toBe(2)
    expect(result.outcomes.every(o => o.reason === 'scope_time_and_meaning_not_approved')).toBe(true)
    expect(result.plan.coreStatus).toBe('hold') // capture never rewrites planning/evidence approval
    expect(result.originals[0].originalVerified).toBe(false)
  })

  it('uses core-first version only in the new connected path and preserves the old planner default', async () => {
    const fixture = researchReplayFixture('news')
    const pay = fixture.input.requirements.economic_release[0]
    const retail = { ...pay, id: 'retail', scope: { ...pay.scope, metric: 'retail' } }
    const input = { ...fixture.input, topics: ['real_pay'], maxQueries: 1,
      requirements: { ...fixture.input.requirements, consumption: [pay, retail] } }
    const legacy = planResearchNeeds(input)
    expect(legacy.version).toBe('research-needs/1')
    expect(legacy.discoveryRequests[0].needId).toBe('consumption')
    const result = await replayResearchCollection({ ...fixture, input })
    expect(result.plan.version).toBe('research-needs/2')
    expect(result.plan.discoveryRequests.map(r => r.needId)).toEqual(['economic_release'])
    expect(result.outcomes.find(o => o.needId === 'consumption')).toMatchObject({ status: 'deferred', reason: 'query_budget' })
    expect(planResearchNeeds(input)).toEqual(legacy)
  })

  it('returns distinct empty-search and access-failure states without a real-network fallback', async () => {
    const empty = await replayResearchCollection(researchReplayFixture('missing'))
    expect(empty.outcomes.every(o => o.status === 'not_found_in_attempt')).toBe(true)
    const fixture = researchReplayFixture('news')
    fixture.responses = []
    const failed = await replayResearchCollection(fixture)
    expect(failed.outcomes.every(o => o.status === 'collection_failed')).toBe(true)
    expect(failed.requests[0]).toMatchObject({ reason: 'fixture_missing', attempted: true })
    expect(failed.networkCalls).toBe(0)
  })

  it('reports partial official coverage when pay succeeds but the retail index fails', async () => {
    const fixture = researchReplayFixture('official')
    fixture.responses[0] = { ...fixture.responses[0], status: 503 }
    const result = await replayResearchCollection(fixture)
    expect(result.outcomes.find(o => o.needId === 'economic_release')?.status).toBe('originals_pending_review')
    expect(result.outcomes.find(o => o.needId === 'consumption')).toMatchObject({ status: 'partial_pending_review', collectionIssues: ['index:http_503'] })
    expect(result.outcomes.find(o => o.needId === 'category')?.status).toBe('collection_failed')
    expect(result.status).toBe('incomplete')
  })

  it('shares scarce original slots across different core questions rather than exhausting the first result list', async () => {
    const fixture = researchReplayFixture('news'), base = fixture.input
    const requirement = base.requirements.economic_release[0]
    const input = { ...base, purpose: 'policy_update', packet: { ...base.packet, purpose: 'policy_update' },
      requirements: { policy_release: [requirement], policy_scope: [requirement] } }
    const article = fixture.responses[1].body
    const urls = ['https://www.df.cl/synthetic-first', 'https://www.df.cl/synthetic-extra', 'https://www.df.cl/synthetic-counter']
    const responses = ['local','counter'].map((questionId, i) => ({
      url: questionSearchUrl({ currency: 'CLP', baseDate: input.packet.baseDate, questionId }),
      body: JSON.stringify({ articles: (i ? [urls[2]] : urls.slice(0, 2)).map((url, index) => ({ url, title: `Synthetic policy coverage ${i}-${index}`, seendate: '20261015T120000Z' })) }),
    })).concat(urls.map(url => ({ url, body: article })))
    const result = await replayResearchCollection({ input, responses, limits: { maxOriginals: 2 } })
    expect(result.originals.map(o => o.url)).toEqual([urls[0], urls[2]])
    expect(result.outcomes.find(o => o.needId === 'policy_release')).toMatchObject({ status: 'partial_pending_review', collectionIssues: ['original_limit'] })
    expect(result.outcomes.find(o => o.needId === 'policy_scope')?.status).toBe('originals_pending_review')
  })

  it.each([
    [{ maxRequests: 1 }, 'request_limit'],
    [{ maxOriginals: 0 }, 'original_limit'],
    [{ maxBytes: 1 }, 'total_size_limit'],
    [{ maxBytesPerRequest: 1 }, 'response_size_limit'],
    [{ timeoutMs: 0 }, 'time_limit'],
  ])('stops at the shared replay limit %j and keeps the blocking reason %s', async (limits, reason) => {
    const result = await replayResearchCollection({ ...researchReplayFixture('news'), limits })
    const reasons = [...result.requests.map(r => r.reason), ...result.outcomes.flatMap(o => o.collectionIssues)]
    expect(reasons).toContain(reason)
    expect(result.status).toBe('incomplete')
    expect(result.simulatedRequests).toBeLessThanOrEqual(result.limits.maxRequests)
    expect(result.simulatedBytes).toBeLessThanOrEqual(result.limits.maxBytes)
    expect(result.publicationApproved).toBe(false)
  })

  it('preserves a captured original but stops the next request when the shared elapsed-time budget expires', async () => {
    const fixture = researchReplayFixture('official')
    // start, two index requests, first PDF, second PDF after the deadline
    const ticks = [0, 0, 0, 0, 121_000]
    const result = await replayResearchCollection({ ...fixture, now: () => ticks.shift() ?? 121_000 })
    expect(result.originals.filter(o => o.status === 'collected_pending_review')).toHaveLength(1)
    expect(result.requests.at(-1)).toMatchObject({ reason: 'time_limit', attempted: false })
    expect(result.status).toBe('incomplete')
    expect(result.networkCalls).toBe(0)
  })

  it('does not search when definitions are unregistered or there is a saved but unreviewed inventory', async () => {
    const fixture = researchReplayFixture('official')
    const result = await replayResearchCollection({ ...fixture, period: '2026-09', input: { ...fixture.input, requirements: {} } })
    expect(result.outcomes.every(o => o.status === 'definition_required')).toBe(true)
    expect(result.requests).toEqual([])
    const news = researchReplayFixture('news')
    const source = { id: 'saved', country: 'CLP', period: '2026-08' }
    const unreviewed = await replayResearchCollection({ ...news, input: { ...news.input,
      packet: { ...news.input.packet, evidence: [source] } } })
    expect(unreviewed.outcomes.every(o => o.status === 'inventory_review_required')).toBe(true)
    expect(unreviewed.requests).toEqual([])
  })

  it('reuses matching reviewed inventory without re-downloading or implying writing approval', async () => {
    const fixture = researchReplayFixture('news'), requirement = fixture.input.requirements.economic_release[0]
    const evidence = { id: 'saved-pay', country: 'CLP', period: requirement.period, publishedAt: '2026-10-07',
      collectedAt: '2026-10-08T12:00:00Z', title: 'Synthetic saved source', url: 'https://www.ine.gob.cl/synthetic',
      review: { originalVerified: true, reuse: 'verified', scope: 'Synthetic metadata match only.' },
      sourceContext: createSourceContext({ blocks: [{ kind: 'paragraph', text: 'Synthetic saved source for matching; not real statistics.' }], selected: [0] }) }
    const card = bindEvidenceScope(evidence, { passageIds: ['p0'], scope: requirement.scope,
      admittedClaims: [{ id: 'fact', kind: 'source_fact', passageIds: ['p0'], text: 'Synthetic statement for metadata matching only.' }],
      allowedUse: 'Synthetic matching only.', countercontext: 'No causal support is established.', excludedExpansions: ['company sales'],
      coverageGaps: [], crossSourceClaims: [] }, { origin: 'agent', status: 'checked', reason: 'Synthetic scope test double only.' })
    const result = await replayResearchCollection({ ...fixture, input: { ...fixture.input,
      packet: { ...fixture.input.packet, evidence: [evidence], evidenceScopeCards: [card] } } })
    expect(result.outcomes.every(o => o.status === 'stored_for_review')).toBe(true)
    expect(result.requests).toEqual([])
    expect(result.writingEligibility).toBe('not_assessed')
  })

  it('does not accept unchecked profiles, widened limits or duplicate fixture responses', async () => {
    const fixture = researchReplayFixture('news')
    await expect(replayResearchCollection({ ...fixture, scopeProfile: 'unknown', period: '2026-08' })).rejects.toThrow('invalid_collection_profile')
    await expect(replayResearchCollection({ ...fixture, limits: { maxRequests: 13 } })).rejects.toThrow('invalid_replay_limits_or_responses')
    await expect(replayResearchCollection({ ...fixture, responses: [fixture.responses[0], fixture.responses[0]] })).rejects.toThrow('invalid_replay_response')
  })
})
