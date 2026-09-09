import type { DailyRate, ExchangeRateDataset, MonthlyRate } from '../../types/exchangeRate'

export function dailyRate(
  currency: DailyRate['currency'],
  date: string,
  value: number | null,
  rateType: DailyRate['rateType'] = 'LOCAL_PER_USD',
): DailyRate {
  const [year, month, day] = date.split('-').map(Number)
  return {
    currency,
    year,
    month,
    day,
    date,
    rateType,
    value,
    status: value === null ? 'empty' : 'ok',
    source: 'API',
    imputationMethod: 'NONE',
  }
}

export function monthlyRate(
  currency: MonthlyRate['currency'],
  year: number,
  month: number,
  value: number | null,
  rateType: MonthlyRate['rateType'] = 'LOCAL_PER_USD',
): MonthlyRate {
  return {
    currency,
    year,
    month,
    rateType,
    value,
    status: value === null ? 'empty' : 'ok',
    source: 'API',
    imputationMethod: 'NONE',
  }
}

export function dataset(overrides: Partial<ExchangeRateDataset> = {}): ExchangeRateDataset {
  return {
    baseDate: '2026-09-01',
    fetchedAt: '2026-09-01T00:00:00.000Z',
    dailyRates: [],
    monthlyRates: [],
    movingComparison: [],
    ...overrides,
  }
}
