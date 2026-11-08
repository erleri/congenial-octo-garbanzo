import { createHash } from 'node:crypto'
import { validDate } from './core.js'

const USER_AGENT = 'LATAM-FX-local-research/2.0'
const MAX_SITEMAP_BYTES = 4_000_000
const MAX_ARTICLE_BYTES = 750_000
const MAX_ARTICLE_FETCHES = 3
export const LOCAL_SOURCE_COLLECTOR_VERSION = 'v3'

const CLP_TERMS = /(?:d[oó]lar|peso|cobre|tipo[- ]de[- ]cambio|mercado[- ]cambiario|inflaci[oó]n|tasa[- ]de[- ]inter[eé]s)/i

export const LOCAL_SOURCE_REGISTRY = {
  CLP: [
    {
      id: 'emol-economia',
      publisher: 'Emol Economía',
      country: 'Chile',
      language: 'Spanish',
      hostnames: ['emol.com', 'www.emol.com'],
      articlePath: /^\/noticias\/Economia\/\d{4}\/\d{2}\/\d{2}\//i,
      sitemapUrls: baseDate => [`https://www.emol.com/sitemap/xml/sitemap3_${baseDate.slice(0, 4)}.xml`],
      timeZone: 'America/Santiago',
      relevance: CLP_TERMS,
      directRelevance: /(?:d[oó]lar|peso|tipo[- ]de[- ]cambio|mercado[- ]cambiario)/i,
      maxArticleFetches: 4,
    },
    {
      id: 'reporte-minero',
      publisher: 'Reporte Minero',
      country: 'Chile',
      language: 'Spanish',
      hostnames: ['reporteminero.cl', 'www.reporteminero.cl'],
      articlePath: /^\/noticia\/noticias\/\d{4}\/\d{2}\//i,
      sitemapUrls: baseDate => [`https://www.reporteminero.cl/sitemap/${baseDate.slice(0, 4)}/${baseDate.slice(5, 7)}/sitemap-pt-post.xml`],
      timeZone: 'America/Santiago',
      relevance: CLP_TERMS,
      directRelevance: /(?:d[oó]lar|peso|tipo[- ]de[- ]cambio|mercado[- ]cambiario)/i,
      maxArticleFetches: 3,
    },
  ],
}

const clean = (value, limit) => decodeEntities(String(value ?? ''))
  .replace(/<[^>]*>/g, '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, limit)

const unsafe = value => /ignore\s+(previous|all)|system\s*prompt|프롬프트|지시.*무시|sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}/i.test(value)

export function decodeEntities(value) {
  const named = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ' }
  return String(value ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const radix = entity[1]?.toLowerCase() === 'x' ? 16 : 10
      const number = Number.parseInt(entity.slice(radix === 16 ? 2 : 1), radix)
      return Number.isInteger(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match
    }
    return named[entity] ?? named[entity.toLowerCase()] ?? match
  })
}

function dateWindow(baseDate, startDate) {
  if (!validDate(baseDate)) throw new Error('invalid_base_date')
  const start=startDate??new Date(Date.parse(`${baseDate}T00:00:00Z`)-86400000).toISOString().slice(0,10)
  if (!validDate(start) || start>baseDate || Date.parse(baseDate)-Date.parse(start)>31*86400000)
    throw new Error('invalid_publisher_date_window')
  const dates=new Set()
  for(let t=Date.parse(start);t<=Date.parse(baseDate);t+=86400000) dates.add(new Date(t).toISOString().slice(0,10))
  return dates
}

function extractPathDate(url) {
  const match = /\/(\d{4})\/(\d{2})\/(\d{2})\//.exec(url.pathname)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null
}

export function parseSitemap(xml) {
  if (typeof xml !== 'string' || xml.length > MAX_SITEMAP_BYTES) throw new Error('invalid_or_oversize_sitemap')
  if (!/<urlset(?:\s[^>]*)?>[\s\S]*<\/urlset>/i.test(xml)) throw new Error('unrecognized_sitemap_layout')
  const entries = []
  for (const block of xml.matchAll(/<url>\s*([\s\S]*?)<\/url>/gi)) {
    const loc = /<loc>\s*([^<]+?)\s*<\/loc>/i.exec(block[1])?.[1]
    const lastmod = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/i.exec(block[1])?.[1] ?? null
    if (loc) entries.push({ loc: decodeEntities(loc), lastmod: lastmod ? decodeEntities(lastmod) : null })
  }
  return entries
}

function safeArticleUrl(raw, source) {
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null
    if (!source.hostnames.includes(url.hostname.toLowerCase()) || !source.articlePath.test(url.pathname)) return null
    url.protocol = 'https:'
    url.search = ''
    url.hash = ''
    return url
  } catch { return null }
}

export function shortlistSitemapEntries(xml, source, baseDate, startDate) {
  if (!validDate(baseDate)) throw new Error('invalid_base_date')
  const dates = dateWindow(baseDate,startDate)
  const seen = new Set()
  return parseSitemap(xml).map(entry => {
    const url = safeArticleUrl(entry.loc, source)
    if (!url) return null
    const date = extractPathDate(url) ?? (entry.lastmod && Number.isFinite(Date.parse(entry.lastmod)) ? new Date(entry.lastmod).toISOString().slice(0, 10) : null)
    if (!date || !dates.has(date) || !source.relevance.test(decodeURIComponent(url.pathname).replaceAll('-', ' '))) return null
    const canonicalUrl = url.toString()
    if (seen.has(canonicalUrl)) return null
    seen.add(canonicalUrl)
    const pathText = decodeURIComponent(url.pathname).replaceAll('-', ' ')
    return { url: canonicalUrl, sitemapDate: date, sitemapLastmod: entry.lastmod, candidateFocus: source.directRelevance.test(pathText) ? 'currency_move' : 'market_context' }
  }).filter(Boolean).sort((a, b) => {
    const focus = { currency_move: 0, market_context: 1 }
    return focus[a.candidateFocus] - focus[b.candidateFocus]
      || String(b.sitemapLastmod ?? b.sitemapDate).localeCompare(String(a.sitemapLastmod ?? a.sitemapDate))
  })
}

function attributes(tag) {
  const result = {}
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) result[match[1].toLowerCase()] = match[3]
  return result
}

export function publisherLocalToIso(value, timeZone) {
  if (typeof value !== 'string' || !validDate(value.slice(0,10))) return null
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return null
  const guess = new Date(`${value}Z`)
  if (!Number.isFinite(guess.getTime())) return null
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  const parts = Object.fromEntries(formatter.formatToParts(guess).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  const displayedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
  const offset = displayedAsUtc - guess.getTime()
  const actual = new Date(guess.getTime() - offset)
  const check=Object.fromEntries(formatter.formatToParts(actual).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]))
  const resolved=`${check.year}-${check.month}-${check.day}T${check.hour}:${check.minute}:${check.second}`
  return Number.isFinite(actual.getTime()) && resolved===value ? actual.toISOString() : null
}

export function parseArticleMetadata(html, source, expectedUrl, baseDate, startDate) {
  if (typeof html !== 'string' || html.length > MAX_ARTICLE_BYTES) return null
  const meta = {}
  for (const tag of html.match(/<meta\s+[^>]*>/gi) ?? []) {
    const attrs = attributes(tag)
    const key = (attrs.property ?? attrs.name)?.toLowerCase()
    if (key && attrs.content && !meta[key]) meta[key] = attrs.content
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  const title = clean(meta['og:title'] ?? titleTag, 240)
  const description = clean(meta['og:description'] ?? meta.description, 500)
  const publishedRaw = meta['article:published_time'] ?? null
  const publishedAt = publisherLocalToIso(publishedRaw, source.timeZone)
  if (!title || unsafe(title) || unsafe(description) || !source.relevance.test(`${title} ${description}`)) return null
  const localParts=publishedAt?Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:source.timeZone,
    year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(publishedAt)).map(p=>[p.type,p.value])):null
  const publisherDate=localParts?`${localParts.year}-${localParts.month}-${localParts.day}`:null
  if (!publishedAt || !publisherDate || !dateWindow(baseDate,startDate).has(publisherDate)) return null
  const url = safeArticleUrl(meta['og:url'] ?? expectedUrl, source)
  if (!url || url.href!==safeArticleUrl(expectedUrl,source)?.href) return null
  const canonicalUrl = url.toString()
  return {
    id: `local-${createHash('sha256').update(canonicalUrl).digest('hex').slice(0, 12)}`,
    title,
    publisher: source.publisher,
    url: canonicalUrl,
    publishedAt,
    sourceCountry: source.country,
    language: source.language,
    reviewTier: 'local_reporting_review',
    reviewStatus: 'unreviewed_candidate',
    evidenceReady: false,
    causalStatus: 'unassessed',
    discoverySource: 'local_public_sitemap',
    candidateFocus: source.directRelevance.test(`${title} ${description}`) ? 'currency_move' : 'market_context',
    metadataSummary: description || null,
    publicationTimeBasis: /[zZ]|[+-]\d{2}:?\d{2}$/.test(publishedRaw ?? '') ? 'explicit_offset' : 'publisher_local_timezone',
    limitation: '공개 sitemap과 기사 메타데이터에서 발견한 후보입니다. 원문 직접 귀속과 독립 출처를 사람이 확인하기 전에는 원인 근거로 사용할 수 없습니다.',
  }
}

async function boundedText(url, maxBytes, fetchImpl) {
  let response
  try { response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(25_000), headers: { Accept: 'text/html,application/xml;q=0.9,*/*;q=0.1', 'User-Agent': USER_AGENT } }) }
  catch(error) { return { status: 'failed', reason: error?.message==='local_request_limit'?'request_budget'
    :error?.message==='local_source_request_limit'?'source_request_budget':'network_or_timeout' } }
  if (!response.ok) return { status: 'failed', reason: `http_${response.status}` }
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > maxBytes) return { status: 'failed', reason: 'oversize' }
  if (!response.body) return { status: 'failed', reason: 'empty_body' }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let received = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) return { status: 'failed', reason: 'oversize' }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return { status: 'ok', text, capturedAt:new Date().toISOString() }
  } catch { return {status:'failed',reason:'body_read_failed'} }
  finally { await reader.cancel().catch(()=>{}) }
}

export async function fetchLocalSourceDiscovery({ currency, baseDate, startDate, fetchImpl = fetch, onCapture = async()=>{} }) {
  const sources = LOCAL_SOURCE_REGISTRY[currency]
  if (!sources || !validDate(baseDate)) throw new Error('unsupported_local_source_case')
  const sourceResults = []
  const candidates = []
  const dates=dateWindow(baseDate,startDate)
  let networkCalls = 0
  for (const source of sources) {
    const shortlists = []
    const issues=[]
    // Include both month/year indexes when the price interval crosses a boundary.
    const sitemapUrls=[...new Set([...dates].flatMap(day=>source.sitemapUrls(day)))]
    for (const sitemapUrl of sitemapUrls) {
      networkCalls += 1
      const sitemap = await boundedText(sitemapUrl, MAX_SITEMAP_BYTES, fetchImpl)
      if (sitemap.status !== 'ok') { issues.push({stage:'sitemap',url:sitemapUrl,reason:sitemap.reason}); continue }
      await onCapture({kind:'sitemap',url:sitemapUrl,text:sitemap.text,capturedAt:sitemap.capturedAt})
      try { shortlists.push(...shortlistSitemapEntries(sitemap.text, source, baseDate,startDate)) }
      catch { issues.push({stage:'sitemap',url:sitemapUrl,reason:'invalid_sitemap'}) }
    }
    const unique = [...new Map(shortlists.map(item => [item.url, item])).values()].slice(0, source.maxArticleFetches ?? MAX_ARTICLE_FETCHES)
    let accepted = 0
    for (const item of unique) {
      networkCalls += 1
      const article = await boundedText(item.url, MAX_ARTICLE_BYTES, fetchImpl)
      if (article.status !== 'ok') {issues.push({stage:'article',url:item.url,reason:article.reason});continue}
      await onCapture({kind:'article',url:item.url,text:article.text,capturedAt:article.capturedAt})
      const candidate = parseArticleMetadata(article.text, source, item.url, baseDate,startDate)
      if (!candidate) {issues.push({stage:'metadata',url:item.url,reason:'metadata_not_admitted'});continue}
      candidates.push({ currency, ...candidate })
      accepted += 1
    }
    sourceResults.push({ source: source.id, status: accepted ? issues.length?'partial_collected_for_review':'collected_for_review'
      : issues.length?'failed':'no_relevant_articles', reason:issues.length?'source_collection_incomplete':null,
      issues,shortlisted: unique.length, candidates: accepted })
  }
  const deduped = [...new Map(candidates.map(candidate => [candidate.url, candidate])).values()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  const incomplete=sourceResults.some(s=>s.issues.length)
  return { version:LOCAL_SOURCE_COLLECTOR_VERSION,baseDate,startDate:[...dates][0],
    status:deduped.length?incomplete?'partial_collected_for_review':'collected_for_review':incomplete?'failed':'not_collected',
    reason:incomplete?'source_collection_incomplete':deduped.length?null:'no_relevant_articles',candidates:deduped,sourceResults,networkCalls }
}
