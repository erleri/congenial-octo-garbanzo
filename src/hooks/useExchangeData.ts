import { useState, useEffect } from 'react'
import {
  fetchRemoteExchangeData,
  fetchRemoteExchangeDataWithExcel,
  fetchStaticDataset,
  loadDatasetFromCache,
  saveDatasetToCache,
} from '../lib'
import type { DashboardFilters, ExchangeRateDataset } from '../types/exchangeRate'

const AUTO_REFRESH_TTL_MS = 12 * 60 * 60 * 1000

export function useExchangeData() {
  const [dataset, setDataset] = useState<ExchangeRateDataset | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [excelPriority, setExcelPriority] = useState(true)
  const [fillMissing, setFillMissing] = useState(true)

  const [filters, setFilters] = useState<DashboardFilters>({
    currency: 'BRL',
    year: 2026,
    month: 4,
    rateType: 'LOCAL_PER_USD',
  })

  const updateFiltersBasedOnDataset = (data: ExchangeRateDataset) => {
    const latest = new Date(data.baseDate)
    setFilters((prev) => ({
      ...prev,
      year: latest.getFullYear(),
      month: latest.getMonth() + 1,
    }))
  }

  const applyDataset = async (data: ExchangeRateDataset) => {
    setDataset(data)
    updateFiltersBasedOnDataset(data)

    const cacheSaved = await saveDatasetToCache(data)
    if (!cacheSaved) {
      setError('IndexedDB에 데이터를 캐시하는 데 실패했습니다. 화면 조회는 계속 가능합니다.')
    }
  }

  const refreshData = async () => {
    try {
      setLoading(true)
      setError(null)
      const fetched = excelFile
        ? await fetchRemoteExchangeDataWithExcel(
            excelFile,
            { excelPriority, fillMissing },
            new Date(),
          )
        : await fetchRemoteExchangeData(new Date())

      await applyDataset(fetched)
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : '환율 데이터 조회 중 오류가 발생했습니다.',
      )
    } finally {
      setLoading(false)
    }
  }

  const uploadAndMergeExcel = async (
    file: File,
    options: { excelPriority: boolean; fillMissing: boolean },
  ) => {
    try {
      setLoading(true)
      setError(null)
      setExcelFile(file)
      setExcelPriority(options.excelPriority)
      setFillMissing(options.fillMissing)

      const merged = await fetchRemoteExchangeDataWithExcel(file, options, new Date())
      await applyDataset(merged)
      window.alert('엑셀 업로드가 완료되었습니다. 데이터가 병합되었습니다.')
    } catch (mergeError) {
      const msg = mergeError instanceof Error ? mergeError.message : '엑셀 병합 중 오류가 발생했습니다.'
      setError(msg)
      window.alert('엑셀 업로드 중 오류가 발생했습니다: ' + msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let isMounted = true

    const init = async () => {
      const cachedPromise = loadDatasetFromCache()
      const staticPromise = fetchStaticDataset()

      const cached = await cachedPromise

      if (!isMounted) return

      if (cached) {
        setDataset(cached)
        updateFiltersBasedOnDataset(cached)
      }

      const staticDataset = await staticPromise

      if (!isMounted) return

      if (staticDataset) {
        await applyDataset(staticDataset)
        return
      }

      if (cached) {
        const fetchedAt = new Date(cached.fetchedAt).getTime()
        const isFresh = Number.isFinite(fetchedAt) && Date.now() - fetchedAt < AUTO_REFRESH_TTL_MS

        if (!isFresh) {
          void refreshData()
        }

        return
      }

      await refreshData()
    }

    void init()

    return () => {
      isMounted = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    dataset,
    loading,
    error,
    excelFile,
    excelPriority,
    fillMissing,
    filters,
    setFilters,
    refreshData,
    uploadAndMergeExcel,
  }
}
