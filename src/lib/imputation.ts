import type { ExchangeRateDataset, MonthlyRate } from '../types/exchangeRate'
import { addDays, parseDateParts, getStatus, average } from './utils'

export function applyForwardFillToDaily(
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

export function applyMonthlyFallbackFromDaily(
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
