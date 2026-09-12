import type { CurrencyCode } from './exchangeRate'

export type FxReportGenerationMode = 'deterministic' | 'ai_enhanced'
export type FxReportConfidence = 'high' | 'medium' | 'low'
export type FxReportRunStatus = 'pending_review' | 'published' | 'rejected' | 'superseded' | 'failed'
export type FxEditorialContextTag =
  | 'broad_usd'
  | 'local_factor_possible'
  | 'policy_possible'
  | 'commodity_possible'
  | 'risk_sentiment_possible'
  | 'insufficient_evidence'
export type FxEditorialScenarioTag =
  | 'direction_persistence'
  | 'volatility_range'
  | 'news_divergence'
  | 'plan_gap'
  | 'usd_krw_spillover'

export interface FxReportFact {
  id: string
  currency: CurrencyCode | 'USD/KRW'
  horizon: string
  value: number
  label: string
}

export interface FxReportNewsEvidence {
  id: string
  title: string
  source: string
  url: string
  publishedAt: string | null
  currencies: string[]
  summary: string
}

export interface FxReportMetric {
  currency: CurrencyCode | 'USD/KRW'
  latestDate: string
  latest: number
  dayPct: number | null
  fiveDayPct: number | null
  mtdPct: number | null
  thirtyDayPct: number | null
  percentile52w: number | null
  volatilityZ: number | null
  leadingPlanDeltaPct: number | null
  movingPlanDeltaPct: number | null
}

export interface FxReportEvidence {
  version: string
  baseDate: string
  generatedAt: string
  dataFetchedAt: string | null
  metrics: FxReportMetric[]
  facts: FxReportFact[]
  news: FxReportNewsEvidence[]
  confidence: FxReportConfidence
}

export interface FxReportStatement {
  currency: CurrencyCode | 'USD/KRW' | null
  text: string
  factIds: string[]
  evidenceIds: string[]
}

export interface FxReportContent {
  headline: string
  executiveSummary: string[]
  keyMoves: FxReportStatement[]
  planObservations: FxReportStatement[]
  scenarios: string[]
  confidence: FxReportConfidence
  limitations: string[]
}

export interface FxEditorialMoveSelection {
  currency: CurrencyCode | 'USD/KRW'
  factIds: string[]
  evidenceIds: string[]
  contextTag: FxEditorialContextTag
}

export interface FxEditorialDecision {
  leadFactIds: string[]
  keyMoves: FxEditorialMoveSelection[]
  planSelections: Array<{ factId: string }>
  scenarioTags: FxEditorialScenarioTag[]
  /** Administrator-only rationale. It is never rendered into the public report. */
  editorNote: string
}

export interface FxEditorialQualityScore {
  score: number
  passed: boolean
  threshold: 80
  breakdown: Partial<Record<'relevance' | 'grounding' | 'nonRepetition' | 'usefulness' | 'readability', number>>
  errors: string[]
}

export interface PublishedFxReport {
  baseDate: string
  runId: string
  schemaVersion: string
  generationMode: FxReportGenerationMode
  confidence: FxReportConfidence
  content: FxReportContent
  evidence: FxReportEvidence
  publishedAt: string
}

export interface FxReportValidation {
  valid: boolean
  errors: string[]
  aiValid?: boolean
  aiErrors?: string[]
  quality?: FxEditorialQualityScore
}

export interface FxReportRun {
  id: string
  baseDate: string
  attempt: number
  schemaVersion: string
  generationMode: FxReportGenerationMode
  publishMode: 'review' | 'automatic'
  status: FxReportRunStatus
  evidence: FxReportEvidence
  deterministicContent: FxReportContent
  aiCandidate: FxReportContent | null
  selectedContent: FxReportContent
  aiProvider: string | null
  aiModel: string | null
  validation: FxReportValidation
  errorMessage: string | null
  createdAt: string
  publishedAt: string | null
}

export interface FxReportReview {
  id: number
  runId: string
  decision: 'approved' | 'rejected'
  reason: string | null
  reviewedByEmail: string
  reviewedAt: string
}
