import { readFile, stat } from 'node:fs/promises'
import { FULL_DATASET_PATH, STATIC_FALLBACK_PATH, writeDatasetFiles } from './dataset-files'
import type { ExchangeRateDataset } from '../src/types/exchangeRate'

const raw = await readFile(FULL_DATASET_PATH, 'utf8')
const source = JSON.parse(raw) as ExchangeRateDataset
const { fullDataset, staticFallback } = await writeDatasetFiles(source)
const fallbackSize = await stat(STATIC_FALLBACK_PATH)

console.log(`Full dataset: ${fullDataset.dailyRates.length} daily rows`)
console.log(`Static fallback: ${staticFallback.dailyRates.length} daily rows`)
console.log(`Static fallback bytes: ${fallbackSize.size}`)
