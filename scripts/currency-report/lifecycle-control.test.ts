import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { assessPilot, assessRelease, executeEventTrial, executeApprovedEventTrial, prepareEventTrial, eventTrialEndpointPreflight,assessTrialCompilation } from './lifecycle-control.js'
const syntheticWeekdays = Array.from({length:14},(_,i)=>new Date(Date.UTC(2026,8,14+i))).filter(d=>d.getUTCDay()>0&&d.getUTCDay()<6).map(d=>d.toISOString())
describe('trial and release lifecycle', () => {
  it('separates a cause-bound local draft content result from its retained publication policy hold',()=>{
    const plan={purpose:'fx_explanation',fxCauseBinding:'synthetic-bound-cause'},policy={ruleId:'R09',status:'hold',reason:'no_material_change'}
    const compiled={validation:{valid:true},editorial:{blockers:[]},rules:{automaticStatus:'hold',checks:[policy]}}
    expect(assessTrialCompilation(plan,compiled)).toMatchObject({valid:true,contentReview:'unverified',publicationApproved:false,
      publicationReadiness:{status:'policy_hold',holds:[policy],publicationApproved:false}})
    expect(assessTrialCompilation({purpose:'fx_explanation'},compiled).valid).toBe(false)
    expect(assessTrialCompilation(plan,{...compiled,validation:{valid:false}}).valid).toBe(false)
    expect(assessTrialCompilation(plan,{...compiled,rules:{automaticStatus:'hold',checks:[policy,{ruleId:'R11',status:'hold',reason:'invalid_reference'}]}}).valid).toBe(false)
    expect(assessTrialCompilation(plan,{...compiled,editorial:{blockers:['unsupported_scope']}}).valid).toBe(false)
  })
  it('honors an explicit three-country comparison without reopening a held request, exceeding the budget or accepting unknown costs',async()=>{
    const fingerprint=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
    const body={model:'anthropic/claude-sonnet-5.5',max_tokens:8192,messages:[],reasoning:{effort:'medium'},provider:{only:['google-vertex/global'],require_parameters:true,zdr:true,data_collection:'deny',allow_fallbacks:false}}
    const plan={status:'prepared_not_called',currency:'MXN',baseDate:'2026-10-28',body,requestHash:fingerprint(body),maximumUsd:.14,timeoutMs:120000,retries:0}
    const prior=[{currency:'CLP',baseDate:plan.baseDate,requestHash:'c'.repeat(64),status:'output_hold',costUsd:.04},
      {currency:'BRL',baseDate:plan.baseDate,requestHash:'b'.repeat(64),status:'schema_and_content_review_required',costUsd:.03}]
    const approval={authorized:true,planHash:fingerprint(plan),budgetUsd:.52,scopedBatch:{version:'scoped-writer-batch/1',model:body.model,maximumUsd:.52,attemptsPerCurrency:1,
      requests:[...prior.map(r=>({currency:r.currency,baseDate:r.baseDate,requestHash:r.requestHash,maximumUsd:.14})),{currency:'MXN',baseDate:plan.baseDate,requestHash:plan.requestHash,maximumUsd:.14}]}}
    const invoke=vi.fn(async()=>({valid:true,actualModel:body.model,costUsd:.03})),claim=vi.fn(),preflight=vi.fn(async()=>({model:body.model,route:'google-vertex/global',zdr:true,dataCollection:'deny'}))
    const attempt=(journal=prior,consent:unknown=approval)=>executeEventTrial({plan,approval:consent,journal,invoke,claim,preflight})
    await expect(attempt(prior,{...approval,scopedBatch:undefined})).rejects.toThrow('duplicate_limit_or_unresolved_cost')
    await expect(attempt([{...prior[0],costUsd:null},prior[1]])).rejects.toThrow('duplicate_limit_or_unresolved_cost')
    await expect(attempt(prior,{...approval,scopedBatch:{...approval.scopedBatch,attemptsPerCurrency:2}})).rejects.toThrow('invalid_scoped_batch_consent')
    await expect(attempt(prior,{...approval,budgetUsd:.20,scopedBatch:{...approval.scopedBatch,maximumUsd:.20}})).rejects.toThrow('invalid_scoped_batch_consent')
    expect(invoke).not.toHaveBeenCalled()
    expect(await attempt()).toMatchObject({status:'schema_and_content_review_required',costUsd:.03})
    await expect(attempt([...prior,{currency:'MXN',baseDate:plan.baseDate,requestHash:plan.requestHash,status:'output_hold',costUsd:.03}])).rejects.toThrow('duplicate_limit_or_unresolved_cost')
    expect(invoke).toHaveBeenCalledTimes(1);expect(claim).toHaveBeenCalledTimes(1)
  })
  it('binds a third changed-input trial to the complete costed held chain without reopening other failures', async () => {
    const fingerprint = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
    const body = {model:'anthropic/claude-sonnet-5.5',max_tokens:8192,messages:[],reasoning:{effort:'medium'},provider:{only:['google-vertex/global'],require_parameters:true,zdr:true,data_collection:'deny',allow_fallbacks:false}}
    const prior = [{currency:'CLP',baseDate:'2026-10-09',requestHash:'first',status:'output_hold',costUsd:.04},
      {currency:'CLP',baseDate:'2026-10-09',requestHash:'second',retestOf:'first',status:'output_hold',costUsd:.02}]
    const plan = {status:'prepared_not_called',currency:'CLP',baseDate:'2026-10-09',body,requestHash:fingerprint(body),maximumUsd:.14,timeoutMs:120000,retries:0,retestOf:'second'}
    const approval = {authorized:true,planHash:fingerprint(plan),budgetUsd:.21,newBudgetUsd:.15,retestAuthorized:true,previousRequestHashes:['first','second']}
    const invoke=vi.fn(async()=>({valid:true,actualModel:body.model,costUsd:.03})),claim=vi.fn(),preflight=vi.fn(async()=>({model:body.model,route:'google-vertex/global',zdr:true,dataCollection:'deny'}))
    const attempt=(journal=prior, consent=approval, request=plan)=>executeEventTrial({plan:request,approval:consent,journal,invoke,claim,preflight})
    for (const hashes of [[], ['second'], ['second','first']]) await expect(attempt(prior,{...approval,previousRequestHashes:hashes})).rejects.toThrow('duplicate_limit_or_unresolved_cost')
    await expect(attempt([prior[0],{...prior[1],retestOf:'unrelated'}])).rejects.toThrow('duplicate_limit_or_unresolved_cost')
    await expect(attempt([prior[0],{...prior[1],costUsd:NaN}])).rejects.toThrow('duplicate_limit_or_unresolved_cost')
    const identical={...plan,requestHash:'first',body:{...body}}
    // A real duplicate body hash is rejected even when the chain consent is complete.
    const duplicatePrior=[{...prior[0],requestHash:plan.requestHash},{...prior[1],retestOf:plan.requestHash}]
    await expect(attempt(duplicatePrior,{...approval,previousRequestHashes:[plan.requestHash,'second']})).rejects.toThrow('duplicate_limit_or_unresolved_cost')
    await expect(attempt(prior,{...approval,budgetUsd:.15})).rejects.toThrow('campaign_budget_exceeded')
    await expect(attempt(prior,{...approval,planHash:fingerprint(identical)},identical)).rejects.toThrow('separate_bound_paid_approval_required')
    expect(invoke).not.toHaveBeenCalled(); expect(preflight).not.toHaveBeenCalled()
    expect(await attempt()).toMatchObject({status:'schema_and_content_review_required',costUsd:.03})
    await expect(attempt([...prior,{...prior[1],requestHash:plan.requestHash}])).rejects.toThrow('duplicate_limit_or_unresolved_cost')
    expect(invoke).toHaveBeenCalledTimes(1); expect(claim).toHaveBeenCalledTimes(1)
    expect(prior.map(r=>r.costUsd)).toEqual([.04,.02])
  })
  it('stops the concrete generation transport before connection or key use when disabled', async () => {
    vi.stubEnv('FX_REPORT_ENABLED','false')
    try { expect(await executeApprovedEventTrial({})).toMatchObject({status:'disabled',modelCalls:0,costUsd:0}) }
    finally { vi.unstubAllEnvs() }
  })
  it('an eligibility or policy scope hold cannot reuse a writer cause gate', () => {
    expect(prepareEventTrial({ decision: { status: 'research_candidate' }, packet: {}, dossier: {} }).status).toBe('eligibility_hold')
    expect(prepareEventTrial({ decision: { ruleVersion: 'generation-decision/2', status: 'draft_candidate', currency: 'BRL', price: { observedDate: '2026-10-07' }, events: [{ status: 'draft_candidate', purpose: 'policy_update' }] }, packet: { currency: 'BRL', observedDate: '2026-10-07' }, dossier: {} }).status).toBe('research_needed')
  })
  it('does not spend based on a proposed dollar cap without a bound authorization', async () => {
    const invoke = vi.fn(), claim = vi.fn(), preflight = vi.fn()
    await expect(executeEventTrial({ plan: { status: 'prepared_not_called' }, approval: { budgetUsd: .75 }, journal: [], claim, invoke, preflight })).rejects.toThrow('separate_bound_paid_approval_required')
    for (const maximumUsd of [undefined, NaN, Infinity, 0, -.1]) {
      const plan = { status: 'prepared_not_called', body: {}, maximumUsd }
      const fingerprint = createHash('sha256').update(JSON.stringify(plan)).digest('hex')
      await expect(executeEventTrial({ plan, approval: { authorized: true, budgetUsd: .75, planHash: fingerprint }, journal: [], claim, invoke, preflight })).rejects.toThrow('separate_bound_paid_approval_required')
    }
    expect(invoke).not.toHaveBeenCalled(); expect(claim).not.toHaveBeenCalled(); expect(preflight).not.toHaveBeenCalled()
  })
  it('extends a quiet pilot and does not fill it using historical or other version cases', () => {
    const records = syntheticWeekdays.map(checkedAt=>({ version: 'v1', mode: 'live_local', businessDay: true, checkedAt, drafts: [] }))
    records.push({ ...records[0], mode: 'replay', drafts: [] })
    records.push({ ...records[0], checkedAt:'2026-10-10T09:00:00Z', drafts:[] })
    const result = assessPilot({ records, version: 'v1', asOf: '2026-10-11T00:00:00Z' })
    expect(result.businessDays).toBe(10); expect(result.generated).toBe(0)
    expect(result.issues).toContain('extend_observation_without_forcing_reports')
  })
  it('keeps a fully evaluated synthetic pilot distinct from launch permission', () => {
    const records = syntheticWeekdays.map((checkedAt,i)=>({ version: 'v1', mode: 'live_local', businessDay: true, checkedAt, drafts: [{ runId: `run-${i}`, generated: true, scores: [4, 4, 4, 4, 4], humanDecision: 'approved', mandatoryReviewPassed: true, criticalErrors: 0, evidenceScore: 4, costUsd: .05 }] }))
    const result = assessPilot({ records, version: 'v1', asOf: '2026-10-11T00:00:00Z' })
    expect(result.status).toBe('pilot_passed_pending_launch_review'); expect(result.publicationApproved).toBe(false)
    records[0].drafts[0].criticalErrors = 1
    expect(assessPilot({ records, version: 'v1', asOf: '2026-10-11T00:00:00Z' }).issues).toContain('mandatory_content_review_failed')
  })
  it('cannot turn an unavailable local DB or missing launch approval into readiness', () => {
    const result = assessRelease({ baseline: true, decisionReplay: true, sourceOriginals: true, writerQuality: true, desktopMobilePrint: true })
    expect(result.missing).toContain('localDbRoles'); expect(result.missing).toContain('launchApproval')
    expect(result.operationalChangesAuthorized).toBe(false)
  })
  it('reserves once and stops on a transport loss without another model or retry', async () => {
    const fingerprint = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
    const body = { model: 'anthropic/claude-sonnet-5.5', max_tokens: 8192, messages: [], reasoning: { effort: 'medium' }, provider: { only: ['google-vertex/global'], require_parameters: true, zdr: true, data_collection: 'deny', allow_fallbacks: false } }
    const plan = { status: 'prepared_not_called', currency: 'BRL', baseDate: '2026-10-07', body, requestHash: fingerprint(body), maximumUsd: .2, timeoutMs: 120000, retries: 0 }
    const approval = { authorized: true, budgetUsd: .75, planHash: fingerprint(plan) }, claim = vi.fn()
    const invoke = vi.fn(async () => { throw new Error('timeout') })
    const preflight = vi.fn(async () => ({ model: body.model, route: 'google-vertex/global', zdr: true, dataCollection: 'deny' }))
    const result = await executeEventTrial({ plan, approval, journal: [], claim, invoke, preflight })
    expect(result.status).toBe('cost_unresolved'); expect(result.reservedUsd).toBe(.2); expect(result.costUsd).toBeNull()
    expect(invoke).toHaveBeenCalledTimes(1); expect(claim).toHaveBeenCalledTimes(1)
    await expect(executeEventTrial({ plan, approval, journal: [result], claim, invoke, preflight })).rejects.toThrow('duplicate_limit_or_unresolved_cost')
    expect(invoke).toHaveBeenCalledTimes(1)
  })
  it('preflights advertised privacy and prices without spending or allowing search add-ons', async () => {
    const body = { model: 'anthropic/claude-sonnet-5.5', max_tokens: 8192, messages: [], reasoning: { effort: 'medium' }, provider: { only: ['google-vertex/global'], require_parameters: true, zdr: true, data_collection: 'deny', allow_fallbacks: false } }
    const endpoint = { tag: 'google-vertex/global', model_id: body.model, status: 0, supported_parameters: ['reasoning', 'response_format', 'structured_outputs', 'max_tokens'], max_completion_tokens: 16000, context_length: 100000, pricing: { prompt: '0.000002', completion: '0.00001', input_cache_write: '0.0000025' } }
    const fetchImpl = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/zdr') ? { data: [endpoint] } : { data: { endpoints: [endpoint] } })))
    expect((await eventTrialEndpointPreflight(body, fetchImpl)).modelCalls).toBe(0)
    await expect(eventTrialEndpointPreflight({...body,temperature:.2}, fetchImpl)).rejects.toThrow('trial_privacy_support_or_price_hold')
    endpoint.pricing.input_cache_write = '0.0000041'
    await expect(eventTrialEndpointPreflight(body, fetchImpl)).rejects.toThrow('trial_privacy_support_or_price_hold')
    await expect(eventTrialEndpointPreflight({ ...body, plugins: [{ id: 'web' }] }, fetchImpl)).rejects.toThrow('unsafe_trial_policy')
    expect(fetchImpl).toHaveBeenCalledTimes(6)
  })
  it('requires a changed input and a separate budget for one costed held-draft retest', async () => {
    const fingerprint = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
    const body = { model:'anthropic/claude-sonnet-5.5', max_tokens:8192, messages:[{role:'system',content:'Corrected economic input'}], reasoning:{effort:'medium'}, provider:{only:['google-vertex/global'],require_parameters:true,zdr:true,data_collection:'deny',allow_fallbacks:false} }
    const previous = {currency:'CLP',baseDate:'2026-10-09',requestHash:'old-request',status:'output_hold',costUsd:.04}
    const plan = {status:'prepared_not_called',currency:previous.currency,baseDate:previous.baseDate,body,requestHash:fingerprint(body),maximumUsd:.13,timeoutMs:120000,retries:0,retestOf:previous.requestHash}
    const approval = {authorized:true,planHash:fingerprint(plan),budgetUsd:.18,newBudgetUsd:.14,retestAuthorized:true}
    const invoke=vi.fn(async()=>({valid:true,actualModel:body.model,costUsd:.03})),claim=vi.fn()
    const preflight=vi.fn(async()=>({model:body.model,route:'google-vertex/global',zdr:true,dataCollection:'deny'}))
    const attempt=(journal:unknown[], consent=approval, request=plan)=>executeEventTrial({plan:request,approval:consent,journal,invoke,claim,preflight})
    await expect(attempt([previous],{...approval,retestAuthorized:false})).rejects.toThrow('duplicate_limit_or_unresolved_cost')
    await expect(attempt([{...previous,costUsd:null}])).rejects.toThrow('duplicate_limit_or_unresolved_cost')
    const identical={...plan,retestOf:plan.requestHash}
    await expect(attempt([{...previous,requestHash:plan.requestHash}],{...approval,planHash:fingerprint(identical)},identical)).rejects.toThrow('duplicate_limit_or_unresolved_cost')
    await expect(attempt([previous,{...previous,currency:'BRL'}])).rejects.toThrow('duplicate_limit_or_unresolved_cost')
    await expect(attempt([previous],{...approval,newBudgetUsd:.12})).rejects.toThrow('duplicate_limit_or_unresolved_cost')
    await expect(attempt([previous],{...approval,budgetUsd:.14})).rejects.toThrow('campaign_budget_exceeded')
    expect(invoke).not.toHaveBeenCalled(); expect(preflight).not.toHaveBeenCalled()
    expect(await attempt([previous])).toMatchObject({status:'schema_and_content_review_required',costUsd:.03,publicationApproved:false})
    expect(claim).toHaveBeenCalledTimes(1); expect(invoke).toHaveBeenCalledTimes(1)
    await expect(attempt([previous,{...previous,requestHash:plan.requestHash,status:'schema_and_content_review_required',costUsd:.03}])).rejects.toThrow('duplicate_limit_or_unresolved_cost')
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})
