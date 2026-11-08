import type { CurrencyReport, CurrencyReportSummary } from '../../src/types/currencyReport'
import type { ExchangeRateDataset } from '../../src/types/exchangeRate'
import type { EvidenceReview, EvidenceReviewSummary } from '../../src/types/evidenceReview'

export const root: string
export const publicDir: string
export const privateDir: string
export const reviewDir: string
export function readDataset(): Promise<ExchangeRateDataset>
export function fixtureReports(): Promise<CurrencyReport[]>
export function localReports(options?: {directory?:string;ledger?:string}): Promise<CurrencyReport[]>
export function summary(report: CurrencyReport): CurrencyReportSummary
export function saveReport(report: CurrencyReport, options?: {directory?:string;ledger?:string}): Promise<void>
export function projectPublicReport(report: CurrencyReport): CurrencyReport
export function projectReviewReport(report: CurrencyReport): CurrencyReport
export function localEvidenceReviews(): Promise<EvidenceReview[]>
export function evidenceReviewSummary(review: EvidenceReview): EvidenceReviewSummary
