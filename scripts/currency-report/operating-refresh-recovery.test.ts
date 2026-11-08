import {it,expect} from 'vitest'
import {operatingFixture} from './operating-fixture.js'
import {runOperatingCycle} from './operating-cycle.js'
import {operatingResultState} from './operating-result.js'
import {prepareRuntimeReview} from './runtime.js'
import {syntheticRuntimeTransport} from './runtime-fixture.js'
import {fingerprint} from './research-harness.js'
import {REPORT_CURRENCIES} from './shared-price-contract.js'
import {oneTimeOperatingPolicy} from './operating-policy.js'

const run=(f,options={})=>runOperatingCycle({...f,testOnly:false,execute:true,...options})
const waitFor=(f,currencies)=>async(body,profile)=>{
 if(body.response_format.json_schema.name==='currency_runtime_review'){
  const task=[...f.state.inputs.values()].find(t=>fingerprint(prepareRuntimeReview(t,syntheticRuntimeTransport(t).compiled).body)===fingerprint(body))
  if(currencies.includes(task?.currency))throw Error('synthetic_endpoint_wait')
 }
 return f.preflightWriter(body,profile)
}
const changedPrice=(f,currency)=>{
 const data=structuredClone(f.dataset)
 for(const point of data.dailyRates)if(point.currency===currency&&point.date===data.baseDate)point.value*=1.01
 return data
}

it('resumes all six original manuscripts after returned access, extraction and discovery failures instead of superseding missing captures',async()=>{
 for(const currency of REPORT_CURRENCIES)for(const status of ['access_failed','extraction_failed','discovery_incomplete']){
  const f=await operatingFixture(),first=await run(f,{preflightWriter:waitFor(f,[currency])})
  expect(first.status).toBe('paused')
  const before=f.state.posts.length,empty=structuredClone(f.collections[currency])
  empty.originals=[];empty.reviewQueue=[];empty.outcomes=[{sourceId:f.collections[currency].originals[0].sourceId,status}]
  const second=await run(f,{acquire:async a=>({collection:a.snapshot.currency===currency?empty:f.collections[a.snapshot.currency],completedAt:f.asOf,networkCalls:0})})
  expect(second.rows.find(r=>r.currency===currency)).toMatchObject({status:'frozen_source_refresh_wait',modelCalls:0})
  expect(second.status).toBe('paused');expect(f.state.posts.length).toBe(before)
  expect(operatingResultState(second)).toMatchObject({kind:'failure',partialSourceFailure:true,exitCode:1})
  const third=await run(f)
  expect(third.rows.find(r=>r.currency===currency).status).toBe('pending_admin_review')
  expect(f.store.drafts).toHaveLength(6);expect(f.state.posts.length-before).toBe(1)
  const writers=f.store.jobs.filter(j=>j.currency===currency&&!j.context?.purpose&&j.stage==='writer')
  expect(writers).toHaveLength(1)
  const posts=f.state.posts.length;await run(f);expect(f.state.posts.length).toBe(posts)
 }
},30000)

it('treats a successful empty index as no observed replacement and retains the original work for recovery',async()=>{
 const f=await operatingFixture();await run(f,{preflightWriter:waitFor(f,['COP'])})
 const empty={...structuredClone(f.collections.COP),originals:[],reviewQueue:[],outcomes:[{sourceId:'cop-larepublica',status:'no_candidates_in_index'}]}
 const r=await run(f,{acquire:async a=>({collection:a.snapshot.currency==='COP'?empty:f.collections[a.snapshot.currency],completedAt:f.asOf})})
 expect(r.rows.find(row=>row.currency==='COP').status).toBe('frozen_source_refresh_wait')
 expect((await run(f)).rows.find(row=>row.currency==='COP').status).toBe('pending_admin_review')
})

it('waits for a missing current reference instead of treating an incomplete price response as a new edition',async()=>{
 const f=await operatingFixture();await run(f,{preflightWriter:waitFor(f,['COP'])})
 const dataset=structuredClone(f.dataset)
 dataset.dailyRates=dataset.dailyRates.filter(r=>r.currency!=='COP'||r.date!==dataset.baseDate)
 const before=f.state.posts.length,r=await run(f,{dataset})
 expect(r.rows.find(row=>row.currency==='COP')).toMatchObject({status:'frozen_reference_refresh_wait',modelCalls:0})
 expect(f.state.posts.length).toBe(before)
 expect((await run(f)).rows.find(row=>row.currency==='COP').status).toBe('pending_admin_review')
 expect(f.store.drafts).toHaveLength(6)
})

it('continues an unchanged observed input through an unrelated partial source failure while reporting the current failure',async()=>{
 const f=await operatingFixture();await run(f,{preflightWriter:waitFor(f,['COP'])})
 const current=structuredClone(f.collections.COP)
 current.outcomes.push({sourceId:'cop-larepublica',status:'discovery_incomplete',reason:'alternative_index_unavailable'})
 const r=await run(f,{acquire:async a=>({collection:a.snapshot.currency==='COP'?current:f.collections[a.snapshot.currency],completedAt:f.asOf})})
 expect(r.rows.find(row=>row.currency==='COP').status).toBe('pending_admin_review')
 expect(operatingResultState(r)).toMatchObject({kind:'review_wait',partialSourceFailure:true,exitCode:0})
})

it('progresses a changed country while another source stays down and later resumes only the original waiting reviewer',async()=>{
 const f=await operatingFixture();await run(f,{preflightWriter:waitFor(f,['COP','PEN'])})
 const dataset=changedPrice(f,'COP'),posts=f.state.posts.length
 const acquire=async a=>{if(a.snapshot.currency==='PEN')throw Error('synthetic_pen_outage');return f.acquire(a)}
 const second=await run(f,{dataset,acquire})
 expect(second.status).toBe('paused');expect(second.executionBatches).toHaveLength(2)
 expect(second.rows.find(r=>r.currency==='COP').status).toBe('pending_admin_review')
 expect(second.rows.find(r=>r.currency==='PEN').status).toBe('frozen_source_refresh_wait')
 expect(f.store.drafts).toHaveLength(5);expect(f.state.posts.length-posts).toBe(2)
 expect(second.modelCalls).toBe(2);expect(second.confirmedUsd).toBeCloseTo(.02)
 for(let i=0;i<2;i++){
  const before=f.state.posts.length,r=await run(f,{dataset,acquire})
  expect(r.status).toBe('paused');expect(f.state.posts.length).toBe(before)
  expect(r.rows.find(row=>row.currency==='COP').status).toBe('pending_admin_review')
  expect(r.rows.find(row=>row.currency==='PEN').status).toBe('frozen_source_refresh_wait')
 }
 const before=f.state.posts.length,restored=await run(f,{dataset})
 expect(restored.rows.find(r=>r.currency==='PEN').status).toBe('pending_admin_review')
 expect(f.store.drafts).toHaveLength(6);expect(f.state.posts.length-before).toBe(1)
})

it('visits later pending country envelopes instead of permanently selecting only the oldest waiting batch',async()=>{
 const f=await operatingFixture();await run(f,{preflightWriter:waitFor(f,['COP','PEN'])})
 const dataset=changedPrice(f,'COP')
 const acquire=async a=>{if(a.snapshot.currency==='PEN')throw Error('synthetic_pen_outage');return f.acquire(a)}
 await run(f,{dataset,acquire,preflightWriter:waitFor(f,['COP'])})
 expect([...f.state.batches.values()].filter(b=>b.state==='paused')).toHaveLength(2)
 const before=f.state.posts.length,r=await run(f,{dataset,acquire})
 expect(r.rows.find(row=>row.currency==='COP').status).toBe('pending_admin_review')
 expect(r.rows.find(row=>row.currency==='PEN').status).toBe('frozen_source_refresh_wait')
 expect(f.state.posts.length-before).toBe(1);expect(f.store.drafts).toHaveLength(5)
})

it('keeps an unknown response cost as a global stop even when another currency has a fresh edition',async()=>{
 const f=await operatingFixture();await run(f,{preflightWriter:waitFor(f,['COP','PEN'])})
 const before=f.state.posts.length,dataset=changedPrice(f,'COP')
 const r=await run(f,{dataset,send:async args=>({...await f.send(args),costUsd:null,responseId:null})})
 expect(r.unknownCost).toBe(true);expect(f.state.posts.length-before).toBe(1)
 expect(f.store.jobs.filter(j=>j.currency==='COP'&&!j.context?.purpose&&j.stage==='writer')).toHaveLength(1)
 expect(operatingResultState(r)).toMatchObject({kind:'action_required',exitCode:2})
})

it('does not turn a one-time authorization into a second country envelope',async()=>{
 const f=await operatingFixture()
 f.state.policy=oneTimeOperatingPolicy({config:f,datasetBinding:fingerprint(f.dataset),authorizationReference:'synthetic-only',
  configuredAt:'2026-11-01T00:00:00Z',expiresAt:'2026-11-03T00:00:00Z'})
 await run(f,{preflightWriter:waitFor(f,['COP','PEN'])})
 const before=f.state.posts.length,r=await run(f,{dataset:changedPrice(f,'COP'),acquire:async a=>{
  if(a.snapshot.currency==='PEN')throw Error('synthetic_pen_outage');return f.acquire(a)
 }})
 expect(r.status).toBe('paused');expect(f.state.batches.size).toBe(1)
 expect(f.state.posts.length).toBe(before)
})

it('preserves execution errors across envelopes but clears recovered historical lookup failures from the current summary',()=>{
 const r={status:'paused',collectionResults:[],executionBatches:[{status:'paused',rows:[{currency:'COP',
  continuation:{action:'await_pipeline_repair'}}],collectionResults:[{status:'collection_or_history_failed',lookupFailures:[{}]}]}]}
 expect(operatingResultState(r)).toMatchObject({kind:'action_required',exitCode:2,partialSourceFailure:false})
})
