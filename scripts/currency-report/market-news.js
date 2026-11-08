import { createHash } from 'node:crypto'

export const TRUSTED_MARKET_DOMAINS = ['reuters.com']
const ALPHA_VANTAGE_ENDPOINT = 'https://www.alphavantage.co/query'
const TERMS = {
  BRL: ['brl', 'brazil', 'brazilian'],
  MXN: ['mxn', 'mexico', 'mexican'],
}
const unsafe = value => /ignore\s+(previous|all)|system\s*prompt|프롬프트|지시.*무시|sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}/i.test(value)
const clean = (value, limit) => String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit)
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const alphaTime = value => {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(String(value ?? ''))
  if (!match) return null
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`
  return Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString().replace('.000Z', 'Z') === iso ? iso : null
}
const tickerSet = article => new Set((article.ticker_sentiment ?? []).map(item => String(item.ticker ?? '').toUpperCase()))

export function normalizeMarketNews(article, currency, baseDate) {
  if (!['BRL', 'MXN'].includes(currency) || !article || typeof article !== 'object') return null
  const title = clean(article.title, 200)
  const summary = clean(article.summary, 1200)
  if (!title || !summary || unsafe(`${title} ${summary}`)) return null
  let url
  try {
    url = new URL(article.url)
    if (url.protocol !== 'https:' || url.username || url.password || !TRUSTED_MARKET_DOMAINS.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return null
    url.search = ''
    url.hash = ''
  } catch { return null }
  const publishedAt = alphaTime(article.time_published)
  if (!publishedAt || publishedAt.slice(0, 10) > baseDate) return null
  const haystack = `${title} ${summary}`.toLowerCase()
  const tickers = tickerSet(article)
  const local = tickers.has(`FOREX:${currency}`) || TERMS[currency].some(term => new RegExp(`\\b${term}\\b`, 'i').test(haystack))
  const global = tickers.has('FOREX:USD') && !local
  if (!local && !global) return null
  const canonicalUrl = url.toString()
  return {
    id: `news-${createHash('sha256').update(canonicalUrl).digest('hex').slice(0, 12)}`,
    country: local ? currency : 'GLOBAL',
    title,
    publisher: clean(article.source, 80) || url.hostname,
    url: canonicalUrl,
    publishedAt,
    eventDate: publishedAt.slice(0, 10),
    eventAt: publishedAt,
    period: '당일 공개 시장 보도',
    collectedAt: new Date().toISOString(),
    summary,
    scope: local ? 'country' : 'global',
    role: 'context',
    causalStatus: 'contextual',
    provenance: 'market_reporting',
  }
}

export function normalizeMarketNewsFeed(feed, currency, baseDate, limit = 6) {
  if (!Array.isArray(feed)) return []
  const seen = new Set()
  return feed.map(article => normalizeMarketNews(article, currency, baseDate)).filter(item => {
    if (!item || seen.has(item.url)) return false
    seen.add(item.url)
    return true
  }).slice(0, limit)
}

export async function fetchMarketNewsFeed({ apiKey, baseDate, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('missing_news_key')
  if (!validDate(baseDate)) throw new Error('invalid_date')
  const compactDate = baseDate.replaceAll('-', '')
  const params = new URLSearchParams({
    function: 'NEWS_SENTIMENT',
    tickers: 'FOREX:USD',
    time_from: `${compactDate}T0000`,
    time_to: `${compactDate}T2359`,
    sort: 'LATEST',
    limit: '50',
    apikey: apiKey,
  })
  let response
  try {
    response = await fetchImpl(`${ALPHA_VANTAGE_ENDPOINT}?${params}`, { signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/json' } })
  } catch { return { status: 'failed', reason: 'network_or_timeout', feed: [] } }
  if (!response.ok) return { status: 'failed', reason: `http_${response.status}`, feed: [] }
  const body = await response.text()
  if (body.length > 2_000_000) return { status: 'failed', reason: 'oversize', feed: [] }
  let payload
  try { payload = JSON.parse(body) } catch { return { status: 'failed', reason: 'invalid_json', feed: [] } }
  if (payload.Note || payload.Information) return { status: 'failed', reason: 'provider_limit_or_notice', feed: [] }
  if (!Array.isArray(payload.feed)) return { status: 'failed', reason: 'source_schema_changed', feed: [] }
  return { status: 'collected', reason: null, feed: payload.feed }
}
