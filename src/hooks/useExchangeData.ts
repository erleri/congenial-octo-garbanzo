import { useCallback, useEffect, useRef, useState } from 'react'
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
  loadBusinessPlanHistoryFromSupabase,
  requestBusinessPlanLogin,
  saveBusinessPlanToSupabase,
  signOutBusinessPlanUser,
} from '../lib/businessPlanRemote'
import { supabase } from '../lib/supabaseClient'
import { validateExcelUpload } from '../lib/uploadValidation'
import { dailyCoverageNotice } from '../lib/dailyCoverage'
import type {
  BusinessPlan,
  BusinessPlanHistoryEntry,
  BusinessPlanHistoryStatus,
  BusinessPlanStatus,
  DashboardFilters,
  DatasetSource,
  ExchangeRateDataset,
  FxDatasetMetadata,
} from '../types/exchangeRate'

const INITIAL_BUSINESS_PLAN: BusinessPlan = { leading: {}, moving: {} }
const EMPTY_HISTORY: BusinessPlanHistoryStatus = {
  loading: false, loaded: false, hasMore: false, nextCursor: null, error: null,
}
const ADMIN_ACCESS_RECHECK_MS = 30_000
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
  const datasetRef = useRef<ExchangeRateDataset | null>(null)
  useEffect(() => { datasetRef.current = dataset }, [dataset])
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
  const planEpoch = useRef(0)
  const [authRevision, setAuthRevision] = useState(0)
  const [businessPlanHistory, setBusinessPlanHistory] = useState<BusinessPlanHistoryEntry[]>([])
  const [businessPlanHistoryStatus, setBusinessPlanHistoryStatus] = useState(EMPTY_HISTORY)

  const clearPlanAccess = useCallback(() => {
    planEpoch.current += 1
    setBusinessPlanHistory([])
    setBusinessPlanHistoryStatus(EMPTY_HISTORY)
    setBusinessPlanStatus((prev) => ({ ...prev, canEdit: false, saving: false, lastUpdatedBy: null }))
  }, [])

  const loadHistory = async (periodMonth: string, epoch: number, before: string | null = null) => {
    setBusinessPlanHistoryStatus((prev) => ({ ...prev, loading: true, error: null }))
    try {
      // Re-check active membership on every page, not just initial login.
      if (!await loadBusinessPlanAdminAccess(businessPlanUserEmail)) {
        if (epoch === planEpoch.current) clearPlanAccess()
        return
      }
      const page = await loadBusinessPlanHistoryFromSupabase(periodMonth, before)
      if (epoch !== planEpoch.current) return
      setBusinessPlanHistory((prev) => before
        ? [...new Map([...prev, ...page.entries].map((entry) => [entry.changeSetId, entry])).values()]
        : page.entries)
      setBusinessPlanHistoryStatus({ ...page, loaded: true, loading: false, error: null })
    } catch (historyError) {
      if (epoch !== planEpoch.current) return
      setBusinessPlanHistory([])
      setBusinessPlanHistoryStatus({ ...EMPTY_HISTORY, error: historyError instanceof Error ? historyError.message : '변경 이력을 불러오지 못했습니다.' })
    }
  }

  const loadMoreBusinessPlanHistory = async () => {
    if (!businessPlanStatus.canEdit || businessPlanHistoryStatus.loading || !businessPlanHistoryStatus.hasMore || !businessPlanStatus.periodMonth) return
    await loadHistory(businessPlanStatus.periodMonth, planEpoch.current, businessPlanHistoryStatus.nextCursor)
  }
  const [fxMetadata, setFxMetadata] = useState<FxDatasetMetadata | null>(null)
  const [dailyRangeLoading, setDailyRangeLoading] = useState(false)
  const [dailyRangeNotice, setDailyRangeNotice] = useState<string | null>(null)

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
    const activeDataset = datasetRef.current
    if (currency === 'ALL' || !periodFrom || !periodTo || !activeDataset) {
      return
    }
    if (!fxMetadata) {
      setDailyRangeNotice(dailyCoverageNotice(activeDataset, currency, periodFrom, periodTo))
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
      setDailyRangeNotice(dailyCoverageNotice(mergeDailyRows(activeDataset, rows), currency, periodFrom, periodTo))
      setDataset((current) => current ? mergeDailyRows(current, rows) : current)

      const adjacentYears = [fromYear - 1, toYear + 1].filter(
        (year) => year >= 2009 && year <= new Date().getFullYear(),
      )
      void loadDailyYears(fxMetadata, currency, adjacentYears).then((prefetched) => {
        setDataset((current) => current ? mergeDailyRows(current, prefetched) : current)
      }).catch(() => { /* Optional prefetch failure must not interrupt the selected range. */ })
    } catch (rangeError) {
      setDailyRangeNotice(dailyCoverageNotice(activeDataset, currency, periodFrom, periodTo))
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
      validateExcelUpload(file)
      setLoading(true)
      setError(null)

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
      setExcelFile(file)
      setExcelPriority(options.excelPriority)
      setFillMissing(options.fillMissing)

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
    clearPlanAccess()
    const epoch = planEpoch.current
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

      if (epoch !== planEpoch.current) return
      setBusinessPlan(remotePlan.plan)
      await saveBusinessPlanToCache(remotePlan.plan)
      if (epoch !== planEpoch.current) return
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
      if (canEdit) void loadHistory(periodMonth, epoch)
    } catch (remoteError) {
      const cachedPlan = await loadBusinessPlanFromCache()
      if (epoch !== planEpoch.current) return
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
    const epoch = planEpoch.current
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
      if (epoch !== planEpoch.current) throw new Error('로그인 상태가 변경되었습니다. 운영 값을 다시 확인해 주세요.')
      setBusinessPlan(saved.plan)
      await saveBusinessPlanToCache(saved.plan)
      if (epoch !== planEpoch.current) throw new Error('로그인 상태가 변경되었습니다.')
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

      void loadHistory(businessPlanStatus.periodMonth, epoch)
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
      if (epoch !== planEpoch.current) throw saveError
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
    clearPlanAccess()
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

    const sessionEpoch = planEpoch.current
    void supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!isMounted || sessionEpoch !== planEpoch.current) {
        return
      }

      setBusinessPlanUserEmail(sessionData.session?.user.email?.toLowerCase() ?? null)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      clearPlanAccess()
      setBusinessPlanUserEmail(session?.user.email?.toLowerCase() ?? null)
      setAuthRevision((revision) => revision + 1)
    })

    // Hide sensitive details while unattended; revalidate membership on return.
    const onBlur = () => clearPlanAccess()
    const onFocus = () => setAuthRevision((revision) => revision + 1)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)

    return () => {
      isMounted = false
      planEpoch.current += 1
      subscription.unsubscribe()
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [clearPlanAccess])

  useEffect(() => {
    if (!dataset) {
      return
    }

    void loadRemoteBusinessPlan(dataset, businessPlanUserEmail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset?.baseDate, businessPlanUserEmail, authRevision])

  useEffect(() => {
    if (!businessPlanStatus.canEdit || !businessPlanUserEmail) {
      return undefined
    }

    let cancelled = false
    const recheckAdminAccess = async () => {
      if (document.visibilityState !== 'visible') {
        return
      }

      try {
        const stillActive = await loadBusinessPlanAdminAccess(businessPlanUserEmail)
        if (!cancelled && !stillActive) {
          clearPlanAccess()
        }
      } catch {
        if (!cancelled) {
          clearPlanAccess()
        }
      }
    }

    const intervalId = window.setInterval(() => {
      void recheckAdminAccess()
    }, ADMIN_ACCESS_RECHECK_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [businessPlanStatus.canEdit, businessPlanUserEmail, clearPlanAccess])

  return {
    dataset,
    datasetSource,
    loading,
    error,
    excelFile,
    excelPriority,
    fillMissing,
    dailyRangeLoading,
    dailyRangeNotice,
    fxMetadata,
    filters,
    setFilters,
    refreshData,
    ensureDailyRange,
    uploadAndMergeExcel,
    businessPlan,
    updateBusinessPlan,
    businessPlanStatus,
    businessPlanHistory,
    businessPlanHistoryStatus,
    loadMoreBusinessPlanHistory,
    requestBusinessPlanAccess,
    signOutBusinessPlanAccess,
  }
}
