import { describe, expect, it } from 'vitest'
import { buildEvidenceReview } from './evidence-review.js'

const dataset = {
  dailyRates: [
    { currency: 'CLP', rateType: 'LOCAL_PER_USD', date: '2026-09-10', value: 900, source: 'API' },
    { currency: 'CLP', rateType: 'LOCAL_PER_USD', date: '2026-09-11', value: 918, source: 'API', observedAt: '2026-09-11T20:00:00Z' },
  ],
}

const discovery = {
  currency: 'CLP', baseDate: '2026-09-11',
  candidates: [{ id: 'gdelt-reuters', title: 'Peso falls after an event', publisher: 'reuters.com', url: 'https://www.reuters.com/example', publishedAt: '2026-09-11T15:00:00Z', reviewTier: 'trusted_reporting_review' }],
  officialReviewTargets: [{ id: 'bcch', publisher: 'Banco Central de Chile', kind: 'monetary_policy', url: 'https://www.bcentral.cl/example' }],
}

describe('evidence review worksheet', () => {
  it('aligns movement, publication time and official checks without asserting a cause', () => {
    const result = buildEvidenceReview(discovery, dataset)
    expect(result.movement).toMatchObject({ dailyPct: 2, direction: 'local_weaker', observationAt: '2026-09-11T20:00:00Z' })
    expect(result).toMatchObject({ causalConclusion: 'unconfirmed', publicationBlocked: true, automaticEvidenceAdmission: false })
    expect(result.candidates[0]).toMatchObject({ happenedBeforeObservation: true, eligibleForContextReview: true, eligibleForTriggerReview: true, decision: null })
    expect(result.candidates[0].blockers).toContain('direct_attribution_not_reviewed')
    expect(result.officialReviewTargets[0]).toMatchObject({ evidenceReady: false, reviewStatus: 'manual_verification_required' })
  })

  it('blocks an unlisted source while retaining the known intraday ordering', () => {
    const unknown = { ...discovery, candidates: [{ ...discovery.candidates[0], reviewTier: 'discovery_only' }] }
    const candidate = buildEvidenceReview(unknown, dataset).candidates[0]
    expect(candidate).toMatchObject({ happenedBeforeObservation: true, eligibleForContextReview: false, eligibleForTriggerReview: false })
    expect(candidate.blockers).toContain('domain_not_in_review_list')
    expect(candidate.blockers).not.toContain('observation_time_missing')
  })

  it('does not infer event order when only the observation timestamp is missing', () => {
    const noTime = { dailyRates: dataset.dailyRates.map(row => ({ ...row, observedAt: undefined })) }
    const candidate = buildEvidenceReview(discovery, noTime).candidates[0]
    expect(candidate).toMatchObject({ happenedBeforeObservation: null, eligibleForContextReview: true, eligibleForTriggerReview: false })
    expect(candidate.blockers).toContain('observation_time_missing')
    expect(candidate.blockers).not.toContain('domain_not_in_review_list')
  })

  it('rejects malformed discovery documents instead of creating a worksheet', () => {
    expect(() => buildEvidenceReview({ ...discovery, candidates: undefined }, dataset)).toThrow('invalid_discovery_document')
  })

  it('shows direct local currency coverage before generic discovery candidates', () => {
    const mixed = { ...discovery, candidates: [
      { ...discovery.candidates[0], id: 'generic', reviewTier: 'discovery_only', discoverySource: 'gdelt' },
      { ...discovery.candidates[0], id: 'local-direct', title: 'Dólar sube tras corrección del cobre', reviewTier: 'local_reporting_review', discoverySource: 'local_public_sitemap', candidateFocus: 'currency_move' },
      { ...discovery.candidates[0], id: 'local-context', title: 'Producción de cobre', reviewTier: 'local_reporting_review', discoverySource: 'local_public_sitemap', candidateFocus: 'market_context' },
    ] }
    expect(buildEvidenceReview(mixed, dataset).candidates.map(candidate => candidate.id)).toEqual(['local-direct', 'local-context', 'generic'])
  })
})
