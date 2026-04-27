import type { CellStatus, CurrencyCode } from '../types/exchangeRate'
import { CURRENCY_FORMAT_RULES } from '../types/exchangeRate'

export function formatCellValue(
  value: number | null,
  status: CellStatus,
  currency: CurrencyCode | 'KRW',
  asPercent = false,
): string {
  if (status === 'error') {
    return 'N/A'
  }

  if (value === null || status === 'empty') {
    return '-'
  }

  if (asPercent) {
    return `${(value * 100).toFixed(2)}%`
  }

  const rule = CURRENCY_FORMAT_RULES[currency]

  return new Intl.NumberFormat('ko-KR', {
    minimumFractionDigits: rule.minFractionDigits,
    maximumFractionDigits: rule.maxFractionDigits,
  }).format(value)
}

export function monthLabel(year: number, month: number): string {
  return `${year}.${String(month).padStart(2, '0')}`
}

export function safeRate(value: number | null): number {
  return value ?? 0
}
