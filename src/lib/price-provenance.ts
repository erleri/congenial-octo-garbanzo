import type { DailyRate, FxPriceProvenance, FxPriceSource } from '../types/exchangeRate'

const transports=new WeakMap<object,FxPriceSource['transport']>()
export function recordPriceTransport(payload: unknown, transport: FxPriceSource['transport']) {
  if(payload!==null&&typeof payload==='object')transports.set(payload,transport)
}

export async function recordPriceResponse(
  provider: FxPriceSource['provider'], endpoint: string, payload: unknown,
  metadata: Pick<FxPriceSource, 'providerUpdatedAt' | 'providerDate' | 'dateMeaning' | 'priceKind'> & {providerTimeZone?: string | null;providerTimestampLocal?: string | null},
): Promise<FxPriceSource> {
  // Only code-owned endpoints (no query, credential or key path) are retained.
  const url = new URL(endpoint)
  const allowedEndpoints=['https://api.frankfurter.dev/v1','https://api.frankfurter.app/',
    'https://v6.exchangerate-api.com/v6','https://open.er-api.com/v6',
    'https://latest.currency-api.pages.dev/v1/currencies','https://www.alphavantage.co/query']
  const datedSnapshot=/^https:\/\/cdn\.jsdelivr\.net\/npm\/@fawazahmed0\/currency-api@\d{4}-\d{2}-\d{2}\/v1\/currencies\/[a-z]{3}\.json$/
  if (url.protocol !== 'https:' || url.search || url.username || url.password || url.hash
    || !allowedEndpoints.includes(url.href)&&!datedSnapshot.test(url.href)) throw new Error('unsafe_price_source_endpoint')
  let responseSha256: string | null = null
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)))
    responseSha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  } catch { /* Metadata failure must not change the existing price path. */ }
  return {provider,endpoint:url.href,capturedAt:new Date().toISOString(),responseSha256,
    digestMeaning:responseSha256?'parsed_json':'unavailable',...metadata,
    providerTimestampLocal:metadata.providerTimestampLocal??null,
    providerTimeZone:metadata.providerTimeZone??null,observedAt:null,localSessionDate:null,origin:'response',
    transport:payload!==null&&typeof payload==='object'?transports.get(payload)??'unknown':'unknown'}
}

export function unknownPriceSource(origin: FxPriceSource['origin']): FxPriceSource {
  return {provider:origin==='manual_input'?'manual_backfill':'unverified_supplemental',endpoint:null,
    capturedAt:null,responseSha256:null,digestMeaning:'unavailable',providerUpdatedAt:null,providerTimestampLocal:null,providerDate:null,
    dateMeaning:'unverified',priceKind:'unverified',providerTimeZone:null,observedAt:null,localSessionDate:null,origin,transport:'unknown'}
}

export function createPriceProvenanceRecorder() {
  const result: FxPriceProvenance = {version:'fx-price-provenance/1',sources:{},quotesByDate:{},selectionAudit:{}}
  const sourceIds = new Map<FxPriceSource,string>()
  function select(date: string, currency: string, value: number, source: FxPriceSource, stage: string) {
    if (!Number.isFinite(value)) return
    let id = sourceIds.get(source)
    if (!id) { id=`s${sourceIds.size+1}`;sourceIds.set(source,id);result.sources[id]={...source} }
    const quotes = result.quotesByDate[date] ??= {}
    const stats = result.selectionAudit[stage] ??= {assignments:0,replacements:0}
    stats.assignments++;if(quotes[currency])stats.replacements++
    quotes[currency]={sourceId:id,value}
  }
  function replaceDate(date: string) {
    const stats=result.selectionAudit.exchange_latest??={assignments:0,replacements:0}
    stats.replacements+=Object.keys(result.quotesByDate[date]??{}).length
    delete result.quotesByDate[date]
  }
  return {select,replaceDate,finish:(rows: DailyRate[])=>prunePriceProvenance(result,rows)}
}

export function prunePriceProvenance(book: FxPriceProvenance | undefined, rows: DailyRate[]): FxPriceProvenance | undefined {
  if (!book) return undefined
  const quotesByDate: FxPriceProvenance['quotesByDate']={},sources: FxPriceProvenance['sources']={}
  for(const row of rows) {
    if(row.rateType!=='LOCAL_PER_USD'||row.source!=='API'||row.imputationMethod!=='NONE')continue
    const quote=book.quotesByDate[row.date]?.[row.currency],source=quote&&book.sources[quote.sourceId]
    if(!quote||!source||quote.value!==row.value)continue
    ;(quotesByDate[row.date]??={})[row.currency]={...quote};sources[quote.sourceId]={...source}
  }
  return {version:book.version,sources,quotesByDate,selectionAudit:structuredClone(book.selectionAudit)}
}
