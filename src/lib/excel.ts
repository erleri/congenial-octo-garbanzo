import * as XLSX from 'xlsx'
import type {
  CurrencyCode,
  ExchangeRateDataset,
  MonthlyRate,
  RawSheet,
} from '../types/exchangeRate'
import { CURRENCIES } from '../types/exchangeRate'
import {
  formatDate,
  parseBaseDateFromFilename,
  // parseDateParts,
  getYearMonthFromColumn,
  toDisplayString,
  toNumericCell,
  getStatus,
} from './utils'

export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

export function buildRawSheetsFromWorkbook(workbook: XLSX.WorkBook): RawSheet[] {
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

export function parseSummarySheet(
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
    
    // Stop parsing this section if we encounter headers for another section
    if (parsed.length > 0 && (currencyText.includes('KRW') || currencyText.includes('LOCAL'))) {
      break
    }

    if (!CURRENCIES.includes(currencyText as CurrencyCode)) {
      // Keep going even if there are empty rows or unmapped currencies
      // We only break when we hit a new section header
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

export function parseCurrencySheet(
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
      const dayMatch = first.match(/^(\d+)\s*일?$/)
      const day = dayMatch ? Number(dayMatch[1]) : NaN
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

export async function parseExcelWorkbook(file: File): Promise<{
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
  const baseDateStr = parseBaseDateFromFilename(file.name) ?? formatDate(new Date())
  // const { year: baseYear, month: baseMonth } = parseDateParts(baseDateStr)

  const monthlyMap = new Map<string, MonthlyRate>()
  for (const row of currencyMonthly) {
    if (row.value === null) continue
    monthlyMap.set(`${row.currency}|${row.year}|${row.month}|${row.rateType}`, row)
  }

  for (const row of summaryMonthly) {
    if (row.value === null) continue
    monthlyMap.set(`${row.currency}|${row.year}|${row.month}|${row.rateType}`, row)
  }

  const dailyMap = new Map<string, ExchangeRateDataset['dailyRates'][number]>()
  for (const row of dailyRates) {
    if (row.value === null) continue
    dailyMap.set(
      `${row.currency}|${row.year}|${row.month}|${row.day}|${row.rateType}`,
      row,
    )
  }

  return {
    monthlyRates: [...monthlyMap.values()],
    dailyRates: [...dailyMap.values()],
    rawSheets,
    baseDate: baseDateStr,
  }
}
