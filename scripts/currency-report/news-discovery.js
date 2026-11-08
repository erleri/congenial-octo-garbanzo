import { createHash } from 'node:crypto'
import { validDate } from './core.js'

const GDELT_ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc'

export const DISCOVERY_CURRENCIES = ['BRL', 'MXN', 'CLP']

export const GDELT_QUERIES = {
  BRL: '(BRL OR "Brazilian real" OR "real brasileiro") (currency OR forex OR cambio OR cambial OR dolar)',
  MXN: '(MXN OR "Mexican peso" OR "peso mexicano") (currency OR forex OR "tipo de cambio" OR dolar OR dollar)',
  CLP: '(CLP OR "Chilean peso" OR "peso chileno") (currency OR forex OR "tipo de cambio" OR dolar OR dollar)',
}

const OFFICIAL_DOMAINS = {
  BRL: ['bcb.gov.br', 'ibge.gov.br'],
  MXN: ['banxico.org.mx', 'inegi.org.mx'],
  CLP: ['bcentral.cl', 'ine.gob.cl'],
}

const TIER_ONE_REPORTING = ['reuters.com']
const TIER_TWO_REPORTING = {
  BRL: ['valor.globo.com', 'infomoney.com.br'],
  MXN: ['elfinanciero.com.mx', 'eleconomista.com.mx', 'expansion.mx'],
  CLP: ['df.cl', 'latercera.com', 'emol.com', 'reporteminero.cl'],
}

const unsafe = value => /ignore\s+(previous|all)|system\s*prompt|프롬프트|지시.*무시|sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}/i.test(value)
const clean = (value, limit) => String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
const domainMatches = (hostname, domains) => domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))

function gdeltTime(value) {
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(value ?? ''))
  if (compact) {
    const iso = `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`
    return Number.isFinite(Date.parse(iso)) ? iso : null
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) return null
  return new Date(value).toISOString().replace('.000Z', 'Z')
}

export function classifyDiscoveryDomain(hostname, currency) {
  if (!DISCOVERY_CURRENCIES.includes(currency)) return 'discovery_only'
  if (domainMatches(hostname, OFFICIAL_DOMAINS[currency])) return 'official_review'
  if (domainMatches(hostname, TIER_ONE_REPORTING)) return 'trusted_reporting_review'
  if (domainMatches(hostname, TIER_TWO_REPORTING[currency])) return 'local_reporting_review'
  return 'discovery_only'
}

export function normalizeGdeltArticle(article, currency, baseDate) {
  if (!DISCOVERY_CURRENCIES.includes(currency) || !validDate(baseDate) || !article || typeof article !== 'object') return null
  const title = clean(article.title, 240)
  if (!title || unsafe(title)) return null
  let url
  try {
    url = new URL(article.url)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    url.search = ''
    url.hash = ''
  } catch { return null }
  const publishedAt = gdeltTime(article.seendate ?? article.date)
  if (!publishedAt || publishedAt.slice(0, 10) > baseDate) return null
  const hostname = url.hostname.toLowerCase()
  const reviewTier = classifyDiscoveryDomain(hostname, currency)
  const canonicalUrl = url.toString()
  return {
    id: `gdelt-${createHash('sha256').update(canonicalUrl).digest('hex').slice(0, 12)}`,
    currency,
    title,
    publisher: hostname,
    url: canonicalUrl,
    publishedAt,
    sourceCountry: clean(article.sourcecountry, 60) || null,
    language: clean(article.language, 40) || null,
    reviewTier,
    reviewStatus: 'unreviewed_candidate',
    evidenceReady: false,
    causalStatus: 'unassessed',
    discoverySource: 'gdelt',
    limitation: 'GDELT 검색 후보입니다. 원문·발행시각·환율 변동과의 관련성을 검토하기 전에는 원인 근거로 사용할 수 없습니다.',
  }
}

export function normalizeGdeltFeed(payload, currency, baseDate, limit = 20) {
  if (!payload || !Array.isArray(payload.articles)) return []
  const seenUrls = new Set()
  const seenTitles = new Set()
  return payload.articles.map(article => normalizeGdeltArticle(article, currency, baseDate)).filter(candidate => {
    if (!candidate) return false
    const titleKey = candidate.title.toLocaleLowerCase('en-US')
    if (seenUrls.has(candidate.url) || seenTitles.has(titleKey)) return false
    seenUrls.add(candidate.url)
    seenTitles.add(titleKey)
    return true
  }).sort((a, b) => {
    const ranks = { official_review: 0, trusted_reporting_review: 1, local_reporting_review: 2, discovery_only: 3 }
    return ranks[a.reviewTier] - ranks[b.reviewTier] || b.publishedAt.localeCompare(a.publishedAt)
  }).slice(0, limit)
}

function compactDate(date) { return date.replaceAll('-', '') }

export function buildGdeltUrl(currency, baseDate) {
  if (!DISCOVERY_CURRENCIES.includes(currency) || !validDate(baseDate)) throw new Error('invalid_currency_or_date')
  const previous = new Date(`${baseDate}T00:00:00Z`)
  previous.setUTCDate(previous.getUTCDate() - 1)
  const params = new URLSearchParams({
    query: GDELT_QUERIES[currency],
    mode: 'artlist',
    format: 'json',
    maxrecords: '75',
    sort: 'datedesc',
    startdatetime: `${compactDate(previous.toISOString().slice(0, 10))}000000`,
    enddatetime: `${compactDate(baseDate)}235959`,
  })
  return `${GDELT_ENDPOINT}?${params}`
}

export async function fetchGdeltDiscovery({ currency, baseDate, fetchImpl = fetch, now = new Date(), pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!DISCOVERY_CURRENCIES.includes(currency) || !validDate(baseDate)) throw new Error('invalid_currency_or_date')
  const ageDays = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.parse(`${baseDate}T00:00:00Z`)) / 86_400_000)
  if (ageDays < 0) return { status: 'not_collected', reason: 'future_date', candidates: [] }
  if (ageDays > 92) return { status: 'not_collected', reason: 'outside_gdelt_window', candidates: [] }
  let response
  let networkCalls = 0
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      networkCalls += 1
      response = await fetchImpl(buildGdeltUrl(currency, baseDate), { signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/json', 'User-Agent': 'LATAM-FX-local-research/2.0' } })
    } catch { return { status: 'failed', reason: 'network_or_timeout', candidates: [], networkCalls } }
    if (response.status !== 429 || attempt === 2) break
    const retryAfter = Number(response.headers.get('retry-after'))
    await pause(Number.isFinite(retryAfter) ? Math.min(Math.max(retryAfter, 1), 5) * 1000 : 2_000)
  }
  if (!response.ok) return { status: 'failed', reason: `http_${response.status}`, candidates: [], networkCalls }
  const body = await response.text()
  if (body.length > 3_000_000) return { status: 'failed', reason: 'oversize', candidates: [], networkCalls }
  let payload
  try { payload = JSON.parse(body) } catch { return { status: 'failed', reason: 'invalid_json', candidates: [], networkCalls } }
  if (!Array.isArray(payload.articles)) return { status: 'failed', reason: 'source_schema_changed', candidates: [], networkCalls }
  return { status: 'collected_for_review', reason: null, candidates: normalizeGdeltFeed(payload, currency, baseDate), networkCalls }
}
