// Question-led adapter orchestration, offline replay only. No env, filesystem,
// model, DB or implicit network access. Collected originals never become admissions.
import { planResearchNeeds } from './research-needs.js'
import { planChileRetailNeeds } from './chile-statistic-scopes.js'
import { planChileConsumptionNeeds } from './chile-consumption-scopes.js'
import { fingerprint } from './research-harness.js'
import { searchQuestion, collectOriginal, allowedResearchUrl, readPublicText } from './public-research-adapter.js'
import { CHILE_MONTHLY_SOURCES, discoverMonthlyPdfs, readMonthlyPdf } from './chile-monthly-originals.js'
import { createResearchReplayTransport } from './research-replay-transport.js'
import { researchTimeScope } from './research-time-scope.js'

export async function replayResearchCollection({ input, scopeProfile, period, responses = [], limits = {}, now = Date.now }) {
  if (!input || (scopeProfile !== undefined && !['clp-retail', 'clp-consumption'].includes(scopeProfile))
    || (!!scopeProfile !== !!period)) throw new Error('invalid_collection_profile')
  // Recompute from the input rather than accepting a caller-edited/stale plan.
  const frozen = structuredClone(input), before = fingerprint(frozen)
  const planner = scopeProfile === 'clp-retail' ? planChileRetailNeeds : scopeProfile === 'clp-consumption' ? planChileConsumptionNeeds : planResearchNeeds
  const plan = planner({ ...frozen, ...(period ? { period } : {}), priority: 'core_first' })
  const transport = createResearchReplayTransport(responses, limits, now)
  const { fetchImpl } = transport
  const outcomes = plan.questions.map(q => ({ needId: q.id, required: q.required, planningStatus: q.status,
    status: { define_scope: 'definition_required', review_inventory: 'inventory_review_required', review_conflict: 'conflict',
      reuse_for_content_review: 'stored_for_review', discover: 'deferred' }[q.action],
    reason: q.action === 'discover' ? 'query_budget' : q.reason,
    evidenceIds: [...new Set(q.requirements.flatMap(r => r.evidenceIds))], originalIds: [], collectionIssues: [] }))
  const originals = [], searches = [], official = new Map(), searched = new Map(), captured = new Map()
  const captureQueues = []
  let originalAttempts = 0
  const saveOriginal = (record, needId) => {
    if (!record.needIds.includes(needId)) record.needIds.push(needId)
    const out = outcomes.find(o => o.needId === needId)
    if (!out.originalIds.includes(record.id)) out.originalIds.push(record.id)
  }
  const captureRecord = (url, result) => {
    const record = { id: fingerprint({ url, kind: result.kind ?? 'article' }), url, needIds: [], ...result }
    originals.push(record)
    return record
  }
  for (const planned of plan.discoveryRequests) {
    // A core requirement may use the same registered series as a supplement.
    // Route only exact registered scope/period matches, not a guessed metric.
    const targets = planned.scopeConstraints.map(c => plan.statisticRegistry?.targets.find(t =>
      t.period === c.period && fingerprint(t.scope) === fingerprint(c.scope)))
    const request = targets.length && targets.every(Boolean) ? { ...planned, sourceTargets: targets,
      adapter: 'chile_official_monthly_pending_review', collectionPeriod: period } : planned
    const out = outcomes.find(o => o.needId === request.needId)
    if (request.adapter === 'chile_official_monthly_pending_review') {
      // Only registered targets are routed; never guess an arbitrary PDF URL.
      const sourceIds = [...new Set(request.sourceTargets.map(t => t.scope.metric === 'real_pay' ? 'cl-pay' : t.scope.metric === 'retail' ? 'cl-retail' : null))]
      out.status = 'not_found_in_attempt'; out.reason = 'official_index_no_match'
      for (const sourceId of sourceIds) {
        if (!sourceId) { out.collectionIssues.push('unsupported_statistic'); continue }
        const key = `${sourceId}:${request.collectionPeriod}`
        if (!official.has(key)) {
          const source = CHILE_MONTHLY_SOURCES.find(s => s.id === sourceId)
          const index = await readPublicText(source.url, { fetchImpl })
          const entry = { sourceId, period: request.collectionPeriod, indexUrl: source.url, records: [], issues: [], needIds: [] }
          official.set(key, entry)
          if (index.status !== 'ok') entry.issues.push(`index:${index.reason}`)
          else {
            entry.indexHash = fingerprint(index.text)
            const found = discoverMonthlyPdfs(index.text, sourceId, request.collectionPeriod)
            entry.discoveryStatus = found.status
            if (!found.candidates.length) entry.issues.push('not_found_in_index')
            captureQueues.push({ kind: 'official_pdf', entry, candidates: [...found.candidates] })
          }
        }
        const entry = official.get(key)
        entry.needIds.push(request.needId)
        out.collectionIssues.push(...entry.issues)
      }
    } else if (request.adapter === 'existing_question_search') {
      const timeScope=researchTimeScope(frozen.packet,request.questionId)
      const key = `${plan.currency}:${timeScope.anchorDate}:${request.questionId}`
      if (!searched.has(key)) {
        const result = await searchQuestion({ currency: plan.currency, baseDate: timeScope.anchorDate,startDate:timeScope.startDate,
          questionId: request.questionId, asOf: plan.asOf.slice(0, 10), fetchImpl })
        const row = { key, questionId: request.questionId, timeScope, needIds: [], ...result }
        searches.push(row); searched.set(key, row)
      }
      const result = searched.get(key)
      result.needIds.push(request.needId)
      out.status = result.status === 'no_candidates' ? 'not_found_in_attempt'
        : result.status === 'candidates_found' ? 'candidates_found' : 'collection_failed'
      out.reason = result.reason ?? result.status
      captureQueues.push({ kind: 'article', request, candidates: [...result.candidates] })
    } else { out.status = 'unsupported_adapter'; out.reason = 'adapter_not_connected' }
  }
  // One candidate per question per pass. Earlier broad queries cannot consume
  // every original slot; canonical URLs are fetched once and keep all need links.
  while (captureQueues.some(q => q.candidates.length)) {
    for (const queue of captureQueues) {
      const candidate = queue.candidates.shift()
      if (!candidate) continue
      if (queue.kind === 'official_pdf') {
        const { entry } = queue
        if (originalAttempts >= transport.limits.maxOriginals) {
          for (const needId of entry.needIds) outcomes.find(o => o.needId === needId).collectionIssues.push('original_limit')
          continue
        }
        originalAttempts++
        const { raw, ...result } = await readMonthlyPdf(candidate.url, entry.sourceId, { fetchImpl })
        const record = captureRecord(candidate.url, { kind: 'official_pdf', sourceId: entry.sourceId, period: entry.period,
          ...result, ...(raw ? { rawBase64: raw.toString('base64') } : {}) })
        entry.records.push(record)
        for (const needId of entry.needIds) saveOriginal(record, needId)
        continue
      }
      const out = outcomes.find(o => o.needId === queue.request.needId)
      let url
      try { url = allowedResearchUrl(candidate.url, plan.currency) } catch { out.collectionIssues.push('url_not_allowed'); continue }
      if (!captured.has(url)) {
        const stored = frozen.packet.evidence.find(e => e.url === url && e.sourceContext)
        if (stored) captured.set(url, captureRecord(url, { status: 'stored_original_pending_review', evidenceId: stored.id, originalVerified: false }))
        else {
          if (originalAttempts >= transport.limits.maxOriginals) { out.collectionIssues.push('original_limit'); continue }
          originalAttempts++
          const result = await collectOriginal({ candidate: { ...candidate, url }, currency: plan.currency, baseDate: plan.baseDate,
            timeScope:researchTimeScope(frozen.packet,queue.request.questionId),fetchImpl })
          captured.set(url, captureRecord(url, result))
        }
      }
      saveOriginal(captured.get(url), queue.request.needId)
    }
  }
  for (const out of outcomes) {
    const linked = originals.filter(r => out.originalIds.includes(r.id))
    if (linked.length) {
      const obtained = linked.filter(r => ['collected_pending_review', 'stored_original_pending_review'].includes(r.status))
      out.collectionIssues.push(...linked.filter(r => !obtained.includes(r)).map(r => r.reason ?? 'capture_failed'))
      out.status = obtained.length ? out.collectionIssues.length ? 'partial_pending_review' : 'originals_pending_review' : 'collection_failed'
      out.reason = obtained.length ? 'scope_time_and_meaning_not_approved' : 'original_capture_failed'
    } else if (out.collectionIssues.some(r => r !== 'not_found_in_index') && ['not_found_in_attempt', 'candidates_found'].includes(out.status)) {
      out.status = 'collection_failed'; out.reason = 'official_collection_incomplete'
    }
    out.collectionIssues = [...new Set(out.collectionIssues)]
  }
  if (fingerprint(frozen) !== before) throw new Error('collection_input_mutated')
  const readyForReview = o => ['stored_for_review', 'originals_pending_review', 'inventory_review_required'].includes(o.status)
  return { version: 'research-collection/1', mode: 'offline_replay', plan,
    collectionId: fingerprint({ planId: plan.planId, responses, limits: transport.limits }),
    status: outcomes.every(readyForReview) ? 'review_required' : 'incomplete', outcomes, searches,
    official: [...official.values()].map(({ records, ...entry }) => ({ ...entry, originalIds: records.map(r => r.id) })), originals,
    requests: transport.ledger, limits: transport.limits, ...transport.snapshot(), originalAttempts,
    writingEligibility: 'not_assessed', contentQuality: 'not_assessed', publicationApproved: false,
    limitation: 'Offline replay only. Original capture and metadata matching do not establish scope, chronology, semantic support or writing eligibility.' }
}
