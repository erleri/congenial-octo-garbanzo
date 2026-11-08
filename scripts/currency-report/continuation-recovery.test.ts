import {it,expect} from 'vitest'
import {operatingFixture} from './operating-fixture.js'
import {runOperatingCycle} from './operating-cycle.js'
import {countryContinuation,researchFeedback} from './research-continuation.js'
import {operatingResultState} from './operating-result.js'
import {bindSelectedOriginalReview} from './selected-source-collection.js'
import {operatingSourceRecords,reuseOperatingSources} from './operating-source-cache.js'
import {fingerprint} from './research-harness.js'
import {REPORT_CURRENCIES} from './shared-price-contract.js'

function anotherArticle(collection) {
 const prior=collection.originals[0],record=structuredClone(prior)
 record.url+='-another-article';delete record.id;delete record.sourceId
 const bound=bindSelectedOriginalReview({record,request:{sourceId:prior.sourceId,period:'2026-10-27'},adapter:'reviewed_news_notes',
  requestIds:['synthetic-refresh'],currency:collection.currency,asOf:collection.asOf,targets:collection.reviewQueue[0].targets})
 collection.originals.push(bound.original);collection.reviewQueue.push(bound.review)
 return collection
}

it('resumes only the uncompleted reviewer for each currency with production identities and preserves the paid writer',async()=>{
 for(const currency of REPORT_CURRENCIES){
  const f=await operatingFixture(),sends=[];let failed=false
  const send=async args=>{sends.push(args);return f.send(args)}
  const first=await runOperatingCycle({...f,testOnly:false,execute:true,send,preflightWriter:async(body,profile)=>{
   // The active staged input identifies the writer's currency; reviewer input uses its claim contract.
   if(!failed&&body.response_format.json_schema.name==='currency_runtime_review'
    &&[...f.state.inputs.values()].at(-1).currency===currency){failed=true;throw Error('synthetic_temporary_endpoint')}
   return f.preflightWriter(body,profile)
  }})
  expect(first.status).toBe('paused')
  expect(first.rows.find(r=>r.currency===currency)).toMatchObject({status:'runtime_endpoint_preflight_wait',continuation:{resumeExact:true}})
  expect(f.store.drafts).toHaveLength(5)
  const count=sends.length,writerJobs=f.store.jobs.filter(j=>j.currency===currency&&j.context?.purpose!=='original_source_review'&&j.stage==='writer')
  expect(writerJobs).toHaveLength(1);expect(writerJobs[0].state).toBe('received')
  const second=await runOperatingCycle({...f,testOnly:false,execute:true,send})
  expect(second.rows.find(r=>r.currency===currency).status,JSON.stringify(second)).toBe('pending_admin_review')
  expect(sends.length-count).toBe(1);expect(f.store.drafts).toHaveLength(6)
  expect(f.store.jobs.filter(j=>j.currency===currency&&j.context?.purpose!=='original_source_review'&&j.stage==='writer')).toHaveLength(1)
  expect(first.publicationApproved||second.publicationApproved).toBe(false)
 }
},20000)

it('finalizes a paid manuscript once when the DB commits but its acknowledgement is lost',async()=>{
 const f=await operatingFixture(),finish=f.store.finish;let lose=true
 f.store.finish=async(...args)=>{
  const id=await finish(...args)
  if(lose&&args[1]){lose=false;throw Error('synthetic_acknowledgement_lost')}
  return id
 }
 const first=await runOperatingCycle({...f,testOnly:false,execute:true})
 expect(first.status).toBe('paused');expect(f.store.drafts).toHaveLength(6)
 const ids=f.store.drafts.map(d=>d.runId),before=f.state.posts.length
 const second=await runOperatingCycle({...f,testOnly:false,execute:true})
 expect(second.rows.find(r=>r.currency==='BRL').status,JSON.stringify(second)).toBe('pending_admin_review')
 expect(f.state.posts.length).toBe(before);expect(f.store.drafts.map(d=>d.runId)).toEqual(ids)
})

it('resumes the frozen country batch even when another country has fresh news and the KST date changes',async()=>{
 const f=await operatingFixture();let fail=true
 const first=await runOperatingCycle({...f,testOnly:false,execute:true,preflightSource:async request=>{
  if(fail&&request.stage==='compare'&&JSON.parse(request.body.messages[1].content).currency==='COP'){fail=false;throw Error('synthetic_endpoint')}
  return f.preflightSource()
 }})
 const originalKey=first.batchKey,before=f.state.posts.length
 const second=await runOperatingCycle({...f,testOnly:false,execute:true,asOf:'2026-11-02T04:00:00Z',acquire:async args=>({
  collection:args.snapshot.currency==='BRL'?anotherArticle(structuredClone(f.collections.BRL)):f.collections[args.snapshot.currency],
  completedAt:'2026-11-02T04:00:00Z',networkCalls:0
 })})
 expect(second.batchKey).toBe(originalKey);expect(second.deferredFreshMaterial).toBe(true)
 expect(second.rows.find(r=>r.currency==='COP').status,JSON.stringify(second)).toBe('pending_admin_review')
 expect(f.state.posts.length-before).toBe(3);expect(f.store.drafts).toHaveLength(6)
 expect(f.store.jobs.filter(j=>j.currency==='COP'&&j.context?.sourceStage==='extract')).toHaveLength(1)
})

it('closes only the affected frozen country then admits its new reference edition on the next cycle',async()=>{
 const f=await operatingFixture();let fail=true
 const first=await runOperatingCycle({...f,testOnly:false,execute:true,preflightSource:async request=>{
  if(fail&&request.stage==='compare'&&JSON.parse(request.body.messages[1].content).currency==='COP'){fail=false;throw Error('synthetic_endpoint')}
  return f.preflightSource()
 }})
 const oldJobs=fingerprint(f.store.jobs),dataset=structuredClone(f.dataset)
 for(const point of dataset.dailyRates)if(point.currency==='COP'&&point.date===dataset.baseDate)point.value*=1.01
 const second=await runOperatingCycle({...f,dataset,testOnly:false,execute:true})
 expect(second.batchKey).toBe(first.batchKey)
 expect(second.rows.find(r=>r.currency==='COP')).toMatchObject({status:'frozen_country_reference_superseded',modelCalls:0})
 expect(fingerprint(f.store.jobs)).toBe(oldJobs)
 const third=await runOperatingCycle({...f,dataset,testOnly:false,execute:true})
 expect(third.batchKey).not.toBe(first.batchKey)
 expect(third.rows.find(r=>r.currency==='COP').status).toBe('pending_admin_review')
 expect(f.store.drafts).toHaveLength(6)
})

it('keeps each unfinished writer safe across own and unrelated reference updates without orphaning another country',async()=>{
 for(const currency of REPORT_CURRENCIES)for(const changed of [currency,REPORT_CURRENCIES.find(c=>c!==currency)]){
  const f=await operatingFixture();let failed=false
  const first=await runOperatingCycle({...f,testOnly:false,execute:true,preflightWriter:async(body,profile)=>{
   if(!failed&&body.response_format.json_schema.name==='currency_runtime_review'&&[...f.state.inputs.values()].at(-1).currency===currency){failed=true;throw Error('synthetic_endpoint')}
   return f.preflightWriter(body,profile)
  }})
  expect(first.status).toBe('paused')
  const jobs=structuredClone(f.store.jobs),before=f.state.posts.length,dataset=structuredClone(f.dataset)
  for(const point of dataset.dailyRates)if(point.currency===changed&&point.date===dataset.baseDate)point.value*=1.01
  const second=await runOperatingCycle({...f,dataset,testOnly:false,execute:true})
  expect(second.batchKey).toBe(first.batchKey)
  const own=changed===currency
  expect(second.rows.find(r=>r.currency===currency).status,JSON.stringify(second)).toBe(own?'frozen_country_reference_superseded':'pending_admin_review')
  expect(f.state.posts.length-before).toBe(own?0:1)
  if(own){
   expect(f.store.jobs).toEqual(jobs)
   const third=await runOperatingCycle({...f,dataset,testOnly:false,execute:true})
   expect(third.rows.find(r=>r.currency===currency).status,JSON.stringify(third)).toBe('pending_admin_review')
   const writers=f.store.jobs.filter(j=>j.currency===currency&&!j.context?.purpose&&j.stage==='writer')
   expect(writers).toHaveLength(2)
   expect(writers[0].taskKey).not.toBe(writers[1].taskKey)
   expect(writers[0].response).toEqual(jobs.find(j=>j.id===writers[0].id).response)
   expect(writers[0].actual).toBe(jobs.find(j=>j.id===writers[0].id).actual)
   const posts=f.state.posts.length
   await runOperatingCycle({...f,dataset,testOnly:false,execute:true})
   expect(f.state.posts.length).toBe(posts)
  }
  expect(f.store.drafts).toHaveLength(6)
 }
},30000)

it('finishes an unchanged waiting country while closing another changed waiting edition in the original batch',async()=>{
 const f=await operatingFixture(),failed=new Set()
 const first=await runOperatingCycle({...f,testOnly:false,execute:true,preflightWriter:async(body,profile)=>{
  const currency=[...f.state.inputs.values()].at(-1).currency
  if(['COP','PEN'].includes(currency)&&!failed.has(currency)&&body.response_format.json_schema.name==='currency_runtime_review'){
   failed.add(currency);throw Error('synthetic_endpoint')
  }
  return f.preflightWriter(body,profile)
 }})
 expect(first.status).toBe('paused');expect(f.store.drafts).toHaveLength(4)
 const dataset=structuredClone(f.dataset),before=f.state.posts.length
 for(const point of dataset.dailyRates)if(point.currency==='COP'&&point.date===dataset.baseDate)point.value*=1.01
 const second=await runOperatingCycle({...f,dataset,testOnly:false,execute:true})
 expect(second.batchKey).toBe(first.batchKey)
 expect(second.rows.find(r=>r.currency==='COP').status).toBe('frozen_country_reference_superseded')
 expect(second.rows.find(r=>r.currency==='PEN').status).toBe('pending_admin_review')
 expect(f.state.posts.length-before).toBe(1)
 const third=await runOperatingCycle({...f,dataset,testOnly:false,execute:true})
 expect(third.rows.find(r=>r.currency==='COP').status,JSON.stringify(third)).toBe('pending_admin_review')
 expect(f.store.drafts).toHaveLength(6)
})

it('distinguishes a newly discovered article from a revision to a used source while another manuscript waits',async()=>{
 for(const change of ['unused_new_article','used_source_revision']){
 const f=await operatingFixture(),failed=new Set()
 const first=await runOperatingCycle({...f,testOnly:false,execute:true,preflightWriter:async(body,profile)=>{
  const currency=[...f.state.inputs.values()].at(-1).currency
  if(['COP','PEN'].includes(currency)&&!failed.has(currency)&&body.response_format.json_schema.name==='currency_runtime_review'){
   failed.add(currency);throw Error('synthetic_endpoint')
  }
  return f.preflightWriter(body,profile)
 }})
 const collection=structuredClone(f.collections.COP)
 if(change==='unused_new_article')anotherArticle(collection)
 else{
  const record=structuredClone(collection.originals[0]),prior=collection.reviewQueue[0]
  record.blocks[0].text+=' Nueva edición de la misma fuente.';delete record.id;delete record.sourceId
  const bound=bindSelectedOriginalReview({record,request:{sourceId:prior.sourceId,period:'2026-10-27'},adapter:'reviewed_news_notes',
   requestIds:['synthetic-used-revision'],currency:'COP',asOf:collection.asOf,targets:prior.targets})
  collection.originals[0]=bound.original;collection.reviewQueue[0]=bound.review
 }
 const acquire=async args=>({collection:args.snapshot.currency==='COP'?collection:f.collections[args.snapshot.currency],completedAt:f.asOf,networkCalls:0})
 const before=f.state.posts.length,oldTask=fingerprint(f.state.inputs.get('COP'))
 const second=await runOperatingCycle({...f,testOnly:false,execute:true,acquire})
 expect(second.batchKey).toBe(first.batchKey)
 expect(second.rows.find(r=>r.currency==='COP').status).toBe(change==='used_source_revision'?'frozen_country_material_superseded':'pending_admin_review')
 expect(second.rows.find(r=>r.currency==='PEN').status).toBe('pending_admin_review')
 expect(f.state.posts.length-before).toBe(change==='used_source_revision'?1:2)
 if(change==='unused_new_article')expect(fingerprint(f.state.inputs.get('COP'))).toBe(oldTask)
 const resumedPosts=f.state.posts.length
 const third=await runOperatingCycle({...f,testOnly:false,execute:true,acquire})
 expect(third.rows.find(r=>r.currency==='COP').status,JSON.stringify(third)).toBe('pending_admin_review')
 if(change==='unused_new_article')expect(f.state.posts.length).toBe(resumedPosts)
 else expect(fingerprint(f.state.inputs.get('COP'))).not.toBe(oldTask)
 expect(f.store.drafts).toHaveLength(6)
 }
})

it('keeps frozen work paused during a failed refresh and resumes it without inventing a source revision',async()=>{
 const f=await operatingFixture();let fail=true
 const first=await runOperatingCycle({...f,testOnly:false,execute:true,preflightSource:async request=>{
  if(fail&&request.stage==='compare'&&JSON.parse(request.body.messages[1].content).currency==='COP'){fail=false;throw Error('endpoint_down')}
  return f.preflightSource()
 }})
 const before=f.state.posts.length
 const second=await runOperatingCycle({...f,testOnly:false,execute:true,acquire:async args=>{
  if(args.snapshot.currency==='COP')throw Error('synthetic_refresh_failure')
  return f.acquire(args)
 }})
 expect(second.batchKey).toBe(first.batchKey);expect(second.status).toBe('paused')
 expect(second.rows.find(r=>r.currency==='COP')).toMatchObject({status:'frozen_source_refresh_wait',continuation:{resumeExact:true}})
 expect(f.state.posts.length).toBe(before)
 const third=await runOperatingCycle({...f,testOnly:false,execute:true})
 expect(third.rows.find(r=>r.currency==='COP').status).toBe('pending_admin_review')
 expect(f.store.drafts).toHaveLength(6)
})

it('acknowledges exact paid stored writer and review without provider catalog access after a lost commit response',async()=>{
 const f=await operatingFixture(),finish=f.store.finish;let lose=true
 f.store.finish=async(...args)=>{const id=await finish(...args);if(lose&&args[1]){lose=false;throw Error('synthetic_ack_lost')}return id}
 const first=await runOperatingCycle({...f,testOnly:false,execute:true}),before=f.state.posts.length,ids=f.store.drafts.map(d=>d.runId)
 expect(first.status).toBe('paused')
 const second=await runOperatingCycle({...f,testOnly:false,execute:true,preflightWriter:async()=>{throw Error('catalog_unavailable')}})
 expect(second.rows.find(r=>r.currency==='BRL').status,JSON.stringify(second)).toBe('pending_admin_review')
 expect(f.state.posts.length).toBe(before);expect(f.store.drafts.map(d=>d.runId)).toEqual(ids)
})

it('reuses pre-upgrade paid responses and their original manuscript identity without buying an upgraded-key duplicate',async()=>{
 const f=await operatingFixture(),stage=f.store.stage,finish=f.store.finish;let firstStage=true,lose=true
 f.store.stage=async task=>{
  if(task.currency==='BRL'&&firstStage){
   firstStage=false
   const legacy=structuredClone(task);legacy.taskKey=legacy.legacyTaskKey
   delete legacy.legacyTaskKey;delete legacy.inputEdition;delete legacy.binding;legacy.binding=fingerprint(legacy)
   return stage(legacy)
  }
  return stage(task)
 }
 f.store.finish=async(...args)=>{const id=await finish(...args);if(lose&&args[1]){lose=false;throw Error('synthetic_ack_lost')}return id}
 const first=await runOperatingCycle({...f,testOnly:false,execute:true}),posts=f.state.posts.length
 expect(first.status).toBe('paused');const before=structuredClone(f.store.drafts)
 const second=await runOperatingCycle({...f,testOnly:false,execute:true,preflightWriter:async()=>{throw Error('no_provider_lookup_required')}})
 expect(second.rows.find(r=>r.currency==='BRL').status,JSON.stringify(second)).toBe('pending_admin_review')
 expect(f.state.posts.length).toBe(posts);expect(f.store.drafts).toEqual(before)
})

it('quarantines conflicting judgments, binds a new independent review, and resolves feedback without overwriting history',async()=>{
 const f=await operatingFixture();await runOperatingCycle({...f,testOnly:false,execute:true})
 const good=f.state.sourceCache.find(r=>r.currency==='MXN'),collection=f.collections.MXN
 const bad=operatingSourceRecords(collection,{receipts:[],items:[{cardBinding:collection.reviewQueue[0].binding,modelCalls:2,costUsd:.002,
  status:'original_support_hold',reason:'original_claim_support_not_confirmed'}]},f.state.policy.processingRulesBinding)[0]
 const before=fingerprint([good,bad]),blocked=reuseOperatingSources(collection,[good,bad],f.state.policy.processingRulesBinding)
 expect(blocked.savedSourceReviews).toEqual([])
 expect(blocked.collection.reviewRevalidations[0]).toMatchObject({reason:'conflict',priorKeys:expect.arrayContaining([good.key,bad.key])})
 const again=await operatingFixture();again.state.sourceCache=structuredClone([good,bad])
 const r=await runOperatingCycle({...again,testOnly:false,execute:true})
 expect(r.rows.find(row=>row.currency==='MXN').status,JSON.stringify(r)).toBe('pending_admin_review')
 const resolved=again.state.sourceCache.filter(row=>row.currency==='MXN')
 expect(resolved).toHaveLength(3);expect(fingerprint(resolved.slice(0,2))).toBe(before)
 const reused=reuseOperatingSources(collection,resolved,f.state.policy.processingRulesBinding)
 expect(reused.savedSourceReviews).toHaveLength(1);expect(reused.savedSourceReviews[0].receipt).toBeDefined()
 expect(researchFeedback(resolved).deprioritizeUrls).not.toContain(good.original.url)
 const extract=again.store.jobs.find(j=>j.currency==='MXN'&&j.context?.sourceStage==='extract')
 expect(extract.context.planBinding).not.toBe(f.store.jobs.find(j=>j.currency==='MXN'&&j.context?.sourceStage==='extract').context.planBinding)
})

it('marks legacy successes as needing revalidation while current unaffected reviews remain reusable',async()=>{
 const f=await operatingFixture();await runOperatingCycle({...f,testOnly:false,execute:true})
 const good=f.state.sourceCache.find(r=>r.currency==='MXN'),legacy=structuredClone(good)
 // Immutable legacy encoding, before review revision keys were introduced.
 legacy.key=legacy.sourceKey;delete legacy.sourceKey;delete legacy.review.validity;delete legacy.review.pipelineVersion
 const held=reuseOperatingSources(f.collections.MXN,[legacy],f.state.policy.processingRulesBinding)
 expect(held.savedSourceReviews).toEqual([]);expect(held.collection.reviewRevalidations[0].reason).toBe('revalidation_required')
 expect(reuseOperatingSources(f.collections.MXN,[good],f.state.policy.processingRulesBinding).savedSourceReviews).toHaveLength(1)
})

it('preserves technical alerts through mixed content failures and cached result wrappers',()=>{
 const row={status:'writing_input_hold',sourceIssues:[{status:'source_review_hold',holds:['unclassified_pipeline_bug']},
  {status:'original_support_hold'}],sourceHolds:['selected_session_attributed_fx_explanation_missing']}
 const continuation=countryContinuation(row)
 expect(continuation.action).toBe('await_pipeline_repair')
 expect(continuation.issues.some(i=>i.action==='find_other_evidence')).toBe(true)
 const first={status:'completed_with_country_results',rows:[{...row,continuation}]}
 expect(operatingResultState(first)).toMatchObject({kind:'action_required',exitCode:2})
 expect(operatingResultState({status:'completed',previousResult:first})).toEqual(operatingResultState(first))
})
