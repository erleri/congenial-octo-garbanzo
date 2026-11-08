import {it,expect} from 'vitest'
import {operatingFixture} from './operating-fixture.js'
import {originalPipelineFixture} from './original-news-pipeline-fixture.js'
import {retainRegisteredResearch} from './retained-research.js'
import {runOperatingCycle} from './operating-cycle.js'
import {RuntimeStoreError} from './runtime-store.js'
import {bindSelectedOriginalReview} from './selected-source-collection.js'
import {operatingResultState} from './operating-result.js'
import {effectiveSourceReview} from './source-review-validity.js'
import {persistDeferredSources,unreviewedSourceCapture} from './operating-source-cache.js'

it('retains a valid registered edition through a total discovery outage using the requested window, while rejecting expired or withdrawn evidence',async()=>{
 const f=await originalPipelineFixture(),record={key:'a'.repeat(64),sourceKey:'b'.repeat(64),original:f.collection.originals[0],card:f.card,review:{receipt:{synthetic:true}}}
 const collection={...structuredClone(f.collection),originals:[],reviewQueue:[]}
 const args={collection,cache:[record],asOf:'2026-10-28T02:00:00Z',sourcePlan:f.sourcePlan,sourceRegister:f.sourceRegister,requestedPeriods:['2026-10-26']}
 const kept=retainRegisteredResearch(args)
 expect(kept.originals).toEqual([record.original]);expect(collection.originals).toEqual([])
 expect(retainRegisteredResearch({...args,requestedPeriods:['2026-10-27']}).originals).toEqual([])
 const withdrawn=structuredClone(record);withdrawn.review.validity={state:'withdrawn'}
 expect(retainRegisteredResearch({...args,cache:[withdrawn]}).originals).toEqual([])
 const pending={...structuredClone(record),kind:'unreviewed_source_capture',key:'c'.repeat(64),review:{validity:{state:'unreviewed'}}}
 const captureWithdrawal={...structuredClone(pending),key:'d'.repeat(64),review:{validity:{state:'withdrawn'}}}
 expect(effectiveSourceReview([pending,captureWithdrawal]).state).toBe('withdrawn')
 expect(()=>retainRegisteredResearch({...args,requestedPeriods:['invalid']})).toThrow('retained_research_window_required')
})

it('isolates transient country history, correction and status storage failures, then recovers without recreating the other five drafts',async()=>{
 for(const operation of ['history','recordCorrections','supplyCheck']){
  const f=await operatingFixture(),original=f.store[operation],seen=[]
  f.store[operation]=async value=>{
   const currency=typeof value==='string'?value:value.currency
   seen.push(currency)
   if(currency==='PEN')throw new RuntimeStoreError('country_operation',{code:'08006'},503)
   return original?original(value):undefined
  }
  const first=await runOperatingCycle({...f,execute:true})
  expect(first.rows.filter(r=>r.status==='pending_admin_review'),operation).toHaveLength(5)
  expect(first.rows.find(r=>r.currency==='PEN').status).toBe('country_preparation_hold')
  expect(first.rows.find(r=>r.currency==='PEN').continuation.action).toBe('wait_for_country_storage')
  expect(first.holds??[]).not.toContain('correction_recording_required')
  f.store[operation]=original??(async()=>{})
  const before=f.state.posts.length
  const resumed=await runOperatingCycle({...f,execute:true})
  expect(resumed.rows.find(r=>r.currency==='PEN').status).toBe('pending_admin_review')
  expect(f.store.drafts).toHaveLength(6)
  expect(f.state.posts.length-before).toBe(4)
  await runOperatingCycle({...f,execute:true})
  expect(f.store.drafts).toHaveLength(6);expect(f.state.posts.length-before).toBe(4)
 }
})

it('keeps shared permission and schema errors as global no-dispatch failures',async()=>{
 for(const code of ['42501','42P01','PGRST301']){
  const f=await operatingFixture()
  f.store.history=async()=>{throw new RuntimeStoreError('currency_report_runtime_history',{code},403)}
  await expect(runOperatingCycle({...f,execute:true})).rejects.toThrow('runtime_store_currency_report_runtime_history_failed')
  expect(f.state.posts).toEqual([])
 }
 const f=await operatingFixture()
 await runOperatingCycle({...f,execute:true,preflightSource:async()=>{throw Error('synthetic_endpoint_outage')}})
 const prior=structuredClone(f.state.batch),key='e'.repeat(64)
 const payload=JSON.parse(prior.payload.serializedOperatingPayload);payload.resumeIdentity=key
 prior.batch_key=key;prior.payload={...payload,serializedOperatingPayload:JSON.stringify(payload)}
 f.state.batches.set(key,prior)
 let reads=0,claims=0
 const claim=f.store.claimBatch
 f.store.claimBatch=async request=>{claims++;return claim(request)}
 f.store.history=async()=>{if(++reads>6)throw new RuntimeStoreError('currency_report_runtime_history',{code:'42501'},403);return []}
 const stopped=await runOperatingCycle({...f,execute:true})
 expect(stopped.status).toBe('operating_execution_hold');expect(stopped.modelCalls).toBe(0);expect(stopped.costUsd).toBe(0)
 expect(claims).toBe(1);expect(f.state.posts).toEqual([])
})

it('accepts only a verified concurrent immutable capture and never hides a permission failure behind an existing winner',async()=>{
 const f=await operatingFixture(),collection=f.collections.COP,rules=f.state.policy.processingRulesBinding
 const record=unreviewedSourceCapture(collection,collection.reviewQueue[0].binding,rules)
 const country={currency:'COP',collection,preparation:{deferredCardBindings:[record.card.binding]}}
 let reads=0
 const store={sourceCache:async()=>++reads===1?[]:[record],
  saveSourceReview:async()=>{throw new RuntimeStoreError('save_currency_report_operating_source_review',{code:'22023'},400)}}
 await expect(persistDeferredSources([country],store,rules)).resolves.toBeUndefined()
 reads=0
 store.saveSourceReview=async()=>{throw new RuntimeStoreError('save_currency_report_operating_source_review',{code:'42501'},403)}
 await expect(persistDeferredSources([country],store,rules)).rejects.toThrow('runtime_store_save_currency_report_operating_source_review_failed')
 expect(reads).toBe(1)
})

it('budgets many candidates fairly and continues source work from saved reviews in the next envelope without raising any limit',async()=>{
 const f=await operatingFixture(),collection=f.collections.PEN,original=collection.originals[0],card=collection.reviewQueue[0]
 const pairs=Array.from({length:25},(_,i)=>{
  const record={...structuredClone(original),url:`https://rpp.pe/economia/economia/synthetic-${i}-noticia-${100+i}`}
  record.blocks[0].text+=` Synthetic candidate ${i}.`
  delete record.id;delete record.sourceId
  return bindSelectedOriginalReview({request:{sourceId:original.sourceId,period:'2026-10-27'},record,adapter:'reviewed_news_notes',
   requestIds:['synthetic'],targets:card.targets,currency:'PEN',asOf:collection.asOf})
 })
 collection.originals=pairs.map(p=>p.original);collection.reviewQueue=pairs.map(p=>p.review)
 const send=f.send
 let held=0
 const attemptedTexts=[]
 f.send=async args=>{
  const input=JSON.parse(args.body.messages[1].content)
  if(input.currency==='PEN'&&args.body.response_format.json_schema.name==='original_news_extract')attemptedTexts.push(input.blocks[0].text)
  if(input.currency==='PEN'&&args.body.response_format.json_schema.name==='original_news_extract'&&!input.blocks[0].text.endsWith('Synthetic candidate 24.')){
   held++
   return {valid:true,actualModel:args.body.model,costUsd:.001,responseId:`gen-synthetic-held-${held}`,
    payload:{choices:[{message:{content:JSON.stringify({decision:'insufficient_information',role:'unrelated',eventDate:'',priceKind:'not_applicable',
     marketPeriod:null,eventDateEvidence:{basis:'unknown',quote:'',blockPositions:[],relation:'none'},reason:'Synthetic article gives no supported causal explanation.',claims:[]})}}]},generationCalls:1,retries:0}
  }
  return send(args)
 }
 const plan=await runOperatingCycle({...f,execute:false})
 expect(plan.maximumUsd).toBeLessThanOrEqual(7);expect(plan.maxCalls).toBeLessThanOrEqual(60)
 expect(plan.holds??[]).not.toContain('batch_cost_exceeds_configuration')
 expect(plan.rows.every(r=>r.articles>0)).toBe(true)
 const first=await runOperatingCycle({...f,execute:true})
 expect(first.rows.filter(r=>r.status==='pending_admin_review'),JSON.stringify(first.rows)).toHaveLength(5)
 expect(first.rows.find(r=>r.currency==='PEN').status).toBe('source_dispatch_deferred')
 expect(operatingResultState(first).kind).not.toBe('action_required')
 const firstHeld=held
 // Simulate a fresh runner whose rolling listing has lost every PEN article.
 // Only the durable private cache survives; no in-memory collection is reused.
 const acquire=f.acquire
 f.acquire=async args=>args.snapshot.currency==='PEN'?{collection:{...f.collections.PEN,originals:[],reviewQueue:[],outcomes:[]},
  researchWindow:{dates:['2026-10-27']},completedAt:f.asOf}:acquire(args)
 let second
 for(let cycle=0;cycle<3;cycle++){
  second=await runOperatingCycle({...f,execute:true})
  if(second.rows.find(r=>r.currency==='PEN').status==='pending_admin_review')break
 }
 expect(attemptedTexts.some(t=>t.endsWith('Synthetic candidate 24.')),JSON.stringify(attemptedTexts)).toBe(true)
 expect(second.rows.find(r=>r.currency==='PEN').status,JSON.stringify(second.rows.find(r=>r.currency==='PEN'))).toBe('pending_admin_review')
 expect(held).toBe(24);expect(firstHeld).toBeLessThan(24)
 expect(f.store.drafts).toHaveLength(6)
 const total=f.state.posts.length,heldBefore=held
 await runOperatingCycle({...f,execute:true})
 expect(f.state.posts.length).toBe(total);expect(held).toBe(heldBefore)
 expect(f.state.policy.limits).toMatchObject({batchUsd:7,maxCalls:60,monthlyUsd:7})
})
