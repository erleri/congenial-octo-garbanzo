import {it,expect,vi} from 'vitest'
import fs from 'node:fs'
import {runtimeFixture} from './runtime-fixture.js'
import {planAutomaticSupply} from './automatic-supply-plan.js'
import {proposeOperatingPolicy} from './operating-batch-plan.js'
import {operatingFixture} from './operating-fixture.js'
import {bindSelectedOriginalReview} from './selected-source-collection.js'
import {sourceRefreshBudget} from './source-refresh-budget.js'
import {inspectSourceAdmission,sourceAdmissionHash} from './source-admission.js'
import {sourceTermsContent} from './source-scope-policy.js'
import {acquireRuntimeResearch} from './runtime-supply.js'

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
 for(const sourceAdmissions of [async()=>{throw Error('source settings unavailable')},async()=>({proofs:[],decisions:[],policies:{invalid:true}})]){
  const unavailable=await planAutomaticSupply({...f,policy:f.state.policy,store:{...f.store,sourceAdmissions}})
  expect(unavailable.rows).toEqual(baseline.rows)
  expect(unavailable.collectionResults.every(r=>r.sourceStates.some(s=>s.status==='source_admission_settings_unavailable'))).toBe(true)
 }
})

it('finishes every registered country before a stalled optional source lookup and preserves their preparation at the deadline',async()=>{
 const f=await operatingFixture(),baseline=await planAutomaticSupply({...f,policy:f.state.policy})
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']})
 try{
  const order:string[]=[],acquire=async args=>{order.push(args.snapshot.currency);return f.acquire(args)}
  let signal:AbortSignal|undefined
  const pending=planAutomaticSupply({...f,policy:f.state.policy,acquire,createSourceBudget:()=>sourceRefreshBudget({maxDurationMs:50}),
   store:{...f.store,sourceAdmissions:async options=>{order.push('source-settings');signal=options.signal;return new Promise(()=>{})}}})
  await vi.advanceTimersByTimeAsync(50)
  const result=await pending
  expect(order).toEqual(['BRL','MXN','COP','PEN','CLP','ARS','source-settings'])
  expect(signal?.aborted).toBe(true);expect(result.rows).toEqual(baseline.rows)
  expect(result.collectionResults.every(r=>r.sourceStates.some(s=>s.status==='source_admission_settings_unavailable'))).toBe(true)
  expect(result.modelCalls).toBe(0);expect(result.publicationApproved).toBe(false)
 }finally{vi.useRealTimers()}
})

it('refreshes stale terms after baseline collection, then collects an eligible supplemental article in the same execution without repeating registered routes',async()=>{
 const f=await operatingFixture(),order:string[]=[],host='supplement.example.org',url=`https://${host}/economia/dolar`,termsUrl=`https://${host}/terms/`
 const terms='Synthetic publisher terms explicitly describe private analysis of its own public articles with independent factual references and attribution. '.repeat(3)
 const html=`<script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',url,headline:'El dólar durante la sesión',datePublished:'2026-10-27T20:00:00Z',
  publisher:{name:'Supplement Example',url:`https://${host}/`},isAccessibleForFree:true,articleBody:f.collections.COP.originals[0].blocks.map(b=>b.text).join('\n')})}</script>`
 const robots='User-agent: *\nAllow: /',proof=inspectSourceAdmission({currency:'COP',url,html,robotsText:robots,collectedAt:f.asOf,asOf:f.asOf})
 const policy={id:'supplement-policy',currency:'COP',host,pathPrefix:'/economia/',publisher:'Supplement Example',termsUrl,action:'apply',revision:2,
  scopes:{discover:true,collect:true,analyze:true,publishNotes:true},approvedTermsHash:sourceTermsContent(terms).hash,decidedAt:f.asOf,
  expiresAt:new Date(Date.parse(f.asOf)+90*86400000).toISOString()}
 const state={proofs:[proof],decisions:[],policies:[policy],terms:[{policyId:policy.id,url:termsUrl,status:'available',hash:policy.approvedTermsHash,
  checkedAt:new Date(Date.parse(f.asOf)-86400000).toISOString()}]}
 const captures=[{url,text:html},{url:`https://${host}/robots.txt`,text:robots},{url:termsUrl,text:terms}]
  .map(c=>({...c,sourceId:'unregistered',httpStatus:200,collectedAt:f.asOf,sha256:sourceAdmissionHash(c.text)}))
 const acquire=async args=>{
  order.push(`${args.supplementalOnly?'supplement':'registered'}:${args.snapshot.currency}`)
  if(args.supplementalOnly)return acquireRuntimeResearch({...args,now:()=>f.asOf,officialInputLoader:()=>{throw Error('supplement_must_not_repeat_official_acquisition')}})
  return f.acquire(args)
 }
 const result=await planAutomaticSupply({...f,policy:f.state.policy,acquire,capturesByCurrency:{COP:captures},
  store:{...f.store,sourceAdmissions:async()=>{order.push('source-settings');return structuredClone(state)},saveSourceTerms:async check=>{
   order.push('terms-save');state.terms=[check];return true
  }}})
 expect(order).toEqual(['registered:BRL','registered:MXN','registered:COP','registered:PEN','registered:CLP','registered:ARS','source-settings','terms-save','supplement:COP'])
 expect(result.sourceSupplementResults).toEqual([{currency:'COP',status:'collected_pending_review'}])
 const cop=result.privateCountries.find(c=>c.currency==='COP')
 expect(cop.collection.originals.some(o=>o.url===url)).toBe(true)
 for(const original of f.collections.COP.originals)expect(cop.collection.originals.some(o=>o.id===original.id)).toBe(true)
 expect(result.sourcePlans.some(p=>p.job.url===url&&p.holds.length===0)).toBe(true)
 expect(result.modelCalls).toBe(0);expect(result.publicationApproved).toBe(false)
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']})
 try{
  let finishLate:(value:unknown)=>void,signal:AbortSignal|undefined
  const pending=planAutomaticSupply({...f,policy:f.state.policy,capturesByCurrency:{COP:captures},
   createSourceBudget:()=>sourceRefreshBudget({maxDurationMs:50}),store:{...f.store,sourceAdmissions:async()=>structuredClone(state)},
   acquire:async args=>{
    if(!args.supplementalOnly)return f.acquire(args)
    signal=args.signal;return new Promise(resolve=>{finishLate=resolve})
   }})
  await vi.advanceTimersByTimeAsync(50)
  const deferred=await pending
  expect(signal?.aborted).toBe(true)
  expect(deferred.sourceSupplementResults).toEqual([{currency:'COP',status:'deferred',reason:'source_refresh_time_budget'}])
  expect(deferred.privateCountries.find(c=>c.currency==='COP').collection.originals.some(o=>o.url===url)).toBe(false)
  expect(deferred.rows).toHaveLength(6)
  expect(deferred.collectionResults.find(c=>c.currency==='COP').sourceStates).toContainEqual({sourceId:'source-supplement',status:'source_refresh_time_budget'})
  const frozen=JSON.stringify(deferred)
  finishLate!({collection:cop.collection,completedAt:f.asOf})
  await vi.advanceTimersByTimeAsync(1)
  expect(JSON.stringify(deferred)).toBe(frozen)
 }finally{vi.useRealTimers()}
})
