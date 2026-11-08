import type { CurrencyCode, FxPriceSource } from '../types/exchangeRate'
import { CURRENCIES } from '../types/exchangeRate'
import { toNumber } from './utils'
import { recordPriceResponse, recordPriceTransport } from './price-provenance'

const REMOTE_ENDPOINT = 'https://v6.exchangerate-api.com/v6'
const HISTORY_ENDPOINTS = ['https://api.frankfurter.dev/v1', 'https://api.frankfurter.app']
const OPEN_ER_API_ENDPOINT = 'https://open.er-api.com/v6'
const CURRENCY_API_LATEST_ENDPOINT = 'https://latest.currency-api.pages.dev/v1/currencies'
const CURRENCY_API_SNAPSHOT_ENDPOINT = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api'
const ALPHA_VANTAGE_ENDPOINT = 'https://www.alphavantage.co/query'
const FETCH_TIMEOUT_MS = 8000

function readEnv(key: string): string | undefined {
  const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
  if (viteEnv?.[key]) {
    return viteEnv[key]
  }

  const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return nodeEnv?.[key]
}

const API_KEY = readEnv('VITE_EXCHANGERATE_API_KEY')
const ALPHA_VANTAGE_API_KEY = readEnv('VITE_ALPHA_VANTAGE_API_KEY')

export const SUPPLEMENTAL_CURRENCIES: CurrencyCode[] = [
  'CLP',
  'COP',
  'PEN',
  'ARS',
  'GTQ',
  'PYG',
  'UYU',
]
export const ALPHA_VANTAGE_HISTORY_CURRENCIES: CurrencyCode[] = ['CLP', 'COP', 'PEN', 'ARS']

export type ExchangeRateHistoryResponse = {
  result: 'success' | 'error'
  conversion_rates?: Record<string, number>
  'error-type'?: string
  time_last_update_utc?: string
}

export type OpenErApiLatestResponse = {
  result?: 'success' | 'error'
  rates?: Record<string, number>
  time_last_update_utc?: string
}

export type CurrencyApiLatestResponse = {
  date?: string
} & Record<string, unknown>

export type FrankfurterRangeResponse = {
  amount: number
  base: string
  start_date: string
  end_date: string
  rates: Record<string, Record<string, number>>
  priceSource?: FxPriceSource
}

type LatestRates = { date: string; rates: Record<string, number>; priceSource?: FxPriceSource }

export async function fetchJsonWithFallback<T>(url: string): Promise<T> {
  const requestUrl=new URL(url)
  const authenticated=Boolean(requestUrl.username||requestUrl.password)||requestUrl.hostname==='v6.exchangerate-api.com'
    ||[...requestUrl.searchParams.keys()].some(key=>/(?:^|_)(?:api_?key|token|password|secret|authorization)$/i.test(key))
  const candidates = authenticated?[url]:[
    url,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ]

  let lastError: unknown = null

  for (const [attempt,candidate] of candidates.entries()) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const response = await fetch(candidate, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const payload=await response.json()
      recordPriceTransport(payload,attempt===0?'direct':attempt===1?'corsproxy':'allorigins')
      return payload as T
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('외부 API 요청 실패')
}

export async function fetchFrankfurterRange(
  startDate: string,
  endDate: string,
): Promise<FrankfurterRangeResponse> {
  const targets = `${CURRENCIES.filter((currency) => currency !== 'USD').join(',')},KRW`
  let lastError: unknown = null

  for (const endpoint of HISTORY_ENDPOINTS) {
    const url = `${endpoint}/${startDate}..${endDate}?from=USD&to=${targets}`

    try {
      const payload = await fetchJsonWithFallback<FrankfurterRangeResponse>(url)
      return {...payload,priceSource:await recordPriceResponse('frankfurter_v1',endpoint,payload,{
        providerUpdatedAt:null,providerDate:null,dateMeaning:'provider_series_date',priceKind:'conversion_reference',
      })}
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Frankfurter 히스토리 조회 실패')
}

export async function fetchLatestRatesFromExchangeApi(
  baseCurrency: string,
): Promise<LatestRates | null> {
  if (!API_KEY) {
    return null
  }

  const url = `${REMOTE_ENDPOINT}/${API_KEY}/latest/${baseCurrency}`

  let payload: ExchangeRateHistoryResponse
  try {
    payload = await fetchJsonWithFallback<ExchangeRateHistoryResponse>(url)
  } catch {
    return null
  }

  if (payload.result !== 'success' || !payload.conversion_rates) {
    return null
  }

  const updateUtc = payload.time_last_update_utc
  const date = updateUtc
    ? new Date(updateUtc).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)

  return {
    date,
    rates: payload.conversion_rates,
    priceSource:await recordPriceResponse('exchange_rate_api',REMOTE_ENDPOINT,payload,{
      providerUpdatedAt:updateUtc?new Date(updateUtc).toISOString():null,providerDate:date,
      dateMeaning:updateUtc?'utc_update_date':'collection_date_fallback',priceKind:'conversion_reference',
    }),
  }
}

export async function fetchLatestRatesFromOpenErApi(
  baseCurrency: string,
): Promise<LatestRates | null> {
  const url = `${OPEN_ER_API_ENDPOINT}/latest/${baseCurrency}`

  let payload: OpenErApiLatestResponse
  try {
    payload = await fetchJsonWithFallback<OpenErApiLatestResponse>(url)
  } catch {
    return null
  }

  if (payload.result !== 'success' || !payload.rates) {
    return null
  }

  const updateUtc = payload.time_last_update_utc
  const date = updateUtc
    ? new Date(updateUtc).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)

  return {
    date,
    rates: payload.rates,
    priceSource:await recordPriceResponse('open_er_api',OPEN_ER_API_ENDPOINT,payload,{
      providerUpdatedAt:updateUtc?new Date(updateUtc).toISOString():null,providerDate:date,
      dateMeaning:updateUtc?'utc_update_date':'collection_date_fallback',priceKind:'conversion_reference',
    }),
  }
}

export async function fetchLatestRatesFromCurrencyApi(
  baseCurrency: string,
): Promise<LatestRates | null> {
  const base = baseCurrency.toLowerCase()
  const url = `${CURRENCY_API_LATEST_ENDPOINT}/${base}.json`

  let payload: CurrencyApiLatestResponse
  try {
    payload = await fetchJsonWithFallback<CurrencyApiLatestResponse>(url)
  } catch {
    return null
  }

  const date = typeof payload.date === 'string' ? payload.date : null
  const rateNode = payload[base]

  if (!date || typeof rateNode !== 'object' || rateNode === null) {
    return null
  }

  const normalized = Object.entries(rateNode as Record<string, unknown>).reduce<Record<string, number>>(
    (acc, [currency, raw]) => {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return acc
      }

      acc[currency.toUpperCase()] = raw
      return acc
    },
    {},
  )

  return {
    date,
    rates: normalized,
    priceSource:await recordPriceResponse('currency_api',CURRENCY_API_LATEST_ENDPOINT,payload,{
      providerUpdatedAt:null,providerDate:date,dateMeaning:'provider_payload_date',priceKind:'conversion_reference',
    }),
  }
}

export async function fetchCurrencyApiSnapshot(
  baseCurrency: string,
  date: string,
  onSource?: (date: string, source: FxPriceSource) => void,
): Promise<Record<string, number> | null> {
  const base = baseCurrency.toLowerCase()
  const url = `${CURRENCY_API_SNAPSHOT_ENDPOINT}@${date}/v1/currencies/${base}.json`

  let payload: CurrencyApiLatestResponse
  try {
    payload = await fetchJsonWithFallback<CurrencyApiLatestResponse>(url)
  } catch {
    return null
  }

  const rateNode = payload[base]
  if (typeof rateNode !== 'object' || rateNode === null) {
    return null
  }

  if(onSource)onSource(date,await recordPriceResponse('currency_api',`${CURRENCY_API_SNAPSHOT_ENDPOINT}@${date}/v1/currencies/${base}.json`,payload,{
    providerUpdatedAt:null,providerDate:typeof payload.date==='string'?payload.date:null,
    dateMeaning:typeof payload.date==='string'?'provider_payload_date':'requested_snapshot_date',priceKind:'conversion_reference',
  }))

  return Object.entries(rateNode as Record<string, unknown>).reduce<Record<string, number>>(
    (acc, [currency, raw]) => {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return acc
      }

      acc[currency.toUpperCase()] = raw
      return acc
    },
    {},
  )
}

export async function fetchSupplementalHistoryFromCurrencyApi(
  dates: string[],
  onSource?: (date: string, source: FxPriceSource) => void,
): Promise<Record<string, Record<string, number>>> {
  const snapshots = await Promise.all(
    dates.map(async (date) => {
      const rates = await fetchCurrencyApiSnapshot('USD', date, onSource)
      if (!rates) {
        return null
      }

      const picked = [...SUPPLEMENTAL_CURRENCIES, 'KRW' as const].reduce<Record<string, number>>(
        (acc, currency) => {
          const value = toNumber(rates[currency])
          if (value !== null) {
            acc[currency] = value
          }
          return acc
        },
        {},
      )

      return Object.keys(picked).length ? { date, rates: picked } : null
    }),
  )

  return snapshots.reduce<Record<string, Record<string, number>>>((acc, item) => {
    if (!item) {
      return acc
    }

    acc[item.date] = item.rates
    return acc
  }, {})
}

export type AlphaVantageFXDailyResponse = {
  'Meta Data'?: Record<string, string>
  'Time Series FX (Daily)'?: Record<
    string,
    { '1. open': string; '2. high': string; '3. low': string; '4. close': string }
  >
  'Error Message'?: string
  Information?: string
  Note?: string
}

/**
 * Alpha Vantage FX_DAILY: USD → toSymbol 전체 일별 히스토리 반환
 * 반환값: { 'YYYY-MM-DD': rate } 또는 null(키 없음/한도 초과)
 */
export async function fetchAlphaVantageFXDaily(
  toSymbol: string,
  onSource?: (source: FxPriceSource) => void,
): Promise<Record<string, number> | null> {
  if (!ALPHA_VANTAGE_API_KEY) {
    return null
  }

  const url = `${ALPHA_VANTAGE_ENDPOINT}?function=FX_DAILY&from_symbol=USD&to_symbol=${toSymbol}&outputsize=full&apikey=${ALPHA_VANTAGE_API_KEY}`

  let payload: AlphaVantageFXDailyResponse
  try {
    payload = await fetchJsonWithFallback<AlphaVantageFXDailyResponse>(url)
  } catch {
    return null
  }

  const timeSeries = payload['Time Series FX (Daily)']
  if (!timeSeries) {
    return null
  }

  let providerTimeZone: string | null = null
  const zone=payload['Meta Data']?.['6. Time Zone']
  if(typeof zone==='string'&&zone.length<80){try{new Intl.DateTimeFormat('en',{timeZone:zone});providerTimeZone=zone}catch{/* Unrecognized metadata stays unknown. */}}
  const localTimestamp=payload['Meta Data']?.['5. Last Refreshed']
  const providerTimestampLocal=typeof localTimestamp==='string'&&/^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(localTimestamp)
    &&Number.isFinite(Date.parse(localTimestamp.slice(0,10)))
    &&new Date(localTimestamp.slice(0,10)).toISOString().slice(0,10)===localTimestamp.slice(0,10)?localTimestamp:null
  if(onSource)onSource(await recordPriceResponse('alpha_vantage',ALPHA_VANTAGE_ENDPOINT,payload,{
    providerUpdatedAt:null,providerDate:null,dateMeaning:'provider_series_date',priceKind:'provider_daily_close',providerTimeZone,providerTimestampLocal,
  }))

  return Object.entries(timeSeries).reduce<Record<string, number>>((acc, [date, ohlc]) => {
    const close = parseFloat(ohlc['4. close'])
    if (Number.isFinite(close) && close > 0) {
      acc[date] = close
    }
    return acc
  }, {})
}
