import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  ALPHA_VANTAGE_HISTORY_CURRENCIES,
  fetchAlphaVantageFXDaily,
} from '../src/lib/api.ts'
import { fetchRemoteExchangeData } from '../src/lib/merger.ts'

type RepoSupplementalCache = {
  fetchedAt: string
  rates: Record<string, Record<string, number>>
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
  const outputPath = resolve(process.cwd(), 'public', 'data.json')
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

  const missingCurrencies = ALPHA_VANTAGE_HISTORY_CURRENCIES.filter(
    (currency) => !supplementalRates[currency],
  )

  for (const currency of missingCurrencies) {
    const rates = await fetchAlphaVantageFXDaily(currency)
    if (rates) {
      supplementalRates[currency] = rates
    }
  }

  const dataset = await fetchRemoteExchangeData(new Date(), {
    supplementalHistoryByCurrency: supplementalRates,
    manualBackfillByDate: repoBackfillCache?.ratesByDate,
  })
  const rawSheets = dataset.rawSheets ?? []
  const coreDataset = { ...dataset }
  delete coreDataset.rawSheets

  await mkdir(dirname(outputPath), { recursive: true })
  await mkdir(dirname(rawSheetsOutputPath), { recursive: true })
  await mkdir(dirname(supplementalOutputPath), { recursive: true })
  await mkdir(dirname(supplementalCachePath), { recursive: true })
  await mkdir(dirname(rawSheetsRepoPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(coreDataset, null, 2)}\n`, 'utf8')
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
    `${JSON.stringify({ fetchedAt: new Date().toISOString(), rates: supplementalRates }, null, 2)}\n`,
    'utf8',
  )
  await writeFile(
    supplementalCachePath,
    `${JSON.stringify({ fetchedAt: new Date().toISOString(), rates: supplementalRates }, null, 2)}\n`,
    'utf8',
  )

  console.log(`Generated ${outputPath}`)
  console.log(`Generated ${rawSheetsOutputPath}`)
  console.log(`Generated ${supplementalOutputPath}`)
  console.log(`Updated ${rawSheetsRepoPath}`)
  console.log(`Updated ${supplementalCachePath}`)
  console.log(`Base date: ${coreDataset.baseDate}`)
  console.log(`Fetched at: ${coreDataset.fetchedAt}`)

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
