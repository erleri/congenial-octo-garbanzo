import type {
  CellStatus,
  CurrencyCode,
  ExchangeRateDataset,
  MonthlyRate,
  MovingColumn,
  MovingComparisonRow,
  RawSheet,
} from '../types/exchangeRate'
import { CURRENCIES, MONTHS, YEARS } from '../types/exchangeRate'
import * as XLSX from 'xlsx'

const CACHE_KEY = 'latam-rate-dashboard-cache-v2'
const REMOTE_ENDPOINT = 'https://v6.exchangerate-api.com/v6'
const HISTORY_ENDPOINT = 'https://api.frankfurter.app'
const OPEN_ER_API_ENDPOINT = 'https://open.er-api.com/v6'
const CURRENCY_API_LATEST_ENDPOINT = 'https://latest.currency-api.pages.dev/v1/currencies'
const CURRENCY_API_SNAPSHOT_ENDPOINT = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api'
const API_KEY = import.meta.env.VITE_EXCHANGERATE_API_KEY as string | undefined
const SUPPLEMENTAL_CURRENCIES: CurrencyCode[] = ['CLP', 'COP', 'PEN']

type ExchangeRateHistoryResponse = {
  result: 'success' | 'error'
  conversion_rates?: Record<string, number>
  'error-type'?: string
  time_last_update_utc?: string
}

type OpenErApiLatestResponse = {
  result?: 'success' | 'error'
  rates?: Record<string, number>
  time_last_update_utc?: string
}

type CurrencyApiLatestResponse = {
  date?: string
} & Record<string, unknown>

type FrankfurterRangeResponse = {
  amount: number
  base: string
  start_date: string
  end_date: string
  rates: Record<string, Record<string, number>>
}

const CACHE_DAILY_LIMITS = [12000, 6000, 2000, 0] as const

export interface ExcelMergeOptions {
  excelPriority: boolean
  fillMissing: boolean
}

function isQuotaExceededError(error: unknown): boolean {
  if (!(error instanceof DOMException)) {
    return false
  }

  return error.name === 'QuotaExceededError' || error.code === 22
}

function trimDailyRatesForCache(
  dailyRates: ExchangeRateDataset['dailyRates'],
  maxRows: number,
): ExchangeRateDataset['dailyRates'] {
  if (maxRows <= 0) {
    return []
  }

  if (dailyRates.length <= maxRows) {
    return dailyRates
  }

  return [...dailyRates]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, maxRows)
}

async function fetchJsonWithFallback<T>(url: string): Promise<T> {
  const candidates = [
    url,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ]

  let lastError: unknown = null

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      return (await response.json()) as T
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('외부 API 요청 실패')
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return formatDate(date)
}

function getStatus(value: number | null): CellStatus {
  if (value === null || Number.isNaN(value)) {
    return 'empty'
  }

  if (!Number.isFinite(value)) {
    return 'error'
  }

  if (value === 0) {
    return 'zero'
  }

  return 'ok'
}

function toNumber(value: number | undefined): number | null {
  if (typeof value !== 'number') {
    return null
  }

  if (!Number.isFinite(value)) {
    return null
  }

  return value
}

function average(values: number[]): number | null {
  if (!values.length) {
    return null
  }

  const sum = values.reduce((acc, cur) => acc + cur, 0)
  return sum / values.length
}

function parseDateParts(dateText: string): { year: number; month: number; day: number } {
  const [yearText, monthText, dayText] = dateText.split('-')
  return {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
  }
}

function parseBaseDateFromFilename(fileName: string): string | null {
  const compactMatched = fileName.match(/(20\d{2})[.\-_]?(0[1-9]|1[0-2])[.\-_]?([0-2]\d|3[0-1])/)
  if (compactMatched) {
    const year = Number(compactMatched[1])
    const month = Number(compactMatched[2])
    const day = Number(compactMatched[3])

    if (
      Number.isInteger(year) &&
      Number.isInteger(month) &&
      Number.isInteger(day) &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }

  const matched = fileName.match(/(\d{2})[.\-_](\d{2})[.\-_](\d{2})/)
  if (!matched) {
    return null
  }

  const year = Number(`20${matched[1]}`)
  const month = Number(matched[2])
  const day = Number(matched[3])

  if (!year || !month || !day) {
    return null
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function getYearMonthFromColumn(columnIndex: number): { year: number; month: number } | null {
  const monthIndex = columnIndex - 1
  if (monthIndex < 0) {
    return null
  }

  const year = 2010 + Math.floor(monthIndex / 12)
  const month = (monthIndex % 12) + 1

  if (!YEARS.includes(year) || !MONTHS.includes(month)) {
    return null
  }

  return { year, month }
}

function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value).trim()
}

function toNumericCell(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }

    const isParenNegative = trimmed.startsWith('(') && trimmed.endsWith(')')
    const stripped = isParenNegative ? trimmed.slice(1, -1) : trimmed

    const sanitized = stripped
      .replaceAll(',', '')
      .replaceAll('$', '')
      .replaceAll('₩', '')
      .replaceAll('USD', '')
      .replaceAll('KRW', '')
      .trim()

    if (!sanitized) {
      return null
    }

    const parsed = Number(sanitized)
    if (!Number.isFinite(parsed)) {
      return null
    }

    return isParenNegative ? -parsed : parsed
  }

  return null
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

function buildRawSheetsFromWorkbook(workbook: XLSX.WorkBook): RawSheet[] {
  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
    })

    const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0)
    const headers = Array.from({ length: maxColumns }, (_, idx) => {
      const headerText = toDisplayString(rows[0]?.[idx])
      return headerText || `COL_${idx + 1}`
    })

    const normalizedRows = rows.slice(1).map((row) => {
      const record: Record<string, string | number | null> = {}
      headers.forEach((header, idx) => {
        const cell = row[idx]
        if (typeof cell === 'number') {
          record[header] = cell
        } else if (cell === null || cell === undefined || cell === '') {
          record[header] = null
        } else {
          record[header] = String(cell)
        }
      })
      return record
    })

    return {
      name: sheetName,
      headers,
      rows: normalizedRows,
    }
  })
}

function parseSummarySheet(
  rows: (string | number | null)[][],
  rateType: 'LOCAL_PER_USD' | 'KRW',
  marker: string,
): MonthlyRate[] {
  const sectionStart = rows.findIndex((row) =>
    row.some((cell) => toDisplayString(cell).toUpperCase().includes(marker)),
  )

  if (sectionStart < 0) {
    return []
  }

  const parsed: MonthlyRate[] = []

  for (let rowIndex = sectionStart + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]
    const currencyText = toDisplayString(row[0]).toUpperCase()
    if (!CURRENCIES.includes(currencyText as CurrencyCode)) {
      if (parsed.length > 0) {
        break
      }
      continue
    }

    const currency = currencyText as CurrencyCode
    for (let col = 1; col < row.length; col += 1) {
      const ym = getYearMonthFromColumn(col)
      if (!ym) {
        continue
      }

      const value = toNumericCell(row[col])
      parsed.push({
        currency,
        year: ym.year,
        month: ym.month,
        rateType,
        value,
        status: getStatus(value),
        source: 'EXCEL',
        imputationMethod: 'NONE',
      })
    }
  }

  return parsed
}

function parseCurrencySheet(
  rows: (string | number | null)[][],
  currency: CurrencyCode,
): { daily: ExchangeRateDataset['dailyRates']; monthly: MonthlyRate[] } {
  const parseSection = (
    marker: string,
    rateType: 'LOCAL_PER_USD' | 'KRW',
  ): { daily: ExchangeRateDataset['dailyRates']; monthly: MonthlyRate[] } => {
    const start = rows.findIndex((row) =>
      row.some((cell) => toDisplayString(cell).toUpperCase().includes(marker)),
    )

    if (start < 0) {
      return { daily: [], monthly: [] }
    }

    const daily: ExchangeRateDataset['dailyRates'] = []
    const monthly: MonthlyRate[] = []

    for (let rowIndex = start + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex]
      const first = toDisplayString(row[0]).toLowerCase()

      const isAvgRow = first.includes('avg')
      const day = Number(first)
      const isDayRow = Number.isInteger(day) && day >= 1 && day <= 31

      if (!isDayRow && !isAvgRow) {
        if (daily.length > 0 || monthly.length > 0) {
          if (first.includes('exchange rate') || first.includes('local')) {
            break
          }
        }
        continue
      }

      for (let col = 1; col < row.length; col += 1) {
        const ym = getYearMonthFromColumn(col)
        if (!ym) {
          continue
        }

        const value = toNumericCell(row[col])

        if (isAvgRow) {
          monthly.push({
            currency,
            year: ym.year,
            month: ym.month,
            rateType,
            value,
            status: getStatus(value),
            source: 'EXCEL',
            imputationMethod: 'NONE',
          })
        } else {
          const maxDay = new Date(ym.year, ym.month, 0).getDate()
          if (day > maxDay) {
            continue
          }

          const date = `${ym.year}-${String(ym.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          daily.push({
            currency,
            year: ym.year,
            month: ym.month,
            day,
            date,
            rateType,
            value,
            status: getStatus(value),
            source: 'EXCEL',
            imputationMethod: 'NONE',
          })
        }
      }
    }

    return { daily, monthly }
  }

  const local = parseSection('1 DOLLAR EXCHANGE RATE', 'LOCAL_PER_USD')
  const krw = parseSection('(KRW)', 'KRW')

  return {
    daily: [...local.daily, ...krw.daily],
    monthly: [...local.monthly, ...krw.monthly],
  }
}

async function parseExcelWorkbook(file: File): Promise<{
  monthlyRates: MonthlyRate[]
  dailyRates: ExchangeRateDataset['dailyRates']
  rawSheets: RawSheet[]
  baseDate: string
}> {
  const fileData = await readFileAsArrayBuffer(file)
  const workbook = XLSX.read(fileData, { type: 'array' })
  const rawSheets = buildRawSheetsFromWorkbook(workbook)

  const summarySheet = workbook.Sheets.Summary
  const summaryRows = summarySheet
    ? XLSX.utils.sheet_to_json<(string | number | null)[]>(summarySheet, {
        header: 1,
        raw: true,
        defval: null,
      })
    : []

  const summaryMonthly = [
    ...parseSummarySheet(summaryRows, 'LOCAL_PER_USD', 'LOCAL'),
    ...parseSummarySheet(summaryRows, 'KRW', 'KRW'),
  ]

  const currencyParsed = CURRENCIES.flatMap((currency) => {
    const sheet = workbook.Sheets[currency]
    if (!sheet) {
      return []
    }

    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
    })

    return [parseCurrencySheet(rows, currency)]
  })

  const dailyRates = currencyParsed.flatMap((item) => item.daily)
  const currencyMonthly = currencyParsed.flatMap((item) => item.monthly)

  const monthlyMap = new Map<string, MonthlyRate>()
  for (const row of currencyMonthly) {
    if (row.value === null) {
      continue
    }
    monthlyMap.set(`${row.currency}|${row.year}|${row.month}|${row.rateType}`, row)
  }

  // Summary 시트의 월평균이 존재하면 통화 시트 Avg 계산값보다 우선한다.
  for (const row of summaryMonthly) {
    if (row.value === null) {
      continue
    }
    monthlyMap.set(`${row.currency}|${row.year}|${row.month}|${row.rateType}`, row)
  }

  const dailyMap = new Map<string, ExchangeRateDataset['dailyRates'][number]>()
  for (const row of dailyRates) {
    if (row.value === null) {
      continue
    }
    dailyMap.set(
      `${row.currency}|${row.year}|${row.month}|${row.day}|${row.rateType}`,
      row,
    )
  }

  return {
    monthlyRates: [...monthlyMap.values()],
    dailyRates: [...dailyMap.values()],
    rawSheets,
    baseDate: parseBaseDateFromFilename(file.name) ?? formatDate(new Date()),
  }
}

function mergeRateSeries(
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

function mergeMonthlySeries(
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

function applyForwardFillToDaily(
  rows: ExchangeRateDataset['dailyRates'],
  fillUntilDate?: string,
): ExchangeRateDataset['dailyRates'] {
  const grouped = new Map<string, ExchangeRateDataset['dailyRates']>()
  for (const row of rows) {
    const key = `${row.currency}|${row.rateType}`
    if (!grouped.has(key)) {
      grouped.set(key, [])
    }
    grouped.get(key)?.push(row)
  }

  const filled: ExchangeRateDataset['dailyRates'] = []
  for (const list of grouped.values()) {
    const ordered = [...list].sort((a, b) => (a.date < b.date ? -1 : 1))
    const rowByDate = new Map(ordered.map((row) => [row.date, row]))

    const firstDate = ordered[0]?.date
    const lastObservedDate = ordered[ordered.length - 1]?.date
    if (!firstDate || !lastObservedDate) {
      continue
    }

    const lastDate =
      fillUntilDate && fillUntilDate > lastObservedDate ? fillUntilDate : lastObservedDate

    const template = ordered[0]
    let lastValue: number | null = null

    for (let cursor = firstDate; cursor <= lastDate; cursor = addDays(cursor, 1)) {
      const row = rowByDate.get(cursor)

      if (!row) {
        if (lastValue === null) {
          continue
        }

        const { year, month, day } = parseDateParts(cursor)
        filled.push({
          currency: template.currency,
          year,
          month,
          day,
          date: cursor,
          rateType: template.rateType,
          value: lastValue,
          status: getStatus(lastValue),
          source: 'IMPUTED',
          imputationMethod: 'FFILL',
        })
        continue
      }

      if (row.value !== null) {
        lastValue = row.value
        filled.push(row)
        continue
      }

      if (lastValue !== null) {
        filled.push({
          ...row,
          value: lastValue,
          status: getStatus(lastValue),
          source: 'IMPUTED',
          imputationMethod: 'FFILL',
        })
      } else {
        filled.push(row)
      }
    }
  }

  return filled
}

function applyMonthlyFallbackFromDaily(
  monthlyRows: MonthlyRate[],
  dailyRows: ExchangeRateDataset['dailyRates'],
): MonthlyRate[] {
  return monthlyRows.map((row) => {
    if (row.value !== null) {
      return row
    }

    const candidates = dailyRows
      .filter(
        (item) =>
          item.currency === row.currency &&
          item.year === row.year &&
          item.month === row.month &&
          item.rateType === row.rateType,
      )
      .map((item) => item.value)
      .filter((value): value is number => typeof value === 'number')

    if (!candidates.length) {
      return row
    }

    const value = average(candidates)
    return {
      ...row,
      value,
      status: getStatus(value),
      source: 'IMPUTED',
      imputationMethod: 'MONTHLY_FALLBACK',
    }
  })
}

function mergeDatasetsWithExcel(
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
  }

  merged.movingComparison = buildMovingComparisonRows(merged, year, month)
  if (!merged.rawSheets.length) {
    merged.rawSheets = buildRawSheets(merged)
  }

  return merged
}

async function fetchFrankfurterRange(
  startDate: string,
  endDate: string,
): Promise<FrankfurterRangeResponse> {
  const targets = `${CURRENCIES.filter((currency) => currency !== 'USD').join(',')},KRW`
  const url = `${HISTORY_ENDPOINT}/${startDate}..${endDate}?from=USD&to=${targets}`

  return await fetchJsonWithFallback<FrankfurterRangeResponse>(url)
}

async function fetchLatestRatesFromExchangeApi(
  baseCurrency: string,
): Promise<{ date: string; rates: Record<string, number> } | null> {
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
  }
}

async function fetchLatestRatesFromOpenErApi(
  baseCurrency: string,
): Promise<{ date: string; rates: Record<string, number> } | null> {
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
  }
}

async function fetchLatestRatesFromCurrencyApi(
  baseCurrency: string,
): Promise<{ date: string; rates: Record<string, number> } | null> {
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
  }
}

async function fetchCurrencyApiSnapshot(
  baseCurrency: string,
  date: string,
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

async function fetchSupplementalHistoryFromCurrencyApi(
  dates: string[],
): Promise<Record<string, Record<string, number>>> {
  const snapshots = await Promise.all(
    dates.map(async (date) => {
      const rates = await fetchCurrencyApiSnapshot('USD', date)
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

function buildMovingComparisonRows(
  dataset: ExchangeRateDataset,
  year: number,
  month: number,
): MovingComparisonRow[] {
  const columns: MovingColumn[] = [
    'KRW',
    'BRL',
    'COP',
    'CLP',
    'PEN',
    'ARS',
    'MXN',
    'PYG',
    'GTQ',
    'UYU',
    'CNY',
    'OIL',
  ]

  const findDaily = (currency: CurrencyCode, day: number): number | null => {
    const row = dataset.dailyRates.find(
      (item) =>
        item.currency === currency &&
        item.year === year &&
        item.month === month &&
        item.day === day &&
        item.rateType === 'KRW',
    )
    return row?.value ?? null
  }

  const findMonthly = (
    currency: CurrencyCode,
    targetYear: number,
    targetMonth: number,
  ): number | null => {
    const row = dataset.monthlyRates.find(
      (item) =>
        item.currency === currency &&
        item.year === targetYear &&
        item.month === targetMonth &&
        item.rateType === 'KRW',
    )

    return row?.value ?? null
  }

  const daysInMonth = new Date(year, month, 0).getDate()

  const dayRows: MovingComparisonRow[] = Array.from({ length: 31 }, (_, idx) => {
    const day = idx + 1

    const values: Record<MovingColumn, number | null> = {
      KRW: day <= daysInMonth ? findDaily('USD', day) : null,
      BRL: day <= daysInMonth ? findDaily('BRL', day) : null,
      COP: day <= daysInMonth ? findDaily('COP', day) : null,
      CLP: day <= daysInMonth ? findDaily('CLP', day) : null,
      PEN: day <= daysInMonth ? findDaily('PEN', day) : null,
      ARS: day <= daysInMonth ? findDaily('ARS', day) : null,
      MXN: day <= daysInMonth ? findDaily('MXN', day) : null,
      PYG: day <= daysInMonth ? findDaily('PYG', day) : null,
      GTQ: day <= daysInMonth ? findDaily('GTQ', day) : null,
      UYU: day <= daysInMonth ? findDaily('UYU', day) : null,
      CNY: day <= daysInMonth ? findDaily('CNY', day) : null,
      OIL: null,
    }

    return {
      label: `${day}일`,
      values,
      isPercent: false,
    }
  })

  const calcByCurrency = (currency: CurrencyCode): number[] => {
    return dayRows
      .map((row) => {
        if (currency === 'USD') {
          return row.values.KRW
        }
        return row.values[currency as MovingColumn]
      })
      .filter((value): value is number => typeof value === 'number')
  }

  const asRecord = (
    mapper: (currency: CurrencyCode) => number | null,
  ): Record<MovingColumn, number | null> => ({
    KRW: mapper('USD'),
    BRL: mapper('BRL'),
    COP: mapper('COP'),
    CLP: mapper('CLP'),
    PEN: mapper('PEN'),
    ARS: mapper('ARS'),
    MXN: mapper('MXN'),
    PYG: mapper('PYG'),
    GTQ: mapper('GTQ'),
    UYU: mapper('UYU'),
    CNY: mapper('CNY'),
    OIL: null,
  })

  const avgActual = asRecord((currency) => average(calcByCurrency(currency)))

  const cumulative = asRecord((currency) => {
    const values = MONTHS.filter((candidateMonth) => candidateMonth <= month)
      .map((candidateMonth) => findMonthly(currency, year, candidateMonth))
      .filter((value): value is number => typeof value === 'number')
    return average(values)
  })

  const leading = asRecord((currency) => {
    const values = [1, 2, 3]
      .map((offset) => {
        const targetDate = new Date(year, month - 1 + offset, 1)
        return findMonthly(
          currency,
          targetDate.getFullYear(),
          targetDate.getMonth() + 1,
        )
      })
      .filter((value): value is number => typeof value === 'number')

    return average(values)
  })

  const leadingVs = asRecord((currency) => {
    const leadValue = leading[currency === 'USD' ? 'KRW' : (currency as MovingColumn)]
    const actualValue = avgActual[currency === 'USD' ? 'KRW' : (currency as MovingColumn)]

    if (leadValue === null || actualValue === null || actualValue === 0) {
      return null
    }

    return (leadValue - actualValue) / actualValue
  })

  const moving = asRecord((currency) => {
    const values = [0, 1, 2]
      .map((offset) => {
        const targetDate = new Date(year, month - 1 - offset, 1)
        return findMonthly(
          currency,
          targetDate.getFullYear(),
          targetDate.getMonth() + 1,
        )
      })
      .filter((value): value is number => typeof value === 'number')

    return average(values)
  })

  const movingVs = asRecord((currency) => {
    const movingValue = moving[currency === 'USD' ? 'KRW' : (currency as MovingColumn)]
    const actualValue = avgActual[currency === 'USD' ? 'KRW' : (currency as MovingColumn)]

    if (movingValue === null || actualValue === null || actualValue === 0) {
      return null
    }

    return (movingValue - actualValue) / actualValue
  })

  const lastYearCumulative = asRecord((currency) => {
    const values = MONTHS.filter((candidateMonth) => candidateMonth <= month)
      .map((candidateMonth) => findMonthly(currency, year - 1, candidateMonth))
      .filter((value): value is number => typeof value === 'number')

    return average(values)
  })

  const yoyVs = asRecord((currency) => {
    const currentValue = cumulative[currency === 'USD' ? 'KRW' : (currency as MovingColumn)]
    const previousValue =
      lastYearCumulative[currency === 'USD' ? 'KRW' : (currency as MovingColumn)]

    if (currentValue === null || previousValue === null || previousValue === 0) {
      return null
    }

    return (currentValue - previousValue) / previousValue
  })

  const summaryRows: MovingComparisonRow[] = [
    { label: '평균(실적)', values: avgActual, isPercent: false },
    { label: '누적(1월~현재)', values: cumulative, isPercent: false },
    { label: '선행', values: leading, isPercent: false },
    { label: '선행 比', values: leadingVs, isPercent: true },
    { label: '이동', values: moving, isPercent: false },
    { label: '이동 比', values: movingVs, isPercent: true },
    { label: '전년동월누적', values: lastYearCumulative, isPercent: false },
    { label: '전년동월누적比', values: yoyVs, isPercent: true },
  ]

  return [...dayRows, ...summaryRows].map((row) => ({
    ...row,
    values: columns.reduce(
      (acc, column) => {
        acc[column] = row.values[column] ?? null
        return acc
      },
      {} as Record<MovingColumn, number | null>,
    ),
  }))
}

function buildRawSheets(dataset: ExchangeRateDataset): RawSheet[] {
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

function buildMonthlyRates(
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

export async function fetchRemoteExchangeData(
  baseDate = new Date(),
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

  const supplementalHistory = supplementalHistoryDates.length
    ? await fetchSupplementalHistoryFromCurrencyApi(supplementalHistoryDates)
    : {}

  for (const [date, supplementalRates] of Object.entries(supplementalHistory)) {
    mergedRatesByDate[date] = {
      ...mergedRatesByDate[date],
      ...supplementalRates,
    }
  }

  if (latestPayload?.date) {
    mergedRatesByDate[latestPayload.date] = latestPayload.rates
  }

  if (openErLatestPayload?.date) {
    const existing = mergedRatesByDate[openErLatestPayload.date] ?? {}
    const merged: Record<string, number> = { ...existing }

    for (const currency of SUPPLEMENTAL_CURRENCIES) {
      const supplemental = toNumber(openErLatestPayload.rates[currency])
      if (supplemental !== null) {
        merged[currency] = supplemental
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
      }
    }

    mergedRatesByDate[currencyApiLatestPayload.date] = merged
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

  const effectiveBaseDate =
    latestPayload?.date ??
    currencyApiLatestPayload?.date ??
    openErLatestPayload?.date ??
    historyPayload.end_date

  const dataset: ExchangeRateDataset = {
    baseDate: effectiveBaseDate,
    fetchedAt: new Date().toISOString(),
    dailyRates: dailyRatesWithFill,
    monthlyRates,
    movingComparison: [],
    rawSheets: [],
  }

  const { year, month } = parseDateParts(endDate)

  const movingComparison = buildMovingComparisonRows(dataset, year, month)

  dataset.movingComparison = movingComparison
  dataset.rawSheets = buildRawSheets(dataset)

  return dataset
}

export function saveDatasetToCache(dataset: ExchangeRateDataset): boolean {
  for (const limit of CACHE_DAILY_LIMITS) {
    const compactDataset: ExchangeRateDataset = {
      ...dataset,
      // rawSheets는 월별/일별 원본의 중복 데이터가 많아 캐시 크기를 크게 키운다.
      rawSheets: [],
      dailyRates: trimDailyRatesForCache(dataset.dailyRates, limit),
    }

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(compactDataset))
      return true
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        return false
      }
    }
  }

  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // noop
  }

  return false
}

export async function fetchRemoteExchangeDataWithExcel(
  file: File,
  options: ExcelMergeOptions,
  baseDate = new Date(),
): Promise<ExchangeRateDataset> {
  const [apiDataset, excelDataset] = await Promise.all([
    fetchRemoteExchangeData(baseDate),
    parseExcelWorkbook(file),
  ])

  return mergeDatasetsWithExcel(apiDataset, excelDataset, options)
}

export function loadDatasetFromCache(): ExchangeRateDataset | null {
  const raw = localStorage.getItem(CACHE_KEY)

  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as ExchangeRateDataset
    if (!parsed.monthlyRates || !parsed.dailyRates) {
      return null
    }

    if (!parsed.rawSheets || parsed.rawSheets.length === 0) {
      parsed.rawSheets = buildRawSheets(parsed)
    }

    return parsed
  } catch {
    return null
  }
}
