import { describe, expect, it } from 'vitest'
import { buildPacket } from './core.js'
import { clpEvidence } from './clp-case.js'
import { finalizePacket, prepareFinalInput } from './final-clp-input.js'

// Synthetic market values; this tests preparation boundaries, not historical truth.
const source = () => {
  const data = { baseDate: '2026-09-11', dailyRates: ['2026-08-31', '2026-09-04', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']
    .map((date, i) => ({ date, currency: 'CLP', rateType: 'LOCAL_PER_USD', source: 'API', value: 920 + i })) }
  const p = buildPacket(data, 'CLP', data.baseDate, clpEvidence)
  p.assessment.publishDecision = { eligible: false, reason: 'historical_review_only_observation_time_missing' }
  return p
}
describe('final historical input preparation', () => {
  it('amends attribution only while preserving the original market, identities and publication block', () => {
    const original = source(), before = structuredClone(original), finalized = finalizePacket(original)
    expect(original).toEqual(before)
    expect(finalized.facts).toEqual(before.facts)
    expect(finalized.series).toEqual(before.series)
    expect(finalized.assessment).toEqual(before.assessment)
    expect(finalized.evidence.map(({ id, url, publishedAt, eventAt, period }) => ({ id, url, publishedAt, eventAt, period })))
      .toEqual(before.evidence.map(({ id, url, publishedAt, eventAt, period }) => ({ id, url, publishedAt, eventAt, period })))
    expect(finalized.evidence.find(e => e.id === 'rm-inflation')?.summary).not.toContain('별도의 조건부 산술 경로')
    expect(finalized.evidence.find(e => e.id === 'emol-morning')?.summary).toContain('긴축적 정책')
  })
  it('refuses a substituted source even if the normal original-review gate would admit it', () => {
    const p = source()
    expect(() => finalizePacket(p)).not.toThrow()
    p.evidence[0].url = 'https://example.com/other-reviewed-article'
    expect(() => finalizePacket(p)).toThrow('final_source_boundary_mismatch')
  })
  it('refuses to reinterpret an observed-time case as the reviewed missing-time case', () => {
    const p = source()
    expect(() => finalizePacket(p)).not.toThrow()
    p.observationAt = '2026-09-11T18:00:00Z'
    expect(() => finalizePacket(p)).toThrow('final_case_boundary_mismatch')
  })
  it('carries the exhausted trial unknown cost forward without allocating or authorizing another call', () => {
    const p = prepareFinalInput({ packet: source(), priorConfirmedUsd: .07933225, priorUnknownUsd: .2016755 },
      { reservedUsd: .16951, costUsd: null })
    expect(p.cost).toMatchObject({ priorConfirmedUsd: .07933225, priorUnknownReservedUsd: .3711855, newCalls: 0, newCostUsd: 0, newReservationUsd: 0 })
    expect(p.status).toMatchObject({ historicalDraftInput: 'ready', paidCallAuthorized: false, publicationApproved: false })
    expect(JSON.parse(p.body.messages[1].content).applicableMechanisms).toEqual([])
    expect(p.reviewOrigin).toBe('agent')
  })
})
