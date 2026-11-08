import type {
  CellStatus,
  CurrencyCode,
  ExchangeRateDataset,
  MonthlyRate,
  RawSheet,
  FxPriceSource,
} from '../types/exchangeRate'
import { CURRENCIES, MONTHS, YEARS } from '../types/exchangeRate'
import {
  formatDate,
  parseDateParts,
  toNumber,
  getStatus,
  average,
} from './utils'
import {
  ALPHA_VANTAGE_HISTORY_CURRENCIES,
  fetchFrankfurterRange,
  fetchLatestRatesFromExchangeApi,
  fetchLatestRatesFromOpenErApi,
  fetchLatestRatesFromCurrencyApi,
  fetchSupplementalHistoryFromCurrencyApi,
  fetchAlphaVantageFXDaily,
  SUPPLEMENTAL_CURRENCIES,
} from './api'
import { applyForwardFillToDaily, applyMonthlyFallbackFromDaily } from './imputation'
import { buildMovingComparisonRows } from './moving'
import { parseExcelWorkbook } from './excel'
import { loadAVSupplementalCache, saveAVSupplementalCache } from './cache'
import {createPriceProvenanceRecorder,unknownPriceSource,prunePriceProvenance} from './price-provenance'

export interface ExcelMergeOptions {
  excelPriority: boolean
  fillMissing: boolean
}

export interface RemoteExchangeDataOptions {
  supplementalHistoryByCurrency?: Record<string, Record<string, number>>
  supplementalPriceSources?: Record<string, FxPriceSource>
  manualBackfillByDate?: Record<string, Record<string, number>>
}

export function mergeRateSeries(
  apiRows: ExchangeRateDataset['dailyRates'],
  excelRows: ExchangeRateDataset['dailyRates'],
  excelPriority: boolean,
): ExchangeRateDataset['dailyRates'] {
  const map = new Map<string, ExchangeRateDataset['dailyRates'][number]>()

  for (const row of apiRows) {
    map.set(`${row.currency}|${row.year}|${row.month}|${row.day}|${row.rateType}`, row)
  }

  for (const row of excelRows) {
    const key = `${row.currency}|${row.year}|${row.month}|${row.day}|${row.rateType}`
    const existing = map.get(key)

    if (!existing) {
      map.set(key, row)
      continue
    }

    if (excelPriority) {
      if (row.value !== null) {
        map.set(key, row)
      }
    } else if (existing.value === null && row.value !== null) {
      map.set(key, row)
    }
  }

  return [...map.values()]
}

export function mergeMonthlySeries(
  apiRows: MonthlyRate[],
  excelRows: MonthlyRate[],
  excelPriority: boolean,
): MonthlyRate[] {
  const map = new Map<string, MonthlyRate>()

  for (const row of apiRows) {
    map.set(`${row.currency}|${row.year}|${row.month}|${row.rateType}`, row)
  }

  for (const row of excelRows) {
    const key = `${row.currency}|${row.year}|${row.month}|${row.rateType}`
    const existing = map.get(key)

    if (!existing) {
      map.set(key, row)
      continue
    }

    if (excelPriority) {
      if (row.value !== null) {
        map.set(key, row)
      }
    } else if (existing.value === null && row.value !== null) {
      map.set(key, row)
    }
  }

  return [...map.values()]
}

export function buildRawSheets(dataset: ExchangeRateDataset): RawSheet[] {
  const summaryHeaders = ['currency', 'year', 'month', 'rate_type', 'value', 'source', 'imputation_method']

  const summaryRows = dataset.monthlyRates.map((row) => ({
    currency: row.currency,
    year: row.year,
    month: row.month,
    rate_type: row.rateType,
    value: row.value,
    source: row.source,
    imputation_method: row.imputationMethod,
  }))

  const dailyByCurrency = CURRENCIES.map((currency) => {
    const headers = ['currency', 'year', 'month', 'day', 'rate_type', 'value', 'status', 'source', 'imputation_method']

    const rows = dataset.dailyRates
      .filter((row) => row.currency === currency)
      .map((row) => ({
        currency: row.currency,
        year: row.year,
        month: row.month,
        day: row.day,
        rate_type: row.rateType,
        value: row.value,
        status: row.status,
        source: row.source,
        imputation_method: row.imputationMethod,
      }))

    return { name: currency, headers, rows }
  })

  const movingHeaders = ['label', 'KRW', 'BRL', 'COP', 'CLP', 'PEN', 'ARS', 'MXN', 'PYG', 'GTQ', 'UYU', 'CNY', '원유가(U$/bbl)']
  const movingRows = dataset.movingComparison.map((row) => ({
    label: row.label,
    KRW: row.values.KRW,
    BRL: row.values.BRL,
    COP: row.values.COP,
    CLP: row.values.CLP,
    PEN: row.values.PEN,
    ARS: row.values.ARS,
    MXN: row.values.MXN,
    PYG: row.values.PYG,
    GTQ: row.values.GTQ,
    UYU: row.values.UYU,
    CNY: row.values.CNY,
    '원유가(U$/bbl)': row.values.OIL,
  }))

  return [
    {
      name: 'Summary',
      headers: summaryHeaders,
      rows: summaryRows,
    },
    ...dailyByCurrency,
    {
      name: '이동 比',
      headers: movingHeaders,
      rows: movingRows,
    },
  ]
}

export function buildMonthlyRates(
  records: Array<{
    currency: CurrencyCode
    year: number
    month: number
    rateType: 'LOCAL_PER_USD' | 'KRW'
    value: number | null
    status: CellStatus
  }>,
): MonthlyRate[] {
  const grouped = new Map<string, number[]>()

  for (const item of records) {
    const key = `${item.currency}|${item.year}|${item.month}|${item.rateType}`

    if (!grouped.has(key)) {
      grouped.set(key, [])
    }

    if (typeof item.value === 'number' && Number.isFinite(item.value)) {
      grouped.get(key)?.push(item.value)
    }
  }

  const monthlyRates: MonthlyRate[] = []

  for (const currency of CURRENCIES) {
    for (const year of YEARS) {
      for (const month of MONTHS) {
        for (const rateType of ['LOCAL_PER_USD', 'KRW'] as const) {
          const key = `${currency}|${year}|${month}|${rateType}`
          const values = grouped.get(key) ?? []
          const avg = average(values)

          monthlyRates.push({
            currency,
            year,
            month,
            rateType,
            value: avg,
            status: getStatus(avg),
            source: 'API',
            imputationMethod: 'NONE',
          })
        }
      }
    }
  }

  return monthlyRates
}

export function mergeDatasetsWithExcel(
  apiDataset: ExchangeRateDataset,
  excelDataset: Awaited<ReturnType<typeof parseExcelWorkbook>>,
  options: ExcelMergeOptions,
): ExchangeRateDataset {
  const mergedDaily = mergeRateSeries(
    apiDataset.dailyRates,
    excelDataset.dailyRates,
    options.excelPriority,
  )

  const mergedMonthly = mergeMonthlySeries(
    apiDataset.monthlyRates,
    excelDataset.monthlyRates,
    options.excelPriority,
  )

  const dailyWithFill = options.fillMissing ? applyForwardFillToDaily(mergedDaily) : mergedDaily
  const monthlyWithFill = options.fillMissing
    ? applyMonthlyFallbackFromDaily(mergedMonthly, dailyWithFill)
    : mergedMonthly

  const baseDate =
    excelDataset.baseDate > apiDataset.baseDate ? excelDataset.baseDate : apiDataset.baseDate
  const { year, month } = parseDateParts(baseDate)

  const merged: ExchangeRateDataset = {
    baseDate,
    fetchedAt: new Date().toISOString(),
    dailyRates: dailyWithFill,
    monthlyRates: monthlyWithFill,
    movingComparison: [],
    rawSheets: excelDataset.rawSheets.length ? excelDataset.rawSheets : apiDataset.rawSheets,
    priceProvenance:prunePriceProvenance(apiDataset.priceProvenance,dailyWithFill),
  }

  merged.movingComparison = buildMovingComparisonRows(merged, year, month)
  if (!merged.rawSheets?.length) {
    merged.rawSheets = buildRawSheets(merged)
  }

  return merged
}

export async function fetchRemoteExchangeData(
  baseDate = new Date(),
  options: RemoteExchangeDataOptions = {},
): Promise<ExchangeRateDataset> {
  const endDate = formatDate(baseDate)
  const startDate = '2010-01-01'

  const historyPayload = await fetchFrankfurterRange(startDate, endDate)
  const [latestPayload, openErLatestPayload, currencyApiLatestPayload] = await Promise.all([
    fetchLatestRatesFromExchangeApi('USD'),
    fetchLatestRatesFromOpenErApi('USD'),
    fetchLatestRatesFromCurrencyApi('USD'),
  ])

  const mergedRatesByDate: Record<string, Record<string, number>> = {
    ...historyPayload.rates,
  }
  const provenance=createPriceProvenanceRecorder()
  const unrecorded=unknownPriceSource('injected_without_source_record')
  const recordMap=(date:string,rates:Record<string,number>,source:FxPriceSource|undefined,stage:string)=>{
    for(const [currency,raw] of Object.entries(rates)){
      const value=toNumber(raw)
      if(value!==null)provenance.select(date,currency,value,source??unrecorded,stage)
    }
  }
  for(const [date,rates] of Object.entries(historyPayload.rates))recordMap(date,rates,historyPayload.priceSource,'frankfurter_history')

  // Alpha Vantage로 CLP/COP/PEN 전체 히스토리 보충 (Frankfurter 미지원)
  // 캐시가 있으면 API 호출 없이 재사용 (무료 25 req/일 한도 보호)
  const avCached = await loadAVSupplementalCache()
  const alphaVantageRatesByCurrency: Record<string, Record<string, number>> = {
    ...(options.supplementalHistoryByCurrency ?? {}),
    ...(avCached?.rates ?? {}),
  }
  const alphaSources:Record<string,FxPriceSource>={...options.supplementalPriceSources}
  for(const currency of Object.keys(avCached?.rates??{})){
    alphaSources[currency]=avCached?.priceSources?.[currency]??unknownPriceSource('cache_without_source_record')
  }

  const missingCurrencies = ALPHA_VANTAGE_HISTORY_CURRENCIES.filter(
    (currency) => !alphaVantageRatesByCurrency[currency],
  )

  if (missingCurrencies.length > 0) {
    for (const currency of missingCurrencies) {
      const rates = await fetchAlphaVantageFXDaily(currency,source=>{alphaSources[currency]=source})
      if (rates) {
        alphaVantageRatesByCurrency[currency] = rates
      }
    }

    if (Object.keys(alphaVantageRatesByCurrency).length > 0) {
      void saveAVSupplementalCache({
        fetchedAt: new Date().toISOString(),
        rates: alphaVantageRatesByCurrency,
        priceSources:alphaSources,
      })
    }
  }

  for (const [currency, dateRates] of Object.entries(alphaVantageRatesByCurrency)) {
    if (!dateRates) continue
    for (const [date, rate] of Object.entries(dateRates)) {
      if (!mergedRatesByDate[date]) continue
      if (currency === 'ARS' || toNumber(mergedRatesByDate[date][currency]) === null) {
        mergedRatesByDate[date][currency] = rate
        provenance.select(date,currency,rate,alphaSources[currency]??unrecorded,'alpha_history')
      }
    }
  }

  // Alpha Vantage 키가 없거나 한도 초과 시를 대비한 보조 경로:
  // 월별 첫 관측일만 snapshot으로 채운 뒤, 이후 전일 보간(FFILL)으로 연속성 확보
  const missingSupplementalEntries = Object.entries(mergedRatesByDate).filter(([, rateMap]) =>
    SUPPLEMENTAL_CURRENCIES.some((currency) => toNumber(rateMap[currency]) === null),
  )

  if (missingSupplementalEntries.length > 0) {
    const monthlyAnchorDateByKey = missingSupplementalEntries.reduce<Record<string, string>>(
      (acc, [date]) => {
        const { year, month } = parseDateParts(date)
        const ymKey = `${year}-${String(month).padStart(2, '0')}`
        const existing = acc[ymKey]

        if (!existing || date < existing) {
          acc[ymKey] = date
        }

        return acc
      },
      {},
    )

    const monthlyAnchorDates = Object.values(monthlyAnchorDateByKey)
    const anchorSources:Record<string,FxPriceSource>={}
    const supplementalMonthlyAnchors = monthlyAnchorDates.length
      ? await fetchSupplementalHistoryFromCurrencyApi(monthlyAnchorDates,(date,source)=>{anchorSources[date]=source})
      : {}

    for (const [date, supplementalRates] of Object.entries(supplementalMonthlyAnchors)) {
      mergedRatesByDate[date] = {
        ...mergedRatesByDate[date],
        ...supplementalRates,
      }
      recordMap(date,supplementalRates,anchorSources[date],'currency_monthly_anchor')
    }
  }

  const latestYear = parseDateParts(endDate).year
  const supplementalHistoryDates = Object.entries(mergedRatesByDate)
    .filter(([date, rateMap]) => {
      const { year } = parseDateParts(date)
      if (year !== latestYear) {
        return false
      }

      return SUPPLEMENTAL_CURRENCIES.some((currency) => toNumber(rateMap[currency]) === null)
    })
    .map(([date]) => date)

  const historySources:Record<string,FxPriceSource>={}
  const supplementalHistory = supplementalHistoryDates.length
    ? await fetchSupplementalHistoryFromCurrencyApi(supplementalHistoryDates,(date,source)=>{historySources[date]=source})
    : {}

  for (const [date, supplementalRates] of Object.entries(supplementalHistory)) {
    mergedRatesByDate[date] = {
      ...mergedRatesByDate[date],
      ...supplementalRates,
    }
    recordMap(date,supplementalRates,historySources[date],'currency_supplemental_history')
  }

  if (latestPayload?.date) {
    mergedRatesByDate[latestPayload.date] = latestPayload.rates
    provenance.replaceDate(latestPayload.date)
    recordMap(latestPayload.date,latestPayload.rates,latestPayload.priceSource,'exchange_latest')
  }

  if (openErLatestPayload?.date) {
    const existing = mergedRatesByDate[openErLatestPayload.date] ?? {}
    const merged: Record<string, number> = { ...existing }

    for (const currency of SUPPLEMENTAL_CURRENCIES) {
      const supplemental = toNumber(openErLatestPayload.rates[currency])
      if (supplemental !== null) {
        merged[currency] = supplemental
        provenance.select(openErLatestPayload.date,currency,supplemental,openErLatestPayload.priceSource??unrecorded,'open_er_latest')
      }
    }

    mergedRatesByDate[openErLatestPayload.date] = merged
  }

  if (currencyApiLatestPayload?.date) {
    const existing = mergedRatesByDate[currencyApiLatestPayload.date] ?? {}
    const merged: Record<string, number> = { ...existing }

    for (const currency of [...SUPPLEMENTAL_CURRENCIES, 'KRW' as const]) {
      const supplemental = toNumber(currencyApiLatestPayload.rates[currency])
      if (supplemental !== null) {
        merged[currency] = supplemental
        provenance.select(currencyApiLatestPayload.date,currency,supplemental,currencyApiLatestPayload.priceSource??unrecorded,'currency_latest')
      }
    }

    mergedRatesByDate[currencyApiLatestPayload.date] = merged
  }

  if (options.manualBackfillByDate) {
    const manualBackfillCurrencies = new Set<CurrencyCode>(['PYG', 'GTQ', 'UYU'])
    const manualSource=unknownPriceSource('manual_input')

    for (const [date, currencyRates] of Object.entries(options.manualBackfillByDate)) {
      const existing = mergedRatesByDate[date]
      if (!existing) {
        continue
      }

      for (const [currency, value] of Object.entries(currencyRates)) {
        if (!manualBackfillCurrencies.has(currency as CurrencyCode)) {
          continue
        }

        const numeric = toNumber(value)
        if (numeric !== null) {
          existing[currency] = numeric
          provenance.select(date,currency,numeric,manualSource,'manual_backfill')
        }
      }
    }
  }

  const dailyRates: ExchangeRateDataset['dailyRates'] = Object.entries(
    mergedRatesByDate,
  ).flatMap(([date, rateMap]) => {
    const { year, month, day } = parseDateParts(date)
    const usdToKrw = toNumber(rateMap.KRW)

    return CURRENCIES.flatMap((currency) => {
      const localPerUsd = currency === 'USD' ? 1 : toNumber(rateMap[currency])

      const krwValue = (() => {
        if (usdToKrw === null || localPerUsd === null) {
          return null
        }

        if (currency === 'USD') {
          return usdToKrw
        }

        if (localPerUsd === 0) {
          return Number.NaN
        }

        return usdToKrw / localPerUsd
      })()

      return [
        {
          currency,
          year,
          month,
          day,
          date,
          rateType: 'LOCAL_PER_USD' as const,
          value: localPerUsd,
          status: getStatus(localPerUsd),
          source: 'API',
          imputationMethod: 'NONE',
        },
        {
          currency,
          year,
          month,
          day,
          date,
          rateType: 'KRW' as const,
          value: Number.isNaN(krwValue) ? null : krwValue,
          status: Number.isNaN(krwValue) ? 'error' : getStatus(krwValue),
          source: 'API',
          imputationMethod: 'NONE',
        },
      ]
    })
  })

  const dailyRatesWithFill = applyForwardFillToDaily(dailyRates, endDate)
  const monthlyRates = buildMonthlyRates(dailyRatesWithFill)

  const effectiveBaseDate = dailyRatesWithFill.length > 0
    ? dailyRatesWithFill.reduce((max, row) => row.date > max ? row.date : max, dailyRatesWithFill[0].date)
    : (latestPayload?.date ??
       currencyApiLatestPayload?.date ??
       openErLatestPayload?.date ??
       historyPayload.end_date)

  const dataset: ExchangeRateDataset = {
    baseDate: effectiveBaseDate,
    fetchedAt: new Date().toISOString(),
    dailyRates: dailyRatesWithFill,
    monthlyRates,
    movingComparison: [],
    rawSheets: [],
    priceProvenance:provenance.finish(dailyRatesWithFill),
  }

  const { year, month } = parseDateParts(endDate)

  const movingComparison = buildMovingComparisonRows(dataset, year, month)

  dataset.movingComparison = movingComparison
  dataset.rawSheets = buildRawSheets(dataset)

  return dataset
}

export async function fetchRemoteExchangeDataWithExcel(
  file: File,
  options: ExcelMergeOptions,
  baseDate = new Date(),
  remoteOptions: RemoteExchangeDataOptions = {},
): Promise<ExchangeRateDataset> {
  const [apiDataset, excelDataset] = await Promise.all([
    fetchRemoteExchangeData(baseDate, remoteOptions),
    parseExcelWorkbook(file),
  ])

  return mergeDatasetsWithExcel(apiDataset, excelDataset, options)
}
