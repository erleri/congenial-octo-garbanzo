import type {
  BusinessPlan,
  CurrencyCode,
  DailyRate,
  ExchangeRateDataset,
  FxDatasetMetadata,
  MonthlyRate,
} from '../types/exchangeRate'

const DB_NAME = 'LatamExchangeRateDB'
const STORE_NAME = 'ExchangeRateStore'
const AV_STORE_NAME = 'AlphaVantageStore'
const PLAN_STORE_NAME = 'BusinessPlanStore'
const FX_QUERY_STORE_NAME = 'FxQueryStore'
const CACHE_KEY = 'latest_dataset'
const AV_CACHE_KEY = 'supplemental_history'
const PLAN_CACHE_KEY = 'latest_business_plan'
const DB_VERSION = 4

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
      if (!db.objectStoreNames.contains(AV_STORE_NAME)) {
        db.createObjectStore(AV_STORE_NAME)
      }
      if (!db.objectStoreNames.contains(PLAN_STORE_NAME)) {
        db.createObjectStore(PLAN_STORE_NAME)
      }
      if (!db.objectStoreNames.contains(FX_QUERY_STORE_NAME)) {
        db.createObjectStore(FX_QUERY_STORE_NAME)
      }
    }

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result)
    }

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error)
    }
  })
}

type CachedValue<T> = {
  dataVersion: string
  savedAt: string
  value: T
}

async function putQueryCache<T>(key: string, value: CachedValue<T>): Promise<boolean> {
  try {
    const db = await openDB()
    return await new Promise((resolve) => {
      const transaction = db.transaction(FX_QUERY_STORE_NAME, 'readwrite')
      const request = transaction.objectStore(FX_QUERY_STORE_NAME).put(value, key)
      request.onsuccess = () => resolve(true)
      request.onerror = () => resolve(false)
    })
  } catch {
    return false
  }
}

async function getQueryCache<T>(key: string): Promise<CachedValue<T> | null> {
  try {
    const db = await openDB()
    return await new Promise((resolve) => {
      const transaction = db.transaction(FX_QUERY_STORE_NAME, 'readonly')
      const request = transaction.objectStore(FX_QUERY_STORE_NAME).get(key)
      request.onsuccess = () => resolve((request.result as CachedValue<T> | undefined) ?? null)
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export function saveFxMetadataToCache(metadata: FxDatasetMetadata) {
  return putQueryCache('fx:metadata', {
    dataVersion: metadata.dataVersion,
    savedAt: new Date().toISOString(),
    value: metadata,
  })
}

export async function loadFxMetadataFromCache(): Promise<FxDatasetMetadata | null> {
  return (await getQueryCache<FxDatasetMetadata>('fx:metadata'))?.value ?? null
}

export function saveMonthlyRatesToCache(dataVersion: string, rows: MonthlyRate[]) {
  return putQueryCache('fx:monthly', {
    dataVersion,
    savedAt: new Date().toISOString(),
    value: rows,
  })
}

export async function loadMonthlyRatesFromCache(
  dataVersion?: string,
): Promise<MonthlyRate[] | null> {
  const cached = await getQueryCache<MonthlyRate[]>('fx:monthly')
  if (!cached || (dataVersion && cached.dataVersion !== dataVersion)) {
    return null
  }
  return cached.value
}

function dailyCacheKey(currency: CurrencyCode, year: number) {
  return `fx:daily:${currency}:${year}`
}

export function saveDailyRatesToCache(
  dataVersion: string,
  currency: CurrencyCode,
  year: number,
  rows: DailyRate[],
) {
  return putQueryCache(dailyCacheKey(currency, year), {
    dataVersion,
    savedAt: new Date().toISOString(),
    value: rows,
  })
}

export async function loadDailyRatesFromCache(
  dataVersion: string | undefined,
  currency: CurrencyCode,
  year: number,
): Promise<DailyRate[] | null> {
  const cached = await getQueryCache<DailyRate[]>(dailyCacheKey(currency, year))
  return cached && (!dataVersion || cached.dataVersion === dataVersion) ? cached.value : null
}

export async function saveDatasetToCache(dataset: ExchangeRateDataset): Promise<boolean> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)

      const cacheableDataset: ExchangeRateDataset = { ...dataset }
      delete cacheableDataset.rawSheets
      const request = store.put(cacheableDataset, CACHE_KEY)

      request.onsuccess = () => resolve(true)
      request.onerror = () => resolve(false)
    })
  } catch {
    return false
  }
}

export async function loadDatasetFromCache(): Promise<ExchangeRateDataset | null> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(CACHE_KEY)

      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result as ExchangeRateDataset)
        } else {
          resolve(null)
        }
      }
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export type AVSupplementalCache = {
  fetchedAt: string
  rates: Record<string, Record<string, number>>
}

export async function saveAVSupplementalCache(data: AVSupplementalCache): Promise<boolean> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const transaction = db.transaction(AV_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(AV_STORE_NAME)
      const request = store.put(data, AV_CACHE_KEY)
      request.onsuccess = () => resolve(true)
      request.onerror = () => resolve(false)
    })
  } catch {
    return false
  }
}

export async function loadAVSupplementalCache(): Promise<AVSupplementalCache | null> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const transaction = db.transaction(AV_STORE_NAME, 'readonly')
      const store = transaction.objectStore(AV_STORE_NAME)
      const request = store.get(AV_CACHE_KEY)
      request.onsuccess = () => {
        resolve(request.result ? (request.result as AVSupplementalCache) : null)
      }
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function saveBusinessPlanToCache(plan: BusinessPlan): Promise<boolean> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const transaction = db.transaction(PLAN_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(PLAN_STORE_NAME)
      const request = store.put(plan, PLAN_CACHE_KEY)
      request.onsuccess = () => resolve(true)
      request.onerror = () => resolve(false)
    })
  } catch {
    return false
  }
}

export async function loadBusinessPlanFromCache(): Promise<BusinessPlan | null> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const transaction = db.transaction(PLAN_STORE_NAME, 'readonly')
      const store = transaction.objectStore(PLAN_STORE_NAME)
      const request = store.get(PLAN_CACHE_KEY)
      request.onsuccess = () => {
        resolve(request.result ? (request.result as BusinessPlan) : null)
      }
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}
