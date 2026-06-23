import type { MonthlyRate } from '../types/exchangeRate'

export function periodToNumber(period: string): number {
  const [yearText, monthText] = period.split('-')
  return Number(yearText) * 100 + Number(monthText)
}

export function buildPeriodOptions(
  monthlyRates: MonthlyRate[],
  baseDate: string,
): string[] {
  const basePeriod = baseDate.slice(0, 7)
  const basePeriodNumber = periodToNumber(basePeriod)
  const unique = new Set(
    monthlyRates
      .filter((row) => row.rateType === 'LOCAL_PER_USD')
      .map((row) => `${row.year}-${String(row.month).padStart(2, '0')}`)
      .filter((period) => periodToNumber(period) <= basePeriodNumber),
  )

  return [...unique].sort((a, b) => periodToNumber(a) - periodToNumber(b))
}

export function buildYearOptions(periodOptions: string[]): number[] {
  return [...new Set(periodOptions.map((period) => Number(period.slice(0, 4))))].sort(
    (a, b) => a - b,
  )
}

export function defaultPeriodRange(periodOptions: string[]): [string, string] {
  if (!periodOptions.length) {
    return ['', '']
  }

  return [
    periodOptions[Math.max(0, periodOptions.length - 2)],
    periodOptions[periodOptions.length - 1],
  ]
}

export function defaultYearRange(yearOptions: number[]): [number, number] {
  if (!yearOptions.length) {
    return [0, 0]
  }

  return [
    yearOptions[Math.max(0, yearOptions.length - 2)],
    yearOptions[yearOptions.length - 1],
  ]
}

export function resolvePeriodRange(
  periodOptions: string[],
  selectedFrom: string,
  selectedTo: string,
): [string, string] {
  const [fallbackFrom, fallbackTo] = defaultPeriodRange(periodOptions)
  const from = periodOptions.includes(selectedFrom) ? selectedFrom : fallbackFrom
  const to = periodOptions.includes(selectedTo) ? selectedTo : fallbackTo

  return periodToNumber(from) <= periodToNumber(to) ? [from, to] : [to, from]
}

export function resolveYearRange(
  yearOptions: number[],
  selectedFrom: number | null,
  selectedTo: number | null,
): [number, number] {
  const [fallbackFrom, fallbackTo] = defaultYearRange(yearOptions)
  const from =
    selectedFrom !== null && yearOptions.includes(selectedFrom) ? selectedFrom : fallbackFrom
  const to = selectedTo !== null && yearOptions.includes(selectedTo) ? selectedTo : fallbackTo

  return from <= to ? [from, to] : [to, from]
}
