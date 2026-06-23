import { useCallback, useEffect, useState } from 'react'
import {
  fetchManualBackfillDataset,
  fetchRemoteExchangeData,
  fetchRemoteExchangeDataWithExcel,
  fetchSupplementalHistoryDataset,
  loadDailyYears,
  loadInitialExchangeDataset,
  loadBusinessPlanFromCache,
  loadDatasetFromCache,
  saveAVSupplementalCache,
  saveBusinessPlanToCache,
  saveDatasetToCache,
} from '../lib'
import {
  canUseRemoteBusinessPlan,
  getBusinessPlanPeriodMonth,
  loadBusinessPlanAdminAccess,
  loadBusinessPlanFromSupabase,
  requestBusinessPlanLogin,
  saveBusinessPlanToSupabase,
  signOutBusinessPlanUser,
} from '../lib/businessPlanRemote'
import { supabase } from '../lib/supabaseClient'
import type {
  BusinessPlan,
  BusinessPlanStatus,
  DashboardFilters,
  DatasetSource,
  ExchangeRateDataset,
  FxDatasetMetadata,
} from '../types/exchangeRate'

const INITIAL_BUSINESS_PLAN: BusinessPlan = { leading: {}, moving: {} }
const INITIAL_BUSINESS_PLAN_STATUS: BusinessPlanStatus = {
  configured: canUseRemoteBusinessPlan(),
  loading: false,
  saving: false,
  source: 'none',
  remoteLoadStatus: canUseRemoteBusinessPlan() ? 'idle' : 'not_configured',
  adminAccessStatus: 'unknown',
  lastSaveStatus: 'idle',
  periodMonth: null,
  isAuthenticated: false,
  canEdit: false,
  userEmail: null,
  lastUpdatedAt: null,
  lastUpdatedBy: null,
  lastVerifiedAt: null,
  lastSaveMessage: null,
  error: null,
}

function mergeDailyRows(
  current: ExchangeRateDataset,
  incoming: ExchangeRateDataset['dailyRates'],
): ExchangeRateDataset {
  const rows = new Map(
    current.dailyRates.map((row) => [
      `${row.currency}|${row.rateType}|${row.date}`,
      row,
    ]),
  )

  for (const row of incoming) {
    rows.set(`${row.currency}|${row.rateType}|${row.date}`, row)
  }

  return {
    ...current,
    dailyRates: [...rows.values()].sort((a, b) =>
      a.date.localeCompare(b.date) ||
      a.currency.localeCompare(b.currency) ||
      a.rateType.localeCompare(b.rateType),
    ),
  }
}

export function useExchangeData() {
  const [dataset, setDataset] = useState<ExchangeRateDataset | null>(null)
  const [datasetSource, setDatasetSource] = useState<DatasetSource>('none')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [excelPriority, setExcelPriority] = useState(true)
  const [fillMissing, setFillMissing] = useState(true)
  const [businessPlan, setBusinessPlan] = useState<BusinessPlan>(INITIAL_BUSINESS_PLAN)
  const [businessPlanStatus, setBusinessPlanStatus] =
    useState<BusinessPlanStatus>(INITIAL_BUSINESS_PLAN_STATUS)
  const [businessPlanUserEmail, setBusinessPlanUserEmail] = useState<string | null>(null)
  const [fxMetadata, setFxMetadata] = useState<FxDatasetMetadata | null>(null)
  const [dailyRangeLoading, setDailyRangeLoading] = useState(false)

  const [filters, setFilters] = useState<DashboardFilters>({
    currency: 'BRL',
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    rateType: 'LOCAL_PER_USD',
  })

  const updateFiltersBasedOnDataset = (data: ExchangeRateDataset) => {
    const latest = new Date(data.baseDate)
    const latestVal = latest.getFullYear() * 100 + (latest.getMonth() + 1)

    setFilters((prev) => {
      const currentVal = prev.year * 100 + prev.month
      if (latestVal <= currentVal) {
        return prev
      }

      return {
        ...prev,
        year: latest.getFullYear(),
        month: latest.getMonth() + 1,
      }
    })
  }

  const applyDataset = async (data: ExchangeRateDataset, source: DatasetSource) => {
    setDataset(data)
    setDatasetSource(source)
    updateFiltersBasedOnDataset(data)

    const cacheSaved = await saveDatasetToCache(data)
    if (!cacheSaved) {
      setError('IndexedDB cache could not be saved. The current session still remains usable.')
    }
  }

  const ensureDailyRange = useCallback(async (
    currency: DashboardFilters['currency'],
    periodFrom: string,
    periodTo: string,
  ) => {
    if (!fxMetadata || currency === 'ALL' || !periodFrom || !periodTo) {
      return
    }

    const startYear = Number(periodFrom.slice(0, 4))
    const endYear = Number(periodTo.slice(0, 4))
    if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) {
      return
    }

    const fromYear = Math.min(startYear, endYear)
    const toYear = Math.max(startYear, endYear)
    const years = Array.from({ length: toYear - fromYear + 1 }, (_, index) => fromYear + index)

    try {
      setDailyRangeLoading(true)
      const rows = await loadDailyYears(fxMetadata, currency, years)
      setDataset((current) => current ? mergeDailyRows(current, rows) : current)

      const adjacentYears = [fromYear - 1, toYear + 1].filter(
        (year) => year >= 2009 && year <= new Date().getFullYear(),
      )
      void loadDailyYears(fxMetadata, currency, adjacentYears).then((prefetched) => {
        setDataset((current) => current ? mergeDailyRows(current, prefetched) : current)
      })
    } catch (rangeError) {
      setError(
        rangeError instanceof Error
          ? `선택 기간 데이터를 불러오지 못했습니다. ${rangeError.message}`
          : '선택 기간 데이터를 불러오지 못했습니다.',
      )
    } finally {
      setDailyRangeLoading(false)
    }
  }, [fxMetadata])

  const refreshData = async () => {
    try {
      setLoading(true)
      setError(null)
      const [manualBackfill, supplementalHistory] = await Promise.all([
        fetchManualBackfillDataset(),
        fetchSupplementalHistoryDataset(),
      ])

      if (supplementalHistory) {
        void saveAVSupplementalCache(supplementalHistory)
      }

      const fetched = excelFile
        ? await fetchRemoteExchangeDataWithExcel(
            excelFile,
            { excelPriority, fillMissing },
            new Date(),
            {
              supplementalHistoryByCurrency: supplementalHistory?.rates,
              manualBackfillByDate: manualBackfill?.ratesByDate,
            },
          )
        : await fetchRemoteExchangeData(new Date(), {
            supplementalHistoryByCurrency: supplementalHistory?.rates,
            manualBackfillByDate: manualBackfill?.ratesByDate,
          })

      await applyDataset(fetched, excelFile ? 'excel' : 'remote')
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : 'An error occurred while refreshing the exchange data.',
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

      const [manualBackfill, supplementalHistory] = await Promise.all([
        fetchManualBackfillDataset(),
        fetchSupplementalHistoryDataset(),
      ])

      if (supplementalHistory) {
        void saveAVSupplementalCache(supplementalHistory)
      }

      const merged = await fetchRemoteExchangeDataWithExcel(file, options, new Date(), {
        supplementalHistoryByCurrency: supplementalHistory?.rates,
        manualBackfillByDate: manualBackfill?.ratesByDate,
      })

      await applyDataset(merged, 'excel')

      return {
        type: 'success' as const,
        text: 'Excel 데이터를 로컬 임시 보기에 반영했습니다.',
      }
    } catch (mergeError) {
      const message =
        mergeError instanceof Error ? mergeError.message : 'An error occurred while merging Excel data.'
      setError(message)

      return {
        type: 'error' as const,
        text: `Excel upload failed: ${message}`,
      }
    } finally {
      setLoading(false)
    }
  }

  const loadRemoteBusinessPlan = async (
    data: ExchangeRateDataset,
    userEmail: string | null,
  ) => {
    const periodMonth = getBusinessPlanPeriodMonth(data.baseDate)

    if (!canUseRemoteBusinessPlan()) {
      setBusinessPlanStatus((prev) => ({
        ...prev,
        configured: false,
        periodMonth,
        isAuthenticated: Boolean(userEmail),
        userEmail,
        source: prev.source === 'none' ? 'local' : prev.source,
        remoteLoadStatus: 'not_configured',
        adminAccessStatus: 'unknown',
        lastSaveStatus: 'idle',
        lastVerifiedAt: null,
        lastSaveMessage: null,
        error: '운영 저장소 연결이 없어 로컬 임시 보기를 사용하고 있습니다.',
      }))
      return
    }

    setBusinessPlanStatus((prev) => ({
      ...prev,
      configured: true,
      loading: true,
      periodMonth,
      isAuthenticated: Boolean(userEmail),
      userEmail,
      remoteLoadStatus: 'loading',
      adminAccessStatus: userEmail ? 'checking' : 'unknown',
      error: null,
    }))

    try {
      const remotePlan = await loadBusinessPlanFromSupabase(periodMonth)
      let canEdit = false
      let adminAccessStatus: BusinessPlanStatus['adminAccessStatus'] = userEmail ? 'denied' : 'unknown'

      try {
        canEdit = await loadBusinessPlanAdminAccess(userEmail)
        adminAccessStatus = userEmail ? (canEdit ? 'allowed' : 'denied') : 'unknown'
      } catch {
        adminAccessStatus = 'failed'
      }

      setBusinessPlan(remotePlan.plan)
      await saveBusinessPlanToCache(remotePlan.plan)
      setBusinessPlanStatus((prev) => ({
        ...prev,
        loading: false,
        source: 'supabase',
        remoteLoadStatus: 'loaded',
        adminAccessStatus,
        canEdit,
        lastUpdatedAt: remotePlan.lastUpdatedAt,
        lastUpdatedBy: remotePlan.lastUpdatedBy,
        lastVerifiedAt: remotePlan.lastVerifiedAt,
        lastSaveStatus: prev.lastSaveStatus === 'saving' ? 'idle' : prev.lastSaveStatus,
        lastSaveMessage: null,
        error: null,
      }))
    } catch (remoteError) {
      const cachedPlan = await loadBusinessPlanFromCache()
      if (cachedPlan) {
        setBusinessPlan(cachedPlan)
      }

      setBusinessPlanStatus((prev) => ({
        ...prev,
        loading: false,
        source: cachedPlan ? 'local' : 'none',
        remoteLoadStatus: 'failed',
        adminAccessStatus: 'unknown',
        lastVerifiedAt: null,
        canEdit: false,
        error:
          remoteError instanceof Error
            ? remoteError.message
            : '운영 데이터를 불러오지 못해 로컬 임시 보기를 사용하고 있습니다.',
      }))
    }
  }

  const updateBusinessPlan = async (newPlan: BusinessPlan) => {
    if (!dataset) {
      throw new Error('Exchange data is not loaded yet.')
    }

    if (!businessPlanStatus.canEdit || !businessPlanUserEmail || !businessPlanStatus.periodMonth) {
      throw new Error('현재 계정에는 계획 환율 저장 권한이 없습니다.')
    }

    setBusinessPlanStatus((prev) => ({
      ...prev,
      saving: true,
      lastSaveStatus: 'saving',
      lastSaveMessage: null,
      error: null,
    }))

    try {
      const saved = await saveBusinessPlanToSupabase(
        businessPlanStatus.periodMonth,
        newPlan,
        businessPlanUserEmail,
      )
      setBusinessPlan(saved.plan)
      await saveBusinessPlanToCache(saved.plan)
      setBusinessPlanStatus((prev) => ({
        ...prev,
        saving: false,
        source: 'supabase',
        remoteLoadStatus: saved.verificationStatus === 'verified' ? 'loaded' : prev.remoteLoadStatus,
        lastSaveStatus: saved.verificationStatus,
        lastUpdatedAt: saved.lastUpdatedAt,
        lastUpdatedBy: saved.lastUpdatedBy,
        lastVerifiedAt: saved.lastVerifiedAt,
        lastSaveMessage:
          saved.verificationStatus === 'verified'
            ? '저장 후 운영 데이터로 다시 확인했습니다.'
            : `저장 요청은 완료됐지만 운영 데이터 확인은 실패했습니다.${saved.verificationMessage ? ` (${saved.verificationMessage})` : ''}`,
        error: null,
      }))

      return saved.verificationStatus === 'verified'
        ? {
            type: 'success' as const,
            text: '저장 후 운영 데이터로 다시 확인했습니다.',
          }
        : {
            type: 'warning' as const,
            text: `저장 요청은 완료됐지만 운영 데이터 확인은 실패했습니다.${saved.verificationMessage ? ` (${saved.verificationMessage})` : ''}`,
          }
    } catch (saveError) {
      setBusinessPlanStatus((prev) => ({
        ...prev,
        saving: false,
        lastSaveStatus: 'failed',
        lastSaveMessage:
          saveError instanceof Error ? saveError.message : '계획 환율 저장에 실패했습니다.',
        error:
          saveError instanceof Error ? saveError.message : '계획 환율 저장에 실패했습니다.',
      }))
      throw saveError
    }
  }

  const requestBusinessPlanAccess = async (email: string) => {
    await requestBusinessPlanLogin(email)
  }

  const signOutBusinessPlanAccess = async () => {
    await signOutBusinessPlanUser()
  }

  useEffect(() => {
    let isMounted = true

    const init = async () => {
      const cachedPlanPromise = loadBusinessPlanFromCache()
      const cachedPromise = loadDatasetFromCache()

      const cachedPlan = await cachedPlanPromise
      if (cachedPlan && isMounted) {
        setBusinessPlan(cachedPlan)
      }

      const cached = await cachedPromise
      if (!isMounted) {
        return
      }

      if (cached) {
        setDataset(cached)
        setDatasetSource('cache')
        updateFiltersBasedOnDataset(cached)
      }

      try {
        const initial = await loadInitialExchangeDataset()
        if (!isMounted) {
          return
        }
        setFxMetadata(initial.metadata)
        await applyDataset(initial.dataset, initial.source)
        if (initial.stale) {
          setError('Supabase 연결이 원활하지 않아 마지막 캐시 또는 JSON 데이터를 표시합니다.')
        }
      } catch (initialError) {
        if (cached) {
          setError('최신 데이터를 불러오지 못해 마지막 로컬 캐시를 표시합니다.')
          return
        }
        setError(
          initialError instanceof Error
            ? initialError.message
            : '환율 데이터를 불러오지 못했습니다.',
        )
      }
    }

    void init()

    return () => {
      isMounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!supabase) {
      return undefined
    }

    let isMounted = true

    void supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!isMounted) {
        return
      }

      setBusinessPlanUserEmail(sessionData.session?.user.email?.toLowerCase() ?? null)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setBusinessPlanUserEmail(session?.user.email?.toLowerCase() ?? null)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!dataset) {
      return
    }

    void loadRemoteBusinessPlan(dataset, businessPlanUserEmail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset?.baseDate, businessPlanUserEmail])

  return {
    dataset,
    datasetSource,
    loading,
    error,
    excelFile,
    excelPriority,
    fillMissing,
    dailyRangeLoading,
    fxMetadata,
    filters,
    setFilters,
    refreshData,
    ensureDailyRange,
    uploadAndMergeExcel,
    businessPlan,
    updateBusinessPlan,
    businessPlanStatus,
    requestBusinessPlanAccess,
    signOutBusinessPlanAccess,
  }
}
