// Local trial/pilot/release controls. Approval inputs are records, not inferred permissions.
import { createHash } from 'node:crypto'
import { harnessRequest } from './report-harness.js'
import { requestTokenBound } from './request-budget.js'
import { decodeGenerationOutput, assertGenerationWireRequest } from './generation-wire.js'
import { callOpenRouterStream, reconcileGenerationCost } from './openrouter-stream.js'
import { DECISION_VERSION } from './generation-decision.js'
import { economicUpdateRequest, composeEconomicUpdate } from './economic-update.js'
import { composeDraft } from './openrouter.js'
import { projectEvidenceScopes } from './evidence-scope.js'
import { economicEditorialPlan } from './economic-editorial.js'
import { scopedComparisonAuthorized, verifyScopedComparisonFiles } from './economic-comparison-consent.js'
import { boundedRetestAuthorized, verifyBoundedRetestFiles } from './bounded-retest-consent.js'
import { assessFxCauseInput } from './fx-cause-input.js'
import {applyWriterPolicy,assertWriterPolicy,writerReservation,inspectWriterEndpoint} from './writer-policy.js'
import {singleReportTrialAuthorized} from './single-report-trial-consent.js'
import {SHARED_WRITING_VERSION} from './shared-writing-contract.js'
import {assertSharedWriterPlan,compileSharedWriterOutput} from './shared-writer.js'
import {SHARED_INPUT_POLICY_VERSION} from './shared-input-policy.js'
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex')

// Explicit comparison consent may schedule one request per country even when
// another country's draft is held. It never reopens a request or unknown cost.
function scopedBatchAuthorized(plan,approval,journal) {
  const b=approval.scopedBatch
  if(!b)return false
  const rows=b.requests
  if(b.version!=='scoped-writer-batch/1'||b.model!==plan.body.model||b.maximumUsd!==approval.budgetUsd
    ||b.attemptsPerCurrency!==1||!Array.isArray(rows)||rows.length!==3||plan.retestOf
    ||new Set(rows.map(r=>r.currency)).size!==3||!['CLP','BRL','MXN'].every(c=>rows.some(r=>r.currency===c))
    ||rows.some(r=>r.baseDate!==plan.baseDate||!/^[a-f0-9]{64}$/.test(r.requestHash)||!Number.isFinite(r.maximumUsd)||r.maximumUsd<=0||r.maximumUsd>.25)
    ||rows.reduce((n,r)=>n+r.maximumUsd,0)>b.maximumUsd
    ||!rows.some(r=>r.currency===plan.currency&&r.requestHash===plan.requestHash&&r.maximumUsd===plan.maximumUsd)
    ||journal.some(r=>!rows.some(x=>x.currency===r.currency&&x.baseDate===r.baseDate&&x.requestHash===r.requestHash))
    ||new Set(journal.map(r=>r.currency)).size!==journal.length)
    throw new Error('invalid_scoped_batch_consent')
  return true
}
// Frozen v1 trial policy for old journals/replay. New preparations use writer-policy.
export const EVENT_TRIAL_POLICY = Object.freeze({ model: 'anthropic/claude-sonnet-5.5', route: 'google-vertex/global', maxCalls: 3, perCallUsd: .25, campaignUsd: .75, timeoutMs: 120000, maxOutputTokens: 8192, retries: 0, promptPrice: 2, inputReservationPrice: 4, completionPrice: 10 })

export function prepareEventTrial({ decision, packet, dossier, fxCauseInput, writer }) {
  if (packet.periodicCheck) return { status: 'periodic_trial_not_authorized', paidCallAuthorized: false, publicationApproved: false }
  const cause=fxCauseInput?assessFxCauseInput({packet,dossier,...fxCauseInput}):null
  if(cause?.status!=='ready_for_writer'&&cause) return {...cause,status:'fx_cause_input_hold',paidCallAuthorized:false}
  if (decision?.ruleVersion !== DECISION_VERSION || decision.status !== 'draft_candidate' || decision.currency !== packet.currency || decision.price.observedDate !== packet.observedDate)
    return { status: 'eligibility_hold', paidCallAuthorized: false, publicationApproved: false }
  const isFx = decision.events.some(e => e.status === 'draft_candidate' && e.purpose === 'fx_explanation')
  if(isFx&&!cause) return {status:'fx_cause_input_hold',purpose:'fx_explanation',holds:['explicit_fx_purpose_review_required'],
    paidCallAuthorized:false,publicationApproved:false,generationRequest:null}
  if(cause&&!isFx) return {...cause,status:'fx_purpose_mismatch',paidCallAuthorized:false}
  const prepared = isFx ? harnessRequest(packet, dossier) : economicUpdateRequest(packet, dossier, decision)
  if (!prepared.request) return { status: 'research_needed', paidCallAuthorized: false, publicationApproved: false }
  const body = structuredClone(prepared.request)
  // This route advertises reasoning controls but not temperature. Do not carry
  // the free-model sampler setting into a require_parameters paid request.
  delete body.temperature
  if(cause) {
    body.messages[0].content+='\n'+cause.instructions
    const input=JSON.parse(body.messages[1].content)
    input.fxExplanation={version:cause.version,priceMovement:cause.priceMovement,
      driverClaimIds:cause.driverClaimIds,counterClaimIds:cause.counterClaimIds,
      structure:cause.structure,businessBackground:cause.businessBackground}
    body.messages[1].content=JSON.stringify(input)
  }
  const selected=applyWriterPolicy(body,writer)
  const {inputBound,maximumUsd}=selected
  if(selected.status!=='prepared_not_called')return {status:selected.status,maximumUsd,
    inputBound:selected.inputBound,inputLimit:selected.profile.inputTokens,
    holdReasons:[...(selected.inputBound>selected.profile.inputTokens?['input_token_bound']:[]),
      ...(maximumUsd>selected.profile.perCallUsd?['per_call_cost_bound']:[])],paidCallAuthorized:false,publicationApproved:false}
  return { version: 'event-trial/2', writerProfile:selected.profile, purpose: isFx ? 'fx_explanation' : 'economic_update', status: 'prepared_not_called', currency: packet.currency, baseDate: packet.baseDate,
    outputContract: selected.outputContract, localOnlyOutputConstraints: selected.localOnlyOutputConstraints,
    decisionHash: hash(decision), packetHash: hash(packet), ...(prepared.scopeCards ? { scopeCards: structuredClone(prepared.scopeCards) } : {}), events: decision.events.filter(e=>e.status==='draft_candidate').map(({id,binding})=>({id,binding})), requestHash: hash(selected.body), body:selected.body, inputBound, maximumUsd, timeoutMs: 120000, retries: 0,
    ...(prepared.editorialPlan ? { editorialPlan: structuredClone(prepared.editorialPlan), ...(prepared.watchReview ? { watchReview: structuredClone(prepared.watchReview) } : {}) } : {}),
    ...(cause?{fxCauseBinding:cause.binding}:{}),paidCallAuthorized: false, publicationApproved: false }
}

export async function eventTrialEndpointPreflight(body, fetchImpl = fetch, selectedProfile) {
  if(selectedProfile) {
    const p=assertWriterPolicy(body,selectedProfile)
    const get=async url=>{const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('trial_endpoint_unavailable');return r.json()}
    const [catalog,zdr]=await Promise.all([get(`https://openrouter.ai/api/v1/models/${p.model}/endpoints`),get('https://openrouter.ai/api/v1/endpoints/zdr')])
    return {...inspectWriterEndpoint(body,p,catalog,zdr),checkedAt:new Date().toISOString()}
  }
  if (body?.model !== EVENT_TRIAL_POLICY.model || body.provider?.only?.join(',') !== EVENT_TRIAL_POLICY.route || body.provider?.zdr !== true || body.provider?.data_collection !== 'deny' || body.provider?.allow_fallbacks !== false || body.provider?.require_parameters !== true || body.max_tokens !== 8192 || body.tools?.length || body.plugins?.length) throw new Error('unsafe_trial_policy')
  const get = async url => { const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(20000) }); if (!response.ok) throw new Error('trial_endpoint_unavailable'); return response.json() }
  const [catalog, zdr] = await Promise.all([get(`https://openrouter.ai/api/v1/models/${EVENT_TRIAL_POLICY.model}/endpoints`), get('https://openrouter.ai/api/v1/endpoints/zdr')])
  const endpoint = catalog.data?.endpoints?.find(e => e.tag === EVENT_TRIAL_POLICY.route), input = requestTokenBound(body)
  const price = n => n !== null && n !== undefined && Number.isFinite(Number(n)) && Number(n) >= 0
  if (!endpoint || endpoint.model_id !== EVENT_TRIAL_POLICY.model || endpoint.status !== 0 || !zdr.data?.some(e => e.model_id === EVENT_TRIAL_POLICY.model && e.tag === EVENT_TRIAL_POLICY.route)
    || !['reasoning','response_format','structured_outputs','max_tokens'].every(p => endpoint.supported_parameters?.includes(p))
    || Object.keys(body).some(p => !['model','messages','provider','stream'].includes(p) && !endpoint.supported_parameters?.includes(p))
    || endpoint.max_completion_tokens < 8192 || endpoint.context_length < input + 8192
    || !price(endpoint.pricing?.prompt) || !price(endpoint.pricing?.completion) || !price(endpoint.pricing?.internal_reasoning ?? endpoint.pricing?.completion)
    || Number(endpoint.pricing.prompt) > 2 / 1e6 || Number(endpoint.pricing.completion) > 10 / 1e6 || Number(endpoint.pricing.internal_reasoning ?? endpoint.pricing.completion) > 10 / 1e6
    || ['input_cache_read','input_cache_write','input_cache_write_1h'].some(key => endpoint.pricing[key] !== undefined && (!price(endpoint.pricing[key]) || Number(endpoint.pricing[key]) > EVENT_TRIAL_POLICY.inputReservationPrice / 1e6))
    || Number(endpoint.pricing.request ?? 0) !== 0 || endpoint.pricing.overrides?.some(p => p.min_prompt_tokens <= input)) throw new Error('trial_privacy_support_or_price_hold')
  return { model: EVENT_TRIAL_POLICY.model, route: EVENT_TRIAL_POLICY.route, zdr: true, dataCollection: 'deny', pricing: endpoint.pricing, checkedAt: new Date().toISOString(), modelCalls: 0 }
}

export async function executeEventTrial({ plan, approval, journal, claim, invoke, preflight }) {
  if (plan?.status !== 'prepared_not_called' || !plan.body || !Number.isFinite(plan.maximumUsd) || plan.maximumUsd <= 0 || plan.requestHash !== hash(plan.body) || approval?.planHash !== hash(plan) || approval?.authorized !== true || !Number.isFinite(approval.budgetUsd) || approval.budgetUsd < plan.maximumUsd || approval.budgetUsd > .75 || plan.maximumUsd > .25)
    throw new Error('separate_bound_paid_approval_required')
  const shared=plan.version===SHARED_WRITING_VERSION
  if(shared){
    assertSharedWriterPlan(plan)
    if(plan.packet.sharedReference.inputPolicyVersion!==SHARED_INPUT_POLICY_VERSION)throw new Error('obsolete_shared_input_policy')
    if(!Array.isArray(journal)||approval.version!=='shared-paid-trial-consent/1'||approval.maximumNewCalls!==1
      ||approval.requestHash!==plan.requestHash||approval.referenceSnapshotId!==plan.packet.sharedReference.referenceSnapshotId
      ||approval.journalHash!==hash(journal)||!Number.isFinite(approval.newBudgetUsd)||approval.newBudgetUsd<=0
      ||approval.newBudgetUsd>.25||plan.maximumUsd>approval.newBudgetUsd||approval.scopedBatch||approval.retestAuthorized)
      throw new Error('shared_single_call_consent_required')
  }
  const selected=plan.version==='event-trial/2'||shared?assertWriterPolicy(plan.body,plan.writerProfile):null
  const policy=selected??EVENT_TRIAL_POLICY
  if (plan.body.model !== policy.model || plan.body.provider?.allow_fallbacks !== false || plan.body.provider?.zdr !== true || plan.body.provider?.data_collection !== 'deny' || plan.body.provider?.require_parameters !== true || plan.body.provider?.only?.join(',') !== policy.route || plan.body.reasoning?.effort !== 'medium' || plan.timeoutMs !== 120000 || plan.retries !== 0)
    throw new Error('unsafe_trial_policy')
  const scopedComparison = scopedComparisonAuthorized(plan, approval, journal)
  const boundedRetest = boundedRetestAuthorized(plan, approval, journal)
  const scopedBatch = scopedBatchAuthorized(plan,approval,journal)
  const scopedSingle = shared || singleReportTrialAuthorized(plan,approval,journal)
  if(plan.singleReportTrial&&!scopedSingle)throw new Error('single_report_trial_consent_required')
  if (plan.scopedComparison && !scopedComparison) throw new Error('scoped_comparison_binding_required')
  if (plan.boundedRetest && !boundedRetest) throw new Error('bounded_retest_consent_required')
  if (!Array.isArray(journal) || journal.length >= 3 && !scopedComparison && !boundedRetest && !shared) throw new Error('duplicate_limit_or_unresolved_cost')
  const sameDate = journal.filter(r => r.currency === plan.currency && r.baseDate === plan.baseDate)
  const previous = sameDate.at(-1)
  const sharedRetest=shared&&sameDate.length>0&&approval.retestOf===previous.requestHash
    &&sameDate.every(r=>r.requestHash!==plan.requestHash&&Number.isFinite(r.costUsd)&&r.costUsd>=0)
  if(shared&&journal.some(r=>r.requestHash===plan.requestHash))throw new Error('duplicate_limit_or_unresolved_cost')
  // Further corrected trials require explicit consent bound to the complete held chain.
  // Preserve all failures/costs; never reopen unknown expenses or repeat any prior input.
  const boundChain = sameDate.length === 1 || sameDate.length > 1
    && JSON.stringify(approval.previousRequestHashes) === JSON.stringify(sameDate.map(r => r.requestHash))
    && sameDate.slice(1).every((r, i) => r.retestOf === sameDate[i].requestHash)
  const retest = plan.retestOf && approval.retestAuthorized === true && sameDate.length > 0 && boundChain
    && previous.requestHash === plan.retestOf
    && new Set(sameDate.map(r => r.requestHash)).size === sameDate.length
    && sameDate.every(r => (r.status === 'output_hold' || scopedComparison && r === previous && r.status === 'schema_and_content_review_required') && r.requestHash !== plan.requestHash && Number.isFinite(r.costUsd) && r.costUsd >= 0)
    && Number.isFinite(approval.newBudgetUsd) && approval.newBudgetUsd > 0 && approval.newBudgetUsd <= .25
    && plan.maximumUsd <= approval.newBudgetUsd
  if (plan.retestOf && !retest || journal.some(r => !Number.isFinite(r.costUsd) || r.costUsd < 0
    || ['cost_unresolved', 'cost_exceeded'].includes(r.status) || r.status === 'output_hold' && !shared && !(retest && sameDate.includes(r)) && !(scopedBatch&&r.currency!==plan.currency))
    || sameDate.length && !retest && !sharedRetest) throw new Error('duplicate_limit_or_unresolved_cost')
  if (!scopedBatch && !scopedSingle && plan.currency === 'MXN' && !['BRL', 'CLP'].every(c => journal.some(r => r.currency === c && r.contentPassed === true))) throw new Error('initial_quality_trials_required')
  const minimum=selected?writerReservation(plan.body,selected):(requestTokenBound(plan.body)*EVENT_TRIAL_POLICY.inputReservationPrice+8192*10)/1e6
  if (plan.body[selected?.outputField??'max_tokens'] !== 8192 || plan.body.tools?.length || plan.body.plugins?.length || requestTokenBound(plan.body) > 44000 || plan.maximumUsd < minimum) throw new Error('request_reservation_mismatch')
  const committed = journal.reduce((n, r) => n + r.costUsd, 0)
  if (committed + plan.maximumUsd > approval.budgetUsd) throw new Error('campaign_budget_exceeded')
  const endpoint = await preflight(plan.body) // Caller verifies live price, support and privacy before reservation.
  if (endpoint?.model !== policy.model || endpoint.route !== policy.route || endpoint.zdr !== true || endpoint.dataCollection !== 'deny') throw new Error('endpoint_verification_required')
  await claim({ currency: plan.currency, baseDate: plan.baseDate, requestHash: plan.requestHash, reservedUsd: plan.maximumUsd })
  let response
  try { response = await invoke({ body: plan.body, timeoutMs: 120000, retries: 0 }) }
  catch { return { status: 'cost_unresolved', currency: plan.currency, baseDate: plan.baseDate, costUsd: null, reservedUsd: plan.maximumUsd, publicationApproved: false } }
  const cost = typeof response.costUsd === 'number' && Number.isFinite(response.costUsd) && response.costUsd >= 0 ? response.costUsd : null
  return { status: cost === null ? 'cost_unresolved' : cost > plan.maximumUsd ? 'cost_exceeded' : response.valid !== true || response.actualModel !== policy.model ? 'output_hold' : 'schema_and_content_review_required',
    currency: plan.currency, baseDate: plan.baseDate, costUsd: cost, reservedUsd: cost === null ? plan.maximumUsd : 0, response, publicationApproved: false }
}

// Shares the existing approval/budget/journal/transport controls. No publication
// or free-model fallback. Injectable endpoints/transport support no-call tests.
export async function executeApprovedSharedTrial({plan,approval,journal,claim,apiKey,checkpoint=async()=>{},
  preflight=body=>eventTrialEndpointPreflight(body,fetch,plan.writerProfile),send=callOpenRouterStream,reconcile=reconcileGenerationCost}) {
  if(process.env.FX_REPORT_ENABLED==='false')return {status:'disabled',costUsd:0,modelCalls:0,publicationApproved:false}
  assertSharedWriterPlan(plan)
  return executeEventTrial({plan,approval,journal,claim,preflight,invoke:async({body})=>{
    const response=await send({body,apiKey,timeoutMs:120000,checkpoint})
    if(response.costUsd===null&&response.responseId)Object.assign(response,await reconcile({responseId:response.responseId,apiKey}))
    if(response.valid){
      try{
        const draft=JSON.parse(response.payload.choices[0].message.content)
        const compiled=compileSharedWriterOutput({plan,draft})
        Object.assign(response,{compiled,valid:compiled.validation?.valid===true&&compiled.rules?.automaticStatus==='pass'
          &&!compiled.editorial?.blockers?.length,contentReview:'pending_separate_review'})
      }catch{Object.assign(response,{valid:false,errors:['invalid_shared_candidate_or_compilation']})}
    }
    return response
  }})
}

export async function executeApprovedEventTrial({ plan, approval, journal, claim, apiKey, packet, dossier, fxCauseInput, trialRoot, checkpoint = async () => {} }) {
  if (process.env.FX_REPORT_ENABLED === 'false') return { status: 'disabled', costUsd: 0, modelCalls: 0, publicationApproved: false }
  if (!packet || plan.packetHash !== hash(packet)) throw new Error('trial_packet_binding_required')
  if (plan.boundedRetest) {
    if (typeof trialRoot !== 'string') throw Error('private_retest_root_required')
    await verifyBoundedRetestFiles({data:{plan,approval,packet,dossier},journal,root:trialRoot})
  }
  if(plan.purpose==='fx_explanation'&&!plan.fxCauseBinding) throw new Error('fx_cause_review_required')
  if(plan.fxCauseBinding) {
    if(!fxCauseInput||!dossier) throw new Error('fx_cause_review_required')
    const expected=prepareEventTrial({packet,dossier,fxCauseInput,writer:plan.writerProfile?.selection,
      decision:{ruleVersion:DECISION_VERSION,status:'draft_candidate',currency:packet.currency,
        price:{observedDate:packet.observedDate},events:[{status:'draft_candidate',purpose:'fx_explanation'}]}})
    if(expected.status!=='prepared_not_called'||expected.fxCauseBinding!==plan.fxCauseBinding
      ||expected.requestHash!==plan.requestHash||plan.purpose!=='fx_explanation') throw new Error('fx_cause_review_changed_or_held')
  }
  if (plan.scopedComparison) {
    if (typeof trialRoot !== 'string') throw new Error('scoped_comparison_files_required')
    await verifyScopedComparisonFiles({ data: { plan, approval, packet }, journal, root: trialRoot })
  }
  if (plan.purpose === 'economic_update') {
    const projected = projectEvidenceScopes(packet, plan.scopeCards, { required: true })
    const sent = JSON.parse(plan.body.messages[1].content)
    if (JSON.stringify(projected) !== JSON.stringify(sent.scopeCards)) throw new Error('trial_scope_binding_required')
    if (plan.editorialPlan || sent.editorialPlan) {
      const expected = economicEditorialPlan(packet, projected, plan.watchReview)
      if (JSON.stringify(expected) !== JSON.stringify(plan.editorialPlan) || JSON.stringify(expected) !== JSON.stringify(sent.editorialPlan))
        throw new Error('economic_editorial_binding_required')
    }
  }
  return executeEventTrial({ plan, approval, journal, claim, preflight: async body => {
    // Budget/duplicate guards run first; schema checks still precede any connection.
    assertGenerationWireRequest(body, plan.outputContract)
    return eventTrialEndpointPreflight(body,fetch,plan.writerProfile)
  },
    invoke: async ({ body }) => {
      // This concrete transport has one POST, no model fallback and no inherited free-path retry.
      const response = await callOpenRouterStream({ body, apiKey, timeoutMs: 120000, checkpoint })
      if (response.costUsd === null && response.responseId) Object.assign(response, await reconcileGenerationCost({ responseId: response.responseId, apiKey }))
      if (response.valid) {
        try {
          const draft = JSON.parse(response.payload.choices[0].message.content)
          const compiled = compileEventTrialOutput({ plan, packet, draft })
          Object.assign(response,{...assessTrialCompilation(plan,compiled),compiled})
        } catch { Object.assign(response,{ valid: false, errors:['invalid_candidate_or_compilation'] }) }
      }
      return response
    } })
}

// A separately authorized, cause-bound local draft may be examined on a quiet
// day. Passing its content checks never clears the R09 publication decision.
export function assessTrialCompilation(plan,compiled) {
  if(plan.purpose==='economic_update')return {valid:compiled.valid===true,contentReview:'unverified',publicationApproved:false}
  const holds=compiled.rules?.checks?.filter(c=>c.status==='hold')
  const policyOnly=plan.purpose==='fx_explanation'&&!!plan.fxCauseBinding&&compiled.rules?.automaticStatus==='hold'
    &&Array.isArray(holds)&&holds.length>0&&holds.every(c=>c.ruleId==='R09')
  const valid=compiled.validation?.valid===true&&Array.isArray(compiled.editorial?.blockers)&&compiled.editorial.blockers.length===0
    &&(compiled.rules?.automaticStatus==='pass'||policyOnly)
  return {valid,contentReview:'unverified',publicationApproved:false,
    publicationReadiness:{status:holds?.some(c=>c.ruleId==='R09')?'policy_hold':'separate_review_required',
      holds:holds?.filter(c=>c.ruleId==='R09')??[],publicationApproved:false}}
}

export function compileEventTrialOutput({ plan, packet, draft }) {
  const normalized = decodeGenerationOutput(draft, plan.outputContract)
  return plan.purpose === 'economic_update' ? composeEconomicUpdate(packet, normalized,
    { scopeCards: plan.scopeCards, editorialPlan: plan.editorialPlan, watchReview: plan.watchReview }) : composeDraft(packet, normalized, true)
}

export function assessPilot({ records, version, asOf }) {
  if (!Array.isArray(records) || !version || !Number.isFinite(Date.parse(asOf))) throw new Error('explicit_pilot_records_required')
  const rows = records.filter(r => r.version === version && r.mode === 'live_local' && Number.isFinite(Date.parse(r.checkedAt)) && Date.parse(r.checkedAt) <= Date.parse(asOf))
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
  const days = new Set(rows.filter(r=>r.businessDay===true).map(r=>formatter.format(new Date(r.checkedAt))).filter(date=>{
    const weekday=new Date(date+'T00:00:00Z').getUTCDay()
    return weekday>0 && weekday<6
  })).size
  const attempts = rows.flatMap(r => r.drafts ?? [])
  const duplicates = attempts.filter((r, i) => attempts.findIndex(x => x.runId === r.runId) !== i)
  const drafted = attempts.filter(r => r.generated === true), graded = drafted.filter(r => Array.isArray(r.scores) && r.scores.length === 5 && r.scores.every(n => Number.isFinite(n) && n >= 1 && n <= 5))
  const approvals = drafted.filter(r => r.humanDecision === 'approved').length
  const average = graded.length ? graded.reduce((n, r) => n + r.scores.reduce((a, b) => a + b, 0) / 5, 0) / graded.length : null
  const issues = []
  if (duplicates.length) issues.push('duplicate_run_records')
  if (days < 10) issues.push('observation_period_incomplete')
  if (drafted.length < 10) issues.push(days < 20 ? 'extend_observation_without_forcing_reports' : 'quality_sample_insufficient_after_twenty_days')
  if (graded.length !== drafted.length) issues.push('ungraded_drafts')
  if (!drafted.length || approvals / drafted.length < .9) issues.push('approval_rate_below_target')
  if (average === null || average < 4) issues.push('quality_below_target')
  if (drafted.some(r => r.mandatoryReviewPassed !== true || (r.criticalErrors ?? 1) !== 0 || !Number.isFinite(r.evidenceScore) || r.evidenceScore < 4 || r.evidenceScore > 5)) issues.push('mandatory_content_review_failed')
  if (rows.some(r => (r.privacyIncidents ?? 0) > 0 || (r.regressionIncidents ?? 0) > 0)) issues.push('privacy_or_regression_incident')
  if (attempts.some(r => r.costUsd === null || r.costUsd === undefined)) issues.push('unresolved_trial_cost')
  return { version, businessDays: days, generated: drafted.length, graded: graded.length, approvals, average, issues,
    status: issues.length ? 'hold' : 'pilot_passed_pending_launch_review', publicationApproved: false }
}

export function assessRelease(checks) {
  const required = ['baseline', 'decisionReplay', 'sourceOriginals', 'writerQuality', 'localDbRoles', 'concurrentApproval', 'privateStateRemoval', 'desktopMobilePrint', 'pilot', 'rollback', 'otherReleaseBacklog', 'launchApproval']
  const missing = required.filter(key => checks?.[key] !== true)
  return { status: missing.length ? 'release_hold' : 'ready_for_approved_rollout', missing, checksPassed: missing.length === 0,
    operationalChangesAuthorized: false } // A local readiness file cannot grant the agent deployment authority.
}
