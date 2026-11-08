import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  ALPHA_VANTAGE_HISTORY_CURRENCIES,
  fetchAlphaVantageFXDaily,
} from '../src/lib/api.ts'
import { fetchRemoteExchangeData } from '../src/lib/merger.ts'
import { FULL_DATASET_PATH, STATIC_FALLBACK_PATH, writeDatasetFiles } from './dataset-files.ts'
import type { FxPriceSource, DashboardReferenceRecovery } from '../src/types/exchangeRate'
import {retainDashboardReferences} from './dashboard-reference-archive'
import {verifyReferenceRecovery} from './dashboard-reference-recovery'

type RepoSupplementalCache = {
  fetchedAt: string
  rates: Record<string, Record<string, number>>
  priceSources?: Record<string, FxPriceSource>
}

type RepoBackfillCache = {
  generatedAt: string
  sourceWorkbook: string
  currencies: string[]
  ratesByDate: Record<string, Record<string, number>>
}

async function loadRepoSupplementalCache(cachePath: string): Promise<RepoSupplementalCache | null> {
  try {
    const raw = await readFile(cachePath, 'utf8')
    return JSON.parse(raw) as RepoSupplementalCache
  } catch {
    return null
  }
}

async function loadRepoBackfillCache(cachePath: string): Promise<RepoBackfillCache | null> {
  try {
    const raw = await readFile(cachePath, 'utf8')
    return JSON.parse(raw) as RepoBackfillCache
  } catch {
    return null
  }
}

async function main() {
  // A missing/corrupt prior full dataset must not silently reset adopted values.
  const previousDataset=JSON.parse(await readFile(FULL_DATASET_PATH,'utf8'))
  let recoveries:DashboardReferenceRecovery[]=[]
  try{
    const saved=JSON.parse(await readFile(resolve(process.cwd(),'data','reference-recoveries.json'),'utf8'))
    if(saved.version!=='dashboard-reference-recovery-set/1'||!Array.isArray(saved.recoveries))throw Error('invalid_reference_recovery_set')
    recoveries=saved.recoveries
    for(const receipt of recoveries)verifyReferenceRecovery(receipt)
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  const rawSheetsOutputPath = resolve(process.cwd(), 'public', 'raw-sheets.json')
  const supplementalOutputPath = resolve(process.cwd(), 'public', 'alpha-vantage-history.json')
  const supplementalCachePath = resolve(process.cwd(), 'data', 'alpha-vantage-history.json')
  const backfillCachePath = resolve(process.cwd(), 'data', 'fx-backfill-history.json')
  const rawSheetsRepoPath = resolve(process.cwd(), 'data', 'raw-sheets.json')
  const repoSupplementalCache = await loadRepoSupplementalCache(supplementalCachePath)
  const repoBackfillCache = await loadRepoBackfillCache(backfillCachePath)
  const supplementalRates = {
    ...(repoSupplementalCache?.rates ?? {}),
  }
  const supplementalPriceSources={...repoSupplementalCache?.priceSources}

  const missingCurrencies = ALPHA_VANTAGE_HISTORY_CURRENCIES.filter(
    (currency) => !supplementalRates[currency],
  )

  for (const currency of missingCurrencies) {
    const rates = await fetchAlphaVantageFXDaily(currency,source=>{supplementalPriceSources[currency]=source})
    if (rates) {
      supplementalRates[currency] = rates
    }
  }

  const incoming = await fetchRemoteExchangeData(new Date(), {
    supplementalHistoryByCurrency: supplementalRates,
    supplementalPriceSources,
    manualBackfillByDate: repoBackfillCache?.ratesByDate,
  })
  const {dataset,review}=retainDashboardReferences(incoming,previousDataset,new Date().toISOString(),recoveries)
  console.log(`Dashboard reference archive: ${JSON.stringify(review)}`)
  const rawSheets = dataset.rawSheets ?? []
  const coreDataset = { ...dataset }
  delete coreDataset.rawSheets

  await mkdir(dirname(rawSheetsOutputPath), { recursive: true })
  await mkdir(dirname(supplementalOutputPath), { recursive: true })
  await mkdir(dirname(supplementalCachePath), { recursive: true })
  await mkdir(dirname(rawSheetsRepoPath), { recursive: true })
  const { fullDataset, staticFallback } = await writeDatasetFiles(coreDataset)
  await writeFile(
    rawSheetsOutputPath,
    `${JSON.stringify({ rawSheets }, null, 2)}\n`,
    'utf8',
  )
  await writeFile(
    rawSheetsRepoPath,
    `${JSON.stringify({ rawSheets }, null, 2)}\n`,
    'utf8',
  )
  await writeFile(
    supplementalOutputPath,
    `${JSON.stringify({ fetchedAt: new Date().toISOString(), rates: supplementalRates, priceSources:supplementalPriceSources }, null, 2)}\n`,
    'utf8',
  )
  await writeFile(
    supplementalCachePath,
    `${JSON.stringify({ fetchedAt: new Date().toISOString(), rates: supplementalRates, priceSources:supplementalPriceSources }, null, 2)}\n`,
    'utf8',
  )

  console.log(`Generated ${FULL_DATASET_PATH}`)
  console.log(`Generated ${STATIC_FALLBACK_PATH}`)
  console.log(`Full daily rows: ${fullDataset.dailyRates.length}`)
  console.log(`Fallback daily rows: ${staticFallback.dailyRates.length}`)
  console.log(`Generated ${rawSheetsOutputPath}`)
  console.log(`Generated ${supplementalOutputPath}`)
  console.log(`Updated ${rawSheetsRepoPath}`)
  console.log(`Updated ${supplementalCachePath}`)
  console.log(`Base date: ${fullDataset.baseDate}`)
  console.log(`Fetched at: ${fullDataset.fetchedAt}`)

  if (repoBackfillCache?.ratesByDate) {
    const targetCurrencies = ['GTQ', 'PYG', 'UYU']
    const stats = targetCurrencies.map((currency) => {
      const count = coreDataset.dailyRates.filter(
        (row) => row.currency === currency && row.rateType === 'LOCAL_PER_USD' && row.value !== null,
      ).length

      return { currency, dailyNonNullCount: count }
    })

    console.log(`Loaded manual backfill from ${backfillCachePath}`)
    console.table(stats)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
