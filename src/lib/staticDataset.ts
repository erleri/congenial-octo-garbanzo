import type { ExchangeRateDataset } from '../types/exchangeRate'

function isDatasetShape(value: unknown): value is ExchangeRateDataset {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<ExchangeRateDataset>
  return (
    typeof candidate.baseDate === 'string' &&
    typeof candidate.fetchedAt === 'string' &&
    Array.isArray(candidate.dailyRates) &&
    Array.isArray(candidate.monthlyRates) &&
    Array.isArray(candidate.movingComparison) &&
    Array.isArray(candidate.rawSheets)
  )
}

export async function fetchStaticDataset(path = '/data.json'): Promise<ExchangeRateDataset | null> {
  try {
    const response = await fetch(path, { cache: 'no-store' })
    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as unknown
    return isDatasetShape(payload) ? payload : null
  } catch {
    return null
  }
}