import { describe, expect, it } from 'vitest'
import { assessEvidencePacket, selectHistoricalCases } from './evidence-quality.js'

const rows = (lastMove = 0.2) => {
  const result = []
  let value = 5
  for (let i = 0; i < 65; i += 1) {
    const date = new Date(Date.UTC(2025, 0, 1 + i))
    if ([0, 6].includes(date.getUTCDay())) continue
    value *= 1 + (i === 64 ? lastMove / 100 : ((i % 3) - 1) * 0.001)
    result.push({ date: date.toISOString().slice(0, 10), value })
  }
  return result
}
const evidence = (overrides = {}) => ({
  id: 'official-event', country: 'BRL', scope: 'country', role: 'trigger', causalStatus: 'source_attributed',
  eventDate: '2025-03-05', eventAt: '2025-03-05T12:00:00Z', publishedAt: '2025-03-05T12:05:00Z', ...overrides,
})
const packet = (lastMove, items = []) => {
  const series = rows(lastMove)
  return { currency: 'BRL', observedDate: series.at(-1).date, observationAt: `${series.at(-1).date}T18:00:00Z`, series, evidence: items }
}

describe('evidence quality assessment', () => {
  it('maps LOCAL_PER_USD increases to local-currency weakness', () => {
    expect(assessEvidencePacket(packet(2, [evidence()])).movement.direction).toBe('local_weaker')
    expect(assessEvidencePacket(packet(-2, [evidence()])).movement.direction).toBe('local_stronger')
  })

  it('holds a calm day even when contextual evidence exists', () => {
    const result = assessEvidencePacket(packet(0.2, [evidence({ role: 'context' })]))
    expect(result.movement.severity).toBe('calm')
    expect(result.publishDecision).toEqual({ eligible: false, reason: 'no_material_change' })
  })

  it('holds a sharp move without timestamped trigger evidence', () => {
    const result = assessEvidencePacket(packet(3, [evidence({ eventAt: undefined, publishedAt: '2025-03-05', role: 'trigger' })]))
    expect(result.movement.severity).toBe('sharp')
    expect(result.timeline[0]).toMatchObject({ timingPrecision: 'date_only', triggerReady: false })
    expect(result.publishDecision.reason).toBe('sharp_move_without_timed_trigger')
  })

  it('does not infer intraday order when the FX observation time is absent', () => {
    const p = packet(3, [evidence()])
    delete p.observationAt
    const result = assessEvidencePacket(p)
    expect(result.timeline[0].happenedBeforeObservation).toBeNull()
    expect(result.publishDecision.reason).toBe('sharp_move_without_timed_trigger')
  })

  it('allows review only when a sharp move has a bounded attributed trigger', () => {
    const p = packet(3)
    const onDay = `${p.observedDate}T10:00:00Z`
    const result = assessEvidencePacket({ ...p, evidence: [evidence({ eventDate: p.observedDate, eventAt: onDay, publishedAt: onDay })] })
    expect(result.timedTriggerEvidenceIds).toEqual(['official-event'])
    expect(result.publishDecision).toEqual({ eligible: true, reason: 'review_required' })
  })

  it('rejects a trigger that occurred after the FX observation', () => {
    const p = packet(3)
    const afterObservation = `${p.observedDate}T19:00:00Z`
    const result = assessEvidencePacket({ ...p, evidence: [evidence({ eventDate: p.observedDate, eventAt: afterObservation, publishedAt: afterObservation })] })
    expect(result.timeline[0]).toMatchObject({ happenedBeforeObservation: false, triggerReady: false })
    expect(result.publishDecision.reason).toBe('sharp_move_without_timed_trigger')
  })

  it('separates global, country and sales-context evidence', () => {
    const p = packet(1)
    const result = assessEvidencePacket({ ...p, evidence: [
      evidence({ id: 'g', scope: 'global', role: 'context' }),
      evidence({ id: 'c', scope: 'country', role: 'context' }),
      evidence({ id: 's', scope: 'sales_context', role: 'context' }),
    ] })
    expect(result.evidenceByScope).toEqual({ global: ['g'], country: ['c'], salesContext: ['s'] })
  })

  it('selects historical extremes without asserting causes', () => {
    const dataset = { dailyRates: [
      { currency: 'BRL', rateType: 'LOCAL_PER_USD', date: '2025-01-02', value: 5 },
      { currency: 'BRL', rateType: 'LOCAL_PER_USD', date: '2025-01-03', value: 5.5 },
      { currency: 'BRL', rateType: 'LOCAL_PER_USD', date: '2025-01-06', value: 5.2 },
    ] }
    const cases = selectHistoricalCases(dataset, { extremes: { BRL: 1 }, controls: {} })
    expect(cases).toHaveLength(1)
    expect(cases[0]).toMatchObject({ currency: 'BRL', baseDate: '2025-01-03', evidenceStatus: 'unresearched', caseType: 'extreme' })
    expect(cases[0]).not.toHaveProperty('cause')
  })
})
