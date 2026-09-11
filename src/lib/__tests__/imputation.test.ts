import { describe, expect, it } from 'vitest'
import { applyForwardFillToDaily, applyMonthlyFallbackFromDaily } from '../imputation'
import { dailyRate, monthlyRate } from './fixtures'

describe('exchange-rate imputation', () => {
  it('forward-fills missing calendar days and marks provenance', () => {
    const rows = [
      dailyRate('BRL', '2026-08-01', 5.1),
      dailyRate('BRL', '2026-08-03', 5.3),
    ]
    const filled = applyForwardFillToDaily(rows)
    const missingDay = filled.find((row) => row.date === '2026-08-02')

    expect(missingDay).toMatchObject({
      value: 5.1,
      source: 'IMPUTED',
      imputationMethod: 'FFILL',
    })
  })

  it('uses daily observations when a monthly value is missing', () => {
    const monthly = [monthlyRate('BRL', 2026, 8, null)]
    const daily = [
      dailyRate('BRL', '2026-08-01', 5),
      dailyRate('BRL', '2026-08-02', 6),
    ]
    const [result] = applyMonthlyFallbackFromDaily(monthly, daily)

    expect(result).toMatchObject({
      value: 5.5,
      source: 'IMPUTED',
      imputationMethod: 'MONTHLY_FALLBACK',
    })
  })
})
