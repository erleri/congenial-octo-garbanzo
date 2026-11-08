import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { readCurrencyApiPrice, compareStoredProviderPrice, readReviewedEmolQuote, compareArticlePair,
  buildPriceBasisReview, buildPriceLinkedEvidenceReview } from './price-basis.js'

// Synthetic regression inputs. The CLI separately verifies saved real originals.
const capture = (day = '2026-10-15', value = 985.53240026) => ({
  raw: Buffer.from(JSON.stringify({ date: day, usd: { clp: value } })), currency: 'CLP', requestedDate: day,
  url: `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${day}/v1/currencies/usd.json`, capturedAt: '2026-10-16T04:34:55Z',
})
const providerPair = () => [readCurrencyApiPrice(capture('2026-10-14', 981.90394653)), readCurrencyApiPrice(capture())]
const dataset = () => ({ baseDate: '2026-10-16', fetchedAt: '2026-10-16T04:34:55Z', dailyRates: providerPair().map(p => ({
  currency: 'CLP', date: p.providerDate, value: p.value, source: 'API', rateType: 'LOCAL_PER_USD', imputationMethod: 'NONE',
})) })
function quoteInput(day = '2026-10-15', ask = '982,1', bid = '981,8') {
  const text = `El d&oacute;lar cerr&oacute; en $${bid} comprador y $${ask} vendedor.`
  const rawHtml = Buffer.from(`<article><p>${text}</p></article>`)
  return { rawHtml, original: { id: `emol-${day}`, publisher: 'Emol', url: `https://www.emol.com/noticias/Economia/${day}`,
    timeZone: 'America/Santiago', role: 'market_close', rawSha256: createHash('sha256').update(rawHtml).digest('hex'),
    publishedAtLocal: `${day}T14:05:00`, blocks: [{ text }] }, review: {
    originalVerified: true, sessionDate: day, checkedAt: '2026-10-16T15:36:19Z',
    publishedAt: `${day}T17:05:00Z`, blockIndex: 0, rawAnchor: `$${bid} comprador y $${ask} vendedor`,
  } }
}
const articlePair = () => [readReviewedEmolQuote(quoteInput('2026-10-14', '985', '984,7')), readReviewedEmolQuote(quoteInput())]
const basis = () => buildPriceBasisReview({ dataset: dataset(), currency: 'CLP', providerPrices: providerPair(), articleQuotes: articlePair() })
const discovery = () => ({ currency: 'CLP', baseDate: '2026-10-15', officialReviewTargets: [], candidates: [{
  id: 'article', title: 'Synthetic reviewed article', publisher: 'Emol', url: quoteInput().original.url,
  publishedAt: '2026-10-15T17:05:00Z', reviewTier: 'trusted_reporting_review', candidateFocus: 'currency_move',
}] })

describe('report-only price provenance and local-session boundary', () => {
  it('keeps UTC generation date, capture time and unknown market time separate', () => {
    const result = readCurrencyApiPrice(capture())
    expect(result).toMatchObject({ providerDate: '2026-10-15', providerDateMeaning: 'utc_generation_date',
      observedAt: null, localSessionDate: null, quoteSide: 'unspecified', upstreamMarketVendor: null })
    expect(result.capturedAt).toBe('2026-10-16T04:34:55Z')
    expect(result.rawSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(() => readCurrencyApiPrice({ ...capture(), requestedDate: '2026-10-14' })).toThrow('unexpected_provider_url')
    expect(() => readCurrencyApiPrice({ ...capture(), raw: capture('2026-10-14').raw })).toThrow('invalid_provider_observation')
  })

  it('records exact reconstructed matches without inventing execution logs or accepting a shifted date', () => {
    const row = dataset().dailyRates[1], price = providerPair()[1]
    expect(compareStoredProviderPrice(row, price)).toMatchObject({ matches: true, lineage: 'reconstructed_exact_match', executionProviderRecorded: false })
    expect(compareStoredProviderPrice({ ...row, value: row.value + 0.01 }, price).matches).toBe(false)
    expect(compareStoredProviderPrice({ ...row, date: '2026-10-14' }, price).matches).toBe(false)
    expect(compareStoredProviderPrice({ ...row, source: 'IMPUTED' }, price).matches).toBe(false)
  })

  it('extracts the selected quote side but does not treat article publication as tick observation', () => {
    const input = quoteInput()
    expect(readReviewedEmolQuote(input)).toMatchObject({ value: 982.1, quoteSide: 'ask', observedAt: null,
      localSessionDate: '2026-10-15', sessionDateBasis: 'manual_original_review', official: false })
    expect(readReviewedEmolQuote({ ...input, quoteSide: 'bid' }).value).toBe(981.8)
    expect(() => readReviewedEmolQuote({ ...input, rawHtml: Buffer.from('replaced HTML') })).toThrow('unverified_market_quote')
    input.original.blocks[0].text = input.original.blocks[0].text.replace('982,1', '999,9')
    expect(() => readReviewedEmolQuote(input)).toThrow('ambiguous_or_missing_quote')
  })

  it('refuses morning, unreviewed or wrong-timezone publication records as a reviewed close', () => {
    const input = quoteInput()
    expect(() => readReviewedEmolQuote({ ...input, original: { ...input.original, role: 'intraday_context' } })).toThrow('unverified_market_quote')
    expect(() => readReviewedEmolQuote({ ...input, review: { ...input.review, originalVerified: false } })).toThrow('unverified_market_quote')
    expect(() => readReviewedEmolQuote({ ...input, review: { ...input.review, publishedAt: '2026-10-15T14:05:00Z' } })).toThrow('publication_session_mismatch')
    expect(() => readReviewedEmolQuote({ ...input, review: { ...input.review, sessionDate: '2026-10-14' } })).toThrow('publication_session_mismatch')
  })

  it('allows same-side source-attributed interval references, not official closes, daily calendars or exact causality', () => {
    const reference = compareArticlePair(articlePair())
    expect(reference).toMatchObject({ status: 'source_attributed_reference', direction: 'local_stronger',
      dailyChangeClaimAllowed: false, intradayCausalityVerified: false, publicationApproved: false })
    expect(reference.intervalPct).toBeCloseTo(-0.29441624365)
    const mixed = articlePair(); mixed[1].quoteSide = 'bid'
    expect(compareArticlePair(mixed).status).toBe('hold')
    mixed[1].quoteSide = 'ask'; mixed[1].publisher = 'DF'
    expect(compareArticlePair(mixed).status).toBe('hold')
  })

  it('detects the opposite API/article directions without changing the original dataset', () => {
    const data = dataset(), before = JSON.stringify(data)
    const result = buildPriceBasisReview({ dataset: data, currency: 'CLP', providerPrices: providerPair(), articleQuotes: articlePair() })
    expect(result.sameLabelDirectionConflict).toBe(true)
    expect(result.providerIntervalPct).toBeCloseTo(0.36953245201)
    expect(result.articleLink).toMatchObject({ status: 'hold', directCauseAllowed: false, automaticDateShiftAllowed: false })
    expect(result.articleLink.blockers).toContain('provider_local_session_unknown')
    expect(JSON.stringify(data)).toBe(before)
  })

  it('holds matching directions too: numerical coincidence cannot establish a local session', () => {
    const quotes = articlePair(); quotes[1].value = 989
    const result = buildPriceBasisReview({ dataset: dataset(), currency: 'CLP', providerPrices: providerPair(), articleQuotes: quotes })
    expect(result.sameLabelDirectionConflict).toBe(false)
    expect(result.writingEligibility).toEqual({ eligible: false, reason: 'price_basis_unverified' })
    expect(result.publicationApproved).toBe(false)
  })

  it('recomputes the combined research gate and rejects stale prices despite edited success flags', () => {
    const input = basis()
    input.articleLink.status = 'pass'; input.writingEligibility.eligible = true
    const result = buildPriceLinkedEvidenceReview(discovery(), dataset(), input)
    expect(result.writingEligibility.eligible).toBe(false)
    expect(result.candidates[0].eligibleForTriggerReview).toBe(false)
    expect(result.candidates[0].blockers).toContain('provider_quote_basis_unspecified')
    expect(result.publicationBlocked).toBe(true)
    const changed = dataset(); changed.dailyRates[1].value += 1
    expect(() => buildPriceLinkedEvidenceReview(discovery(), changed, input)).toThrow('stale_price_basis_review')
    const shifted = basis(); shifted.providerInterval[0] = '2026-10-13'
    expect(() => buildPriceLinkedEvidenceReview(discovery(), dataset(), shifted)).toThrow('stale_price_basis_review')
  })
})
