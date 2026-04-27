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

export type CurrencyCode = (typeof CURRENCIES)[number]
export type CurrencyFilter = CurrencyCode | 'ALL'

export const YEARS = Array.from({ length: 17 }, (_, idx) => 2010 + idx)
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
  ARS: { minFractionDigits: 2, maxFractionDigits: 4 },
  USD: { minFractionDigits: 2, maxFractionDigits: 4 },
}
