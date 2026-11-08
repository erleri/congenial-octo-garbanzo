// Local planning decisions only. No network, keys, writing, or publication.
import { createHash } from 'node:crypto'
import { validDate } from './core.js'

export const DECISION_VERSION = 'generation-decision/2'
export const WINDOW_RULES = Object.freeze([
  { key: 'daily', observations: 1, floor: .75, percentile: .8, maximumSpanDays: 7 },
  { key: 'five', observations: 5, floor: 2, percentile: .8, maximumSpanDays: 14 },
  { key: 'twenty', observations: 20, floor: 4, percentile: .8, maximumSpanDays: 45 },
])
const percent = (a, b) => (a / b - 1) * 100
const days = (a, b) => (Date.parse(a) - Date.parse(b)) / 86400000
const timestamp = value => typeof value === 'string' && validDate(value.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function quantile(values, probability) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * probability
  const low = Math.floor(position)
  return sorted[low] + ((sorted[low + 1] ?? sorted[low]) - sorted[low]) * (position - low)
}

export function inspectMovements(dataset, currency, asOf) {
  if (!['BRL', 'CLP', 'MXN'].includes(currency) || !timestamp(asOf)) throw new Error('explicit_currency_and_asof_required')
  const date = asOf.slice(0, 10), rows = new Map(), conflicts = new Set()
  for (const row of dataset.dailyRates ?? []) {
    if (row.currency !== currency || row.rateType !== 'LOCAL_PER_USD' || !validDate(row.date) || row.date > date) continue
    const weekday = new Date(row.date + 'T00:00:00Z').getUTCDay()
    if (!weekday || weekday === 6 || row.status !== 'ok' || row.source === 'IMPUTED' || (row.imputationMethod && row.imputationMethod !== 'NONE') || !Number.isFinite(row.value) || row.value <= 0) continue
    if (rows.has(row.date) && rows.get(row.date).value !== row.value) conflicts.add(row.date)
    rows.set(row.date, row)
  }
  const series = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date))
  const current = series.at(-1), recentDates = series.slice(-81).map(r => r.date)
  const issues = [...conflicts].filter(d => recentDates.includes(d)).map(d => `conflicting_observation:${d}`)
  if (!current) issues.push('no_valid_observation')
  // Four calendar days is a data-delay flag, not an inferred holiday calendar.
  if (current && days(date, current.date) > 4) issues.push('price_data_delayed')
  const windows = WINDOW_RULES.map(rule => {
    const i = series.length - 1, k = rule.observations
    if (i < k) return { ...rule, status: 'unverified', reason: 'insufficient_window', changePct: null, candidate: false }
    const reference = series[i - k], selected = series.slice(i - k, i + 1)
    const changePct = percent(current.value, reference.value), direction = changePct > 0 ? 'local_weaker' : changePct < 0 ? 'local_stronger' : 'unchanged'
    const providers = new Set(selected.map(r => r.provider).filter(Boolean))
    if (issues.length || days(current.date, reference.date) > rule.maximumSpanDays || selected.some(r => r.holidayCarry === true || r.providerChanged === true) || providers.size > 1)
      return { ...rule, status: 'unverified', reason: issues[0] ?? 'window_gap_carry_or_provider_change', changePct, direction, candidate: false }
    const baseline = []
    for (let j = Math.max(k, i - 60); j < i; j++) {
      const observations = series.slice(j - k, j + 1)
      if (days(series[j].date, series[j - k].date) <= rule.maximumSpanDays && !observations.some(r => r.holidayCarry === true || r.providerChanged === true) && new Set(observations.map(r => r.provider).filter(Boolean)).size <= 1)
        baseline.push(Math.abs(percent(series[j].value, series[j - k].value)))
    }
    const complete = baseline.length === 60
    const threshold = Math.max(rule.floor, complete ? quantile(baseline, rule.percentile) : 0)
    const sharpThreshold = rule.key === 'daily' ? Math.max(1.5, complete ? quantile(baseline, .95) : 0) : null
    return { ...rule, status: complete ? 'verified' : 'unverified', reason: complete ? null : 'insufficient_baseline', changePct, direction,
      referenceDate: reference.date, observedDate: current.date, baselineCount: baseline.length, threshold,
      candidate: Math.abs(changePct) >= threshold, sharp: sharpThreshold !== null && Math.abs(changePct) >= sharpThreshold, sharpThreshold }
  })
  return { status: issues.length ? 'failed' : windows.some(w => w.status === 'unverified') ? 'partial' : 'available', observedDate: current?.date ?? null, issues, windows,
    limitations: ['가격 관측시각과 공급자 미기록은 추정하지 않습니다.', '휴장 이월값이 모두 식별된 것은 아닙니다.'], snapshotHash: hash(series.slice(-81).map(r => [r.date, r.value, r.provider ?? null])) }
}

export function eventBinding(event) {
  const { id, country, kind, period, revision, publishedAt, publishedDate, sourceUrl, bodyHash, summary } = event
  return hash({ id, country, kind, period, revision, publishedAt, publishedDate, sourceUrl, bodyHash, summary })
}
export function trialEventHistory(journal) {
  if (!Array.isArray(journal)) throw new Error('invalid_trial_history')
  return journal.filter(r=>['BRL','CLP','MXN'].includes(r.currency) && ['cost_unresolved','output_hold','cost_exceeded','schema_and_content_review_required'].includes(r.status))
    .flatMap(r=>(Array.isArray(r.events)?r.events:[]).filter(e=>typeof e.id==='string' && /^[a-f0-9]{64}$/.test(e.binding??''))
      .map(e=>({currency:r.currency,eventId:e.id,eventBinding:e.binding,status:r.status==='schema_and_content_review_required'||r.status==='cost_unresolved'?'pending_review':'failed'})))
}
function inspectEvent(event, currency, asOf, history) {
  if (!event || !/^[a-zA-Z0-9:_-]{1,120}$/.test(event.id ?? '') || /^sk-or-/i.test(event.id) || !['BRL', 'CLP', 'MXN', 'GLOBAL'].includes(event.country) || !['policy', 'inflation', 'consumption', 'employment', 'market', 'correction'].includes(event.kind) || typeof event.period !== 'string' || typeof event.revision !== 'string')
    return { id: 'invalid', status: 'data_failed', reason: 'invalid_event' }
  if (![currency, 'GLOBAL'].includes(event.country)) return null
  if (event.state === 'scheduled') return { id: event.id, status: 'scheduled', reason: 'release_not_confirmed' }
  if (event.state === 'failed') return { id: event.id, status: 'data_failed', reason: 'source_failed' }
  const timed = timestamp(event.publishedAt), dateOnly = validDate(event.publishedDate)
  if (!['published', 'original_pending'].includes(event.state) || (timed ? Date.parse(event.publishedAt) > Date.parse(asOf) : !dateOnly || event.publishedDate > asOf.slice(0, 10))) return { id: event.id, status: 'data_failed', reason: 'release_time_unverified_or_future' }
  if (event.state === 'original_pending') return { id: event.id, status: 'evidence_pending', reason: 'release_original_pending' }
  let url
  try { url = new URL(event.sourceUrl) } catch { return { id: event.id, status: 'data_failed', reason: 'invalid_source_url' } }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || /@|sk-or-|<|ignore previous/i.test(event.summary ?? '')) return { id: event.id, status: 'data_failed', reason: 'unsafe_source' }
  const binding = eventBinding(event), review = event.review
  if (history.some(h => h.currency === currency && h.eventId === event.id && h.eventBinding === binding && ['published', 'held', 'failed', 'pending_review'].includes(h.status)))
    return { id: event.id, binding, status: 'duplicate', reason: 'event_already_processed' }
  if (!review || review.binding !== binding || !timestamp(review.checkedAt) || Date.parse(review.checkedAt) > Date.parse(asOf)) return { id: event.id, binding, status: 'evidence_pending', reason: 'change_review_required' }
  if (review.novelty === 'none') return { id: event.id, binding, status: 'no_new_interpretation', reason: 'no_changed_explanation' }
  if (review.novelty !== 'new' || ![review.previousExplanation, review.newFact, review.readerChange].every(t => typeof t === 'string' && t.trim().length > 5))
    return { id: event.id, binding, status: 'evidence_pending', reason: 'incomplete_change_record' }
  if (event.country === 'GLOBAL' && review.currencyRelevance !== currency) return { id: event.id, binding, status: 'evidence_pending', reason: 'currency_link_unverified' }
  if (!review.originalVerified || !/^[a-f0-9]{64}$/.test(event.bodyHash ?? '') || review.bodyHash !== event.bodyHash || review.reuse !== 'verified')
    return { id: event.id, binding, status: 'evidence_pending', reason: 'original_or_reuse_unverified' }
  if (event.kind === 'correction') return { id: event.id, binding, status: 'correction_required', reason: 'existing_interpretation_changed' }
  if (!['policy_update', 'economic_update', 'fx_explanation'].includes(review.purpose) || (review.purpose === 'economic_update' && !['inflation', 'consumption', 'employment'].includes(event.kind)) || (review.purpose === 'fx_explanation' && (review.marketLinkVerified !== true || !timed)))
    return { id: event.id, binding, status: 'evidence_pending', reason: 'market_scope_unverified' }
  return { id: event.id, binding, status: 'draft_candidate', purpose: review.purpose, reason: 'new_explanation_reviewed' }
}

export function decideGeneration({ dataset, currency, asOf, events = [], history = [] }) {
  if (!Array.isArray(events) || !Array.isArray(history)) throw new Error('event_and_history_arrays_required')
  const price = inspectMovements(dataset, currency, asOf)
  const inspected = events.map(e => inspectEvent(e, currency, asOf, history)).filter(Boolean)
  const prior = history.filter(h => h.currency === currency && timestamp(h.checkedAt) && Date.parse(h.checkedAt) <= Date.parse(asOf) && h.price?.status === 'available').sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0]
  const priceSignals = price.windows.filter(w => w.candidate).map(w => {
    const previous = prior?.price?.windows?.find(p => p.key === w.key && p.candidate && p.direction === w.direction)
    const continuing = previous && days(price.observedDate, prior.price.observedDate) <= 4 && !(w.sharp && !previous.sharp)
    return { window: w.key, direction: w.direction, changePct: w.changePct, status: w.status, episode: continuing ? 'continuing' : 'new_or_escalated' }
  })
  const statuses = inspected.map(e => e.status)
  const status = statuses.includes('correction_required') ? 'correction_required'
    : statuses.includes('draft_candidate') ? 'draft_candidate'
    : statuses.includes('evidence_pending') ? 'evidence_pending'
    : priceSignals.some(s => s.episode === 'new_or_escalated') ? 'research_candidate'
    : price.status !== 'available' || statuses.includes('data_failed') ? 'data_failed'
    : statuses.includes('duplicate') || priceSignals.length ? 'duplicate' : 'no_new_interpretation'
  // Review eligibility is not AI authority, content approval, or publication.
  return { ruleVersion: DECISION_VERSION, currency, checkedAt: asOf, status, price, events: inspected, priceSignals,
    authorization: { paidCallAuthorized: false, publicationApproved: false },
    next: status === 'draft_candidate' ? 'Prepare bounded request; separate paid approval required.' : status === 'correction_required' ? 'Review affected published claims before generation.' : status === 'research_candidate' || status === 'evidence_pending' ? 'Verify original, novelty, reuse and explanation scope.' : 'Keep the prior report with its original date.' }
}
