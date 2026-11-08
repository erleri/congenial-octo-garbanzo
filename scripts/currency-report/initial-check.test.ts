import {expect,it} from 'vitest'
import {sharedWriterFixture,sharedDraftFixture} from './shared-writer-fixture.js'
import {prepareSharedWriter,compileSharedWriterOutput} from './shared-writer.js'
import {fingerprint} from './research-harness.js'
import {runtimeFixture,memoryRuntimeStore,syntheticRuntimeTransport,runtimeTestEnv} from './runtime-fixture.js'
import {prepareRuntimeTask,runCurrencyRuntime,prepareRuntimeReview} from './runtime.js'
import {buildSharedDashboardPriceSnapshot} from './shared-price-contract.js'

function backgroundOnly(currency='BRL'){
 const h=sharedWriterFixture(currency),c=h.materialConnection
 c.sections.market_observation=[];c.sections.attributed_fx_explanation=[]
 c.holds=['selected_session_market_observation_missing','selected_session_attributed_fx_explanation_missing']
 delete c.binding;c.binding=fingerprint(c)
 return h
}
it('requires current FX evidence in every currency and every cadence, even when reviewed statistics exist',()=>{
 for(const currency of ['BRL','MXN','CLP','COP','PEN','ARS'])for(const purpose of ['market','initial_check','periodic_check','context_update']){
  const h=backgroundOnly(currency),before=structuredClone(h),plan=prepareSharedWriter({handoff:h,purpose})
  expect(plan).toMatchObject({status:'material_hold',request:null,modelCalls:0,publicationApproved:false})
  expect(plan.holds).toEqual(expect.arrayContaining(['fx_market_observation_required','fx_explanation_required']))
  expect(h).toEqual(before)
 }
})
it('allows an FX-first initial check without business filler and rejects background promoted into its cause',()=>{
 const plan=prepareSharedWriter({handoff:sharedWriterFixture(),purpose:'initial_check'}),raw=sharedDraftFixture(plan)
 raw.implications={slot_0:null};raw.ruleLedger.claims=raw.ruleLedger.claims.filter(r=>!r.target.startsWith('implications.'))
 const compiled=compileSharedWriterOutput({plan,draft:raw})
 expect(compiled.validation.valid).toBe(true);expect(compiled.candidate.implications).toEqual([])
 expect(compiled.claimReview.sharedReference.edition.previousReportId).toBeNull()
 const promoted=structuredClone(raw),note=plan.packet.evidence.flatMap(e=>e.sharedNotes.claims).find(n=>n.role==='consumer_background')
 promoted.drivers.slot_0.text=note.text;promoted.drivers.slot_0.evidenceIds=[note.evidenceId]
 Object.assign(promoted.ruleLedger.claims.find(r=>r.target==='drivers.0.text'),{materialClaimIds:[note.claimId],evidenceIds:[note.evidenceId]})
 expect(compileSharedWriterOutput({plan,draft:promoted}).validation.errors).toContain('background_used_as_fx_driver:drivers.0.text')
 const missing=structuredClone(raw);missing.drivers.slot_0=null
 expect(()=>compileSharedWriterOutput({plan,draft:missing})).toThrow('generation_slot_count')
})
it('uses the initial edition only without a published anchor, persists its real runtime candidate as a periodic check and keeps it unapproved',async()=>{
 const f=runtimeFixture(),transport=syntheticRuntimeTransport(f.task),store=memoryRuntimeStore()
 expect(f.task.purpose).toBe('initial')
 expect(prepareRuntimeReview(f.task,transport.compiled).body.messages[0].content).toContain('shared_initial_baseline')
 expect(await runCurrencyRuntime({...f,env:runtimeTestEnv,store,...transport})).toMatchObject({status:'pending_admin_review',modelCalls:2,publicationApproved:false})
 expect(store.drafts[0].candidate).toMatchObject({purpose:'periodic_check',publishedAt:null,status:'draft'})
 const oldDate='2026-10-27',snapshot=buildSharedDashboardPriceSnapshot({dataset:{...f.dataset,baseDate:oldDate,
  fetchedAt:oldDate+'T02:00:00Z',dailyRates:[{...f.dataset.dailyRates[0],date:'2026-10-26',value:99},f.dataset.dailyRates[0]]},currency:f.currency,asOf:oldDate+'T12:00:00Z'})
 const publications=[{id:'published-anchor',currency:f.currency,publishedAt:oldDate+'T12:00:00Z',kind:'market',state:'published',origin:'published_record',stored:true,
  approved:true,priceReviewed:true,historical:false,editorialOnly:false,withdrawn:false,snapshot}]
 expect(prepareRuntimeTask({...f,publications})).toMatchObject({status:'held',reason:'no_active_trigger'})
})
