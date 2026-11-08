// Node-only public reads. Search dates are discovery dates, never publication proof.
import { validDate } from './core.js'
import { GDELT_QUERIES, normalizeGdeltFeed } from './news-discovery.js'
import { extractReviewedClpArticle, extractRegisteredChileanArticle, registeredChileanPublisher,extractBrazilAgencyArticle,extractColombiaRepublicaArticle,extractExpandedPublisherArticle } from './article-context-adapters.js'
import {publisherAccessBarrier,articleOriginHints,NEWS_PUBLISHERS,inspectRobots} from './news-publisher-access.js'
import { extractArticleBlocks, sourceTextHash } from './source-context.js'
import { decodeEntities, publisherLocalToIso } from './local-source-discovery.js'
import { originalPriceTimeRelation } from './research-time-scope.js'
import {MARKET_ZONES,marketCalendarDate} from './market-calendar.js'
import {withinArticleBodyLimits} from './article-body-limits.js'
import {unsafeSourceText} from './source-text-safety.js'
export {marketCalendarDate} from './market-calendar.js'

export const PUBLIC_RESEARCH_VERSION = 'public-research/1'
export const RESEARCH_HOSTS = Object.freeze({
  BRL: ['bcb.gov.br', 'ibge.gov.br', 'valor.globo.com', 'infomoney.com.br', 'economia.uol.com.br', 'agenciabrasil.ebc.com.br', 'reuters.com','cnnbrasil.com.br','www.camara.leg.br'],
  MXN: ['banxico.org.mx', 'inegi.org.mx', 'elfinanciero.com.mx', 'eleconomista.com.mx', 'expansion.mx', 'reuters.com','forbes.com.mx'],
  CLP: ['df.cl', 'latercera.com', 'emol.com', 'reporteminero.cl', 'bcentral.cl', 'cochilco.cl', 'dipres.gob.cl', 'hacienda.cl', 'ine.gob.cl', 'reuters.com','biobiochile.cl','cooperativa.cl'],
  COP: ['banrep.gov.co', 'dane.gov.co', 'superfinanciera.gov.co', 'larepublica.co', 'portafolio.co','valoraanalitik.com'],
  PEN: ['bcrp.gob.pe', 'inei.gob.pe', 'gestion.pe', 'rpp.pe','elcomercio.pe','andina.pe','infobae.com','www.revistaeconomia.com'],
  ARS: ['bcra.gob.ar', 'indec.gob.ar', 'infobae.com', 'cronista.com','iprofesional.com'],
})
const THEMES = {
  market: '(dolar OR dollar OR cotización OR cotacao OR cambio)',
  local: '(anuncio OR comunicado OR política OR politica OR gobierno OR governo)',
  global: '(dollar OR dólar OR "Federal Reserve" OR tasas OR juros)',
  counter: '(riesgo OR risco OR condiciones OR petróleo OR copper OR cobre)',
  consumer: '(consumo OR inflação OR inflación OR crédito OR varejo OR minorista)',
  watch: '(calendario OR ejecución OR posiciones OR perspectivas)',
}
const unsafe = unsafeSourceText
const domainMatches = (host, domains) => domains.some(d => host === d || host.endsWith(`.${d}`))
function utcDayStart(localDate, currency) {
  const guess = new Date(`${localDate}T00:00:00Z`)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: MARKET_ZONES[currency], year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(guess).map(p => [p.type, p.value]))
  const displayed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
  return new Date(guess.getTime() - (displayed - guess.getTime()))
}

export function allowedResearchUrl(raw, currency) {
  const domains = RESEARCH_HOSTS[currency]
  if (!domains) throw new Error('unsupported_research_currency')
  let url
  try { url = new URL(raw) } catch { throw new Error('invalid_research_url') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !domainMatches(url.hostname.toLowerCase(), domains))
    throw new Error('research_url_not_allowed')
  url.hash = ''
  for (const name of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(name)) url.searchParams.delete(name)
  return url.href
}

export function questionSearchUrl({ currency, baseDate, questionId, round = 1, startDate }) {
  if (!GDELT_QUERIES[currency] || !validDate(baseDate) || !THEMES[questionId] || ![1, 2, 3].includes(round))
    throw new Error('invalid_question_search')
  if (startDate!==undefined && (!validDate(startDate) || startDate>baseDate || Date.parse(baseDate)-Date.parse(startDate)>31*86400000))
    throw new Error('invalid_question_search_start')
  const start = new Date(`${startDate??baseDate}T00:00:00Z`)
  if (startDate===undefined) start.setUTCDate(start.getUTCDate() - (questionId === 'consumer' ? 30 : 1))
  // Consumer data need not mention an FX code; a daily FX-only search misses it.
  const identity = questionId === 'consumer' ? { BRL: '(Brazil OR Brasil)', MXN: '(Mexico OR México)', CLP: '(Chile)' }[currency] : GDELT_QUERIES[currency]
  const domains = round === 1 ? RESEARCH_HOSTS[currency] : RESEARCH_HOSTS[currency].filter(d => /gov|gob|bcentral|hacienda|banxico|inegi|cochilco|ibge/.test(d))
  const query = `${identity} ${THEMES[questionId]} (${domains.map(d => `domain:${d}`).join(' OR ')})`
  const tomorrow = new Date(`${baseDate}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const end = new Date(utcDayStart(tomorrow.toISOString().slice(0, 10), currency).getTime() - 1000)
  const compact = d => d.toISOString().slice(0, 19).replace(/[-:T]/g, '')
  return `https://api.gdeltproject.org/api/v2/doc/doc?${new URLSearchParams({ query, mode: 'artlist', format: 'json',
    maxrecords: '30', sort: 'datedesc', startdatetime: compact(utcDayStart(start.toISOString().slice(0, 10), currency)), enddatetime: compact(end) })}`
}

// Bound bytes while reading, including absent/incorrect Content-Length headers.
export async function readPublicText(url, { fetchImpl = fetch, maxBytes = 2_000_000, timeoutMs = 15000 } = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs)
  let reader
  try {
    const response = await fetchImpl(url, { redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json,text/html;q=0.9', 'User-Agent': 'LATAM-FX-local-research/2.0' } })
    if (!response.ok) return { status: 'failed', reason: `http_${response.status}` }
    const size = Number(response.headers.get('content-length'))
    if (Number.isFinite(size) && size > maxBytes) return { status: 'failed', reason: 'oversize' }
    if (!response.body) return { status: 'failed', reason: 'empty_body' }
    reader = response.body.getReader()
    const decoder = new TextDecoder(), chunks = []
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) return { status: 'failed', reason: 'oversize' }
      chunks.push(decoder.decode(value, { stream: true }))
    }
    chunks.push(decoder.decode())
    return { status: 'ok', text: chunks.join(''), bytes: received, fetchedAt: new Date().toISOString() }
  } catch { return { status: 'failed', reason: controller.signal.aborted ? 'timeout' : 'transport_or_redirect_error' } }
  finally { clearTimeout(timer); controller.abort(); if (reader) await reader.cancel().catch(() => {}) }
}

export async function searchQuestion({ currency, baseDate, questionId, round = 1, asOf, startDate, fetchImpl = fetch }) {
  if (!validDate(asOf) || baseDate > asOf) throw new Error('invalid_research_asof')
  const age = (Date.parse(asOf) - Date.parse(baseDate)) / 86400000
  if ((age > 62 && questionId === 'consumer') || age > 92)
    return { status: 'not_collected', reason: 'outside_gdelt_window', candidates: [], networkCalls: 0 }
  const url = questionSearchUrl({ currency, baseDate, questionId, round, startDate })
  const read = await readPublicText(url, { fetchImpl, maxBytes: 3_000_000 })
  if (read.status !== 'ok') return { ...read, candidates: [], networkCalls: 1 }
  let payload
  try { payload = JSON.parse(read.text) } catch { return { status: 'failed', reason: 'invalid_search_json', candidates: [], networkCalls: 1 } }
  if (!Array.isArray(payload.articles)) return { status: 'failed', reason: 'search_schema_changed', candidates: [], networkCalls: 1 }
  const endCompact = new URL(url).searchParams.get('enddatetime')
  const endUtcDate = `${endCompact.slice(0, 4)}-${endCompact.slice(4, 6)}-${endCompact.slice(6, 8)}`
  const candidates = normalizeGdeltFeed(payload, currency, endUtcDate, 24).flatMap(candidate => {
    if (marketCalendarDate(candidate.publishedAt, currency) > baseDate) return []
    if (startDate && marketCalendarDate(candidate.publishedAt,currency)<startDate) return []
    try { return [{ ...candidate, url: allowedResearchUrl(candidate.url, currency), questionId,
      firstSeenAt: candidate.publishedAt, publishedAt: null, publicationTimeBasis: 'not_observed',
      limitation: '검색의 최초 발견시각은 기사 발표시각이 아닙니다. 공개 원문 수집과 검토가 필요합니다.' }] } catch { return [] }
  })
  return { status: candidates.length ? 'candidates_found' : 'no_candidates', candidates, networkCalls: 1,
    queryUrl: url, fetchedAt: read.fetchedAt }
}

function structuredArticles(html) {
  const items = []
  const visit = value => {
    if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') {
      if ([value['@type']].flat().some(t => ['Article', 'NewsArticle', 'Report', 'BlogPosting'].includes(t))) items.push(value)
      if (value['@graph']) visit(value['@graph'])
    }
  }
  for (const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(script[1])) } catch { /* Malformed structured metadata is not publication proof. */ }
  }
  return items
}

export function extractPublicArticle(url, html) {
  if(publisherAccessBarrier(html))throw Error('publisher_paywall')
  const registeredLatam=extractExpandedPublisherArticle(url,html)??extractBrazilAgencyArticle(url,html)??extractColombiaRepublicaArticle(url,html)
  if(registeredLatam){if(registeredLatam.blocks.some(b=>unsafe(b.text)))throw Error('unsafe_article_body');return registeredLatam}
  if (registeredChileanPublisher(url)) {
    const registered=extractRegisteredChileanArticle(url,html)
    if (registered.blocks.some(b=>unsafe(b.text))) throw new Error('unsafe_article_body')
    return {...registered,adapter:registered.adapterVersion,coverage:'registered_publisher_body'}
  }
  const articles = structuredArticles(html)
  const withBody = articles.filter(a => typeof a.articleBody === 'string' && a.articleBody.trim())
  if (withBody.length === 1) {
    const blocks = withBody[0].articleBody.split(/\n\s*\n|\n/u).map(text => ({ kind: 'paragraph', text: decodeEntities(text).trim() })).filter(b => b.text)
    // JSON-LD often encodes the entire article as one paragraph. Keep it intact;
    // arbitrary paragraph length must not reject otherwise processable bodies.
    if (!withinArticleBodyLimits(blocks) || blocks.some(b => unsafe(b.text))) throw new Error('invalid_structured_article_body')
    return { blocks, adapter: 'jsonld_article_body', coverage: 'publisher_structured_body', bodyHash: sourceTextHash(JSON.stringify(blocks)) }
  }
  try {
    const legacy = extractReviewedClpArticle(url, html)
    return { ...legacy, adapter: legacy.adapterVersion, coverage: 'public_article_excerpt' }
  } catch { /* New pages require identifiable article boundaries below. */ }
  const boundaries = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)]
  if (boundaries.length !== 1) throw new Error('article_body_not_identified')
  const blocks = extractArticleBlocks(boundaries[0][1])
  if (blocks.some(b => unsafe(b.text))) throw new Error('unsafe_article_body')
  return { blocks, adapter: 'single_article_element', coverage: 'public_article_excerpt', bodyHash: sourceTextHash(JSON.stringify(blocks)) }
}

export function publicationMetadata(html,url) {
  const registered=registeredChileanPublisher(url)
  const items = structuredArticles(html)
  const dates = [...new Set(items.map(a => a.datePublished).filter(v => typeof v === 'string'))]
  const modified = [...new Set(items.map(a => a.dateModified).filter(v => typeof v === 'string'))]
  // Radio pages expose a calendar date, not a timestamp. Read only their
  // publication label; a date in the episode body/sidebar is not metadata.
  if(new URL(url).hostname==='www.camara.leg.br'&&/^\/radio\/programas\/\d+-[^/]+\/$/.test(new URL(url).pathname)){
    const labels=[...html.matchAll(/<p\b[^>]*class=["'][^"']*\bg-artigo__data-hora\b[^"']*["'][^>]*>\s*(\d{2})\/(\d{2})\/(\d{4})\s*-?\s*<\/p>/gi)]
    if(labels.length===1){const m=labels[0],date=`${m[3]}-${m[2]}-${m[1]}`;if(validDate(date))dates.push(date)}
  }
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(m => [m[1].toLowerCase(), m[3]]))
    const field=(attrs.property??attrs.name??attrs.itemprop??'').toLowerCase()
    if (['article:published_time','datepublished'].includes(field) && attrs.content) dates.push(attrs.content)
    if (['article:modified_time','datemodified'].includes(field) && attrs.content) modified.push(attrs.content)
  }
  const normalize = value => validDate(value) ? value : /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString()
    : registered?publisherLocalToIso(value,registered.timeZone):null
  const edits = [...new Set(modified.map(normalize).filter(Boolean))]
  const common = { modifiedAt: edits.length === 1 ? edits[0] : null,
    modifiedTimeStatus: !modified.length ? 'not_reported' : edits.length === 1 ? 'publisher_metadata' : 'unresolved_or_conflicting',
    bodyAvailability: 'current_page_not_archived' }
  let unique = [...new Set(dates)]
  // An unzoned duplicate is not a second observed instant. Prefer an explicit
  // timestamp only when the unresolved field repeats its exact wall-clock
  // digits. Do not assign a timezone to the unresolved value or discard a real
  // contradiction. Registered publisher-zone values still use normalize().
  const zoned=unique.filter(v=>/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(v)&&normalize(v))
  const unresolved=unique.filter(v=>!normalize(v))
  const withoutZone=v=>v.replace(/(?:Z|[+-]\d{2}:?\d{2})$/,'')
  const sameClock=(a,b)=>{
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(a))return false
    const x=a.split('.'),y=withoutZone(b).split('.')
    return x[0]===y[0]&&(x[1]??'').padEnd(3,'0')===(y[1]??'').padEnd(3,'0')
  }
  if(!registered&&zoned.length&&unresolved.length&&unresolved.every(v=>zoned.some(z=>sameClock(v,z)))){
    common.publicationResolution={basis:'explicit_timezone_metadata',timezoneInferred:false,
      observedValues:[...unique],ignoredUnzonedDuplicates:[...unresolved],rule:'same_wall_clock_unresolved_duplicate_not_an_inferred_instant'}
    unique=unique.filter(v=>!unresolved.includes(v))
  }
  if(unique.length>1) {
    const parsed=unique.map(normalize),canonical=[...new Set(parsed)]
    const explicit=unique.every(v=>/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(v))
    if(parsed.every(Boolean)&&canonical.length===1) return {...common,publishedAt:canonical[0],
      status:validDate(canonical[0])?'date_only':explicit?'explicit_timezone':'registered_publisher_timezone',
      ...(!explicit&&registered?{timeZone:registered.timeZone,timeZoneBasis:'registered_publisher_not_explicit_in_page_timestamp'}:{})}
    // A seconds-only field and its millisecond counterpart do not conflict.
    // Keep the coarser precision; two differing precise fields still conflict.
    if(explicit&&parsed.every(Boolean)&&unique.some(v=>/T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})$/.test(v))
      &&new Set(parsed.map(v=>Math.floor(Date.parse(v)/1000))).size===1)
      return {...common,publishedAt:new Date(Math.floor(Date.parse(parsed[0])/1000)*1000).toISOString(),
        status:'explicit_timezone_consistent_at_second_precision',publicationPrecision:'second'}
    return {...common,publishedAt:null,status:'conflicting_metadata'}
  }
  if(!unique.length)return {...common,publishedAt:null,status:'missing_metadata'}
  const value = unique[0]
  if (validDate(value)) return { ...common, publishedAt: value, status: 'date_only' }
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value) && Number.isFinite(Date.parse(value)))
    return { ...common, publishedAt: new Date(value).toISOString(), status: 'explicit_timezone' }
  const local=registered?publisherLocalToIso(value,registered.timeZone):null
  if(local) return {...common,publishedAt:local,status:'registered_publisher_timezone',timeZone:registered.timeZone,
    timeZoneBasis:'registered_publisher_not_explicit_in_page_timestamp'}
  return { ...common, publishedAt: null, status: 'unresolved_timezone' }
}

export async function collectOriginal({ candidate, currency, baseDate, timeScope, fetchImpl = fetch, robotsText }) {
  const url = allowedResearchUrl(candidate.url, currency)
  const expanded=Object.values(NEWS_PUBLISHERS).find(p=>p.currency===currency&&p.host===new URL(url).hostname)
  let accessRequests=0
  if(expanded){
    if(!expanded.path.test(new URL(url).pathname))return {status:'not_collected',reason:'publisher_article_path_not_allowed',url,networkCalls:0}
    if(robotsText===undefined){
      const robots=await readPublicText(new URL(url).origin+'/robots.txt',{fetchImpl,maxBytes:200_000})
      accessRequests=1
      if(robots.status!=='ok')return {status:'not_collected',reason:'robots_unavailable',url,networkCalls:accessRequests}
      robotsText=robots.text
    }
    let policy
    try{policy=inspectRobots(robotsText,url)}catch{return {status:'not_collected',reason:'robots_invalid',url,networkCalls:accessRequests}}
    if(!policy.allowed||policy.crawlDelaySeconds>0)return {status:'not_collected',reason:!policy.allowed?'robots_disallowed':'publisher_delay_requires_scheduler',url,networkCalls:accessRequests}
  }
  const read = await readPublicText(url, { fetchImpl })
  const common = { version: PUBLIC_RESEARCH_VERSION, url, questionIds: candidate.questionIds ?? [candidate.questionId].filter(Boolean),
    networkCalls: 1+accessRequests, originalVerified: false, publicationApproved: false }
  if (read.status !== 'ok') return { ...common, status: 'not_collected', reason: read.reason }
  const metadata = publicationMetadata(read.text,url)
  let article
  try { article = extractPublicArticle(url, read.text) } catch (e) { return { ...common, status: 'not_collected',
    reason: ['article_body_not_identified', 'invalid_structured_article_body', 'unsafe_article_body','registered_article_wrapper_changed','publisher_paywall'].includes(e.message) ? e.message : 'article_extraction_failed', metadata } }
  return { ...common, status: 'collected_pending_review', fetchedAt: read.fetchedAt, metadata,
    ...(timeScope?.priceSessionDate?{priceTimeRelation:originalPriceTimeRelation(metadata,timeScope,currency)}:{}),
    temporalStatus: metadata.publishedAt === null ? 'publication_unverified' : marketCalendarDate(metadata.publishedAt, currency) > baseDate ? 'after_case_date' : 'within_case_date',
    contentTemporalStatus: metadata.modifiedAt && marketCalendarDate(metadata.modifiedAt, currency) > baseDate ? 'modified_after_case_date' : 'historical_body_availability_unverified',
    marketTimeZone: MARKET_ZONES[currency],
    ...article,originHints:articleOriginHints(url,article.blocks), sourceVersion: 'current_page_not_archived' }
}
