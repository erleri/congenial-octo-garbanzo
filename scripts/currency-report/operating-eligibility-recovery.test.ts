import {NEWS_EVENT_DATE_VERSION} from './news-event-date.js'
import {it,expect} from 'vitest'
import {operatingFixture} from './operating-fixture.js'
import {runOperatingCycle} from './operating-cycle.js'
import {classifyCountryRefresh,frozenSourceReviewHolds} from './operating-refresh.js'
import {operatingResultState} from './operating-result.js'
import {prepareRuntimeReview} from './runtime.js'
import {syntheticRuntimeTransport} from './runtime-fixture.js'
import {fingerprint} from './research-harness.js'
import {REPORT_CURRENCIES} from './shared-price-contract.js'
import {oneTimeOperatingPolicy} from './operating-policy.js'
import {bindSelectedOriginalReview} from './selected-source-collection.js'
import {createRuntimeStore,isTemporaryRuntimeReadError} from './runtime-store.js'
import {operatingSourceKey} from './operating-source-cache.js'
import {ORIGINAL_NEWS_PIPELINE_VERSION} from './original-news-pipeline.js'
import {SOURCE_REVIEW_VALIDITY_VERSION} from './source-review-validity.js'

const run=(f,options={})=>runOperatingCycle({...f,testOnly:false,execute:true,...options})
const waitFor=(f,currency)=>async(body,profile)=>{
 if(body.response_format.json_schema.name==='currency_runtime_review'){
  const task=[...f.state.inputs.values()].find(t=>fingerprint(prepareRuntimeReview(t,syntheticRuntimeTransport(t).compiled).body)===fingerprint(body))
  if(task?.currency===currency)throw Error('synthetic_endpoint_wait')
 }
 return f.preflightWriter(body,profile)
}
const revision=(prior,change)=>{
 const next=structuredClone(prior);change(next)
 next.key=fingerprint({version:'operating-source-review-record/3',sourceKey:next.sourceKey,
  cardBinding:next.card.binding,reviewBinding:fingerprint(next.review)})
 return next
}
const withdraw=(f,currency)=>{
 const prior=f.state.sourceCache.find(r=>r.currency===currency)
 const next=revision(prior,r=>{r.review.validity={...r.review.validity,state:'withdrawn',supersedes:[prior.key]}})
 f.state.sourceCache.push(next);return {prior,next}
}

it('does not let a never-accepted candidate reject other frozen evidence before staging, while retaining dependency revocation',async()=>{
 for(const currency of REPORT_CURRENCIES){
  const f=await operatingFixture();await run(f)
  const prior=f.state.sourceCache.find(r=>r.currency===currency),collection=structuredClone(f.collections[currency])
  const original=structuredClone(prior.original);original.url+='-candidate';delete original.id;delete original.sourceId
  const bound=bindSelectedOriginalReview({record:original,request:{sourceId:prior.original.sourceId,period:'2026-10-27'},
   adapter:'reviewed_news_notes',requestIds:['synthetic-rejected-candidate'],currency,asOf:f.asOf,targets:prior.card.targets})
  collection.originals.push(bound.original);collection.reviewQueue.push(bound.review)
  const candidate={...structuredClone(prior),sourceKey:operatingSourceKey(bound.original,prior.rulesBinding),original:bound.original,card:bound.review,
   review:{cardBinding:bound.review.binding,heldStatus:'original_pipeline_failed',holds:['event_date_unverified'],
    dateRuleVersion:NEWS_EVENT_DATE_VERSION,pipelineVersion:ORIGINAL_NEWS_PIPELINE_VERSION,
    validity:{version:SOURCE_REVIEW_VALIDITY_VERSION,pipelineVersion:ORIGINAL_NEWS_PIPELINE_VERSION,state:'held',supersedes:[]}}}
  const rejected=revision(candidate,()=>{}),cache=[prior,rejected],country={collection}
  expect(frozenSourceReviewHolds(country,cache,prior.rulesBinding)).toEqual([])
  expect(frozenSourceReviewHolds(country,cache,prior.rulesBinding,{materialEditions:[{url:prior.original.url}]})).toEqual([])
  // If an exact staged input actually used it, the hold must remain blocking.
  expect(frozenSourceReviewHolds(country,cache,prior.rulesBinding,{materialEditions:[{url:bound.original.url}]})).toEqual(['original_pipeline_failed'])
  const revoked=revision(prior,r=>{r.review.heldStatus='original_support_hold';r.review.holds=['original_claim_support_not_confirmed'];r.review.dateRuleVersion=NEWS_EVENT_DATE_VERSION;
   r.review.validity={...r.review.validity,state:'held',supersedes:[prior.key]}})
  expect(frozenSourceReviewHolds(country,[...cache,revoked],prior.rulesBinding)).toEqual(['original_support_hold'])
  expect(frozenSourceReviewHolds({...country,savedSourceReviews:[prior.review]},[revoked,rejected],prior.rulesBinding)).toEqual(['original_support_hold'])
 }
})

it('resumes the whole coordinator after pre-staging storage repair using valid alternatives in every currency',async()=>{
 for(const currency of REPORT_CURRENCIES){
  const f=await operatingFixture(),collection=f.collections[currency],source=collection.originals[0],original=structuredClone(source)
  original.url+='-rejected';delete original.id;delete original.sourceId
  const bound=bindSelectedOriginalReview({record:original,request:{sourceId:source.sourceId,period:'2026-10-27'},
   adapter:'reviewed_news_notes',requestIds:['synthetic-rejected'],currency,asOf:f.asOf,targets:collection.reviewQueue[0].targets})
  collection.originals.push(bound.original);collection.reviewQueue.push(bound.review)
  const candidate={currency,rulesBinding:f.state.policy.processingRulesBinding,
   sourceKey:operatingSourceKey(bound.original,f.state.policy.processingRulesBinding),original:bound.original,card:bound.review,
   review:{cardBinding:bound.review.binding,heldStatus:'original_pipeline_failed',holds:['event_date_unverified'],
    dateRuleVersion:NEWS_EVENT_DATE_VERSION,pipelineVersion:ORIGINAL_NEWS_PIPELINE_VERSION,
    validity:{version:SOURCE_REVIEW_VALIDITY_VERSION,pipelineVersion:ORIGINAL_NEWS_PIPELINE_VERSION,state:'held',supersedes:[]}}}
  const rejected=revision(candidate,()=>{});f.state.sourceCache.push(rejected)
  const stage=f.store.stage
  f.store.stage=async task=>{if(task.currency===currency)throw Error('unsafe_or_oversized_runtime_payload');return stage(task)}
  const first=await run(f)
  expect(first.rows.find(r=>r.currency===currency)).toMatchObject({status:'country_execution_hold',reason:'unsafe_or_oversized_runtime_payload'})
  expect(f.state.inputs.has(currency)).toBe(false)
  const before=f.state.posts.length,sourceHash=fingerprint(rejected)
  f.store.stage=stage
  const second=await run(f)
  expect(second.rows.find(r=>r.currency===currency).status).toBe('pending_admin_review')
  expect(f.state.posts.length-before).toBe(2) // writer and independent review, no source repayment
  expect(f.store.drafts).toHaveLength(6)
  expect(fingerprint(f.state.sourceCache.find(r=>r.key===rejected.key))).toBe(sourceHash)
  expect(f.state.inputs.get(currency).materialEditions.some(e=>e.url===bound.original.url)).toBe(false)
  const posts=f.state.posts.length;await run(f);expect(f.state.posts.length).toBe(posts)
 }
},30000)
// Exercise the real restoration/error adapter with synthetic RPC responses.
const readAdapter=(response)=>createRuntimeStore({url:'http://127.0.0.1:56321',key:'synthetic-not-a-key',mode:'local',
 client:{rpc:(name)=>({abortSignal:async()=>response(name)})}})

it('recognizes confirmed availability failures without treating permission, schema or arbitrary errors as recoverable reads',async()=>{
 for(const [error,status,temporary] of [
  [{code:'PGRST003'},504,true],[{code:'08006'},503,true],
  [{code:'',message:'TypeError: fetch failed'},0,true],[{code:'',message:'TimeoutError: signal timed out'},0,true],
  [{code:'',message:'upstream unavailable'},503,true],
  [{code:'PGRST000'},503,false],[{code:'42501'},503,false],[{code:'PGRST202'},404,false],
  [{code:'',message:'TypeError: invalid headers'},0,false],[{code:'',message:'unexpected'},500,false],
 ] as const){
  const store=readAdapter(()=>({data:null,error,status}))
  for(const read of [()=>store.input('COP','synthetic'),()=>store.sourceCache('COP','synthetic')]){
   let failure
   try{await read()}catch(e){failure=e}
   expect(failure).toBeInstanceOf(Error)
   expect(isTemporaryRuntimeReadError(failure)).toBe(temporary)
  }
  // A write failure cannot authorize resuming a read or another paid request.
  let failure
  try{await store.receive('synthetic',{},0)}catch(e){failure=e}
  expect(isTemporaryRuntimeReadError(failure)).toBe(false)
 }
 expect(isTemporaryRuntimeReadError(Error('runtime_store_load_currency_report_runtime_input_failed'))).toBe(false)
})

it('blocks a withdrawn supporting source before resuming each of six paid manuscripts and accepts a genuinely new alternative',async()=>{
 for(const currency of REPORT_CURRENCIES){
  const f=await operatingFixture();await run(f,{preflightWriter:waitFor(f,currency)})
  const {prior}=withdraw(f,currency),before=f.state.posts.length
  const r=await run(f,currency==='COP'?{acquire:async a=>{
   if(a.snapshot.currency===currency)throw Error('synthetic_source_lookup_outage');return f.acquire(a)
  }}:{})
  expect(r.rows.find(x=>x.currency===currency)).toMatchObject({status:'frozen_source_review_withdrawn',modelCalls:0,holds:['source_review_withdrawn']})
  expect(f.state.posts.length).toBe(before);expect(f.store.drafts).toHaveLength(5)
  expect(f.store.jobs.filter(j=>j.currency===currency&&j.stage==='writer'&&!j.context?.purpose)).toHaveLength(1)
  const original=structuredClone(prior.original)
  original.url+='-independent-alternative';delete original.id;delete original.sourceId
  const bound=bindSelectedOriginalReview({record:original,request:{sourceId:prior.original.sourceId,period:'2026-10-27'},
   adapter:'reviewed_news_notes',requestIds:['synthetic-alternative'],currency,asOf:f.asOf,targets:prior.card.targets})
  f.collections[currency].originals.push(bound.original);f.collections[currency].reviewQueue.push(bound.review)
  const alternate=await run(f)
  expect(alternate.rows.find(x=>x.currency===currency).status).toBe('pending_admin_review')
  expect(f.store.drafts).toHaveLength(6)
  const posts=f.state.posts.length;await run(f);expect(f.state.posts.length).toBe(posts)
 }
},30000)

it('requires current review validity for conflicts and obsolete review versions without replaying an old successful response',async()=>{
 for(const kind of ['conflict','revalidation_required']){
  const f=await operatingFixture();await run(f,{preflightWriter:waitFor(f,'COP')})
  const prior=f.state.sourceCache.find(r=>r.currency==='COP')
  f.state.sourceCache.push(revision(prior,r=>{
   if(kind==='conflict')r.review.assessment={...r.review.assessment,syntheticConflict:true}
   else r.review.validity={...r.review.validity,version:'synthetic-obsolete',supersedes:[prior.key]}
  }))
  const before=f.state.posts.length,r=await run(f)
  expect(r.rows.find(x=>x.currency==='COP').status).toBe('frozen_source_review_'+kind)
  expect(f.state.posts.length).toBe(before);expect(f.store.drafts).toHaveLength(5)
 }
})

it('finishes each staged manuscript in its original one-time envelope when an unused rejected article is withdrawn',async()=>{
 for(const currency of REPORT_CURRENCIES){
  const f=await operatingFixture()
  f.state.policy=oneTimeOperatingPolicy({config:f,datasetBinding:fingerprint(f.dataset),authorizationReference:'synthetic-only',
   configuredAt:'2026-11-01T00:00:00Z',expiresAt:'2026-11-03T00:00:00Z'})
  const original=structuredClone(f.collections[currency].originals[0]),sourceId=original.sourceId
  original.url+='-unused';delete original.id;delete original.sourceId
  const bound=bindSelectedOriginalReview({record:original,request:{sourceId,period:'2026-10-27'},adapter:'reviewed_news_notes',
   requestIds:['synthetic-unused'],currency,asOf:f.asOf,targets:[{needId:'market',requestedPeriod:'2026-10-27'}]})
  f.collections[currency].originals.push(bound.original);f.collections[currency].reviewQueue.push(bound.review)
  const record={currency,rulesBinding:f.state.policy.processingRulesBinding,sourceKey:operatingSourceKey(bound.original,f.state.policy.processingRulesBinding),
   original:bound.original,card:bound.review,review:{cardBinding:bound.review.binding,heldStatus:'original_support_hold',
    holds:['original_claim_support_not_confirmed'],dateRuleVersion:NEWS_EVENT_DATE_VERSION,pipelineVersion:ORIGINAL_NEWS_PIPELINE_VERSION,
    validity:{version:SOURCE_REVIEW_VALIDITY_VERSION,pipelineVersion:ORIGINAL_NEWS_PIPELINE_VERSION,state:'held',supersedes:[]}}}
  record.key=fingerprint({version:'operating-source-review-record/3',sourceKey:record.sourceKey,cardBinding:record.card.binding,reviewBinding:fingerprint(record.review)})
  f.state.sourceCache.push(record)
  const first=await run(f,{preflightWriter:waitFor(f,currency)}),task=f.state.inputs.get(currency)
  expect(task.materialEditions.some(e=>e.url===bound.original.url)).toBe(false)
  const taskHash=fingerprint(task),before=f.state.posts.length
  f.state.sourceCache.push(revision(record,r=>{r.review.validity={...r.review.validity,state:'withdrawn',supersedes:[record.key]}}))
  const current=f.state.sourceCache.filter(r=>r.currency===currency)
  expect(frozenSourceReviewHolds({collection:f.collections[currency]},current,f.state.policy.processingRulesBinding,
   {materialEditions:task.materialEditions})).toEqual([])
  expect(frozenSourceReviewHolds({collection:f.collections[currency]},current,f.state.policy.processingRulesBinding)).toContain('source_review_withdrawn')
  const result=await run(f)
  expect(result.rows.find(r=>r.currency===currency).status).toBe('pending_admin_review')
  expect(result.batchKey).toBe(first.batchKey);expect(f.state.batches.size).toBe(1)
  expect(fingerprint(f.state.inputs.get(currency))).toBe(taskHash)
  expect(f.state.posts.length-before).toBe(1);expect(f.store.drafts).toHaveLength(6)
  const count=f.state.posts.length;await run(f);expect(f.state.posts.length).toBe(count)
 }
},30000)

it('recognizes explicit reapproval as a new validity edition without deleting the withdrawal or paying for the writer again',async()=>{
 const f=await operatingFixture();await run(f,{preflightWriter:waitFor(f,'COP')})
 const {prior,next}=withdraw(f,'COP');await run(f)
 const renewed=revision(prior,r=>{r.review.validity={...r.review.validity,state:'usable',supersedes:[prior.key,next.key]}})
 f.state.sourceCache.push(renewed)
 const before=f.state.posts.length,r=await run(f)
 expect(r.rows.find(x=>x.currency==='COP').status).toBe('pending_admin_review')
 expect(f.state.posts.length-before).toBe(1);expect(f.store.drafts).toHaveLength(6)
 expect(f.state.sourceCache.some(x=>x.key===next.key&&x.review.validity.state==='withdrawn')).toBe(true)
 expect(f.store.jobs.filter(j=>j.currency==='COP'&&j.stage==='writer'&&!j.context?.purpose)).toHaveLength(1)
 const count=f.state.posts.length;await run(f);expect(f.state.posts.length).toBe(count)
})

it('pauses a validity lookup outage and resumes only the existing reviewer when the lookup recovers',async()=>{
 const f=await operatingFixture();await run(f,{preflightWriter:waitFor(f,'COP')})
 const read=f.store.sourceCache;let reads=0
 const unavailable=readAdapter(()=>({data:null,error:{code:'PGRST003'},status:504}))
 f.store.sourceCache=async(...args)=>args[0]==='COP'&&++reads===2?unavailable.sourceCache(...args):read(...args)
 const before=f.state.posts.length,r=await run(f)
 expect(r.rows.find(x=>x.currency==='COP').status).toBe('frozen_source_refresh_wait')
 expect(f.state.posts.length).toBe(before)
 f.store.sourceCache=read
 expect((await run(f)).rows.find(x=>x.currency==='COP').status).toBe('pending_admin_review')
 expect(f.state.posts.length-before).toBe(1);expect(f.store.drafts).toHaveLength(6)
})

it('preserves real restoration failures as repair-required across six currencies without paying or losing the original work',async()=>{
 for(const currency of REPORT_CURRENCIES)for(const damage of ['projection','missing_bytes','invalid_json']){
  const f=await operatingFixture();await run(f,{preflightWriter:waitFor(f,currency)})
  const task=structuredClone(f.state.inputs.get(currency)),stored={...task,serializedRuntimeInput:JSON.stringify(task)}
  if(damage==='projection')stored.writer='synthetic-corruption'
  if(damage==='missing_bytes')delete stored.serializedRuntimeInput
  if(damage==='invalid_json')stored.serializedRuntimeInput='{'
  const error=damage==='projection'?'runtime_stored_projection_changed':damage==='missing_bytes'?'runtime_exact_bytes_missing':'runtime_exact_json_invalid'
  const damaged=readAdapter(()=>({data:stored,error:null})),read=f.store.input
  f.store.input=(requested,snapshot)=>requested===currency?damaged.input(requested,snapshot):read(requested,snapshot)
  const before=f.state.posts.length
  for(let i=0;i<2;i++){
   const result=await run(f)
   expect(result).toMatchObject({status:'operating_execution_hold',reason:error,holds:[error]})
   expect(operatingResultState(result)).toMatchObject({kind:'action_required',exitCode:2})
   expect(f.state.posts.length).toBe(before)
  }
  f.store.input=read
  expect((await run(f)).rows.find(r=>r.currency===currency).status).toBe('pending_admin_review')
  expect(f.state.posts.length-before).toBe(1);expect(f.store.drafts).toHaveLength(6)
 }
},30000)

it('does not downgrade permission, schema or unknown read failures into temporary waits',async()=>{
 for(const fault of ['42501','PGRST202','unknown_exception','source_cache_integrity']){
  const f=await operatingFixture();await run(f,{preflightWriter:waitFor(f,'COP')})
  const before=f.state.posts.length
  if(fault==='source_cache_integrity'){
   const read=f.store.sourceCache;let reads=0
   const record=structuredClone(f.state.sourceCache.find(r=>r.currency==='COP'))
   const damaged=readAdapter(()=>({data:[{...record,serializedSourceReview:JSON.stringify({...record,key:'synthetic-changed'})}],error:null}))
   f.store.sourceCache=(...args)=>args[0]==='COP'&&++reads===2?damaged.sourceCache(...args):read(...args)
  }else{
   const read=f.store.input,failed=readAdapter(()=>({data:null,error:{code:fault},status:403}))
   f.store.input=(currency,snapshot)=>currency!=='COP'?read(currency,snapshot):fault==='unknown_exception'
    ?Promise.reject(Error('synthetic_unknown_read_failure')):failed.input(currency,snapshot)
  }
  const result=await run(f)
  expect(result.status).toBe('operating_execution_hold')
  expect(operatingResultState(result)).toMatchObject({kind:'action_required',exitCode:2})
  expect(f.state.posts.length).toBe(before)
 }
})

it('applies staged news dependencies to body changes and retains reference and official revision gates',async()=>{
 const f=await operatingFixture(),old=f.collections.COP,used=old.originals[0].url
 const unused=structuredClone(old.originals[0]);unused.url+='-unused';unused.id+='-unused'
 const country={collection:{...old,originals:[...old.originals,unused]}}
 const fresh=structuredClone(country);fresh.collection.originals[1].blocks[0].text+=' changed'
 const scope={materialEditions:[{url:used}]}
 expect(classifyCountryRefresh(country,fresh,scope)).toBeNull()
 expect(classifyCountryRefresh(country,fresh)).toBe('frozen_country_material_superseded')
 fresh.collection.originals[0].blocks[0].text+=' actual supporting source revision'
 expect(classifyCountryRefresh(country,fresh,scope)).toBe('frozen_country_material_superseded')
 expect(classifyCountryRefresh(country,country,{...scope,referenceChanged:true})).toBe('frozen_country_reference_superseded')
 const statistic={seriesId:'s',definitionId:'d',period:'2026-09',value:1,scope:{comparison:'monthly'},release:{url:'https://example.org/release',sha256:'v1',publishedOn:'2026-10-27'}}
 const withOfficial={...country,officialBackground:{admission:{admitted:[statistic],rows:[]}}}
 const revised=structuredClone(withOfficial);revised.officialBackground.admission.admitted[0].value=2
 expect(classifyCountryRefresh(withOfficial,revised,scope)).toBe('frozen_country_material_superseded')
})

it('recovers preparation for all six currencies without new article or price bytes while another country remains paused',async()=>{
 for(const currency of REPORT_CURRENCIES){
  const f=await operatingFixture(),waiting=currency==='PEN'?'COP':'PEN'
  const first=await run(f,{acquire:async a=>({...await f.acquire(a),...(a.snapshot.currency===currency?{completedAt:'2026-10-01T00:00:00Z'}:{})}),
   preflightWriter:waitFor(f,waiting)})
  expect(first.rows.find(x=>x.currency===currency).status).toBe('country_preparation_hold')
  const acquire=async a=>{if(a.snapshot.currency===waiting)throw Error('synthetic_other_country_outage');return f.acquire(a)}
  const before=f.state.posts.length,r=await run(f,{acquire})
  expect(r.rows.find(x=>x.currency===currency).status).toBe('pending_admin_review')
  expect(r.rows.find(x=>x.currency===waiting).status).toBe('frozen_source_refresh_wait')
  expect(f.store.drafts).toHaveLength(5);expect(f.state.posts.length-before).toBe(4)
  expect(operatingResultState(r)).toMatchObject({kind:'failure',partialSourceFailure:false,exitCode:1})
  for(let i=0;i<3;i++){
   const count=f.state.posts.length,repeat=await run(f,{acquire})
   expect(repeat.rows.find(x=>x.currency===currency).status).toBe('pending_admin_review')
   expect(f.state.posts.length).toBe(count)
  }
  const count=f.state.posts.length,restored=await run(f)
  expect(restored.rows.find(x=>x.currency===waiting).status).toBe('pending_admin_review')
  expect(f.state.posts.length-count).toBe(1);expect(f.store.drafts).toHaveLength(6)
 }
},30000)

it('preserves one-time approval scope when preparation recovers alongside an unrelated waiting country',async()=>{
 const f=await operatingFixture()
 f.state.policy=oneTimeOperatingPolicy({config:f,datasetBinding:fingerprint(f.dataset),authorizationReference:'synthetic-only',
  configuredAt:'2026-11-01T00:00:00Z',expiresAt:'2026-11-03T00:00:00Z'})
 await run(f,{acquire:async a=>({...await f.acquire(a),...(a.snapshot.currency==='COP'?{completedAt:'2026-10-01T00:00:00Z'}:{})}),
  preflightWriter:waitFor(f,'PEN')})
 const before=f.state.posts.length,r=await run(f,{acquire:async a=>{if(a.snapshot.currency==='PEN')throw Error('synthetic_pen_outage');return f.acquire(a)}})
 expect(r.status).toBe('paused');expect(f.state.batches.size).toBe(1);expect(f.state.posts.length).toBe(before)
 expect(f.store.drafts).toHaveLength(4)
})
