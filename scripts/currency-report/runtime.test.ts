import {expect,it,vi} from 'vitest'
import {runtimeFixture,memoryRuntimeStore,syntheticRuntimeTransport,runtimeTestEnv} from './runtime-fixture.js'
import {runCurrencyRuntime,prepareRuntimeTask,prepareRuntimeReview,assessRuntimeReview} from './runtime.js'
import {assertRuntimeDestination,runtimePublications} from './runtime-store.js'
import {runRuntimeWorker} from './runtime-worker.js'
import {buildSharedDashboardPriceSnapshot} from './shared-price-contract.js'
import {fingerprint} from './research-harness.js'

it('holds an unverified model-use scope before preflight, reservation or transmission',async()=>{
 const f=runtimeFixture(),{binding,...body}=f.task;void binding
 const next={...body,sourceUseReview:{externalModel:'unverified',publicDisplay:'unverified'}}
 const store=memoryRuntimeStore(),preflight=vi.fn(),send=vi.fn()
 const result=await runCurrencyRuntime({...f,task:{...next,binding:fingerprint(next)},env:runtimeTestEnv,store,preflight,send})
 expect(result).toMatchObject({status:'source_use_wait',modelCalls:0})
 expect(store.jobs).toHaveLength(0);expect(preflight).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled()
})

it('requires explicit new-generator review mode and leaves legacy, disabled and automatic paths without any call',async()=>{
 const f=runtimeFixture(),store=memoryRuntimeStore(),send=vi.fn(),preflight=vi.fn()
 for(const [env,status] of [[{},'legacy'],[{...runtimeTestEnv,FX_REPORT_OPERATIONAL_HOLD:'true'},'disabled'],[{...runtimeTestEnv,FX_REPORT_PUBLISH_MODE:'automatic'},'review_mode_required']] as const){
  const result=await runCurrencyRuntime({...f,env,store,send,preflight})
  expect(result).toMatchObject({status,modelCalls:0,publicationApproved:false})
 }
 expect(send).not.toHaveBeenCalled();expect(preflight).not.toHaveBeenCalled();expect(store.jobs).toHaveLength(0)
})
it('binds the ready material to the dashboard snapshot and current published anchor before any provider preflight',async()=>{
 const f=runtimeFixture(),transport=syntheticRuntimeTransport(f.task),preflight=vi.fn(transport.preflight)
 const revised=structuredClone(f.dataset);revised.dailyRates.at(-1)!.value=102
 expect(prepareRuntimeTask({...f,dataset:revised,handoff:f.handoff})).toMatchObject({status:'held',reason:'current_dashboard_material_required'})
 await expect(runCurrencyRuntime({...f,dataset:revised,env:runtimeTestEnv,store:memoryRuntimeStore(),...transport,preflight})).rejects.toThrow('runtime_input_stale_or_revised')
 await expect(runCurrencyRuntime({...f,asOf:'2026-10-29T12:00:00Z',env:runtimeTestEnv,store:memoryRuntimeStore(),...transport,preflight})).rejects.toThrow('runtime_input_stale_or_revised')
 expect(preflight).not.toHaveBeenCalled()
})
it('stores exactly one writer and one separate sentence-review response and exposes only an unapproved review draft',async()=>{
 const f=runtimeFixture('MXN'),store=memoryRuntimeStore(),t=syntheticRuntimeTransport(f.task),send=vi.fn(t.send)
 expect(f.task.plan.body.provider.only).toEqual(['azure'])
 expect(f.task.reviewer).toBe('sol-us')
 const before=structuredClone(f)
 const result=await runCurrencyRuntime({...f,env:runtimeTestEnv,store,...t,send})
 expect(result).toMatchObject({status:'pending_admin_review',modelCalls:2,publicationApproved:false,cost:{costUsd:.02,unknownCost:false}})
 expect(send).toHaveBeenCalledTimes(2);expect(store.jobs).toHaveLength(2);expect(store.drafts).toHaveLength(1)
 expect(send.mock.calls[1][0].body.provider).toMatchObject({only:['azure/us'],zdr:true,data_collection:'deny',allow_fallbacks:false})
 expect(send.mock.calls[1][0].body.model).toBe(send.mock.calls[0][0].body.model)
 expect(store.drafts[0].validation).toMatchObject({contentReview:'passed',qualityAverage:4,evidenceScore:4,publicationApproved:false})
 expect(store.drafts[0].candidate).toMatchObject({currency:'MXN',status:'draft',publishedAt:null})
 expect(store.drafts[0].candidate.facts).toEqual(f.task.plan.packet.facts.map(({id,value,label})=>({id,value,label})))
 expect(JSON.stringify(store.drafts[0].candidate)).not.toMatch(/sharedNotes|scopeBinding|sourceClaimLinks|PRIVATE|RAW-DO-NOT-COPY/)
 expect(f).toEqual(before)
 const again=await runCurrencyRuntime({...f,env:runtimeTestEnv,store,...t,send})
 expect(again).toMatchObject({status:'pending_admin_review',runId:result.runId,modelCalls:0});expect(send).toHaveBeenCalledTimes(2)
 expect(store.drafts).toHaveLength(1)
})
it('preserves the paid writer when review is disabled and cannot turn structural success into content approval',async()=>{
 const f=runtimeFixture(),store=memoryRuntimeStore();store.config.review_enabled=false
 const result=await runCurrencyRuntime({...f,env:runtimeTestEnv,store,...syntheticRuntimeTransport(f.task)})
 expect(result).toMatchObject({status:'runtime_disabled',waitingStage:'reviewer',modelCalls:1,publicationApproved:false})
 expect(store.drafts).toHaveLength(0)
 expect(store.jobs[0].state).toBe('received')
 expect(store.jobs[0].response.payload.choices[0].message.content).toBe(JSON.stringify(syntheticRuntimeTransport(f.task).writerOutput))
})
it('retains an unknown reservation after a transport failure and refuses the next model call',async()=>{
 const f=runtimeFixture(),store=memoryRuntimeStore(),t=syntheticRuntimeTransport(f.task),send=vi.fn(async()=>{throw Error('simulated timeout')})
 const first=await runCurrencyRuntime({...f,env:runtimeTestEnv,store,...t,send})
 expect(first).toMatchObject({status:'cost_unresolved',modelCalls:1})
 expect(store.jobs[0]).toMatchObject({costState:'unknown',actual:null,state:'received'});expect(store.jobs[0].reservedNano).toBeGreaterThan(0)
 const other=runtimeFixture('CLP')
 expect(await runCurrencyRuntime({...other,env:runtimeTestEnv,store,...syntheticRuntimeTransport(other.task),send})).toMatchObject({status:'unresolved_or_inflight_call',modelCalls:0})
 expect(send).toHaveBeenCalledTimes(1)
})
it('records review timeout as unknown, keeps the writer draft on hold, and never reports partial confirmed cost as the total',async()=>{
 const f=runtimeFixture(),store=memoryRuntimeStore(),t=syntheticRuntimeTransport(f.task)
 const send=vi.fn(async args=>{if(args.body.response_format.json_schema.name==='currency_runtime_review')throw Error('timeout');return t.send(args)})
 const result=await runCurrencyRuntime({...f,env:runtimeTestEnv,store,...t,send})
 expect(result).toMatchObject({status:'cost_unresolved',waitingStage:'accounting',modelCalls:2,cost:{costUsd:null,confirmedUsd:.01,unknownCost:true}})
 expect(store.drafts).toHaveLength(0);expect(store.jobs[1].costState).toBe('unknown')
})
it('uses the existing full sentence schema and distinguishes unsupported claims from a style-only suggestion',()=>{
 const f=runtimeFixture(),t=syntheticRuntimeTransport(f.task)
 const request=prepareRuntimeReview(f.task,t.compiled)
 expect(request.outputContract.sections).toEqual({});expect(request.body.messages[0].content).not.toContain('전송 형식: drivers')
 const bad=structuredClone(t.reviewOutput);bad.review.claims[0].support='limited';bad.review.claims[0].decision='rewrite';bad.review.claims[0].issue='claim_scope';bad.review.claims[0].subclaims[0].support='limited'
 expect(assessRuntimeReview(t.compiled,bad).validation.contentReview).toBe('unverified')
 const style=structuredClone(t.reviewOutput);style.review.claims[0].decision='refine';style.review.claims[0].issue='style'
 expect(assessRuntimeReview(t.compiled,style).validation.contentReview).toBe('passed')
})
it('keeps a missing reviewed input and an unbound legacy publication distinct from an empty history',async()=>{
 const f=runtimeFixture(),store=memoryRuntimeStore(),send=vi.fn()
 const result=await runRuntimeWorker({env:runtimeTestEnv,currency:f.currency,asOf:f.asOf,
  store:{...store,input:async()=>null},loadDataset:async()=>f.dataset,send})
 expect(result).toMatchObject({status:'reviewed_input_wait',modelCalls:0});expect(send).not.toHaveBeenCalled()
 expect(runtimePublications([],f.currency)).toEqual([])
 expect(()=>runtimePublications([{report:{id:'legacy-1',currency:'BRL'},publishedAt:f.asOf}],f.currency)).toThrow('published_anchor_snapshot_unavailable')
 expect(runtimePublications([{report:{historicalReview:true}}],f.currency)).toEqual([])
})
it('rejects production credentials in local mode and restricts workflow execution to the named repository',()=>{
 expect(assertRuntimeDestination('http://127.0.0.1:56321','local')).toBe('http://127.0.0.1:56321')
 expect(()=>assertRuntimeDestination('https://example.supabase.co','local')).toThrow('isolated_local_api_required')
 expect(()=>assertRuntimeDestination('https://example.supabase.co','workflow',{})).toThrow('explicit_runtime_destination_required')
 expect(()=>assertRuntimeDestination('https://example.supabase.co','workflow',{GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'other/repo'})).toThrow('explicit_runtime_destination_required')
})
it('does not turn the fortnightly check into a full market report when its reviewed comparison input is missing',()=>{
 const f=runtimeFixture(),oldDate='2026-10-05'
 const dataset={...f.dataset,dailyRates:[{...f.dataset.dailyRates[0],date:'2026-10-02',value:99},{...f.dataset.dailyRates[0],date:oldDate},f.dataset.dailyRates[1]]}
 const previous=buildSharedDashboardPriceSnapshot({dataset:{...dataset,baseDate:oldDate,fetchedAt:oldDate+'T02:00:00Z',dailyRates:dataset.dailyRates.slice(0,2)},currency:f.currency,asOf:oldDate+'T12:00:00Z'})
 const publications=[{id:'BRL-prior-fixture',currency:f.currency,publishedAt:oldDate+'T12:00:00Z',kind:'market',state:'published',origin:'published_record',
  stored:true,approved:true,priceReviewed:true,historical:false,editorialOnly:false,withdrawn:false,snapshot:previous}]
 const result=prepareRuntimeTask({...f,dataset,publications})
 expect(result).toMatchObject({status:'held',reason:'current_dashboard_material_required',modelCalls:0})
 expect(result.cadence.triggers).toEqual(['periodic']);expect(result.cadence.cumulativePct).toBeCloseTo(1)
})
it('accepts an explicitly confirmed weekend reference date without accepting other price defects',()=>{
 const f=runtimeFixture(),asOf='2026-11-01T03:00:00Z'
 const snapshot=buildSharedDashboardPriceSnapshot({dataset:f.dataset,currency:f.currency,asOf,calendar:f.calendar})
 expect(snapshot.numericStatus).toBe('pass')
 const damaged=buildSharedDashboardPriceSnapshot({dataset:{...f.dataset,dailyRates:[...f.dataset.dailyRates,f.dataset.dailyRates[1]]},currency:f.currency,asOf,calendar:f.calendar})
 expect(damaged.numericHolds).toContain('duplicate_stored_price_dates')
 const unconfirmed=buildSharedDashboardPriceSnapshot({dataset:f.dataset,currency:f.currency,asOf})
 expect(unconfirmed.numericHolds).toContain('older_saved_dataset_not_current_market')
})
it('checks the stop switch again after reservation and leaves an interrupted response write unresolved without retrying',async()=>{
 const f=runtimeFixture(),t=syntheticRuntimeTransport(f.task),stopped=memoryRuntimeStore(),send=vi.fn(t.send)
 stopped.begin=async()=>false
 expect(await runCurrencyRuntime({...f,env:runtimeTestEnv,store:stopped,...t,send})).toMatchObject({status:'runtime_stopped_before_call',modelCalls:0})
 expect(send).not.toHaveBeenCalled()
 const broken=memoryRuntimeStore();broken.receive=async()=>{throw Error('database response lost')}
 await expect(runCurrencyRuntime({...f,env:runtimeTestEnv,store:broken,...t,send})).rejects.toThrow('database response lost')
 expect(send).toHaveBeenCalledTimes(1);expect(broken.jobs[0]).toMatchObject({state:'calling',costState:'unknown'})
})
it('binds the explicitly approved reviewer while keeping legacy defaults unchanged',()=>{
 const f=runtimeFixture(),legacy=prepareRuntimeTask(f),selected=prepareRuntimeTask({...f,reviewer:'sol'})
 expect(legacy.reviewer).toBe('sol-us');expect(selected.reviewer).toBe('sol')
 expect(selected.taskKey).not.toBe(legacy.taskKey);expect(selected.plan.body).toEqual(legacy.plan.body)
})
