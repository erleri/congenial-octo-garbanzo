import { expect, it } from 'vitest'
import { dailyCoverageNotice } from '../dailyCoverage'
import { dataset } from './fixtures'

it('reports partial start months and missing cached periods based on actual rows', () => {
  expect(dailyCoverageNotice(dataset({ baseDate: '2026-09-09' }), 'BRL', '2026-09', '2026-09')).toContain('2026-09-01')
})

it('accepts a complete one-day period without requiring future dates', () => {
  const data = dataset({ baseDate: '2026-09-01', dailyRates: (['KRW', 'LOCAL_PER_USD'] as const).map(rateType => ({ currency: 'BRL', year: 2026, month: 9, day: 1, date: '2026-09-01', rateType, value: 5, status: 'ok', source: 'API', imputationMethod: 'NONE' })) })
  expect(dailyCoverageNotice(data, 'BRL', '2026-09', '2026-09')).toBeNull()
})
