import * as XLSX from 'xlsx';
const CURRENCIES = ['ARS', 'BRL', 'CLP', 'COP', 'GTQ', 'MXN', 'PYG', 'PEN', 'CNY', 'UYU', 'USD'];
const MONTHS = Array.from({ length: 12 }, (_, idx) => idx + 1);
const YEARS = Array.from({ length: 17 }, (_, idx) => 2010 + idx);

function getYearMonthFromColumn(columnIndex) {
  const monthIndex = columnIndex - 1
  if (monthIndex < 0) return null

  const year = 2010 + Math.floor(monthIndex / 12)
  const month = (monthIndex % 12) + 1

  if (!YEARS.includes(year) || !MONTHS.includes(month)) return null

  return { year, month }
}

function toDisplayString(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function toNumericCell(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const isParenNegative = trimmed.startsWith('(') && trimmed.endsWith(')')
    const stripped = isParenNegative ? trimmed.slice(1, -1) : trimmed

    const sanitized = stripped
      .replaceAll(',', '')
      .replaceAll('$', '')
      .replaceAll('₩', '')
      .replaceAll('USD', '')
      .replaceAll('KRW', '')
      .trim()

    if (!sanitized) return null

    const parsed = Number(sanitized)
    if (!Number.isFinite(parsed)) return null

    return isParenNegative ? -parsed : parsed
  }
  return null
}

function getStatus(value) {
  if (value === null || Number.isNaN(value)) return 'empty'
  if (!Number.isFinite(value)) return 'error'
  if (value === 0) return 'zero'
  return 'ok'
}

function parseSummarySheet(rows, rateType, marker) {
  const sectionStart = rows.findIndex((row) =>
    row.some((cell) => toDisplayString(cell).toUpperCase().includes(marker)),
  )

  if (sectionStart < 0) {
    return []
  }

  const parsed = []

  for (let rowIndex = sectionStart + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]
    const currencyText = toDisplayString(row[0]).toUpperCase()
    console.log(`Row ${rowIndex}: currencyText='${currencyText}'`);
    if (!CURRENCIES.includes(currencyText)) {
      if (parsed.length > 0) {
        console.log(`Breaking because '${currencyText}' is not in CURRENCIES and parsed.length=${parsed.length}`);
        break
      }
      continue
    }

    const currency = currencyText
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

import fs from 'fs'
import XLSX from 'xlsx'
import { parseExcelWorkbook } from './src/lib/excel.js' // wait, I can't import TS files easily in node without ts-node

// Let's just use ts-node

