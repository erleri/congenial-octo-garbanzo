import { validDate } from './core.js'

const SUPPORTED = ['BRL', 'MXN', 'CLP']
const REVIEWABLE_TIERS = new Set(['official_review', 'trusted_reporting_review', 'local_reporting_review'])

function observedRows(dataset, currency, baseDate) {
  const unique = new Map()
  for (const row of dataset.dailyRates ?? []) {
    if (row.currency !== currency || row.rateType !== 'LOCAL_PER_USD' || row.date > baseDate || !validDate(row.date)) continue
    const weekday = new Date(`${row.date}T00:00:00Z`).getUTCDay()
    if (!weekday || weekday === 6 || row.source === 'IMPUTED' || (row.imputationMethod && row.imputationMethod !== 'NONE')) continue
    if (typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value <= 0) continue
    unique.set(row.date, { date: row.date, value: row.value, ...(typeof row.observedAt === 'string' ? { observedAt: row.observedAt } : {}) })
  }
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function movement(dataset, currency, baseDate) {
  const rows = observedRows(dataset, currency, baseDate)
  const current = rows.at(-1)
  const previous = rows.at(-2)
  if (!current || !previous) throw new Error('insufficient_observations')
  const dailyPct = ((current.value - previous.value) / previous.value) * 100
  return {
    observedDate: current.date,
    previousObservedDate: previous.date,
    observationAt: current.observedAt ?? null,
    currentValue: current.value,
    previousValue: previous.value,
    dailyPct,
    absoluteDailyPct: Math.abs(dailyPct),
    direction: dailyPct > 0 ? 'local_weaker' : dailyPct < 0 ? 'local_stronger' : 'unchanged',
    baseDateHasObservation: current.date === baseDate,
  }
}

function reviewCandidate(candidate, baseDate, observationAt) {
  const blockers = []
  const publishedAt = typeof candidate.publishedAt === 'string' && Number.isFinite(Date.parse(candidate.publishedAt)) ? candidate.publishedAt : null
  if (!publishedAt || publishedAt.slice(0, 10) > baseDate) blockers.push('invalid_or_future_publication_time')
  if (!REVIEWABLE_TIERS.has(candidate.reviewTier)) blockers.push('domain_not_in_review_list')
  if (!observationAt) blockers.push('observation_time_missing')
  const happenedBeforeObservation = publishedAt && observationAt ? Date.parse(publishedAt) <= Date.parse(observationAt) : null
  if (happenedBeforeObservation === false) blockers.push('published_after_observation')
  blockers.push('direct_attribution_not_reviewed')
  const eligibleForContextReview = Boolean(publishedAt) && REVIEWABLE_TIERS.has(candidate.reviewTier)
  const eligibleForTriggerReview = eligibleForContextReview
    && candidate.reviewTier === 'trusted_reporting_review'
    && happenedBeforeObservation === true
    && !blockers.includes('invalid_or_future_publication_time')
  return {
    id: candidate.id,
    title: candidate.title,
    publisher: candidate.publisher,
    url: candidate.url,
    publishedAt,
    language: candidate.language ?? null,
    sourceCountry: candidate.sourceCountry ?? null,
    reviewTier: candidate.reviewTier,
    discoverySource: candidate.discoverySource ?? 'gdelt',
    metadataSummary: candidate.metadataSummary ?? null,
    publicationTimeBasis: candidate.publicationTimeBasis ?? null,
    candidateFocus: candidate.candidateFocus ?? null,
    happenedBeforeObservation,
    eligibleForContextReview,
    eligibleForTriggerReview,
    blockers,
    decision: null,
  }
}

export function buildEvidenceReview(discovery, dataset) {
  if (!discovery || !SUPPORTED.includes(discovery.currency) || !validDate(discovery.baseDate)) throw new Error('invalid_discovery_document')
  if (!Array.isArray(discovery.candidates) || !Array.isArray(discovery.officialReviewTargets)) throw new Error('invalid_discovery_document')
  const move = movement(dataset, discovery.currency, discovery.baseDate)
  const focusRank = { currency_move: 0, market_context: 1 }
  const tierRank = { trusted_reporting_review: 0, official_review: 1, local_reporting_review: 2, discovery_only: 3 }
  const candidates = discovery.candidates
    .map(candidate => reviewCandidate(candidate, discovery.baseDate, move.observationAt))
    .sort((a, b) => (focusRank[a.candidateFocus] ?? 2) - (focusRank[b.candidateFocus] ?? 2)
      || Number(b.eligibleForContextReview) - Number(a.eligibleForContextReview)
      || tierRank[a.reviewTier] - tierRank[b.reviewTier]
      || String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')))
  return {
    id: `${discovery.currency}-${discovery.baseDate}`,
    schemaVersion: 'evidence-review/1',
    currency: discovery.currency,
    baseDate: discovery.baseDate,
    preparedAt: new Date().toISOString(),
    movement: move,
    causalConclusion: 'unconfirmed',
    publicationBlocked: true,
    automaticEvidenceAdmission: false,
    candidates,
    officialReviewTargets: discovery.officialReviewTargets.map(source => ({
      id: source.id,
      publisher: source.publisher,
      kind: source.kind,
      url: source.url,
      reviewStatus: 'manual_verification_required',
      evidenceReady: false,
    })),
    requiredNextChecks: [
      '기사 원문이 해당 환율 움직임을 직접 설명하는지 확인',
      '발표·사건 시각과 환율 관측 시각의 선후 관계 확인',
      '공식 원문 또는 두 번째 독립 출처로 사건 사실 대조',
      '직접 원인과 일반적인 시장 배경을 구분해 기록',
    ],
  }
}
