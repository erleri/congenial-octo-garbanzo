import type { ExchangeRateDataset } from '../types/exchangeRate'

const DB_NAME = 'LatamExchangeRateDB'
const STORE_NAME = 'ExchangeRateStore'
const CACHE_KEY = 'latest_dataset'
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
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
