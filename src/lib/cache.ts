import type { ExchangeRateDataset, BusinessPlan } from '../types/exchangeRate'

const DB_NAME = 'LatamExchangeRateDB'
const STORE_NAME = 'ExchangeRateStore'
const AV_STORE_NAME = 'AlphaVantageStore'
const PLAN_STORE_NAME = 'BusinessPlanStore'
const CACHE_KEY = 'latest_dataset'
const AV_CACHE_KEY = 'supplemental_history'
const PLAN_CACHE_KEY = 'latest_business_plan'
const DB_VERSION = 3

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
    }

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result)
    }

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error)
    }
  })
}

export async function saveDatasetToCache(dataset: ExchangeRateDataset): Promise<boolean> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      
      // Store full dataset without truncating rawSheets or dailyRates
      const request = store.put(dataset, CACHE_KEY)

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
