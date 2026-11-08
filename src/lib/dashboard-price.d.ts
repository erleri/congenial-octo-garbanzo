import type { CurrencyCode, DailyRate } from '../types/exchangeRate'
export function getDashboardDaily(rows: DailyRate[], currency: CurrencyCode, date: string): DailyRate | undefined
export function getDashboardPreviousDaily(rows: DailyRate[], currency: CurrencyCode, date: string): DailyRate | undefined
export function getDashboardDailyChange(current: DailyRate | undefined, previous: DailyRate | undefined): number | null
