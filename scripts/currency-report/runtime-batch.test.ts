import {expect,it,vi} from 'vitest'
import {runOperationalReportBatch,countryWorkOrder} from './runtime-batch.js'
import {runtimeFixture,memoryRuntimeStore,runtimeTestEnv} from './runtime-fixture.js'
import {fingerprint} from './research-harness.js'
import fs from 'node:fs'

it('schedules already reviewed coherent observations and explanations before unresolved source work without treating the hint as approval',()=>{
 const pending={currency:'COP',savedSourceReviews:[]}
 const reviewed={currency:'PEN',savedSourceReviews:[{receipt:{synthetic:true},materialInput:{materials:[{record:{sessionDate:'2026-10-27',claimRoles:{a:'market_observation',b:'attributed_fx_explanation'}}}]}}]}
 expect(countryWorkOrder([pending,reviewed]).map(c=>c.currency)).toEqual(['PEN','COP'])
 const mismatched=structuredClone(reviewed)
 mismatched.savedSourceReviews[0].materialInput.materials[0].record.claimRoles={a:'market_observation'}
 mismatched.savedSourceReviews.push({receipt:{synthetic:true},materialInput:{materials:[{record:{sessionDate:'2026-10-28',claimRoles:{a:'attributed_fx_explanation'}}}]}})
 expect(countryWorkOrder([pending,mismatched]).map(c=>c.currency)).toEqual(['COP','PEN'])
 expect(pending.savedSourceReviews).toEqual([])
})

function fixture(){
 const currencies=['BRL','MXN','CLP','COP','PEN','ARS'],asOf='2026-11-01T04:00:00Z'
 const fixtures=currencies.map(c=>runtimeFixture(c))
 for(const f of fixtures){
  const c=f.handoff.materialConnection
  for(const role of ['global_context','countercontext','policy_background','watch_context'])c.sections[role]=[]
  for(const item of Object.values(c.sections).flat())item.eventDate=item.sourceSessionDate
  c.sourceUseSummary=[];c.externalSourceAttributions=[];c.excluded=[]
  delete c.binding;c.binding=fingerprint(c)
 }
 const dataset={...fixtures[0].dataset,dailyRates:fixtures.flatMap(f=>f.dataset.dailyRates)}
 const countries=fixtures.map(f=>({currency:f.currency,calendar:f.calendar,commentaryTarget:{date:'2026-10-27',basis:'synthetic'},
  handoff:f.handoff,collection:{version:'selected-source-collection/1',currency:f.currency,asOf,originals:[],reviewQueue:[],outcomes:[]}}))
 const sourcePlan=JSON.parse(fs.readFileSync('docs/2.0/six-currency-explanation-sources-20261027.json','utf8'))
 const sourceRegister=JSON.parse(fs.readFileSync('docs/2.0/six-currency-source-register-20261027.json','utf8'))
 const registry=JSON.parse(fs.readFileSync('docs/2.0/original-news-source-policy-20261028.json','utf8'))
 const processingRules=JSON.parse(fs.readFileSync('docs/2.0/material-processing-rules.json','utf8'))
 const approval={version:'operational-report-batch-approval/1',authorized:true,maxReports:6,maxCalls:12,budgetUsd:3,sourceBudgetUsd:0,
  asOf,sourcePlanBindings:[],datasetBinding:fingerprint(dataset),rulesBinding:fingerprint(processingRules),countriesBinding:fingerprint(countries)}
 return {dataset,countries,asOf,sourcePlan,sourceRegister,registry,processingRules,approval,env:runtimeTestEnv}
}
it('requires a complete exact authorized batch before source collection or paid transport',async()=>{
 const f=fixture(),store=memoryRuntimeStore(),send=vi.fn()
 for(const change of [a=>a.authorized=false,a=>a.countriesBinding='changed',a=>a.budgetUsd=2.99]){
  const approval=structuredClone(f.approval);change(approval)
  await expect(runOperationalReportBatch({...f,approval,store,send})).rejects.toThrow('bound_operational_batch_budget_required')
 }
 expect(await runOperationalReportBatch({...f,store:{...store,control:async()=>({...store.config,enabled:false})},send})).toMatchObject({status:'runtime_disabled',modelCalls:0})
 expect(send).not.toHaveBeenCalled();expect(store.jobs).toHaveLength(0)
})
it('records a held country and continues every other currency without fabricating drafts or making model calls',async()=>{
 const f=fixture(),store={...memoryRuntimeStore(),history:async()=>[]},send=vi.fn(),events=[]
 const failed=structuredClone(f.countries);failed[0].calendar={status:'unverified'}
 const approval={...f.approval,countriesBinding:fingerprint(failed)}
 const result=await runOperationalReportBatch({...f,countries:failed,approval,store,send,
  checkpoint:async(currency,stage,value)=>{events.push({currency,stage,status:value.status})}})
 expect(result.rows.map(r=>r.currency)).toEqual(['BRL','MXN','COP','PEN','CLP','ARS'])
 expect(result.rows[0]).toMatchObject({status:'cadence_hold'})
 expect(result.rows.every(r=>r.runId===null&&r.publicationApproved===false)).toBe(true)
 expect(result).toMatchObject({modelCalls:0,costUsd:0,manualEdits:0,publicationApproved:false})
 expect(events.filter(e=>e.stage==='generation')).toHaveLength(6)
 expect(send).not.toHaveBeenCalled();expect(store.drafts).toHaveLength(0)
})
it('retains a timed-out writer reservation and prevents every later country from spending',async()=>{
 const f=fixture(),countries=structuredClone(f.countries),clp=countries.find(c=>c.currency==='CLP')
 const c=clp.handoff.materialConnection
 for(const item of Object.values(c.sections).flat())item.sourceUrl='https://www.emol.com/noticias/Economia/synthetic.html'
 delete c.binding;c.binding=fingerprint(c)
 const tasks=new Map(),store={...memoryRuntimeStore(),history:async()=>[],stage:async task=>{tasks.set(task.currency,structuredClone(task));return 'synthetic-staged'},
  input:async currency=>tasks.get(currency)??null}
 const send=vi.fn(async()=>{throw Error('synthetic transport timeout')})
 const approval={...f.approval,countriesBinding:fingerprint(countries)}
 const result=await runOperationalReportBatch({...f,countries,approval,store,send,
  preflightWriter:async(body,profile)=>({model:body.model,route:profile.route,zdr:true,dataCollection:'deny'})})
 expect(send,JSON.stringify(result)).toHaveBeenCalledTimes(1)
 expect(result).toMatchObject({status:'batch_cost_unresolved',modelCalls:1,costUsd:null,unknownCost:true,manualEdits:0})
 expect(result.rows.find(r=>r.currency==='ARS')).toMatchObject({status:'batch_cost_unresolved_no_call',modelCalls:0})
 expect(store.jobs[0]).toMatchObject({costState:'unknown',state:'received'})
 expect(store.drafts).toHaveLength(0)
})
