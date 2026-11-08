import { describe, expect, it, vi } from 'vitest'
import { collectSources, normalizeSnapshot, SOURCE_CATALOG } from './sources.js'

describe('official source snapshots', () => {
  it('filters future effective dates and never invents publication timestamps', () => {
    const result = normalizeSnapshot(SOURCE_CATALOG[0], [{ data: '13/09/2026', valor: '14.0' }, { data: '16/09/2026', valor: '14.0' }], '2026-09-13')
    expect(result.observations).toEqual([{ date: '2026-09-13', value: 14 }])
    expect(result.publishedAt).toBeNull(); expect(result.evidenceReady).toBe(false)
  })
  it('keeps missing monthly values null, not zero, and labels total retail', () => {
    const result = normalizeSnapshot(SOURCE_CATALOG[2], [{ id: '11708', resultados: [{ series: [{ localidade: { id: '1' }, serie: { '202606': '1.2', '202607': '-', '202610': '99' } }] }] }], '2026-09-13')
    expect(result.observations).toEqual([{ period: '202606', value: 1.2 }, { period: '202607', value: null }])
    expect(result.evidenceReady).toBe(false)
  })
  it('reports unavailable Mexico adapters honestly without network calls', async () => {
    const fetchImpl = vi.fn()
    const results = await collectSources({ currency: 'MXN', asOf: '2026-09-13', fetchImpl })
    expect(results.every(r => r.status === 'not_collected')).toBe(true); expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('source failures remain failures instead of fabricated evidence', async () => {
    const results = await collectSources({ currency: 'BRL', asOf: '2026-09-13', fetchImpl: async () => new Response('', { status: 503 }) })
    expect(results).toHaveLength(3); expect(results.every(r => r.status === 'failed')).toBe(true)
  })
})
