export interface SourcePublicationTiming {
  relation: 'published_after_reference' | 'published_by_reference'
  referenceKind: 'aggregation_cutoff' | 'price_observation'
  referenceAt: string
  label: string
}
export function sourcePublicationTiming(evidence: unknown, report: unknown): SourcePublicationTiming | null
export function reportPriceSourceLabel(report: unknown): string | null
