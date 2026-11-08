import {it,expect,vi} from 'vitest'
import fs from 'node:fs'
import {runtimeFixture} from './runtime-fixture.js'
import {planAutomaticSupply} from './automatic-supply-plan.js'
import {proposeOperatingPolicy} from './operating-batch-plan.js'
import {operatingFixture} from './operating-fixture.js'
import {bindSelectedOriginalReview} from './selected-source-collection.js'

it('plans every due country from the registered acquisition adapter, isolates a failed country and never activates or spends',async()=>{
 const currencies=['BRL','MXN','COP','PEN','CLP','ARS'],examples=currencies.map(c=>runtimeFixture(c))
 const dataset={...examples[0].dataset,dailyRates:examples.flatMap(f=>f.dataset.dailyRates)},asOf='2026-11-01T04:00:00Z'
 const sourcePlan=JSON.parse(fs.readFileSync('docs/2.0/six-currency-explanation-sources-20261027.json','utf8'))
 const sourceRegister=JSON.parse(fs.readFileSync('docs/2.0/six-currency-source-register-20261027.json','utf8'))
 const processingRules=JSON.parse(fs.readFileSync('docs/2.0/material-processing-rules.json','utf8'))
 const registry=JSON.parse(fs.readFileSync('docs/2.0/original-news-source-policy-20261028.json','utf8'))
 const acquire=vi.fn(async args=>{
  if(args.snapshot.currency==='BRL')throw Error('synthetic_collection_failure')
  return {collection:{version:'selected-source-collection/1',currency:args.snapshot.currency,asOf,
   originals:[],reviewQueue:[],outcomes:[]},completedAt:'2026-11-01T04:00:03Z'}
 })
 const store={history:async()=>[],control:async()=>({enabled:false,review_enabled:false,writer:'sol',monthly_limit_nano:0})}
 const result=await planAutomaticSupply({dataset,asOf,calendarByCurrency:Object.fromEntries(examples.map(f=>[f.currency,f.calendar])),store,
  policy:proposeOperatingPolicy({sourcePlan,sourceRegister,processingRules}),sourcePlan,sourceRegister,registry,processingRules,acquire})
 expect(acquire).toHaveBeenCalledTimes(6)
 expect(result.asOf).toBe('2026-11-01T04:00:03Z')
 expect(result.collectionResults[0]).toMatchObject({currency:'BRL',status:'collection_or_history_failed'})
 expect(result.collectionResults.slice(1).every(r=>r.status==='collection_returned_not_approved')).toBe(true)
 expect(result.rows[0].holds).toContain('source_acquisition_failed')
 expect(result.authorizationCandidate.authorized).toBe(false)
 expect(result).toMatchObject({standingPolicyActivated:false,modelCalls:0,publicationApproved:false})
 expect(acquire.mock.calls.every(([args])=>args.mode==='saved')).toBe(true)
})

it('persists one candidate per outlet across six currencies without promoting unknown articles to events, corrections or paid inputs',async()=>{
 const f=await operatingFixture(),monitors=new Map(),corrections:unknown[]=[],before=JSON.stringify(f.collections)
 const acquire=async({snapshot})=>{
  const collection=structuredClone(f.collections[snapshot.currency]),record={...collection.originals[0],url:`https://unknown.example.org/${snapshot.currency}/dolar`}
  delete record.id
  const bound=bindSelectedOriginalReview({record,request:{sourceId:record.sourceId,period:'2026-10-27'},adapter:'reviewed_news_notes',
   requestIds:['synthetic'],currency:snapshot.currency,asOf:f.asOf,targets:[{needId:'market',requestedPeriod:'2026-10-27'}]})
  collection.originals=[bound.original];collection.reviewQueue=[bound.review]
  return {collection,completedAt:f.asOf}
 }
 const store={...f.store,sourceMonitor:async c=>monitors.get(c)??null,saveSourceMonitor:vi.fn(async(state,previous)=>{
  if((monitors.get(state.currency)?.binding??null)!==previous)return false
  monitors.set(state.currency,structuredClone(state));return true
 }),recordCorrections:vi.fn(async r=>{corrections.push(r);return {inserted:0}})}
 const result=await planAutomaticSupply({...f,policy:f.state.policy,store,acquire})
 expect(result.collectionResults.every(r=>r.sourceMonitorStatus==='recorded'&&r.newMaterialCandidates===0)).toBe(true)
 expect(result.sourcePlans).toEqual([])
 expect(result.privateCountries.every(c=>c.collection.originals.length===0)).toBe(true)
 expect(monitors.size).toBe(6)
 expect([...monitors.values()].every(m=>m.candidates.length===1&&!m.writingEligible)).toBe(true)
 const second=await planAutomaticSupply({...f,policy:f.state.policy,store,acquire})
 expect(second.collectionResults.every(r=>r.sourceMonitor.candidates.length===1)).toBe(true)
 expect(second.modelCalls).toBe(0)
 expect(JSON.stringify(f.collections)).toBe(before)
 expect(corrections.every(r=>(r as {candidates:unknown[]}).candidates.length===0)).toBe(true)
})

it('continues registered preparation when candidate monitoring fails or a concurrent monitor update wins',async()=>{
 const f=await operatingFixture(),baseline=await planAutomaticSupply({...f,policy:f.state.policy})
 const failed=await planAutomaticSupply({...f,policy:f.state.policy,store:{...f.store,sourceMonitor:async()=>{throw Error('synthetic_monitor_read_failure')}}})
 expect(failed.rows).toEqual(baseline.rows)
 expect(failed.collectionResults.every(r=>r.sourceMonitorStatus==='storage_or_validation_failed')).toBe(true)
 const concurrent=await planAutomaticSupply({...f,policy:f.state.policy,store:{...f.store,sourceMonitor:async()=>null,saveSourceMonitor:async()=>false}})
 expect(concurrent.rows).toEqual(baseline.rows)
 expect(concurrent.collectionResults.every(r=>r.sourceMonitorStatus==='concurrent_update_deferred')).toBe(true)
})
