import {it,expect,vi} from 'vitest'
import {sourceContinuation,researchFeedback} from './research-continuation.js'
import {operatingFixture} from './operating-fixture.js'
import {runOperatingCycle} from './operating-cycle.js'
import {bindSelectedOriginalReview} from './selected-source-collection.js'
import {fingerprint} from './research-harness.js'
import {discoverRegisteredNews} from './registered-material-adapters.js'
import {operatingResultState} from './operating-result.js'

it('separates recoverable stage waits, immutable content rejection and global unknown accounting',()=>{
 expect(sourceContinuation({reason:'source_endpoint_preflight_hold'})).toMatchObject({resumeExact:true,action:'resume_saved_stages'})
 expect(sourceContinuation({holds:['source_budget_not_approved']})).toMatchObject({resumeExact:true,action:'wait_for_budget'})
 expect(sourceContinuation({status:'original_support_hold'})).toMatchObject({resumeExact:false,resumeWhen:'new_material_or_review_rules'})
 expect(sourceContinuation({status:'source_cost_unresolved'})).toMatchObject({resumeExact:false,action:'stop_paid_work'})
 expect(sourceContinuation({reason:'unclassified_pipeline_bug'})).toMatchObject({category:'technical',action:'await_pipeline_repair'})
 expect(operatingResultState({status:'completed_with_country_results',rows:[{continuation:sourceContinuation({reason:'unclassified_pipeline_bug'})}]}))
  .toMatchObject({kind:'action_required',exitCode:2})
})

it('uses rejected-source feedback to select a different article without banning corrections at the same URL',()=>{
 const base='https://www.valoraanalitik.com/',old=base+'dolar-colombia-cae-por-oferta-local/',other=base+'dolar-colombia-ante-demanda-externa/'
 const html=`<a href="${old}">El dólar en Colombia cae por oferta local</a><a href="${other}">El dólar en Colombia ante demanda externa</a>`
 const feedback=researchFeedback([{original:{url:old,sourceId:'cop-valora'},review:{heldStatus:'unrelated'}}])
 expect(discoverRegisteredNews(html,base,'COP',{sourceId:'cop-valora',limit:1,...feedback}).candidates.map(c=>c.url)).toEqual([other])
 expect(discoverRegisteredNews(html,base,'COP',{sourceId:'cop-valora',limit:2,...feedback}).candidates.map(c=>c.url)).toContain(old)
})

it('resumes a paused six-country cycle from comparison while reusing the paid extraction exactly once',async()=>{
 const f=await operatingFixture(),send=vi.fn(f.send),preflight=f.preflightSource
 let fail=true
 const first=await runOperatingCycle({...f,send,execute:true,preflightSource:async request=>{
  const data=JSON.parse(request.body.messages[1].content)
  if(fail&&request.stage==='compare'&&data.currency==='COP'){fail=false;throw Error('synthetic_endpoint_unavailable')}
  return preflight()
 }})
 expect(first.status,JSON.stringify(first)).toBe('paused')
 expect(first.rows.find(r=>r.currency==='COP').continuation).toMatchObject({resumeExact:true})
 expect(f.state.sourceCache.some(r=>r.currency==='COP')).toBe(false)
 expect(f.store.drafts).toHaveLength(5)
 const before=f.state.posts.length
 const second=await runOperatingCycle({...f,send,execute:true})
 expect(second.rows.find(r=>r.currency==='COP').status,JSON.stringify(second)).toBe('pending_admin_review')
 expect(f.state.posts.length-before).toBe(3) // comparison, writer, manuscript review
 expect(f.store.drafts).toHaveLength(6)
 const extracts=send.mock.calls.filter(([r])=>r.body.response_format.json_schema.name==='original_news_extract'
  &&JSON.parse(r.body.messages[1].content).currency==='COP')
 expect(extracts).toHaveLength(1)
})

it('feeds support failures back into acquisition for all six currencies and proceeds when different evidence is verified',async()=>{
 const f=await operatingFixture(),originalHash=fingerprint(f.collections),send=f.send
 const first=await runOperatingCycle({...f,execute:true,send:async args=>{
  const response=await send(args)
  if(args.body.response_format.json_schema.name!=='original_news_compare')return response
  const output=JSON.parse(response.payload.choices[0].message.content)
  output.decision='hold';output.limitations=[{kind:'price_basis',blocking:true,reason:'Synthetic conflicting price basis must not enter a report.'}]
  return {...response,payload:{choices:[{message:{content:JSON.stringify(output)}}]}}
 }})
 expect(first.rows.every(r=>r.status!=='pending_admin_review')).toBe(true)
 expect(f.store.drafts).toHaveLength(0)
 const rejected=fingerprint(f.state.sourceCache),unneeded=vi.fn()
 const unchanged=await runOperatingCycle({...f,execute:true,send:unneeded})
 expect(unchanged.modelCalls).toBe(0);expect(unneeded).not.toHaveBeenCalled()
 const observed=[]
 const second=await runOperatingCycle({...f,execute:true,acquire:async args=>{
  const collection=structuredClone(f.collections[args.snapshot.currency]),prior=collection.originals[0]
  observed.push({currency:collection.currency,feedback:args.researchNeeds})
  expect(args.researchNeeds.preservedForReviewUrls).toContain(prior.url)
  const record=structuredClone(prior),u=new URL(record.url)
  u.pathname=u.pathname.replace(/(\.html)?$/,(match)=>'-different-evidence'+match)
  record.url=u.href
  delete record.id;delete record.sourceId
  const bound=bindSelectedOriginalReview({record,request:{sourceId:prior.sourceId,period:'2026-10-27'},adapter:'reviewed_news_notes',
   requestIds:['synthetic-followup'],currency:collection.currency,asOf:collection.asOf,targets:collection.reviewQueue[0].targets})
  collection.originals.push(bound.original);collection.reviewQueue.push(bound.review)
  return {collection,networkCalls:0,completedAt:f.asOf}
 }})
 expect(observed.map(r=>r.currency)).toEqual(['BRL','MXN','COP','PEN','CLP','ARS'])
 expect(second.rows.map(r=>r.status),JSON.stringify(second)).toEqual(Array(6).fill('pending_admin_review'))
 expect(f.store.drafts).toHaveLength(6)
 expect(fingerprint(f.state.sourceCache.slice(0,6))).toBe(rejected)
 expect(new Set(f.state.sourceCache.map(r=>r.key)).size).toBe(12)
 expect(fingerprint(f.collections)).toBe(originalHash)
 expect(first.publicationApproved||second.publicationApproved).toBe(false)
})
