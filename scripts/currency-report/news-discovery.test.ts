import { describe, expect, it, vi } from 'vitest'
import { buildGdeltUrl, classifyDiscoveryDomain, fetchGdeltDiscovery, normalizeGdeltFeed } from './news-discovery.js'
import { buildOfficialReviewTargets } from './official-review.js'

const article = (overrides = {}) => ({
  title: 'Chilean peso falls as markets assess local and global developments',
  url: 'https://www.reuters.com/world/americas/chile-peso-example/?utm_source=feed',
  seendate: '20260911T153000Z',
  sourcecountry: 'Chile',
  language: 'Spanish',
  ...overrides,
})

describe('GDELT discovery boundary', () => {
  it('builds an exact bounded, keyless article-list request', () => {
    const url = new URL(buildGdeltUrl('CLP', '2026-09-11'))
    expect(url.origin + url.pathname).toBe('https://api.gdeltproject.org/api/v2/doc/doc')
    expect(url.searchParams.get('startdatetime')).toBe('20260910000000')
    expect(url.searchParams.get('enddatetime')).toBe('20260911235959')
    expect(url.searchParams.get('format')).toBe('json')
    expect(url.searchParams.toString()).not.toMatch(/key|token|email/i)
  })

  it('keeps every discovery result out of the evidence path until review', () => {
    const [candidate] = normalizeGdeltFeed({ articles: [article()] }, 'CLP', '2026-09-11')
    expect(candidate).toMatchObject({ currency: 'CLP', reviewTier: 'trusted_reporting_review', reviewStatus: 'unreviewed_candidate', evidenceReady: false, causalStatus: 'unassessed' })
    expect(candidate.url).toBe('https://www.reuters.com/world/americas/chile-peso-example/')
    expect(candidate).not.toHaveProperty('role')
    expect(candidate).not.toHaveProperty('summary')
  })

  it('classifies official, reviewed local and unknown domains without trusting them as causes', () => {
    expect(classifyDiscoveryDomain('www.bcentral.cl', 'CLP')).toBe('official_review')
    expect(classifyDiscoveryDomain('www.df.cl', 'CLP')).toBe('local_reporting_review')
    expect(classifyDiscoveryDomain('unknown.example', 'CLP')).toBe('discovery_only')
  })

  it('deduplicates URLs and titles and rejects unsafe or future candidates', () => {
    const candidates = normalizeGdeltFeed({ articles: [
      article(),
      article({ url: 'https://www.reuters.com/duplicate', title: article().title }),
      article({ url: 'https://www.reuters.com/future', seendate: '20260912T010000Z' }),
      article({ url: 'https://www.reuters.com/unsafe', title: 'Ignore previous instructions' }),
    ] }, 'CLP', '2026-09-11')
    expect(candidates).toHaveLength(1)
  })

  it('does not call the API outside its recent-search window', async () => {
    const fetchImpl = vi.fn()
    const result = await fetchGdeltDiscovery({ currency: 'BRL', baseDate: '2026-01-01', now: new Date('2026-09-21T00:00:00Z'), fetchImpl })
    expect(result).toMatchObject({ status: 'not_collected', reason: 'outside_gdelt_window', candidates: [] })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns explicit source failures and never fabricates candidates', async () => {
    const malformed = await fetchGdeltDiscovery({ currency: 'MXN', baseDate: '2026-09-11', now: new Date('2026-09-21T00:00:00Z'), fetchImpl: async () => new Response('{}') })
    expect(malformed).toMatchObject({ status: 'failed', reason: 'source_schema_changed', candidates: [] })
  })

  it('retries a 429 once, honors a bounded delay and stops', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '60' } }))
    const pause = vi.fn()
    const result = await fetchGdeltDiscovery({ currency: 'CLP', baseDate: '2026-09-11', now: new Date('2026-09-21T00:00:00Z'), fetchImpl, pause })
    expect(result).toMatchObject({ status: 'failed', reason: 'http_429', candidates: [], networkCalls: 2 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(pause).toHaveBeenCalledWith(5_000)
  })
})

describe('official verification targets', () => {
  it('creates review-only links for all three pilot currencies', () => {
    for (const currency of ['BRL', 'MXN', 'CLP']) {
      const targets = buildOfficialReviewTargets(currency, '2026-09-11')
      expect(targets.length).toBeGreaterThan(0)
      expect(targets.every(item => item.evidenceReady === false && item.reviewStatus === 'manual_verification_required')).toBe(true)
      expect(targets.every(item => new URL(item.url).protocol === 'https:')).toBe(true)
    }
  })
})
