import { describe, expect, it, vi } from 'vitest'
import { selectInitialExchangeDataset } from '../exchangeRateRepository'
import { dataset } from './fixtures'

describe('initial exchange-rate data source selection', () => {
  it('labels the cached outage recovery as static and stale', async () => {
    const result = await selectInitialExchangeDataset({
      mode: 'auto', supabaseConfigured: true,
      loadSupabase: vi.fn().mockResolvedValue({ dataset: dataset(), metadata: null, stale: true }),
      loadStatic: vi.fn(),
    })
    expect(result).toMatchObject({ source: 'static', stale: true })
  })
  it('uses Supabase first in auto mode', async () => {
    const remote = dataset({ baseDate: '2026-09-01' })
    const result = await selectInitialExchangeDataset({
      mode: 'auto',
      supabaseConfigured: true,
      loadSupabase: vi.fn().mockResolvedValue({ dataset: remote, metadata: null, stale: false }),
      loadStatic: vi.fn().mockResolvedValue(dataset({ baseDate: '2026-08-31' })),
    })

    expect(result.source).toBe('supabase')
    expect(result.dataset.baseDate).toBe('2026-09-01')
  })

  it('falls back to static data when Supabase fails in auto mode', async () => {
    const fallback = dataset({ baseDate: '2026-08-31' })
    const result = await selectInitialExchangeDataset({
      mode: 'auto',
      supabaseConfigured: true,
      loadSupabase: vi.fn().mockRejectedValue(new Error('offline')),
      loadStatic: vi.fn().mockResolvedValue(fallback),
    })

    expect(result).toMatchObject({ source: 'static', dataset: fallback })
  })

  it('does not hide Supabase failures in strict mode', async () => {
    await expect(selectInitialExchangeDataset({
      mode: 'supabase',
      supabaseConfigured: true,
      loadSupabase: vi.fn().mockRejectedValue(new Error('offline')),
      loadStatic: vi.fn().mockResolvedValue(dataset()),
    })).rejects.toThrow('offline')
  })

  it('uses static data directly in json mode', async () => {
    const loadSupabase = vi.fn()
    const result = await selectInitialExchangeDataset({
      mode: 'json',
      supabaseConfigured: true,
      loadSupabase,
      loadStatic: vi.fn().mockResolvedValue(dataset()),
    })

    expect(result.source).toBe('static')
    expect(loadSupabase).not.toHaveBeenCalled()
  })
})
