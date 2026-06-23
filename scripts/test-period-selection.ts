import assert from 'node:assert/strict'
import {
  buildPeriodOptions,
  buildYearOptions,
  defaultPeriodRange,
  defaultYearRange,
  resolvePeriodRange,
  resolveYearRange,
} from '../src/lib/periodSelection'
import type { MonthlyRate } from '../src/types/exchangeRate'

const monthlyRates: MonthlyRate[] = []
for (let year = 2024; year <= 2026; year += 1) {
  for (let month = 1; month <= 12; month += 1) {
    monthlyRates.push({
      currency: 'BRL',
      year,
      month,
      rateType: 'LOCAL_PER_USD',
      value: 1,
      status: 'ok',
      source: 'API',
      imputationMethod: 'NONE',
    })
  }
}

const periods = buildPeriodOptions(monthlyRates, '2026-06-23')
assert.equal(periods.at(-1), '2026-06')
assert.equal(periods.includes('2026-07'), false)
assert.deepEqual(defaultPeriodRange(periods), ['2026-05', '2026-06'])
assert.deepEqual(
  resolvePeriodRange(periods, '2024-01', '2025-12'),
  ['2024-01', '2025-12'],
)

const years = buildYearOptions(periods)
assert.deepEqual(years, [2024, 2025, 2026])
assert.deepEqual(defaultYearRange(years), [2025, 2026])
assert.deepEqual(resolveYearRange(years, 2024, 2025), [2024, 2025])

console.log('Period selection tests passed.')
