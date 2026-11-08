import { describe, expect, it, vi } from 'vitest'
import { selectInitialExchangeDataset,refreshableDatasetLoader } from '../exchangeRateRepository'
import { dataset } from './fixtures'

describe('initial exchange-rate data source selection', () => {
  it('reloads the operating store explicitly while ordinary reads share the current request',async()=>{
    const source=vi.fn().mockResolvedValueOnce({version:1}).mockResolvedValueOnce({version:2})
    const load=refreshableDatasetLoader(source)
    const first=load();expect(load()).toBe(first)
    expect(await first).toEqual({version:1})
    expect(await load(true)).toEqual({version:2})
    expect(await load()).toEqual({version:2})
    expect(source).toHaveBeenCalledTimes(2)
  })
  it('does not let an older failed read discard a successful refresh',async()=>{
    let rejectOld:(e:Error)=>void=()=>{}
    const source=vi.fn().mockImplementationOnce(()=>new Promise((_resolve,reject)=>{rejectOld=reject})).mockResolvedValueOnce({version:2})
    const load=refreshableDatasetLoader(source),old=load();await Promise.resolve()
    const current=load(true);expect(await current).toEqual({version:2})
    rejectOld(new Error('old request failed'));await expect(old).rejects.toThrow('old request failed')
    expect(load()).toBe(current)
  })
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
