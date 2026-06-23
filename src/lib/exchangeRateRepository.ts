import type {
  CurrencyCode,
  DailyRate,
  ExchangeRateDataset,
  FxDataSourceMode,
  FxDatasetMetadata,
  MonthlyRate,
} from '../types/exchangeRate'
import {
  loadDailyRatesFromCache,
  loadFxMetadataFromCache,
  loadMonthlyRatesFromCache,
  saveDailyRatesToCache,
  saveFxMetadataToCache,
  saveMonthlyRatesToCache,
} from './cache'
import { fetchStaticDataset } from './staticDataset'
import { isSupabaseConfigured, supabase } from './supabaseClient'

type DashboardRpcPayload = {
  baseDate: string
  fetchedAt: string
  dataVersion: string
  dailyRates: Array<Record<string, unknown>>
  monthlyRates: Array<Record<string, unknown>>
}

const PAGE_SIZE = 1000
const pendingDailyRequests = new Map<string, Promise<DailyRate[]>>()

export function getFxDataSourceMode(): FxDataSourceMode {
  const raw = import.meta.env.VITE_FX_DATA_SOURCE?.trim().toLowerCase()
  return raw === 'json' || raw === 'supabase' ? raw : 'auto'
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeDaily(row: Record<string, unknown>): DailyRate {
  const date = String(row.date ?? row.rate_date)
  const [year, month, day] = date.split('-').map(Number)
  return {
    currency: String(row.currency) as CurrencyCode,
    year,
    month,
    day,
    date,
    rateType: String(row.rateType ?? row.rate_type) as DailyRate['rateType'],
    value: numberOrNull(row.value ?? row.rate_value),
    status: String(row.status) as DailyRate['status'],
    source: String(row.source) as DailyRate['source'],
    imputationMethod: String(
      row.imputationMethod ?? row.imputation_method,
    ) as DailyRate['imputationMethod'],
  }
}

function normalizeMonthly(row: Record<string, unknown>): MonthlyRate {
  const period = String(row.periodMonth ?? row.period_month)
  const [year, month] = period.split('-').map(Number)
  return {
    currency: String(row.currency) as CurrencyCode,
    year,
    month,
    rateType: String(row.rateType ?? row.rate_type) as MonthlyRate['rateType'],
    value: numberOrNull(row.value ?? row.rate_value),
    status: String(row.status) as MonthlyRate['status'],
    source: String(row.source) as MonthlyRate['source'],
    imputationMethod: String(
      row.imputationMethod ?? row.imputation_method,
    ) as MonthlyRate['imputationMethod'],
  }
}

async function fetchMetadata(): Promise<FxDatasetMetadata> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }
  const { data, error } = await supabase
    .from('fx_dataset_state')
    .select('base_date,fetched_at,data_version,daily_row_count,monthly_row_count')
    .eq('dataset_key', 'primary')
    .eq('load_status', 'ready')
    .single()
  if (error) {
    throw error
  }
  return {
    baseDate: data.base_date,
    fetchedAt: data.fetched_at,
    dataVersion: data.data_version,
    dailyRowCount: data.daily_row_count,
    monthlyRowCount: data.monthly_row_count,
  }
}

async function fetchAllMonthlyRates(): Promise<MonthlyRate[]> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }
  const rows: MonthlyRate[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('fx_monthly_rates')
      .select('period_month,currency,rate_type,rate_value,status,source,imputation_method')
      .order('period_month')
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      throw error
    }
    rows.push(...(data ?? []).map((row) => normalizeMonthly(row)))
    if (!data || data.length < PAGE_SIZE) {
      break
    }
  }
  return rows
}

async function fetchDashboardSnapshot(): Promise<DashboardRpcPayload> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }
  const { data, error } = await supabase.rpc('get_fx_dashboard')
  if (error) {
    throw error
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Dashboard snapshot is empty.')
  }
  return data as DashboardRpcPayload
}

export async function loadSupabaseInitialDataset(): Promise<{
  dataset: ExchangeRateDataset
  metadata: FxDatasetMetadata
  stale: boolean
}> {
  const cachedMetadata = await loadFxMetadataFromCache()
  const cachedMonthly = await loadMonthlyRatesFromCache(cachedMetadata?.dataVersion)

  try {
    const [metadata, dashboard, monthlyRates] = await Promise.all([
      fetchMetadata(),
      fetchDashboardSnapshot(),
      fetchAllMonthlyRates(),
    ])
    const dataset: ExchangeRateDataset = {
      baseDate: dashboard.baseDate,
      fetchedAt: dashboard.fetchedAt,
      dailyRates: dashboard.dailyRates.map(normalizeDaily),
      monthlyRates,
      movingComparison: [],
    }
    void saveFxMetadataToCache(metadata)
    void saveMonthlyRatesToCache(metadata.dataVersion, monthlyRates)
    return { dataset, metadata, stale: false }
  } catch (error) {
    if (cachedMetadata && cachedMonthly) {
      const staticDataset = await fetchStaticDataset()
      if (staticDataset) {
        return {
          dataset: {
            ...staticDataset,
            monthlyRates: cachedMonthly,
          },
          metadata: cachedMetadata,
          stale: true,
        }
      }
    }
    throw error
  }
}

async function fetchDailyYear(
  metadata: FxDatasetMetadata,
  currency: CurrencyCode,
  year: number,
): Promise<DailyRate[]> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }
  const key = `${metadata.dataVersion}:${currency}:${year}`
  const pending = pendingDailyRequests.get(key)
  if (pending) {
    return pending
  }

  const request = (async () => {
    const baseYear = Number(metadata.baseDate.slice(0, 4))
    const cached = await loadDailyRatesFromCache(
      year === baseYear ? metadata.dataVersion : undefined,
      currency,
      year,
    )
    if (cached) {
      return cached
    }
    const { data, error } = await supabase
      .from('fx_daily_rates')
      .select('rate_date,currency,rate_type,rate_value,status,source,imputation_method')
      .eq('currency', currency)
      .gte('rate_date', `${year}-01-01`)
      .lte('rate_date', `${year}-12-31`)
      .order('rate_date')
      .limit(1000)
    if (error) {
      throw error
    }
    const rows = (data ?? []).map((row) => normalizeDaily(row))
    void saveDailyRatesToCache(metadata.dataVersion, currency, year, rows)
    return rows
  })().finally(() => pendingDailyRequests.delete(key))

  pendingDailyRequests.set(key, request)
  return request
}

export async function loadDailyYears(
  metadata: FxDatasetMetadata,
  currency: CurrencyCode,
  years: number[],
): Promise<DailyRate[]> {
  const chunks = await Promise.all(
    [...new Set(years)].sort((a, b) => a - b).map((year) =>
      fetchDailyYear(metadata, currency, year),
    ),
  )
  return chunks.flat()
}

export async function loadInitialExchangeDataset(): Promise<{
  dataset: ExchangeRateDataset
  source: 'supabase' | 'static'
  metadata: FxDatasetMetadata | null
  stale: boolean
}> {
  const mode = getFxDataSourceMode()
  if (mode === 'supabase' && !isSupabaseConfigured) {
    throw new Error('VITE_FX_DATA_SOURCE=supabase이지만 Supabase 연결 정보가 없습니다.')
  }
  if (mode !== 'json' && isSupabaseConfigured) {
    try {
      const result = await loadSupabaseInitialDataset()
      return { ...result, source: 'supabase' }
    } catch (error) {
      if (mode === 'supabase') {
        throw error
      }
    }
  }

  const dataset = await fetchStaticDataset()
  if (!dataset) {
    throw new Error('정적 환율 데이터를 불러오지 못했습니다.')
  }
  return { dataset, source: 'static', metadata: null, stale: false }
}
