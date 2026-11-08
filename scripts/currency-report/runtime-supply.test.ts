import fs from 'node:fs'
import {it,expect,vi} from 'vitest'
import {runtimeFixture,memoryRuntimeStore} from './runtime-fixture.js'
import {previousWeekdayTarget,runtimeResearchDates,latestReviewedMarketSession,runtimeResearchInput,recontextualizeSupplyCache,supplyRuntimeInput,acquireRuntimeResearch} from './runtime-supply.js'
import {fingerprint} from './research-harness.js'
import {planResearchSourceSelection,compileResearchSourceCatalog,countryNewsCollectionSources} from './research-source-selection.js'

const sourcePlan=JSON.parse(fs.readFileSync('docs/2.0/six-currency-explanation-sources-20261027.json','utf8'))
const sourceRegister=JSON.parse(fs.readFileSync('docs/2.0/six-currency-source-register-20261027.json','utf8'))
const target={date:'2026-10-27',basis:'synthetic_search_target_not_market_proof'}
const connection=({handoff})=>({handoff,summary:{sources:[],pendingArticles:0}})
const emptyCollection=asOf=>({version:'selected-source-collection/1',asOf,originals:[],reviewQueue:[]})
const options=()=>{
 const f=runtimeFixture('BRL'),c=f.handoff.materialConnection
 for(const role of ['global_context','countercontext','policy_background','watch_context'])c.sections[role]=[]
 for(const row of Object.values(c.sections).flat())row.eventDate=row.sourceSessionDate
 delete c.binding;c.binding=fingerprint(c)
 return {...f,commentaryTarget:target,sourcePlan,sourceRegister,connect:connection}
}

it('searches every enabled country route with the same four market questions and no newspaper preference',()=>{
 for(const currency of ['CLP','MXN','BRL','COP','PEN','ARS']){
  const f=runtimeFixture(currency),input=runtimeResearchInput({snapshot:f.task.snapshot,asOf:f.asOf,commentaryTarget:target})
  const catalog=compileResearchSourceCatalog(sourcePlan,sourceRegister)
  const selection=planResearchSourceSelection({input,sourcePlan,sourceRegister})
  const chosen=countryNewsCollectionSources(selection,catalog)
  expect(chosen.length).toBeGreaterThan(0)
  expect(chosen.every(id=>!id.endsWith('-yahoo'))).toBe(true)
  expect(selection.questions.filter(q=>q.required).map(q=>q.needId)).toEqual(['market','local','global','counter'])
 }
 expect(previousWeekdayTarget('2026-11-01')).toEqual({date:'2026-10-30',basis:'previous_weekday_search_target_not_verified_trading_day'})
})
it('does not silently redate old commentary or let archived sessions fill the current source limit',()=>{
 const f=options(),before=fingerprint(f.handoff)
 const moved=recontextualizeSupplyCache({...f,snapshot:f.task.snapshot,commentaryTarget:{date:'2026-10-28',basis:'synthetic'}})
 expect(moved.materialConnection.sections.attributed_fx_explanation).toEqual([])
 expect(moved.materialConnection.cacheProjection.archivedClaimBindings.length).toBeGreaterThan(0)
 expect(moved.materialConnection.holds).toContain('selected_session_attributed_fx_explanation_missing')
 expect(fingerprint(f.handoff)).toBe(before)
})
it('keeps the latest complete reviewed session distinct from newer quotes, scheduled policy and dashboard dates for every currency',()=>{
 const material=(date:string,roles:string[])=>({input:{materials:[{record:{sessionDate:date,claimRoles:Object.fromEntries(roles.map((r,i)=>[i,r]))}}]}})
 for(const currency of ['BRL','MXN','COP','PEN','CLP','ARS']){
  const asOf='2026-11-01T16:00:00Z',window=runtimeResearchDates({currency,baseDate:'2026-11-01'},asOf)
  expect(window.dates).toEqual(['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01'])
  const inputs=[material('2026-10-29',['market_observation','attributed_fx_explanation']),material('2026-10-30',['market_observation']),
   material('2026-10-31',['global_context','policy_background']),material('2026-11-02',['market_observation','attributed_fx_explanation'])]
  const args={materialInputs:inputs,currency,asOf,requestedDates:window.dates},before=fingerprint(inputs)
  expect(latestReviewedMarketSession(args)).toBe('2026-10-29')
  expect(latestReviewedMarketSession({...args,materialInputs:inputs.slice(1)})).toBeNull()
  expect(latestReviewedMarketSession({...args,requestedDates:['2026-10-30']})).toBeNull()
  expect(latestReviewedMarketSession({...args,materialInputs:[...inputs,material('2026-10-30',['attributed_fx_explanation'])]})).toBe('2026-10-30')
  expect(fingerprint(inputs)).toBe(before)
 }
})
it('preserves Thursday coverage across a Monday weekend window for all currencies without raising the query budget',async()=>{
 for(const currency of ['BRL','MXN','COP','PEN','CLP','ARS']){
  const snapshot={currency,baseDate:'2026-11-02'},asOf='2026-11-02T12:00:00Z'
  const window=runtimeResearchDates(snapshot,asOf)
  expect(window).toEqual({dates:['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01','2026-11-02'],
   requestedStart:'2026-10-26',checkedStart:'2026-10-26',end:'2026-11-02',coverageLimited:false})
  const fetchImpl=vi.fn(),result=await acquireRuntimeResearch({snapshot,asOf,commentaryTarget:previousWeekdayTarget(snapshot.baseDate),
   sourcePlan,sourceRegister,mode:'saved',fetchImpl,now:()=>asOf})
  expect(fetchImpl).not.toHaveBeenCalled();expect(result.networkCalls).toBe(0)
  expect([...new Set(result.collection.outcomes.map(o=>o.period))].sort()).toEqual(window.dates)
  const m={input:{materials:[{record:{sessionDate:'2026-10-29',claimRoles:{0:'market_observation',1:'attributed_fx_explanation'}}}]}}
  expect(latestReviewedMarketSession({materialInputs:[m],currency,asOf,requestedDates:window.dates})).toBe('2026-10-29')
 }
 expect(()=>runtimeResearchDates({currency:'PEN',baseDate:'2026-09-01'},'2026-11-02T12:00:00Z')).toThrow('research_window_capacity_hold')
 expect(()=>runtimeResearchDates({currency:'PEN',baseDate:'2026-11-09'},'2026-11-02T12:00:00Z')).toThrow('research_window_invalid')
})
it('registers a bound prepared input without calling a writer and preserves the input hash on reload',async()=>{
 const f=options(),store={...memoryRuntimeStore(),stage:vi.fn(async task=>{expect(task.binding).toBe(fingerprint(Object.fromEntries(Object.entries(task).filter(([k])=>k!=='binding'))));return 'local-input'})}
 const acquired={collection:null,networkCalls:0,sources:[],reason:'synthetic_no_addition',completedAt:'2026-10-28T12:00:02Z'}
 const result=await supplyRuntimeInput({...f,store,acquire:async()=>acquired})
 expect(result).toMatchObject({status:'input_staged',modelCalls:0,newPaidCostUsd:0,staged:true})
 expect(store.stage).toHaveBeenCalledTimes(1)
 expect(store.jobs).toHaveLength(0)
 expect(result.asOf).toBe(acquired.completedAt)
 expect(result.task.plan.packet.evidence[0].publishedAt).toBe('2026-10-27')
})
it('reuses the exact staged input on resume instead of hitting the DB payload hash uniqueness constraint',async()=>{
 const f=options();let registered=null
 const store={...memoryRuntimeStore(),input:async()=>registered,stage:vi.fn(async task=>{
  if(registered?.binding===task.binding)throw Error('duplicate_payload_hash')
  registered=structuredClone(task);return 'synthetic-id'
 })}
 const first=await supplyRuntimeInput({...f,store}),second=await supplyRuntimeInput({...f,store})
 expect(first).toMatchObject({staged:true,inputId:'synthetic-id'})
 expect(second).toMatchObject({staged:true,registrationReused:true,inputId:null})
 expect(second.task).toEqual(first.task);expect(store.stage).toHaveBeenCalledTimes(1)
})
it('does not fetch anything when reference data or the publication gate is held',async()=>{
 const acquire=vi.fn(),f=options()
 const result=await supplyRuntimeInput({...f,calendar:{status:'unverified'},acquire})
 expect(result.status).toBe('cadence_hold');expect(acquire).not.toHaveBeenCalled()
})
it('keeps access failure distinct from no new information and never stages a guessed cause',async()=>{
 const f=options(),stage=vi.fn()
 const result=await supplyRuntimeInput({...f,store:{stage},acquire:async()=>{throw Error('publisher_access_failed')}})
 expect(result).toMatchObject({status:'collection_or_review_hold',holds:['publisher_access_failed'],staged:false})
 expect(stage).not.toHaveBeenCalled()
})
it('stops the writer queue after an unresolved source-review expense',async()=>{
 const f=options(),stage=vi.fn()
 const result=await supplyRuntimeInput({...f,store:{stage},acquire:async()=>({collection:emptyCollection(f.asOf),networkCalls:1,sources:[]}),
  review:async()=>({status:'source_cost_unresolved',modelCalls:1,newPaidCostUsd:null})})
 expect(result).toMatchObject({status:'source_cost_unresolved',newPaidCostUsd:null,modelCalls:1})
 expect(stage).not.toHaveBeenCalled()
})
it('uses the real collector in saved mode without making external requests or manufacturing evidence',async()=>{
 const f=options(),fetchImpl=vi.fn()
 const result=await acquireRuntimeResearch({snapshot:f.task.snapshot,asOf:f.asOf,commentaryTarget:target,
  sourcePlan,sourceRegister,mode:'saved',fetchImpl})
 expect(fetchImpl).not.toHaveBeenCalled();expect(result.networkCalls).toBe(0)
 expect(result.collection.reviewQueue).toEqual([])
 expect(result.collection.outcomes.some(o=>o.status==='not_attempted')).toBe(true)
})
it('blocks a new session with only archived explanations and no reviewed initial-check background, while preserving the bundle',async()=>{
 const f=options(),stage=vi.fn(),c=f.handoff.materialConnection
 c.sections.consumer_background=[];delete c.binding;c.binding=fingerprint(c)
 const before=fingerprint(f.handoff)
 const result=await supplyRuntimeInput({...f,commentaryTarget:{date:'2026-10-28',basis:'synthetic'},store:{stage}})
 expect(result.status).toBe('writing_input_hold');expect(stage).not.toHaveBeenCalled()
 expect(fingerprint(f.handoff)).toBe(before)
})
it('keeps a prepared alternative actionable when another outlet is restricted',async()=>{
 const f=options(),stage=vi.fn(),c=f.handoff.materialConnection
 c.sections.consumer_background=[];delete c.binding;c.binding=fingerprint(c)
 const result=await supplyRuntimeInput({...f,commentaryTarget:{date:'2026-10-28',basis:'synthetic'},store:{stage},
  acquire:async()=>({collection:emptyCollection(f.asOf),sources:[],networkCalls:0}),review:async()=>({receipts:[],materialInputs:[],modelCalls:0,newPaidCostUsd:0,
   items:[{status:'processing_restricted',holds:['explicit_external_text_scope_review']},{status:'source_review_budget_required',holds:[]}]})})
 expect(result.status).toBe('source_review_wait')
 expect(result.sourceReviewIssues).toHaveLength(2)
 expect(stage).not.toHaveBeenCalled()
})
