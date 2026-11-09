import {it,expect,vi} from 'vitest'
import {operatingFixture} from './operating-fixture.js'
import {automaticReferenceCalendars} from './operating-entry.js'
import {buildSharedDashboardPriceSnapshot} from './shared-price-contract.js'
import {evaluatePublicationCadence} from './publication-cadence.js'
import {runOperatingCycle,operatingMaterialHash} from './operating-cycle.js'
import {runtimeResearchDates,runtimeResearchInput} from './runtime-supply.js'
import {recoverOperatingCalls} from './operating-recovery.js'
import {operatingResultState} from './operating-result.js'
import {oneTimeOperatingPolicy,operatingConfigurationHolds,runtimeAccountingCapUsd} from './operating-policy.js'
import {prepareOperatingBatch} from './operating-batch-plan.js'
import {fingerprint} from './research-harness.js'
import {runtimeFixture} from './runtime-fixture.js'
import {prepareRuntimeTask} from './runtime.js'
import {acquireOfficialBackground} from './runtime-official-supply.js'
import {acquireRuntimeResearch} from './runtime-supply.js'
import {createHash} from 'node:crypto'
import {assertSharedPacket,sealSharedPacket} from './shared-writing-contract.js'

it('uses Friday values through a carried weekend without declaring new observations, a holiday or a market close',async()=>{
 const f=await operatingFixture(),dataset={...f.dataset,baseDate:'2026-11-01',fetchedAt:'2026-11-01T02:00:00Z',dailyRates:[] as unknown[]}
 dataset.dailyRates=['BRL','MXN','COP','PEN','CLP','ARS'].flatMap(currency=>[
  {currency,date:'2026-10-29',value:99,rateType:'LOCAL_PER_USD',status:'ok',source:'API',imputationMethod:'NONE'},
  {currency,date:'2026-10-30',value:100,rateType:'LOCAL_PER_USD',status:'ok',source:'API',imputationMethod:'NONE'},
  ...['2026-10-31','2026-11-01'].map(date=>({currency,date,value:100,rateType:'LOCAL_PER_USD',status:'ok',source:'IMPUTED',imputationMethod:'FFILL'}))])
 const calendar=automaticReferenceCalendars(dataset,f.asOf).CLP
 const snapshot=buildSharedDashboardPriceSnapshot({dataset,currency:'CLP',asOf:f.asOf,calendar})
 expect(snapshot).toMatchObject({current:{value:100,date:'2026-11-01'},changePct:0,numericStatus:'pass',carryForward:{currentOrigin:{date:'2026-10-30'},holidayConfirmed:false}})
 expect(evaluatePublicationCadence({snapshot,asOf:f.asOf,calendar}).status).toBe('research_candidate')
 const window=runtimeResearchDates(snapshot,f.asOf)
 expect(window.dates).toContain('2026-10-31')
 expect(runtimeResearchInput({snapshot,asOf:f.asOf,commentaryTarget:{date:'2026-10-31',basis:'search_only'}}).packet.observedDate).toBe('2026-10-31')
 expect(automaticReferenceCalendars(dataset,'2026-11-06T03:00:00Z').CLP.status).toBe('unverified')
})

it('refreshes free acquisition after completion and detects changed material without rebuying identical captures',async()=>{
 const f=await operatingFixture(),acquire=vi.fn(f.acquire)
 await runOperatingCycle({...f,acquire,execute:true})
 expect(f.state.posts).toHaveLength(24)
 const repeat=await runOperatingCycle({...f,acquire,execute:true})
 expect(repeat.status).toBe('completed');expect(acquire).toHaveBeenCalledTimes(12);expect(f.state.posts).toHaveLength(24)
 const refreshedDataset={...f.dataset,fetchedAt:'2026-11-01T03:00:00Z'}
 const metadataOnly=await runOperatingCycle({...f,dataset:refreshedDataset,acquire,execute:true})
 expect(metadataOnly.status).toBe('completed');expect(f.state.posts).toHaveLength(24)
 const prior=operatingMaterialHash({collection:f.collections.CLP})
 // The time/window is not new content, while an actual body revision is.
 const copy=structuredClone(f.collections.CLP);copy.originals.push(structuredClone(copy.originals[0]))
 expect(operatingMaterialHash({collection:copy})).toBe(prior)
 copy.originals[0].blocks[0].text+=' New independently available information.'
 expect(operatingMaterialHash({collection:copy})).not.toBe(prior)
})

it('does not hide a source outage behind an earlier completed batch',async()=>{
 const f=await operatingFixture();await runOperatingCycle({...f,execute:true})
 const r=await runOperatingCycle({...f,execute:false,acquire:async()=>{throw Error('synthetic_outage')}})
 expect(r.collectionResults.every(c=>c.status==='collection_or_history_failed')).toBe(true)
 expect(operatingResultState(r)).toMatchObject({kind:'failure',exitCode:1})
 expect(f.state.posts).toHaveLength(24)
})

it('keeps a quiet day quiet after a publication while still checking sources, with no repeat draft from the same article editions',async()=>{
 const f=await operatingFixture();await runOperatingCycle({...f,execute:true})
 // Production-shaped records in memory only; this is not an actual publication
 // or an economic quality sample. The writer's exact editions become history.
 f.store.history=async currency=>{
  const task=f.state.inputs.get(currency),candidate=f.store.drafts.find(d=>d.candidate.currency===currency).candidate
  const context={task}
  return [{baseDate:task.baseDate,publishedAt:f.asOf,report:{...candidate,testOnly:false,status:'approved'},
   runtimeContext:{...context,serializedRuntimeContext:JSON.stringify(context)}}]
 }
 const acquire=vi.fn(f.acquire),r=await runOperatingCycle({...f,acquire,execute:true})
 expect(acquire).toHaveBeenCalledTimes(6)
 expect(r).toMatchObject({status:'no_report_due',maximumUsd:0,maxCalls:0,modelCalls:0})
 expect(operatingResultState(r).kind).toBe('normal')
 expect(f.store.drafts).toHaveLength(6);expect(f.state.posts).toHaveLength(24)
})

it('resumes a paused frozen batch after midnight without changing its cutoff or repurchasing a request',async()=>{
 const f=await operatingFixture()
 const paused=await runOperatingCycle({...f,execute:true,clock:()=>1000,deadlineMs:125000})
 expect(paused.status).toBe('paused')
 const r=await runOperatingCycle({...f,asOf:'2026-11-02T04:00:00Z',execute:true,dataset:{...f.dataset,fetchedAt:'2026-11-02T03:00:00Z'},
  calendarByCurrency:automaticReferenceCalendars(f.dataset,'2026-11-02T04:00:00Z'),
  acquire:async args=>({...await f.acquire(args),completedAt:args.asOf})})
 expect(r.status).toBe('completed_with_country_results');expect(f.state.posts).toHaveLength(24)
 const {restoreFrozenInput}=await import('./operating-storage.js')
 const {restoreOperatingPayload}=await import('./runtime-store.js')
 expect((await restoreFrozenInput(f.state.batch.payload,f.store,restoreOperatingPayload)).prepared.asOf).toBe(f.asOf)
})

it('treats an evidence update under a fixed reference price as context, with a separate timing review obligation',()=>{
 const f=runtimeFixture(),snapshot=f.handoff.reportPriceSnapshot
 const publications=[{id:'actual-published-anchor',currency:f.currency,kind:'market',state:'published',origin:'published_record',
  publishedAt:'2026-10-28T10:00:00Z',stored:true,approved:true,priceReviewed:true,historical:false,editorialOnly:false,withdrawn:false,
  snapshot,report:{content:{summary:'전회 설명',drivers:[],implications:[]}}}]
 const task=prepareRuntimeTask({...f,publications,eventCandidateIds:['new-material-version']})
 expect(task).toMatchObject({status:'prepared',purpose:'policy'})
 expect(task.plan.packet.sharedReference.edition).toMatchObject({kind:'context_update',priceCauseEstablished:false})
 expect(task.plan.body.messages[0].content).toContain('과거 가격의 원인으로 소급하지 않는다')
 expect(JSON.parse(task.plan.body.messages[1].content).writingCoverageRequirements.some(r=>r.id==='shared_evidence_after_reference')).toBe(true)
})

it('carries a Saturday article through source review and writing without moving the earlier dashboard reference date',async()=>{
 const f=await operatingFixture({newsDate:'2026-10-31'}),r=await runOperatingCycle({...f,execute:true})
 expect(r.rows.every(row=>row.status==='pending_admin_review'),JSON.stringify(r.rows)).toBe(true)
 const task=f.state.inputs.get('CLP')
 expect(task.plan.packet.baseDate).toBe('2026-10-28')
 expect(task.plan.packet.sharedReference.commentaryDate).toBe('2026-10-31')
 expect(task.plan.packet.evidence[0].eventDate).toBe('2026-10-31')
 expect(JSON.parse(task.plan.body.messages[1].content).writingCoverageRequirements.some(r=>r.id==='shared_evidence_after_reference')).toBe(true)
 expect(task.snapshot.current.value).toBe(f.dataset.dailyRates.find(row=>row.currency==='CLP'&&row.date===f.dataset.baseDate).value)
 const future=sealSharedPacket({...task.plan.packet,sharedReference:{...task.plan.packet.sharedReference,
  materialCutoff:{version:'independent-material-cutoff/1',asOf:'2026-10-30T12:00:00Z'}}})
 expect(()=>assertSharedPacket(future)).toThrow('shared_material_cutoff_required')
})

it('releases only DB-proven unsent jobs and reconciles existing IDs without any model send',async()=>{
 const reconcile=vi.fn(async()=>({costUsd:.02,costSource:'generation.total_cost'})),receipt=vi.fn(),release=vi.fn(async()=>({released:true}))
 const store={recoverableCalls:async()=>[
  {id:'unsent',state:'reserved',cost_state:'reserved'},
  {id:'received',state:'received',cost_state:'unknown',response_id:'gen-synthetic',reserved_nano:30000000,valid_response:true},
  {id:'lost',state:'calling',cost_state:'unknown',response_id:null}],releaseUnsent:release,reconcile:receipt}
 const r=await recoverOperatingCalls({store,reconcile})
 expect(r.status).toBe('action_required');expect(r.modelCalls).toBe(0)
 expect(release).toHaveBeenCalledExactlyOnceWith('unsent')
 expect(reconcile).toHaveBeenCalledExactlyOnceWith({responseId:'gen-synthetic'})
 expect(receipt).toHaveBeenCalledWith('received','gen-synthetic',20000000,{source:'generation.total_cost',responseId:'gen-synthetic',costNano:'20000000'})
})

it('binds a one-time allowance to its dataset and expiry without fabricating monthly authorization',async()=>{
 const f=await operatingFixture(),policy=oneTimeOperatingPolicy({config:f,datasetBinding:fingerprint(f.dataset),
  authorizationReference:'synthetic-only',configuredAt:'2026-11-01T00:00:00Z',expiresAt:'2026-11-02T00:00:00Z'})
 expect(policy).toMatchObject({state:'trial_configured',budgetScope:'one_time_trial_only',recurringBudgetAuthorization:'not_authorized',limits:{monthlyUsd:0,batchUsd:7}})
 expect(operatingConfigurationHolds(policy,await f.store.control())).toEqual([])
 f.state.policy=policy
 const prepared=await runOperatingCycle({...f,execute:false})
 expect(prepared.holds).not.toContain('standing_budget_configuration_pending')
 const p=await f.store.operatingPolicy()
 const bad=prepareOperatingBatch({...f,policy:p.policy,dataset:{...f.dataset,dataVersion:'different'},
  asOf:'2026-11-03T04:00:00Z',countries:Object.values(f.collections).map(collection=>({currency:collection.currency,calendar:f.calendarByCurrency[collection.currency],collection})),
  publicationsByCurrency:Object.fromEntries(Object.keys(f.collections).map(c=>[c,[]])),control:await f.store.control()})
 expect(bad.holds).toEqual(expect.arrayContaining(['trial_dataset_scope_changed','trial_authorization_expired']))
 const proposed=oneTimeOperatingPolicy({config:f,datasetBinding:fingerprint(f.dataset),authorizationReference:'synthetic-new-budget',
  configuredAt:'2026-11-01T00:00:00Z',expiresAt:'2026-11-02T00:00:00Z',budgetUsd:6.70,accountingPriorSpendUsd:.8520151})
 expect(proposed.limits.batchUsd).toBe(6.70)
 expect(runtimeAccountingCapUsd(proposed)).toBe(7.5520151)
 expect(operatingConfigurationHolds(proposed,{...await f.store.control(),monthly_limit_nano:7552015100})).toEqual([])
 // The previous control cannot dispatch a differently funded proposal;
 // a disabled control cannot dispatch any proposal.
 expect(operatingConfigurationHolds(proposed,await f.store.control())).toContain('runtime_budget_configuration_mismatch')
 expect(operatingConfigurationHolds(proposed,{...await f.store.control(),enabled:false,review_enabled:false,monthly_limit_nano:0}))
  .toEqual(expect.arrayContaining(['runtime_not_enabled','runtime_budget_configuration_mismatch']))
 expect(()=>oneTimeOperatingPolicy({config:f,datasetBinding:fingerprint(f.dataset),authorizationReference:'synthetic-over-capacity',
  configuredAt:'2026-11-01T00:00:00Z',expiresAt:'2026-11-02T00:00:00Z',budgetUsd:8.01})).toThrow('server_operating_policy_invalid')
 expect(f.state.posts).toHaveLength(0)
})

it('connects official collection separately and never promotes missing or unreviewed background into writer evidence',async()=>{
 const f=await operatingFixture(),fetchImpl=vi.fn(()=>{throw Error('unexpected_network')})
 const snapshot=buildSharedDashboardPriceSnapshot({dataset:f.dataset,currency:'BRL',asOf:f.asOf,calendar:f.calendarByCurrency.BRL})
 const r=await acquireOfficialBackground({...f,snapshot,asOf:f.asOf,mode:'saved',fetchImpl})
 expect(r.admissionStatus).toBe('official_background_held')
 expect(r.admission.admitted).toEqual([])
 expect(r.states.some(s=>s.metric==='retail')).toBe(true)
 expect(r.states.every(s=>s.writingEligible===false)).toBe(true)
 expect(r.networkCalls).toBe(0);expect(fetchImpl).not.toHaveBeenCalled()
})

it('collects a multi-date window within the physical network budget and queues the same article only once',async()=>{
 const f=await operatingFixture(),asOf='2026-10-28T12:00:00Z',fetchImpl=vi.fn(()=>{throw Error('unexpected_network')})
 const url='https://www.emol.com/noticias/Economia/2026/10/27/1/dolar-synthetic.html'
 const text='<meta property="article:published_time" content="2026-10-27T15:00:00Z"><div id="cuDetalle_cuTexto_textoNoticia"><p>Primer contexto sintético del dólar.</p><p>Condición sintética conservada.</p></div>'
 const capture={sourceId:'clp-existing-four-outlets',url,text,httpStatus:200,collectedAt:'2026-10-27T18:00:00Z',sha256:createHash('sha256').update(text).digest('hex')}
 const args={...f,asOf,mode:'saved',fetchImpl,commentaryTarget:{date:'2026-10-27',basis:'search_not_market_proof'},now:()=>asOf}
 const clp=await acquireRuntimeResearch({...args,snapshot:runtimeFixture('CLP').task.snapshot,captures:[capture]})
 expect(clp.collection.reviewQueue).toHaveLength(1)
 expect([...new Set(clp.collection.reviewQueue[0].targets.map(t=>t.requestedPeriod))]).toEqual(expect.arrayContaining(['2026-10-27','2026-10-28']))
 expect(clp.collection.originals[0].metadata.publishedAt).toBe('2026-10-27T15:00:00.000Z')
 const pen=await acquireRuntimeResearch({...args,snapshot:runtimeFixture('PEN').task.snapshot})
 expect(pen.collection.outcomes.length).toBeGreaterThan(32)
 expect(pen.networkCalls).toBe(0);expect(fetchImpl).not.toHaveBeenCalled()
})
