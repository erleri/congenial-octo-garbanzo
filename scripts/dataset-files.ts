import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { DatasetCoverage, ExchangeRateDataset } from '../src/types/exchangeRate'

export const FULL_DATASET_PATH = resolve(process.cwd(), 'data', 'fx-full-history.json')
export const STATIC_FALLBACK_PATH = resolve(process.cwd(), 'public', 'data.json')
export const STATIC_DAILY_HISTORY_DAYS = 400

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

function periodMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

function minimum(values: string[], fallback: string): string {
  return values.length ? values.reduce((current, value) => value < current ? value : current) : fallback
}

function maximum(values: string[], fallback: string): string {
  return values.length ? values.reduce((current, value) => value > current ? value : current) : fallback
}

function coverageFor(
  dataset: ExchangeRateDataset,
  dailyRates: ExchangeRateDataset['dailyRates'],
  dataVersion: string,
  limitedDailyHistory: boolean,
): DatasetCoverage {
  const dailyDates = dailyRates.map((row) => row.date)
  const monthlyDates = dataset.monthlyRates.map((row) => periodMonth(row.year, row.month))
  const baseMonth = `${dataset.baseDate.slice(0, 7)}-01`

  return {
    dailyFrom: minimum(dailyDates, dataset.baseDate),
    dailyTo: maximum(dailyDates, dataset.baseDate),
    monthlyFrom: minimum(monthlyDates, baseMonth),
    monthlyTo: maximum(monthlyDates, baseMonth),
    limitedDailyHistory,
    dataVersion,
  }
}

export function buildDatasetFiles(dataset: ExchangeRateDataset): {
  fullDataset: ExchangeRateDataset
  staticFallback: ExchangeRateDataset
} {
  const datasetWithoutCoverage = { ...dataset }
  delete datasetWithoutCoverage.coverage
  const canonicalJson = JSON.stringify(datasetWithoutCoverage)
  const dataVersion = createHash('sha256').update(canonicalJson).digest('hex')
  const fallbackDailyFrom = addDays(dataset.baseDate, -(STATIC_DAILY_HISTORY_DAYS - 1))
  const fallbackDailyRates = dataset.dailyRates.filter((row) => row.date >= fallbackDailyFrom && row.date <= dataset.baseDate)

  const fullDataset: ExchangeRateDataset = {
    ...datasetWithoutCoverage,
    coverage: coverageFor(dataset, dataset.dailyRates, dataVersion, false),
  }
  const staticFallback: ExchangeRateDataset = {
    ...datasetWithoutCoverage,
    dailyRates: fallbackDailyRates,
    coverage: coverageFor(dataset, fallbackDailyRates, dataVersion, true),
  }

  return { fullDataset, staticFallback }
}

export async function writeDatasetFiles(dataset: ExchangeRateDataset) {
  const { fullDataset, staticFallback } = buildDatasetFiles(dataset)
  if (Buffer.byteLength(`${JSON.stringify(staticFallback, null, 2)}\n`, 'utf8') > 5_000_000) {
    throw new Error('Static fallback exceeds 5,000,000 bytes; no dataset files were written.')
  }
  await mkdir(dirname(FULL_DATASET_PATH), { recursive: true })
  await mkdir(dirname(STATIC_FALLBACK_PATH), { recursive: true })
  await Promise.all([
    writeFile(FULL_DATASET_PATH, `${JSON.stringify(fullDataset, null, 2)}\n`, 'utf8'),
    writeFile(STATIC_FALLBACK_PATH, `${JSON.stringify(staticFallback, null, 2)}\n`, 'utf8'),
  ])
  return { fullDataset, staticFallback }
}
