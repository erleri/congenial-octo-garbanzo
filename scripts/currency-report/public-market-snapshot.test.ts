import { describe, expect, it, vi } from 'vitest'
import { fetchPublicMarketSnapshot } from './public-market-snapshot.js'
const data = { baseDate: '2026-10-10', dailyRates: ['BRL', 'CLP', 'MXN'].map(currency => ({ currency, rateType: 'LOCAL_PER_USD', date: '2026-10-09', value: 1, status: 'ok' })), monthlyRates: [] }
describe('public market snapshot provenance', () => {
  it('pins the second public request to a verified commit without claiming a production deployment', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'a'.repeat(40) }))).mockResolvedValueOnce(new Response(JSON.stringify(data)))
    const result = await fetchPublicMarketSnapshot(fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[1][0]).toBe(`https://raw.githubusercontent.com/erleri/congenial-octo-garbanzo/${'a'.repeat(40)}/public/data.json`)
    expect(result.receipt).toMatchObject({ baseDate: '2026-10-10', observationTimeVerified: false, productionDeploymentVerified: false, modelCalls: 0 })
  })
  it('cannot form an arbitrary URL from an invalid commit or expose contact fields as market data', async () => {
    const invalid = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sha: '../main' })))
    await expect(fetchPublicMarketSnapshot(invalid)).rejects.toThrow('public_commit_not_verified')
    expect(invalid).toHaveBeenCalledTimes(1)
    const unsafe = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'b'.repeat(40) }))).mockResolvedValueOnce(new Response(JSON.stringify({ ...data, email: 'sample@example.test' })))
    await expect(fetchPublicMarketSnapshot(unsafe)).rejects.toThrow('private_data_in_public_snapshot')
  })
})
