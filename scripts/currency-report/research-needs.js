// Pure, opt-in planning. No IO, environment access, model calls or publication.
import { fingerprint, researchPlan, inspectDossier, RESEARCH_CURRENCIES } from './research-harness.js'
import { projectEvidenceScopes } from './evidence-scope.js'
import { inspectSourceUses } from './source-use.js'
import {MAX_RESEARCH_PERIODS_PER_QUESTION} from './research-limits.js'
export {MAX_RESEARCH_PERIODS_PER_QUESTION} from './research-limits.js'

export const RESEARCH_NEEDS_VERSION = 'research-needs/1'
// Logical evidence coverage, independent of maxQueries and HTTP budgets. A
// calendar window must never lose weekdays merely because it includes a weekend.
const PURPOSES = ['fx_explanation', 'policy_update', 'economic_update']
const TOPICS = ['real_pay', 'retail', 'financing']
const DIMENSIONS = ['subject', 'metric', 'unit', 'comparison', 'channel', 'priceBasis', 'adjustment', 'baseYear']
const DAY = /^\d{4}-\d{2}-\d{2}$/
const date = s => typeof s === 'string' && DAY.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s
const timestamp = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s)) && date(s.slice(0, 10))
const period = s => typeof s === 'string' && (/^\d{4}-(0[1-9]|1[0-2])$/.test(s) || /^\d{4}-Q[1-4]$/.test(s) || date(s))
const periodStart = s => /^\d{4}-Q[1-4]$/.test(s) ? `${s.slice(0,4)}-${String((Number(s.at(-1))-1)*3+1).padStart(2,'0')}-01` : s.length===7 ? `${s}-01` : s
const text = s => typeof s === 'string' && !!s.trim() && s.length <= 480
const safe = v => !/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|bearer\s+\S+|-----BEGIN .*PRIVATE KEY|<[^>]+>|ignore\s+(previous|all)|system\s*prompt|지시.*무시/i.test(JSON.stringify(v))
const EXTRA = {
  consumption: { question: '같은 기간의 실제 소매 흐름은 어떠한가?', why: '보수 지표만으로 실제 소비를 설명하지 않기 위해 비교한다.' },
  category: { question: '관련 상품군은 전체 소매와 같은 흐름인가?', why: '전체 소매 흐름을 특정 내구재에 확대하지 않기 위해 비교한다.' },
  financing: { question: '관련 소비자신용의 구매 여건은 달라졌는가?', why: '정책금리와 실제 소비자 금융 여건을 구분한다.' },
}

function selectQuestions(legacy, purpose, topics) {
  const old = id => legacy.questions.find(q => q.id === id)
  const required = purpose === 'fx_explanation'
    ? legacy.questions.filter(q => q.required).map(q => ({ ...q, legacyQuestionId: q.id }))
    : purpose === 'policy_update'
      ? [
        { ...old('local'), id: 'policy_release', question: '실제 정책 결정은 이전 결정과 어떻게 다른가?', legacyQuestionId: 'local' },
        { ...old('counter'), id: 'policy_scope', question: '발표 내용의 적용 조건과 반대 근거는 무엇인가?', legacyQuestionId: 'counter' },
      ]
      : [
        { ...old('consumer'), id: 'economic_release', question: '확인된 발표의 수치·대상 기간·비교 기준은 무엇인가?', legacyQuestionId: 'consumer', required: true },
        { ...old('consumer'), id: 'economic_scope', question: '지표의 모집단·품목·채널과 설명 범위는 무엇인가?', legacyQuestionId: 'consumer', required: true },
      ]
  const requested = [topics.includes('real_pay') && 'consumption', topics.includes('retail') && 'category', topics.includes('financing') && 'financing'].filter(Boolean)
  const maximum = purpose === 'fx_explanation' ? 1 : 2
  return {
    questions: [...required, ...requested.slice(0, maximum).map(id => ({ ...old('consumer'), id,
      question: EXTRA[id].question, why: EXTRA[id].why, legacyQuestionId: 'consumer', required: false }))],
    deferred: requested.slice(maximum).map(id => ({ id, reason: 'supplement_limit' })),
  }
}

function validateRequirements(requirements, ids) {
  if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements) || !safe(requirements)) throw new Error('invalid_requirements')
  for (const [questionId, rows] of Object.entries(requirements)) {
    if (!ids.includes(questionId) || !Array.isArray(rows) || rows.length > MAX_RESEARCH_PERIODS_PER_QUESTION || new Set(rows.map(r => r?.id)).size !== rows.length)
      throw new Error('invalid_requirements')
    for (const r of rows) {
      if (!/^[a-z][a-z0-9_-]{0,79}$/.test(r?.id) || !period(r.period) || !r.scope || typeof r.scope !== 'object' || Array.isArray(r.scope)
        || !DIMENSIONS.slice(0, 4).every(k => text(r.scope[k]))
        || Object.entries(r.scope).some(([k,v]) => !DIMENSIONS.includes(k) || !text(v))) throw new Error('invalid_requirements')
      // Statistics cannot silently match unknown nominal/real or online/all scopes.
      if (EXTRA[questionId] && !DIMENSIONS.every(k => text(r.scope[k]) && !/unknown|unverified|not_provided|to_verify|unresolved/i.test(r.scope[k]))) throw new Error('statistical_dimensions_required')
    }
    if (rows.length && questionId === 'consumption' && (rows.length !== 2 || !['real_pay','retail'].every(metric => rows.some(r => r.scope.metric === metric))))
      throw new Error('consumption_baseline_and_retail_required')
    if (rows.length && questionId === 'category' && (rows.length !== 2 || rows.some(r => r.scope.metric !== 'retail') || rows[0].scope.subject === rows[1].scope.subject))
      throw new Error('total_and_category_required')
    if (rows.length && ['consumption','category'].includes(questionId)) {
      const keys = questionId === 'category' ? DIMENSIONS.filter(k => k !== 'subject') : ['unit','comparison']
      if (rows.some(r => r.period !== rows[0].period || keys.some(k => r.scope[k] !== rows[0].scope[k]))) throw new Error('comparison_targets_mismatch')
    }
  }
}

export function researchSourceTimeIssue(e, asOf) {
  if (!date(e.publishedAt) && !timestamp(e.publishedAt)) return 'publication_unverified'
  // A day-only publication on the cutoff day does not prove intraday availability.
  if (date(e.publishedAt) && e.publishedAt === asOf.slice(0, 10)) return 'publication_time_unverified'
  if (Date.parse(e.publishedAt) > Date.parse(asOf)) return 'after_cutoff'
  if (e.modifiedAt && (!timestamp(e.modifiedAt) || Date.parse(e.modifiedAt) > Date.parse(asOf))) return 'historical_version_unverified'
  if (e.sourceContext?.sourceVersion !== 'archived_original'
    && (!timestamp(e.collectedAt) || Date.parse(e.collectedAt) > Date.parse(asOf))) return 'historical_version_unverified'
  return null
}

function sourceState(e, asOf, sourceUses) {
  const temporal=researchSourceTimeIssue(e,asOf)
  if(temporal) return temporal
  if(sourceUses) {
    const use=sourceUses.items.find(i=>i.resourceId===e.id).uses.external_model
    return use.status==='allowed'?null:use.reason
  }
  return e.review?.reuse==='verified'?null:'terms_unverified'
}

function inspectRequirement(packet, requirement, asOf, sourceUses) {
  const candidates = [], available = [], unclassifiedEvidenceIds = []
  for (const evidence of packet.evidence) {
    const rawCards = (packet.evidenceScopeCards ?? []).filter(c => c.evidenceId === evidence.id)
    if (!rawCards.length && evidence.country === packet.currency && evidence.period === requirement.period) unclassifiedEvidenceIds.push(evidence.id)
    if (!rawCards.some(c => c.scope?.metric === requirement.scope.metric)) continue
    let card, reason
    try {
      if (rawCards.length !== 1) throw new Error('ambiguous_scope')
      card = projectEvidenceScopes(packet, rawCards, { required: true })[0]
    } catch { reason = 'scope_review_unverified' }
    if (!reason && evidence.country !== packet.currency) reason = 'country_mismatch'
    if (!reason && card.period !== requirement.period) reason = 'period_mismatch'
    if (!reason && Object.entries(requirement.scope).some(([key,value]) => card.scope[key] !== value)) reason = 'scope_mismatch'
    if (!reason) reason = sourceState(evidence, asOf, sourceUses)
    candidates.push({ evidenceId: evidence.id, reason: reason ?? 'reviewed_scope_match' })
    if (!reason) available.push(evidence.id)
  }
  // Multiple records are not votes. Different releases/definitions need adjudication.
  const uniqueBodies = new Set(available.map(id => packet.evidence.find(e => e.id === id).sourceContext.bodyHash))
  const status = uniqueBodies.size > 1 ? 'conflict' : available.length ? 'available' : 'review_pending'
  return { id: requirement.id, period: requirement.period, scope: structuredClone(requirement.scope), status,
    evidenceIds: available, candidates, unclassifiedEvidenceIds, reason: status === 'conflict' ? 'multiple_versions_require_review' : available.length ? 'reviewed_scope_match'
      : candidates.length ? 'candidate_not_usable' : 'not_in_verified_inventory' }
}

/** Requirements are explicit, reviewer-selected scopes, not inferred from titles.
 * Matching proves metadata compatibility only. It never grants semantic, writing,
 * novelty or publication approval. Old reports without scope cards stay pending.
 * Input: { packet, purpose, asOf, topics, requirements, dossier?, attempts?, maxQueries? }
 * asOf is the report cutoff (with timezone), NOT the date of a later replay.
 * requirements[questionId] = [{ id, period, scope: { subject, metric, unit,
 * comparison, channel, priceBasis, adjustment, baseYear } }]. Core requirements
 * need the first four scope fields; statistical comparisons need all eight.
 * Topics are explicit reviewer interests, not facts inferred from prose:
 * real_pay -> consumption; retail -> category; financing -> financing.
 * Requests are an adapter handoff only. No existing live runner is reconfigured.
 */
export function planResearchNeeds({ packet, purpose, asOf, topics = [], requirements = {}, dossier, attempts = [], maxQueries = 4, priority = 'supplement_first', sourceUse }) {
  if (!packet || !RESEARCH_CURRENCIES.includes(packet.currency) || !date(packet.baseDate) || !timestamp(asOf)
    || packet.baseDate !== asOf.slice(0, 10) || !PURPOSES.includes(purpose)
    || (packet.purpose && packet.purpose !== purpose) || !Array.isArray(topics) || topics.some(t => !TOPICS.includes(t))
    || new Set(topics).size !== topics.length || !Number.isInteger(maxQueries) || maxQueries < 0 || maxQueries > 4
    || !['supplement_first', 'core_first'].includes(priority)
    || !Array.isArray(packet.evidence) || packet.evidence.length > 60 || new Set(packet.evidence.map(e => e?.id)).size !== packet.evidence.length
    || packet.evidence.some(e => !e || !text(e.id)) || !safe(packet)
    || (packet.evidenceScopeCards !== undefined && (!Array.isArray(packet.evidenceScopeCards) || packet.evidenceScopeCards.some(c => !c))))
    throw new Error('invalid_research_needs_input')
  const legacy = researchPlan(packet), selection = selectQuestions(legacy, purpose, topics)
  // Opt-in explicit scope records can supersede an old coarse reuse flag for
  // planning only. The evidence, old flag and scope bindings are never rewritten.
  const sourceUses=sourceUse===undefined?null:inspectSourceUses({resources:packet.evidence,reviews:sourceUse?.reviews,evaluatedOn:sourceUse?.evaluatedOn})
  const ids = selection.questions.map(q => q.id)
  validateRequirements(requirements, ids)
  if (Object.values(requirements).flat().some(r => periodStart(r.period) > packet.baseDate)) throw new Error('future_target_period')
  if (!Array.isArray(attempts) || attempts.length > 24 || !safe(attempts) || attempts.some(a => !ids.includes(a?.questionId)
    || !['access_failed','extraction_failed','not_found_in_attempt','not_yet_released','no_matching_series'].includes(a.status))) throw new Error('invalid_attempts')
  let coverage = null
  if (dossier) coverage = inspectDossier(packet, dossier) // Existing hash/scope contract, fail closed.
  const questions = selection.questions.map(q => {
    const checked = (requirements[q.id] ?? []).map(r => inspectRequirement(packet, r, asOf, sourceUses))
    const old = coverage?.questions.find(c => c.id === q.id)
    const unresolved = checked.filter(r => r.status !== 'available')
    const inventoryNeedsReview = unresolved.some(r => r.unclassifiedEvidenceIds.length || r.candidates.some(c => ['scope_review_unverified','publication_unverified','publication_time_unverified','terms_unverified','historical_version_unverified'].includes(c.reason) || c.reason.startsWith('source_use_')))
    // Legacy dossiers are preserved as context, not elevated over new metadata checks.
    const status = checked.some(r => r.status === 'conflict') || old?.status === 'conflict' ? 'conflict'
      : !checked.length ? 'review_pending' : unresolved.length ? 'research_needed' : 'available'
    const observations = attempts.filter(a => a.questionId === q.id).map(a => ({ status: a.status,
      verified: false, reason: ['not_yet_released','no_matching_series'].includes(a.status) ? 'official_confirmation_required' : 'attempt_not_absence_proof' }))
    return { id: q.id, question: q.question, why: q.why ?? q.purpose, required: q.required,
      legacyQuestionId: q.legacyQuestionId, status, requirements: checked, attempts: observations,
      legacyStatus: old?.status ?? 'unverified', reason: !checked.length ? 'explicit_scope_required' : status === 'available' ? 'metadata_compatible_review_still_required' : 'unresolved_requirements',
      action: status === 'available' ? 'reuse_for_content_review' : status === 'conflict' ? 'review_conflict'
        : !checked.length ? 'define_scope' : inventoryNeedsReview ? 'review_inventory' : 'discover', queryTemplate: q.query }
  })
  // Preserve legacy plans. The opt-in connected collector prioritizes core gaps.
  const first = priority === 'core_first'
  const pending = [...questions.filter(q => q.required === first), ...questions.filter(q => q.required !== first)].filter(q => q.action === 'discover')
  const discoveryRequests = pending.slice(0, maxQueries).map(q => ({ needId: q.id, questionId: q.legacyQuestionId,
    query: q.queryTemplate, scopeConstraints: q.requirements.filter(r => r.status !== 'available').map(({ id, period, scope }) => ({ id, period, scope })),
    maxQueries: 1, status: 'planned_not_executed', adapter: 'existing_question_search',
    limitation: '기존 검색 질문으로 후보만 찾는다. 기간·통계 범위는 원문 어댑터와 검토가 확인해야 한다.' }))
  const extendedScope = !['BRL','CLP','MXN'].includes(packet.currency) || Object.values(requirements).flat().some(r=>/^\d{4}-Q[1-4]$/.test(r.period))
  const version = extendedScope ? 'research-needs/3' : priority === 'core_first' ? 'research-needs/2' : RESEARCH_NEEDS_VERSION
  const binding = { version, packetHash: legacy.packetHash, purpose, asOf, topics: [...topics].sort(), requirements,
    scopeCards: packet.evidenceScopeCards ?? [], dossier: dossier ?? null, attempts, maxQueries,
    ...(sourceUse===undefined?{}:{sourceUse}) }
  return { version, planId: fingerprint(binding), currency: packet.currency, baseDate: packet.baseDate, asOf, purpose,
    questions, discoveryRequests, deferred: [...selection.deferred, ...pending.slice(maxQueries).map(q => ({ id: q.id, reason: 'query_budget' }))],
    dataStatus: questions.every(q => q.status === 'available') ? 'metadata_compatible' : 'incomplete',
    coreStatus: questions.filter(q => q.required).every(q => q.status === 'available') ? 'review_required' : 'hold',
    limits: { maxQueries, reservedQueries: discoveryRequests.length, remainingQueries: maxQueries - discoveryRequests.length },
    ...(sourceUses?{sourceUses}:{}),
    writingEligibility: 'not_assessed', contentQuality: 'not_assessed', publicationApproved: false, networkCalls: 0, modelCalls: 0 }
}
