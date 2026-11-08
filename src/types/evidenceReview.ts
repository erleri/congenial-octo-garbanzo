export type EvidenceReviewCurrency = 'BRL' | 'MXN' | 'CLP'
export interface EvidenceReviewSummary {
  id: string
  currency: EvidenceReviewCurrency
  baseDate: string
  causalConclusion: 'unconfirmed'
  publicationBlocked: boolean
  candidates: number
}
export interface EvidenceReviewCandidate {
  id: string
  title: string
  publisher: string
  url: string
  publishedAt: string | null
  language: string | null
  sourceCountry: string | null
  reviewTier: 'official_review' | 'trusted_reporting_review' | 'local_reporting_review' | 'discovery_only'
  discoverySource: 'gdelt' | 'openrouter_web_search' | 'local_public_sitemap'
  metadataSummary: string | null
  publicationTimeBasis: 'explicit_offset' | 'publisher_local_timezone' | null
  candidateFocus: 'currency_move' | 'market_context' | null
  happenedBeforeObservation: boolean | null
  eligibleForContextReview: boolean
  eligibleForTriggerReview: boolean
  blockers: string[]
  decision: null
}
export interface EvidenceReview {
  id: string
  schemaVersion: 'evidence-review/1'
  currency: EvidenceReviewCurrency
  baseDate: string
  preparedAt: string
  movement: {
    observedDate: string
    previousObservedDate: string
    observationAt: string | null
    currentValue: number
    previousValue: number
    dailyPct: number
    absoluteDailyPct: number
    direction: 'local_weaker' | 'local_stronger' | 'unchanged'
    baseDateHasObservation: boolean
  }
  causalConclusion: 'unconfirmed'
  publicationBlocked: boolean
  automaticEvidenceAdmission: false
  candidates: EvidenceReviewCandidate[]
  officialReviewTargets: { id: string; publisher: string; kind: string; url: string; reviewStatus: 'manual_verification_required'; evidenceReady: false }[]
  requiredNextChecks: string[]
}
