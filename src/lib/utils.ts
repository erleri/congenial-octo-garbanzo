import type { CellStatus } from '../types/exchangeRate';
import { MONTHS, YEARS } from '../types/exchangeRate';

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return formatDate(date)
}

export function getStatus(value: number | null): CellStatus {
  if (value === null || Number.isNaN(value)) return 'empty'
  if (!Number.isFinite(value)) return 'error'
  if (value === 0) return 'zero'
  return 'ok'
}

export function toNumber(value: number | undefined | unknown): number | null {
  if (typeof value !== 'number') return null
  if (!Number.isFinite(value)) return null
  return value
}

export function average(values: number[]): number | null {
  if (!values.length) return null
  const sum = values.reduce((acc, cur) => acc + cur, 0)
  return sum / values.length
}

export function parseDateParts(dateText: string): { year: number; month: number; day: number } {
  const [yearText, monthText, dayText] = dateText.split('-')
  return {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
  }
}

export function parseBaseDateFromFilename(fileName: string): string | null {
  const compactMatched = fileName.match(/(20\d{2})[.\-_]?(0[1-9]|1[0-2])[.\-_]?([0-2]\d|3[0-1])/)
  if (compactMatched) {
    const year = Number(compactMatched[1])
    const month = Number(compactMatched[2])
    const day = Number(compactMatched[3])
    if (
      Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day) &&
      month >= 1 && month <= 12 && day >= 1 && day <= 31
    ) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }

  const matched = fileName.match(/(\d{2})[.\-_](\d{2})[.\-_](\d{2})/)
  if (!matched) return null

  const year = Number(`20${matched[1]}`)
  const month = Number(matched[2])
  const day = Number(matched[3])

  if (!year || !month || !day) return null

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function getYearMonthFromColumn(columnIndex: number): { year: number; month: number } | null {
  const monthIndex = columnIndex - 1
  if (monthIndex < 0) return null

  const year = 2010 + Math.floor(monthIndex / 12)
  const month = (monthIndex % 12) + 1

  if (!YEARS.includes(year) || !MONTHS.includes(month)) return null

  return { year, month }
}

/**
 * Parses year and month from a header string (e.g., "2024.01", "24년 1월", "Jan 24").
 */
export function parseYearMonthFromHeader(header: string): { year: number; month: number } | null {
  const text = toDisplayString(header).toUpperCase();
  if (!text) return null;

  // Pattern 1: 2024.01, 24.01, 2024-01, 2024/01, 24/01
  const numericMatch = text.match(/(20\d{2}|\d{2})[.\-_/ ]?(0[1-9]|1[0-2]|[1-9])(?![0-9])/);
  if (numericMatch) {
    let year = Number(numericMatch[1]);
    if (year < 100) year += 2000;
    const month = Number(numericMatch[2]);
    if (year >= 2010 && year <= 2035 && month >= 1 && month <= 12) {
      return { year, month };
    }
  }

  // Pattern 2: "JAN", "FEB"... maybe with year
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const monthIdx = months.findIndex(m => text.includes(m));
  if (monthIdx >= 0) {
    const month = monthIdx + 1;
    const yearMatch = text.match(/(20\d{2}|\d{2})/);
    let year = 0;
    if (yearMatch) {
      year = Number(yearMatch[1]);
      if (year < 100) year += 2000;
    }
    return { year, month };
  }

  // Pattern 3: Korean "24년 1월"
  const koMatch = text.match(/(\d{2,4})\s*년\s*(\d{1,2})\s*월/);
  if (koMatch) {
    let year = Number(koMatch[1]);
    if (year < 100) year += 2000;
    const month = Number(koMatch[2]);
    return { year, month };
  }

  return null;
}

export function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

export function toNumericCell(value: unknown): number | null {
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
