import type { ExchangeRateDataset } from '../types/exchangeRate'

export interface ManualBackfillDataset {
  generatedAt: string
  sourceWorkbook: string
  currencies: string[]
  ratesByDate: Record<string, Record<string, number>>
}

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

function isManualBackfillShape(value: unknown): value is ManualBackfillDataset {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<ManualBackfillDataset>
  return (
    typeof candidate.generatedAt === 'string' &&
    typeof candidate.sourceWorkbook === 'string' &&
    Array.isArray(candidate.currencies) &&
    candidate.currencies.every((item) => typeof item === 'string') &&
    !!candidate.ratesByDate &&
    typeof candidate.ratesByDate === 'object'
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

export async function fetchManualBackfillDataset(
  path = '/fx-backfill-history.json',
): Promise<ManualBackfillDataset | null> {
  try {
    const response = await fetch(path, { cache: 'no-store' })
    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as unknown
    return isManualBackfillShape(payload) ? payload : null
  } catch {
    return null
  }
}
