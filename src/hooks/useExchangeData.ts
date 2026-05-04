import { useState, useEffect } from 'react'
import {
  fetchRemoteExchangeData,
  fetchRemoteExchangeDataWithExcel,
  fetchStaticDataset,
  loadDatasetFromCache,
  saveDatasetToCache,
  loadBusinessPlanFromCache,
  saveBusinessPlanToCache,
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
  DashboardFilters,
  ExchangeRateDataset,
  BusinessPlan,
  BusinessPlanStatus,
} from '../types/exchangeRate'

const INITIAL_BUSINESS_PLAN: BusinessPlan = { leading: {}, moving: {} }
const INITIAL_BUSINESS_PLAN_STATUS: BusinessPlanStatus = {
  configured: canUseRemoteBusinessPlan(),
  loading: false,
  saving: false,
  source: 'none',
  periodMonth: null,
  isAuthenticated: false,
  canEdit: false,
  userEmail: null,
  lastUpdatedAt: null,
  lastUpdatedBy: null,
  error: null,
}

const AUTO_REFRESH_TTL_MS = 12 * 60 * 60 * 1000

function datasetSortValue(data: ExchangeRateDataset): number {
  const baseDateTime = new Date(`${data.baseDate}T00:00:00Z`).getTime()
  const fetchedAtTime = new Date(data.fetchedAt).getTime()

  const safeBaseDateTime = Number.isFinite(baseDateTime) ? baseDateTime : 0
  const safeFetchedAtTime = Number.isFinite(fetchedAtTime) ? fetchedAtTime : 0

  return safeBaseDateTime * 10_000_000 + safeFetchedAtTime
}

function pickLatestDataset(
  first: ExchangeRateDataset | null,
  second: ExchangeRateDataset | null,
): ExchangeRateDataset | null {
  if (!first) {
    return second
  }

  if (!second) {
    return first
  }

  return datasetSortValue(second) > datasetSortValue(first) ? second : first
}

function isFreshEnough(data: ExchangeRateDataset): boolean {
  const fetchedAtTime = new Date(data.fetchedAt).getTime()
  const fetchedAtDate = new Date(data.fetchedAt).toLocaleDateString()
  const todayDate = new Date().toLocaleDateString()

  return (
    Number.isFinite(fetchedAtTime) &&
    Date.now() - fetchedAtTime < AUTO_REFRESH_TTL_MS &&
    fetchedAtDate === todayDate
  )
}

export function useExchangeData() {
  const [dataset, setDataset] = useState<ExchangeRateDataset | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [excelPriority, setExcelPriority] = useState(true)
  const [fillMissing, setFillMissing] = useState(true)
  const [businessPlan, setBusinessPlan] = useState<BusinessPlan>(INITIAL_BUSINESS_PLAN)
  const [businessPlanStatus, setBusinessPlanStatus] =
    useState<BusinessPlanStatus>(INITIAL_BUSINESS_PLAN_STATUS)
  const [businessPlanUserEmail, setBusinessPlanUserEmail] = useState<string | null>(null)

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

  const applyDataset = async (data: ExchangeRateDataset) => {
    setDataset(data)
    updateFiltersBasedOnDataset(data)

    const cacheSaved = await saveDatasetToCache(data)
    if (!cacheSaved) {
      setError('IndexedDB에 데이터를 저장하지 못했습니다. 화면 조회는 계속 가능합니다.')
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
      const msg =
        mergeError instanceof Error ? mergeError.message : '엑셀 병합 중 오류가 발생했습니다.'
      setError(msg)
      window.alert(`엑셀 업로드 중 오류가 발생했습니다: ${msg}`)
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
        error: 'Supabase 환경변수가 설정되지 않아 로컬 임시값을 사용합니다.',
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
      error: null,
    }))

    try {
      const [remotePlan, canEdit] = await Promise.all([
        loadBusinessPlanFromSupabase(periodMonth),
        loadBusinessPlanAdminAccess(userEmail),
      ])

      setBusinessPlan(remotePlan.plan)
      await saveBusinessPlanToCache(remotePlan.plan)
      setBusinessPlanStatus((prev) => ({
        ...prev,
        loading: false,
        source: 'supabase',
        canEdit,
        lastUpdatedAt: remotePlan.lastUpdatedAt,
        lastUpdatedBy: remotePlan.lastUpdatedBy,
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
        canEdit: false,
        error:
          remoteError instanceof Error
            ? remoteError.message
            : 'Supabase 계획 환율을 불러오지 못해 로컬 임시값을 사용합니다.',
      }))
    }
  }

  const updateBusinessPlan = async (newPlan: BusinessPlan) => {
    if (!dataset) {
      throw new Error('데이터가 아직 로드되지 않았습니다.')
    }

    if (!businessPlanStatus.canEdit || !businessPlanUserEmail || !businessPlanStatus.periodMonth) {
      throw new Error('계획 환율 저장 권한이 없습니다.')
    }

    setBusinessPlanStatus((prev) => ({ ...prev, saving: true, error: null }))

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
        lastUpdatedAt: saved.lastUpdatedAt,
        lastUpdatedBy: saved.lastUpdatedBy,
        error: null,
      }))
    } catch (saveError) {
      setBusinessPlanStatus((prev) => ({
        ...prev,
        saving: false,
        error: saveError instanceof Error ? saveError.message : '계획 환율 저장에 실패했습니다.',
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
      const staticPromise = fetchStaticDataset()

      const cachedPlan = await cachedPlanPromise
      if (cachedPlan && isMounted) {
        setBusinessPlan(cachedPlan)
      }

      const cached = await cachedPromise
      if (!isMounted) return

      if (cached) {
        setDataset(cached)
        updateFiltersBasedOnDataset(cached)
      }

      const staticDataset = await staticPromise
      if (!isMounted) return

      const latestLocalDataset = pickLatestDataset(cached, staticDataset)
      const staticDatasetIsNewer =
        staticDataset &&
        (!cached || datasetSortValue(staticDataset) > datasetSortValue(cached))

      if (staticDatasetIsNewer) {
        await applyDataset(staticDataset)
      }

      if (latestLocalDataset) {
        if (!isFreshEnough(latestLocalDataset)) {
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
    loading,
    error,
    excelFile,
    excelPriority,
    fillMissing,
    filters,
    setFilters,
    refreshData,
    uploadAndMergeExcel,
    businessPlan,
    updateBusinessPlan,
    businessPlanStatus,
    requestBusinessPlanAccess,
    signOutBusinessPlanAccess,
  }
}
