import { describe, expect, it, vi } from 'vitest'
import { buildWebSearchRequest, fetchOpenRouterWebSearch, normalizeWebSearchResponse, searchNeeded, SONAR_MODEL } from './openrouter-web-search.js'

const review = {
  currency: 'CLP', baseDate: '2026-09-11',
  movement: { absoluteDailyPct: 1.49 },
  candidates: [{ eligibleForContextReview: false }],
}

describe('guarded OpenRouter evidence search', () => {
  it('only activates for a notable CLP move without a reviewable candidate', () => {
    expect(searchNeeded(review)).toEqual({ eligible: true, reason: 'notable_move_without_reviewable_evidence' })
    expect(searchNeeded({ ...review, movement: { absoluteDailyPct: .4 } }).eligible).toBe(false)
    expect(searchNeeded({ ...review, candidates: [{ eligibleForContextReview: true }] }).eligible).toBe(false)
    expect(searchNeeded({ ...review, currency: 'BRL' }).eligible).toBe(false)
  })

  it('hard caps one search and six allowlisted results', () => {
    const body = buildWebSearchRequest({ currency: 'CLP', baseDate: '2026-09-11', model: 'openrouter/free' })
    expect(body.max_tool_calls).toBe(1)
    expect(body.tool_choice).toBe('required')
    expect(body.tools[0].parameters).toMatchObject({ engine: 'perplexity', max_results: 6, max_total_results: 6, max_uses: 1 })
    expect(body.tools[0].parameters.allowed_domains).toContain('emol.com')
  })

  it('uses the integrated-search request shape for Sonar', () => {
    const body = buildWebSearchRequest({ currency: 'CLP', baseDate: '2026-09-11', model: SONAR_MODEL })
    expect(body.web_search_options).toEqual({ search_context_size: 'low' })
    expect(body).not.toHaveProperty('tools')
    expect(body.provider).toMatchObject({ data_collection: 'deny', zdr: true, allow_fallbacks: false })
  })

  it('keeps allowed citations as unreviewed candidates and rejects unknown domains', () => {
    const result = normalizeWebSearchResponse({
      model: 'test/model', usage: { server_tool_use: { web_search_requests: 1 }, cost: .006 },
      choices: [{ message: { annotations: [
        { type: 'url_citation', url_citation: { title: 'El dólar sube por la caída del cobre', url: 'https://www.emol.com/noticias/Economia/2026/09/11/example.html?ref=search' } },
        { type: 'url_citation', url_citation: { title: 'Unknown source', url: 'https://unknown.example/story' } },
      ] } }],
    }, 'CLP', '2026-09-11')
    expect(result).toMatchObject({ status: 'collected_for_review', webSearchRequests: 1, model: 'test/model' })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({ publisher: 'www.emol.com', reviewTier: 'local_reporting_review', evidenceReady: false, causalStatus: 'unassessed', discoverySource: 'openrouter_web_search' })
    expect(result.candidates[0].url).not.toContain('?')
  })

  it('fails closed when the model skips or exceeds the search', () => {
    expect(normalizeWebSearchResponse({ usage: { server_tool_use: { web_search_requests: 0 } } }, 'CLP', '2026-09-11')).toMatchObject({ status: 'failed', reason: 'search_not_executed' })
    expect(normalizeWebSearchResponse({ usage: { server_tool_use: { web_search_requests: 2 } } }, 'CLP', '2026-09-11')).toMatchObject({ status: 'failed', reason: 'search_limit_exceeded' })
  })

  it('accepts allowlisted citations from an integrated Sonar response without auto-admission', () => {
    const result = normalizeWebSearchResponse({
      model: SONAR_MODEL,
      citations: ['https://www.reporteminero.cl/noticia/noticias/2026/09/dolar-chile-sube-cobre-corrige-maximos-historicos'],
      choices: [{ message: { content: 'summary' } }],
    }, 'CLP', '2026-09-11', SONAR_MODEL)
    expect(result).toMatchObject({ status: 'collected_for_review', webSearchRequests: 1 })
    expect(result.candidates[0]).toMatchObject({ evidenceReady: false, causalStatus: 'unassessed' })
  })

  it('does not expose HTTP bodies and does not retry a paid search', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('secret reflected body', { status: 429 }))
    const result = await fetchOpenRouterWebSearch({ apiKey: 'secret-key', currency: 'CLP', baseDate: '2026-09-11', model: 'openrouter/free', fetchImpl })
    expect(result).toEqual({ status: 'failed', reason: 'http_429', candidates: [], webSearchRequests: 0 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
