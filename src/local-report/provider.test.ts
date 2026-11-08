import { afterEach, describe, expect, it, vi } from 'vitest'
import { localProvider } from './provider'

afterEach(() => vi.unstubAllGlobals())
function cache() {
  const data = new Map<string, string>()
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k) })
  return data
}
describe('local report provider', () => {
  it('reads live data then explicitly flags the cached result on failure', async () => {
    cache()
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'test', baseDate: '2025-06-20' }]))).mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetcher)
    const provider = localProvider('fixture')
    expect((await provider.list()).cached).toBe(false)
    const fallback = await provider.list()
    expect(fallback.cached).toBe(true); expect(fallback.items[0].baseDate).toBe('2025-06-20')
  })
  it('does not reuse the fixture cache for live data', async () => {
    cache()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]))))
    await localProvider('fixture').list()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(localProvider('live-local').list()).rejects.toThrow('로컬 서버')

  })
  it('does not hide uncached or corrupt-cache failures', async () => {
    const store = cache()
    store.set('latamfx:local-currency-report:v1:fixture:index', '{')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(localProvider('fixture').list()).rejects.toThrow('자료를 불러오지 못했습니다')
  })
})
describe('cache removal boundary', () => {
  it('keeps a withdrawn result out of offline cache even after constructing a new provider', async () => {
    const store=cache()
    store.set('latamfx:local-currency-report:v2:live-local:index',JSON.stringify({version:2,checkedAt:Date.now(),data:[{id:'BRL-test',baseDate:'2026-10-09'}]}))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: 'BRL-test' }))).mockResolvedValueOnce(new Response('', { status: 410 })).mockRejectedValue(new Error('offline')))
    await localProvider('live-local').get('BRL-test')
    await expect(localProvider('live-local').get('BRL-test')).rejects.toThrow('withdrawn')
    expect(JSON.parse(store.get('latamfx:local-currency-report:v2:live-local:index')!).data).toEqual([])
    await expect(localProvider('live-local').get('BRL-test')).rejects.toThrow('자료를 불러오지 못했습니다')
  })
  it('does not serve a cached report after the server returns 404', async () => {
    cache()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([]))).mockResolvedValueOnce(new Response('', { status: 404 })))
    const provider = localProvider('fixture')
    await provider.list()
    await expect(provider.list()).rejects.toThrow('not_found')
  })
})
describe('bounded public cache and private review separation',()=>{
 it('expires public cache by last successful check while preserving the original report date',async()=>{
  cache();let now=Date.parse('2026-10-29T00:00:00Z');vi.spyOn(Date,'now').mockImplementation(()=>now)
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json([{id:'bounded',baseDate:'2026-09-10'}])).mockRejectedValue(Error('offline')))
  const provider=localProvider('fixture');await provider.list();now+=23*3600000
  expect((await provider.list()).items[0].baseDate).toBe('2026-09-10')
  now+=2*3600000;await expect(provider.list()).rejects.toThrow('자료를 불러오지 못했습니다')
  vi.restoreAllMocks()
 })
 it('never persists live-local drafts or private comparison responses',async()=>{
  const store=cache();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({id:'private-draft',comparison:{reviewNotes:['PRIVATE_REVIEW']}})).mockRejectedValue(Error('offline')))
  const provider=localProvider('live-local');await provider.get('private-draft')
  expect([...store.values()].join()).not.toContain('PRIVATE_REVIEW')
  await expect(provider.get('private-draft')).rejects.toThrow('자료를 불러오지 못했습니다')
 })
 it('does not resurrect a known withdrawn immutable ID after a stale successful response',async()=>{
  cache();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('',{status:410})).mockResolvedValueOnce(Response.json({id:'withdrawal-race'})))
  const provider=localProvider('fixture');await expect(provider.get('withdrawal-race')).rejects.toThrow('withdrawn')
  await expect(provider.get('withdrawal-race')).rejects.toThrow('withdrawn')
 })
})
