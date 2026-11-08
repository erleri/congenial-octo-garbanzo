export type ReportCurrency = 'BRL' | 'MXN' | 'CLP' | 'COP' | 'PEN' | 'ARS'
export interface ReportClaim {
  title: string
  text: string
  kind: 'fact' | 'interpretation' | 'mechanism'
  factIds: string[]
  evidenceIds: string[]
}
export interface ReportEvidence {
  id: string
  country: ReportCurrency | 'GLOBAL'
  title: string
  publisher: string
  url: string
  publishedAt: string
  eventDate: string
  period: string
  collectedAt: string
  summary: string
  eventAt?: string
  scope?: 'global' | 'country' | 'sales_context'
  role?: 'trigger' | 'context'
  causalStatus?: 'confirmed' | 'source_attributed' | 'contextual'
  provenance?: 'official' | 'market_reporting'
}
export interface CurrencyReportAssessment {
  movement: {
    observedDate: string
    previousObservedDate: string
    dailyPct: number
    absoluteDailyPct: number
    direction: 'local_weaker' | 'local_stronger' | 'unchanged'
    severity: 'calm' | 'notable' | 'sharp'
    baseline: {
      observations: number
      p80AbsoluteDailyPct: number | null
      p95AbsoluteDailyPct: number | null
      notableThreshold: number
      sharpThreshold: number
      percentile: number | null
    }
  }
  timeline: {
    evidenceId: string
    scope: 'global' | 'country' | 'sales_context'
    role: 'trigger' | 'context'
    causalStatus: 'confirmed' | 'source_attributed' | 'contextual'
    timingPrecision: 'timestamp' | 'date_only'
    happenedBeforeObservation: boolean | null
    triggerReady: boolean
  }[]
  evidenceByScope: { global: string[]; country: string[]; salesContext: string[] }
  timedTriggerEvidenceIds: string[]
  publishDecision: { eligible: boolean; reason: string }
  limitations: string[]
}
export interface CurrencyReportContent {
  title: string
  summary: string
  change: ReportClaim
  drivers: ReportClaim[]
  implications: ReportClaim[]
  watch: ReportClaim[]
  limitations: string[]
}
export interface CurrencyReport {
  presentationVersion?: 'monthly-facts/1'
  authorship?: 'ai_with_manual_edit'
  historicalReview?: boolean
  purpose?: 'fx_explanation' | 'economic_update' | 'periodic_check'
  testOnly?: boolean
  comparison?: { inputHash: string; label: string; model: string; costUsd: number | null; average: number | null; preferred: boolean; provisional: boolean; publicationBlocked: boolean; reviewNotes?: string[]; referenceOnly?: boolean; citationRevision?: boolean; editorialRevision?: boolean; rulesReviewOnly?: boolean; historicalReview?: boolean; datasetFetchedAt?: string }
  id: string
  schemaVersion: 'currency-report/1'
  currency: ReportCurrency
  baseDate: string
  observedDate: string
  observationAt?: string
  marketData?: { fetchedAt: string | null; source: 'API' | 'JSON' | 'EXCEL' | 'UNKNOWN'; rateType: 'LOCAL_PER_USD' }
  assemblyVersion?: 'currency-assembly/1'
  publishedAt: string | null
  generationMode: 'editorial_fixture' | 'ai_enhanced'
  status: 'sample' | 'draft' | 'pending_review' | 'approved' | 'rejected'
  content: CurrencyReportContent
  facts: { id: string; value: number; label: string }[]
  evidence: ReportEvidence[]
  assessment?: CurrencyReportAssessment
  series: { date: string; value: number }[]
  limitations: string[]
}
export type CurrencyReportSummary = Pick<CurrencyReport, 'id' | 'currency' | 'baseDate' | 'observedDate' | 'generationMode' | 'status' | 'comparison' | 'purpose' | 'testOnly' | 'historicalReview'> & {
  title: string; summary: string; publishedAt?: string | null
  // Only an explicit public correction classification may produce this label.
  revisionKind?: 'correction'
  reportKind?: 'movement' | 'periodic'
  stateVersion?: number
}
export interface ReportPeriod { year?: number; month?: number }
export interface ReportHistoryQuery extends ReportPeriod { currency: ReportCurrency; includeTest?: boolean; cursor?: string }
export interface ReportPage { items: CurrencyReportSummary[]; nextCursor: string | null }
export interface ReportResolution {
  state: 'active' | 'superseded' | 'withdrawn' | 'not_found'
  id?: string; currency?: ReportCurrency; baseDate?: string; version?: number
  publishedAt?: string; changedAt?: string; revisionKind?: string; reportKind?: string
  replacement?: { id: string; currency: ReportCurrency; baseDate: string } | null
  report?: CurrencyReport | null
}
export interface CurrencyReportProvider {
  list(): Promise<{ items: CurrencyReportSummary[]; cached: boolean; checkedAt?: number }>
  get(id: string): Promise<{ report: CurrencyReport; cached: boolean; checkedAt?: number }>
}
