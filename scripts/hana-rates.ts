import { recordPriceResponse } from '../src/lib/price-provenance'
import type { FxPriceSource, CurrencyCode } from '../src/types/exchangeRate'

export const HANA_CURRENCIES = ['BRL', 'MXN', 'CLP', 'COP', 'PEN', 'ARS'] as const
const published = 'https://www.kebhana.com/cms/rate/wpfxd651_01i_01.do'
const cross = 'https://www.kebhana.com/cms/rate/wpfxd651_10i_01.do'
export interface HanaQuote {
  currency: CurrencyCode
  date: string
  value: number
  source: FxPriceSource
}
const clean = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim()
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(date).toISOString().slice(0, 10) === date
const number = (s: string) => {
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s)) throw Error('hana_invalid_number')
  const value = Number(s.replaceAll(',', ''))
  if (!Number.isFinite(value) || value <= 0) throw Error('hana_nonpositive_number')
  return value
}

// The HTML response is parsed as data, with bounded size and a checked layout.
export async function parseHanaRates(html: string, kind: 'initial' | 'cross', requestedDate: string, capturedAt: string): Promise<HanaQuote[]> {
  if (!validDate(requestedDate) || html.length > 1_000_000) throw Error('hana_invalid_input')
  const header = html.match(/<p\b[^>]*class="txtRateBox"[^>]*>([\s\S]*?)<\/p>/)?.[1]
  const days = header && clean(header).match(/기준일\s*:\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/)
  if (!days) throw Error('hana_reference_date_missing')
  const date = `${days[1]}-${days[2].padStart(2, '0')}-${days[3].padStart(2, '0')}`
  if (!validDate(date) || date > requestedDate) throw Error('hana_reference_date_invalid')
  const display = clean(header!)
  const clock = kind === 'initial' ? display.match(/고시일시\s*:\s*\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*(\d{2})시(\d{2})분(\d{2})초\s*\(1회차\)/) : null
  if (kind === 'initial' && !clock) throw Error('hana_initial_bulletin_required')
  const localTime = clock ? `${date} ${clock[1]}:${clock[2]}:${clock[3]}` : null
  const updatedAt = localTime ? new Date(localTime.replace(' ', 'T') + '+09:00').toISOString() : null
  if (!Number.isFinite(Date.parse(capturedAt)) || updatedAt && Date.parse(updatedAt) > Date.parse(capturedAt)) throw Error('hana_capture_clock_invalid')
  const table = html.match(/<table\b[^>]*>[\s\S]*?<\/table>/)?.[0]
  const head = table?.match(/<thead>[\s\S]*?<\/thead>/)?.[0]
  if (!head || !(kind === 'initial' ? /미화\s*환산율/.test(clean(head)) : /Cross Rate/.test(clean(head)))) throw Error('hana_columns_changed')
  const body = table?.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0]
  const rows = Array.from((body ?? '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g), row =>
    Array.from(row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g), cell => clean(cell[1])))
  const currencies = kind === 'initial' ? HANA_CURRENCIES.slice(0, 4) : HANA_CURRENCIES.slice(4)
  const quotes: HanaQuote[] = []
  for (const currency of currencies) {
    const matches = rows.filter(row => kind === 'initial' ? new RegExp(`\\b${currency}\\b`).test(row[0]) : row[2] === currency)
    if (matches.length !== 1 || matches[0].length !== (kind === 'initial' ? 11 : 5)) throw Error('hana_currency_row_changed_' + currency)
    const row = matches[0]
    if (kind === 'initial' && !row[0].endsWith(currency)) throw Error('hana_currency_unit_changed')
    const raw = row.at(-1)!
    const rawValue = number(raw)
    const value = kind === 'initial' ? 1 / rawValue : rawValue
    const source = await recordPriceResponse('hana_bank', kind === 'initial' ? published : cross,
      {date,kind,currency,raw,value,localTime}, {providerDate:date,providerUpdatedAt:updatedAt,
        providerTimestampLocal:localTime,providerTimeZone:'Asia/Seoul',dateMeaning:'provider_payload_date',priceKind:'conversion_reference'})
    source.capturedAt = capturedAt
    source.transport = 'direct'
    source.bankQuote = {kind,rawValue:raw,unit:kind === 'initial' ? 'USD_per_local' : 'local_per_USD',bulletin:kind === 'initial' ? 1 : null}
    quotes.push({currency,date,value,source})
  }
  return quotes
}

export async function fetchHanaRates(date: string, fetchImpl = fetch): Promise<HanaQuote[]> {
  if (!validDate(date)) throw Error('hana_request_date_invalid')
  const quotes: HanaQuote[] = []
  for (const kind of ['initial', 'cross'] as const) {
    const body = new URLSearchParams({inqStrDt:date.replaceAll('-', ''),inqEndDt:date.replaceAll('-', ''),
      pbldDvCd:'1',inqKindCd:kind === 'initial' ? '1' : '2',inqDvCd:'az',requestTarget:'searchContentDiv'})
    const response = await fetchImpl(kind === 'initial' ? published : cross, {method:'POST',body,
      signal:AbortSignal.timeout(20000),redirect:'error'})
    if (!response.ok) throw Error('hana_http_' + response.status)
    const text = await response.text()
    quotes.push(...await parseHanaRates(text,kind,date,new Date().toISOString()))
  }
  return quotes
}
