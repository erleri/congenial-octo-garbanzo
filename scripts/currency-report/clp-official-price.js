// Isolated report research adapter. Never writes the operational dataset.
import { createHash } from 'node:crypto'
import { buildPacket, validDate } from './core.js'
import { decodeEntities } from './local-source-discovery.js'
import { marketCalendarDate } from './public-research-adapter.js'
import { compareArticlePair } from './price-basis.js'
import { BCCH_METHOD, BCCH_PRICE_LIMITATIONS } from './price-limitations.js'
export { BCCH_METHOD } from './price-limitations.js'

export const CLP_PRICE_VERSION = 'clp-official-price/1'
export const BCCH_DAILY_URL = 'https://si3.bcentral.cl/Indicadoressiete/secure/Indicadoresdiarios.aspx'
const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const digest = raw => createHash('sha256').update(raw).digest('hex')
function decodeHtml(raw) {
  // The current server declares Latin-1 while some actual bodies are UTF-8.
  // Prefer valid UTF-8; a real Latin-1 response fails this strict decoder.
  try { return new TextDecoder('utf-8',{fatal:true}).decode(raw) }
  catch { return new TextDecoder('windows-1252').decode(raw) }
}
const text = html => decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
const timestamp = value => typeof value === 'string' && validDate(value.slice(0, 10))
  && /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))

export function bcchPriceUrl(raw) {
  const url = new URL(raw, BCCH_DAILY_URL)
  if (url.protocol !== 'https:' || url.hostname !== 'si3.bcentral.cl' || url.port || url.username || url.password || url.hash)
    throw new Error('unregistered_bcch_url')
  if (url.href === BCCH_DAILY_URL) return url.href
  if (url.pathname !== '/Indicadoressiete/secure/Serie.aspx' || [...url.searchParams].length !== 2
    || url.searchParams.get('gcode') !== 'PRE_TCO'
    || !/^[A-Za-z0-9+/=]{20,1200}$/.test(url.searchParams.get('param') ?? '')) throw new Error('unregistered_bcch_url')
  return url.href
}

export function discoverBcchPriceSeries(html) {
  const found = []
  for (const a of html.matchAll(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>[\s\S]*?<\/a>/gi)) {
    const href = decodeEntities(a[2])
    try { const url = bcchPriceUrl(href); if (url !== BCCH_DAILY_URL && !found.includes(url)) found.push(url) } catch { /* Ignore other indicators. */ }
  }
  if (found.length !== 1) throw new Error('bcch_price_series_link_changed')
  return found[0]
}

// Fixed local clock hours are converted using IANA DST rules, not a permanent -03.
export function chileClockUtc(day, clock) {
  if (!validDate(day) || !/^(16:00|17:30)$/.test(clock)) throw new Error('invalid_bcch_clock')
  const target = Date.parse(`${day}T${clock}:00Z`)
  let guess = target
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago',
      year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23' })
      .formatToParts(new Date(guess)).map(part => [part.type, part.value]))
    const displayed = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`)
    if (displayed === target) return new Date(guess).toISOString()
    guess += target - displayed
  }
  throw new Error('bcch_clock_resolution_failed')
}

function precedingSession(effectiveDate, positiveDates) {
  const cursor = new Date(`${effectiveDate}T00:00:00Z`)
  // A positive official date establishes a banking day. Blank weekdays do not
  // prove a holiday: they can also indicate a missing publication. Hold them.
  for (let i = 0; i < 4; i++) {
    cursor.setUTCDate(cursor.getUTCDate() - 1)
    const day = cursor.toISOString().slice(0, 10)
    if (positiveDates.has(day)) return { date: day, basis: 'preceding_official_day_with_only_weekend_between' }
    if (![0, 6].includes(cursor.getUTCDay())) return { date: null, basis: 'blank_weekday_calendar_unverified' }
  }
  return { date: null, basis: 'previous_year_or_calendar_unverified' }
}

export function parseBcchPriceTable({ raw, url, year }) {
  bcchPriceUrl(url)
  if (url === BCCH_DAILY_URL || !Number.isInteger(year) || year < 2000 || year > 2100
    || !Buffer.isBuffer(raw) || raw.length > 2_000_000) throw new Error('invalid_bcch_series_input')
  const html = decodeHtml(raw)
  const label = id => text(html.match(new RegExp(`<label\\b[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/label>`, 'i'))?.[1] ?? '')
  if (label('lblNombreSerie') !== 'Dólar observado' || label('lblUnidadMedida') !== '(Pesos por dólar)'
    || label('lblAnioValor') !== String(year)) throw new Error('bcch_series_identity_changed')
  const tables = [...html.matchAll(/<table\b[^>]*id=["']gr["'][^>]*>([\s\S]*?)<\/table>/gi)]
  if (tables.length !== 1) throw new Error('bcch_grid_changed')
  const rows = [...tables[0][1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
  const headers = [...(rows[0]?.[1] ?? '').matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(cell => text(cell[1]))
  if (JSON.stringify(headers) !== JSON.stringify(['Día', ...months]) || rows.length !== 32) throw new Error('bcch_grid_changed')
  const values = [], blanks = []
  for (let day = 1; day <= 31; day++) {
    const cells = [...rows[day][1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
    if (cells.length !== 13 || text(cells[0][1]) !== String(day)) throw new Error('bcch_day_row_changed')
    for (let month = 1; month <= 12; month++) {
      const dayLabel = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
      const number = text(cells[month][1])
      if (!validDate(dayLabel)) { if (number) throw new Error('bcch_invalid_calendar_value'); continue }
      if (!number) { blanks.push(dayLabel); continue }
      if (!/^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(number) && !/^\d+,\d{2}$/.test(number)) throw new Error('bcch_invalid_price')
      const value = Number(number.replaceAll('.','').replace(',','.'))
      if (!(value > 0) || [0,6].includes(new Date(dayLabel).getUTCDay())) throw new Error('bcch_non_banking_value')
      values.push({ effectiveDate: dayLabel, value })
    }
  }
  if (!values.length) throw new Error('bcch_empty_series')
  values.sort((a,b) => a.effectiveDate.localeCompare(b.effectiveDate))
  return {values,blanks,rawSha256:digest(raw)}
}

export function mapBcchSessionDates(values) {
  const positiveDates = new Set(values.map(v => v.effectiveDate))
  return values.map(v => ({...v,localSessionDate:precedingSession(v.effectiveDate,positiveDates).date,
    sessionDateBasis:precedingSession(v.effectiveDate,positiveDates).basis}))
}

export function parseBcchPriceSeries({ raw, url, year, capturedAt, methodologyRaw }) {
  if (!timestamp(capturedAt)) throw new Error('invalid_bcch_capture_time')
  if (!Buffer.isBuffer(methodologyRaw) || digest(methodologyRaw) !== BCCH_METHOD.sha256) throw new Error('bcch_methodology_changed')
  const {values,blanks}=parseBcchPriceTable({raw,url,year})
  const mapped=mapBcchSessionDates(values)
  const observations = mapped.map(v => {
    const cutoff = v.localSessionDate ? chileClockUtc(v.localSessionDate,'16:00') : null
    const scheduled = v.localSessionDate ? chileClockUtc(v.localSessionDate,'17:30') : null
    if (!v.localSessionDate && v.effectiveDate > marketCalendarDate(capturedAt,'CLP')) throw new Error('bcch_future_effective_day_unverified')
    if (scheduled && Date.parse(scheduled) > Date.parse(capturedAt)) throw new Error('bcch_price_ahead_of_schedule')
    return { ...v, currency:'CLP', unit:'LOCAL_PER_USD', provider:BCCH_METHOD.provider, seriesId:BCCH_METHOD.seriesId,
      priceKind:'official_transaction_weighted_average', quoteSide:'not_applicable', timeZone:'America/Santiago',
      observationWindow:{ startAt:null, endAt:cutoff },
      observedAt:null, publishedAt:null, scheduledWebAvailabilityAt:scheduled, firstSeenAt:capturedAt,
      url, rawSha256:digest(raw), methodologyVersion:BCCH_METHOD.version, methodologySha256:BCCH_METHOD.sha256 }
  })
  return { version:CLP_PRICE_VERSION, currency:'CLP', year, url, capturedAt, rawSha256:digest(raw),
    priceRowsSha256:digest(JSON.stringify(values)),
    methodology:BCCH_METHOD, observations, blankDates:blanks,
    calendarUnverified:observations.filter(o => !o.localSessionDate).map(o => o.effectiveDate),
    status:'collected_local_review_only', publicReuseApproved:false, publicationApproved:false }
}

export async function collectBcchPriceSeries({ year, methodologyRaw, fetchImpl = fetch, now = () => new Date().toISOString() }) {
  const requests = [], captures = []
  async function read(url) {
    bcchPriceUrl(url); requests.push(url)
    // Same streamed-byte limit as the public-original collectors. Unlike a text
    // round trip, this preserves original encoding and the exact source hash.
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(),15000)
    let reader
    try {
      const response = await fetchImpl(url,{redirect:'error',signal:controller.signal,
        headers:{Accept:'text/html','User-Agent':'LATAM-FX-local-research/2.0'}})
      if (!response.ok) throw new Error(`bcch_http_${response.status}`)
      if (response.redirected || (response.url && bcchPriceUrl(response.url) !== url)) throw new Error('bcch_redirect')
      if (!(response.headers.get('content-type') ?? '').includes('text/html')) throw new Error('bcch_not_html')
      if (Number(response.headers.get('content-length')) > 2_000_000) throw new Error('bcch_read_oversize')
      reader = response.body?.getReader()
      if (!reader) throw new Error('bcch_empty_body')
      const chunks = []; let size = 0
      while (true) {
        const part = await reader.read(); if (part.done) break
        size += part.value.byteLength
        if (size > 2_000_000) throw new Error('bcch_read_oversize')
        chunks.push(Buffer.from(part.value))
      }
      const raw = Buffer.concat(chunks)
      captures.push({url,raw,capturedAt:now()})
      return captures.at(-1)
    } finally {clearTimeout(timer);controller.abort();if (reader) await reader.cancel().catch(() => {})}
  }
  try {
    if (!Number.isInteger(year) || digest(methodologyRaw) !== BCCH_METHOD.sha256) throw new Error('bcch_methodology_changed')
    const index = await read(BCCH_DAILY_URL)
    const url = discoverBcchPriceSeries(decodeHtml(index.raw))
    const series = await read(url)
    return {status:'collected_local_review_only',series:parseBcchPriceSeries({...series,year,methodologyRaw}),captures,requests,
      modelCalls:0,apiCostUsd:0,publicationApproved:false}
  } catch(error) {
    return {status:'failed',reason:error.message,captures,requests,modelCalls:0,apiCostUsd:0,publicationApproved:false}
  }
}

export function prepareOfficialClpResearch(series, { throughSessionDate, asOf, articleQuotes = [] }) {
  if (series?.version !== CLP_PRICE_VERSION || !validDate(throughSessionDate) || !timestamp(asOf)
    || !timestamp(series.capturedAt) || Date.parse(asOf) < Date.parse(series.capturedAt)
    || throughSessionDate > marketCalendarDate(asOf,'CLP')) throw new Error('invalid_official_price_asof')
  const observations = series.observations.filter(o => o.localSessionDate && o.localSessionDate <= throughSessionDate)
  if (observations.at(-1)?.localSessionDate !== throughSessionDate) throw new Error('requested_session_price_missing')
  const reportDate = asOf.slice(0,10)
  const dataset = {baseDate:reportDate,fetchedAt:series.capturedAt,dailyRates:observations.map(o => ({
    currency:'CLP',rateType:'LOCAL_PER_USD',date:o.localSessionDate,value:o.value,source:'API',imputationMethod:'NONE',
  }))}
  const packet = buildPacket(dataset,'CLP',reportDate)
  const pair = observations.slice(-2), intervalPct = (pair[1].value/pair[0].value-1)*100
  const reference = articleQuotes.length ? compareArticlePair(articleQuotes) : null
  const aligned = reference?.status === 'source_attributed_reference'
    && reference.previousSessionDate === pair[0].localSessionDate && reference.currentSessionDate === pair[1].localSessionDate
    && articleQuotes.every(q => q.currency === 'CLP')
  const metadata = {provider:BCCH_METHOD.provider,seriesId:BCCH_METHOD.seriesId,priceKind:'official_transaction_weighted_average',
    dateBasis:'underlying_local_transaction_day',timeZone:'America/Santiago',methodology:BCCH_METHOD,
    observations:pair,intervalPct,rawSha256:series.rawSha256,vintage:'retrieved_snapshot_not_historical_availability',
    sourceAdapter:series.sourceAdapter??'bcch-html/1',sourceUrl:series.url??null,
    ...(series.sourceAdapter==='bcch-bde-api/1'?{attribution:{source:'Banco Central de Chile / BDE',seriesId:BCCH_METHOD.seriesId,
      termsUrl:'https://si3.bcentral.cl/estadisticas/Principal1/Web_Services/terminos_condiciones.html',
      adaptationResponsibility:'LATAM FX: date mapping, calculations and Korean interpretation'}}:{}),publicReuseApproved:false}
  packet.marketData = {...packet.marketData,reportPriceBasis:metadata}
  packet.limitations = [...BCCH_PRICE_LIMITATIONS]
  packet.assessment = {...packet.assessment,publishDecision:{eligible:false,reason:'official_price_local_review_only'}}
  return {version:CLP_PRICE_VERSION,packet,priceDataStatus:'verified_method_and_session_for_selected_pair',
    articleLink:{status:aligned?'same_sessions_different_price_basis':'hold',sessionAligned:aligned,
      pricesInterchangeable:false,directCauseAllowed:false,intradayCausalityVerified:false,
      articleReference:reference,officialIntervalPct:intervalPct,
      directionAgrees:aligned?Math.sign(intervalPct)===Math.sign(reference.intervalPct):null},
    writingEligibility:{eligible:false,reason:'source_scope_and_reuse_review_required'},publicationApproved:false}
}
