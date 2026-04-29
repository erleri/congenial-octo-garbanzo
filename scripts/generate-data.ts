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

async function loadRepoSupplementalCache(cachePath: string): Promise<RepoSupplementalCache | null> {
  try {
    const raw = await readFile(cachePath, 'utf8')
    return JSON.parse(raw) as RepoSupplementalCache
  } catch {
    return null
  }
}

async function main() {
  const outputPath = resolve(process.cwd(), 'public', 'data.json')
  const supplementalCachePath = resolve(process.cwd(), 'data', 'alpha-vantage-history.json')
  const repoSupplementalCache = await loadRepoSupplementalCache(supplementalCachePath)
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
  })

  await mkdir(dirname(outputPath), { recursive: true })
  await mkdir(dirname(supplementalCachePath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8')
  await writeFile(
    supplementalCachePath,
    `${JSON.stringify({ fetchedAt: new Date().toISOString(), rates: supplementalRates }, null, 2)}\n`,
    'utf8',
  )

  console.log(`Generated ${outputPath}`)
  console.log(`Updated ${supplementalCachePath}`)
  console.log(`Base date: ${dataset.baseDate}`)
  console.log(`Fetched at: ${dataset.fetchedAt}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})