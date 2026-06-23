export const CURRENCIES = [
  'ARS',
  'BRL',
  'CLP',
  'COP',
  'GTQ',
  'MXN',
  'PYG',
  'PEN',
  'CNY',
  'UYU',
  'USD',
] as const

export interface BusinessPlan {
  leading: Partial<Record<(typeof CURRENCIES)[number], number>>
  moving: Partial<Record<(typeof CURRENCIES)[number], number>>
}

export type BusinessPlanType = keyof BusinessPlan

export type BusinessPlanRemoteLoadStatus = 'not_configured' | 'idle' | 'loading' | 'loaded' | 'failed'
export type BusinessPlanAdminAccessStatus = 'unknown' | 'checking' | 'allowed' | 'denied' | 'failed'
export type BusinessPlanSaveStatus = 'idle' | 'saving' | 'verified' | 'unverified' | 'failed'

export interface BusinessPlanStatus {
  configured: boolean
  loading: boolean
  saving: boolean
  source: 'supabase' | 'local' | 'none'
  remoteLoadStatus: BusinessPlanRemoteLoadStatus
  adminAccessStatus: BusinessPlanAdminAccessStatus
  lastSaveStatus: BusinessPlanSaveStatus
  periodMonth: string | null
  isAuthenticated: boolean
  canEdit: boolean
  userEmail: string | null
  lastUpdatedAt: string | null
  lastUpdatedBy: string | null
  lastVerifiedAt: string | null
  lastSaveMessage: string | null
  error: string | null
}

export type DatasetSource = 'remote' | 'static' | 'cache' | 'supabase' | 'excel' | 'none'

export const DATASET_SOURCE_LABELS: Record<DatasetSource, string> = {
  remote: '외부 API 최신 조회',
  static: '정적 배포 데이터',
  cache: '로컬 캐시',
  supabase: 'Supabase 운영 데이터',
  excel: '업로드 Excel 병합',
  none: '-',
}

export type CurrencyCode = (typeof CURRENCIES)[number]
export type CurrencyFilter = CurrencyCode | 'ALL'

export const YEARS = Array.from(
  { length: new Date().getFullYear() - 2010 + 1 },
  (_, idx) => 2010 + idx,
)
export const MONTHS = Array.from({ length: 12 }, (_, idx) => idx + 1)

export type RateType = 'LOCAL_PER_USD' | 'KRW' | 'MOVING_COMPARISON'

export type CellStatus = 'ok' | 'empty' | 'zero' | 'error'
export type DataSource = 'API' | 'EXCEL' | 'IMPUTED'
export type ImputationMethod = 'NONE' | 'FFILL' | 'LINEAR' | 'MONTHLY_FALLBACK'

export interface MonthlyRate {
  currency: CurrencyCode
  year: number
  month: number
  rateType: Extract<RateType, 'LOCAL_PER_USD' | 'KRW'>
  value: number | null
  status: CellStatus
  source: DataSource
  imputationMethod: ImputationMethod
}

export interface DailyRate {
  currency: CurrencyCode
  year: number
  month: number
  day: number
  date: string
  rateType: Extract<RateType, 'LOCAL_PER_USD' | 'KRW'>
  value: number | null
  status: CellStatus
  source: DataSource
  imputationMethod: ImputationMethod
}

export type MovingColumn =
  | 'KRW'
  | 'BRL'
  | 'COP'
  | 'CLP'
  | 'PEN'
  | 'ARS'
  | 'MXN'
  | 'PYG'
  | 'GTQ'
  | 'UYU'
  | 'CNY'
  | 'OIL'

export interface MovingComparisonRow {
  label: string
  values: Record<MovingColumn, number | null>
  isPercent: boolean
}

export interface RawSheet {
  name: string
  headers: string[]
  rows: Array<Record<string, string | number | null>>
}

export interface ExchangeRateDataset {
  baseDate: string
  fetchedAt: string
  monthlyRates: MonthlyRate[]
  dailyRates: DailyRate[]
  movingComparison: MovingComparisonRow[]
  rawSheets?: RawSheet[]
}

export type FxDataSourceMode = 'json' | 'supabase' | 'auto'

export interface FxDatasetMetadata {
  baseDate: string
  fetchedAt: string
  dataVersion: string
  dailyRowCount: number
  monthlyRowCount: number
}

export interface DailySeriesQuery {
  currency: CurrencyCode
  year: number
}

export interface DailySeriesResult extends DailySeriesQuery {
  rows: DailyRate[]
  source: 'supabase' | 'cache'
}

export interface RawSheetsDataset {
  rawSheets: RawSheet[]
}

export interface DashboardFilters {
  currency: CurrencyFilter
  year: number
  month: number
  rateType: RateType
}

export interface CurrencyFormatRule {
  minFractionDigits: number
  maxFractionDigits: number
}

export const CURRENCY_FORMAT_RULES: Record<CurrencyCode | 'KRW', CurrencyFormatRule> = {
  KRW: { minFractionDigits: 0, maxFractionDigits: 0 },
  CLP: { minFractionDigits: 0, maxFractionDigits: 1 },
  COP: { minFractionDigits: 0, maxFractionDigits: 1 },
  PYG: { minFractionDigits: 0, maxFractionDigits: 1 },
  BRL: { minFractionDigits: 2, maxFractionDigits: 4 },
  PEN: { minFractionDigits: 2, maxFractionDigits: 4 },
  MXN: { minFractionDigits: 2, maxFractionDigits: 4 },
  GTQ: { minFractionDigits: 2, maxFractionDigits: 4 },
  UYU: { minFractionDigits: 2, maxFractionDigits: 4 },
  CNY: { minFractionDigits: 2, maxFractionDigits: 4 },
  ARS: { minFractionDigits: 2, maxFractionDigits: 2 },
  USD: { minFractionDigits: 2, maxFractionDigits: 4 },
}
