import {it,expect,vi} from 'vitest'
import {operatingFixture} from './operating-fixture.js'
import {runOperatingCycle,operatingMaterialHash} from './operating-cycle.js'
import {operatingPolicyDraft,assertOperatingPolicy} from './operating-policy.js'
import {fingerprint} from './research-harness.js'
import {reuseOperatingSources,operatingSourceKey,operatingSourceRecords} from './operating-source-cache.js'
import {effectiveSourceReview} from './source-review-validity.js'
import {automaticReferenceCalendars} from './operating-entry.js'
import {operatingResultState} from './operating-result.js'
import {NEWS_EVENT_DATE_VERSION} from './news-event-date.js'
import {bindSelectedOriginalReview} from './selected-source-collection.js'
import {buildSharedDashboardPriceSnapshot} from './shared-price-contract.js'

it('uses the frozen published reference after a history update without blocking supply, rebasing or spending',async()=>{
 const f=await operatingFixture(),currency='BRL',calendar=f.calendarByCurrency[currency]
 const old=buildSharedDashboardPriceSnapshot({dataset:f.dataset,currency,asOf:f.asOf,calendar})
 const actual=old.current.value;old.current.value=actual-1
 old.series=old.series.map(p=>p.date===old.current.date&&p.currency===currency&&p.rateType==='LOCAL_PER_USD'?{...p,value:actual-1}:p)
 const saved=structuredClone(old),context={task:{currency,baseDate:f.dataset.baseDate,purpose:'periodic',snapshot:old}}
 f.store.history=async c=>c===currency?[{currency,baseDate:f.dataset.baseDate,publishedAt:f.asOf,report:{id:'published-brl-reference',currency},
  runtimeContext:{...context,serializedRuntimeContext:JSON.stringify(context)}}]:[]
 f.store.supplyCheck=vi.fn(async()=>{})
 const result=await runOperatingCycle({...f,execute:false})
 expect(result.modelCalls).toBe(0)
 expect(result.collectionResults.find(r=>r.currency===currency).publicationDecision).toMatchObject({status:'no_active_trigger',cumulativePct:expect.closeTo((actual/(actual-1)-1)*100),
  comparisonHolds:[],comparisonDetails:[{publishedValue:actual-1,currentHistoryValue:actual,resolution:'use_frozen_publication_value'}]})
 expect(f.store.supplyCheck.mock.calls.find(([r])=>r.currency===currency)[0].result.dataStatus).toBe(result.collectionResults.find(r=>r.currency===currency).referenceStatus)
 expect(old).toEqual(saved)
})

it('uses the same free section filter in planning and execution without suppressing other countries',async()=>{
 const f=await operatingFixture(),collection=f.collections.ARS,previous=collection.originals[0]
 const record={...previous,url:'https://www.infobae.com/deportes/2026/10/27/synthetic-dolar/' }
 delete record.id;delete record.sourceId
 const bound=bindSelectedOriginalReview({request:{sourceId:'ars-infobae',period:'2026-10-27'},record,adapter:'reviewed_news_notes',
  requestIds:['synthetic'],targets:collection.reviewQueue[0].targets,currency:'ARS',asOf:collection.asOf})
 collection.originals=[bound.original];collection.reviewQueue=[bound.review]
 const plan=await runOperatingCycle({...f,execute:false})
 expect(plan.rows.find(r=>r.currency==='ARS').articles).toBe(0)
 const result=await runOperatingCycle({...f,execute:true})
 const ars=result.rows.find(r=>r.currency==='ARS')
 expect(ars.modelCalls).toBe(0)
 expect(ars.sourceHolds).toContain('non_economic_section')
 expect(ars.continuation.category).toBe('content')
 expect(result.rows.filter(r=>r.status==='pending_admin_review')).toHaveLength(5)
})

it('finishes a six-country run with large collection diagnostics and resumes from the compact checkpoint without duplicate work',async()=>{
 const f=await operatingFixture(),acquire=f.acquire,checkpoint=f.store.batchCheckpoint
 f.acquire=async args=>{
  const value=await acquire(args)
  value.collection.outcomes.push(...Array.from({length:120},()=>({sourceId:'synthetic-source',status:'access_failed',reason:'synthetic_failure_'.repeat(40)})))
  return value
 }
 f.store.batchCheckpoint=async r=>{
  expect(Buffer.byteLength(JSON.stringify(r.result))).toBeLessThan(24000)
  return checkpoint(r)
 }
 const result=await runOperatingCycle({...f,execute:true})
 expect(Buffer.byteLength(JSON.stringify(result))).toBeGreaterThan(64000)
 expect(result.rows.every(r=>r.status==='pending_admin_review')).toBe(true)
 expect(f.state.batch.result.version).toBe('operating-checkpoint/1')
 expect(operatingResultState(f.state.batch.result)).toEqual(operatingResultState(result))
 const count=f.state.posts.length
 const again=await runOperatingCycle({...f,execute:true})
 expect(again.status).toBe('completed');expect(f.state.posts).toHaveLength(count)
})

it('links replacement judgments to obsolete held records instead of creating another active conflicting judgment',async()=>{
 const f=await operatingFixture(),collection=f.collections.COP,card=collection.reviewQueue[0],rules=f.state.policy.processingRulesBinding
 const prior={key:operatingSourceKey(collection.originals[0],rules),currency:'COP',rulesBinding:rules,
  original:collection.originals[0],card,review:{cardBinding:card.binding,heldStatus:'original_pipeline_failed',
   pipelineVersion:'original-news-pipeline/obsolete',holds:['comparison_dropped_candidate_context']}}
 const original=structuredClone(prior),reused=reuseOperatingSources(collection,[prior],rules)
 expect(reused.savedSourceReviews).toEqual([])
 expect(reused.collection.reviewRevalidations).toEqual([{cardBinding:card.binding,priorKeys:[prior.key],reason:'revalidation_required'}])
 const next=operatingSourceRecords(reused.collection,{receipts:[],materialInputs:[],
  items:[{cardBinding:card.binding,status:'original_support_hold',modelCalls:2,costUsd:.01,holds:['original_claim_support_not_confirmed']}]},rules)[0]
 expect(next.review.validity.supersedes).toEqual([prior.key])
 expect(effectiveSourceReview([prior,next]).state).toBe('held')
 expect(prior).toEqual(original)
})

it('keeps restored research dates instead of replacing them with a narrower cached card',async()=>{
 const f=await operatingFixture(),collection=structuredClone(f.collections.COP),rules=f.state.policy.processingRulesBinding
 const original=structuredClone(collection.originals[0]),card=structuredClone(collection.reviewQueue[0])
 const prior={key:operatingSourceKey(original,rules),currency:'COP',rulesBinding:rules,original,card,
  review:{cardBinding:card.binding,heldStatus:'original_support_hold',holds:['original_claim_support_not_confirmed']}}
 const current=collection.reviewQueue[0]
 current.targets.push({...current.targets[0],requestedPeriod:'2026-10-25',requirementId:'restored-day'})
 delete current.binding;current.binding=fingerprint(Object.fromEntries(Object.entries(current).filter(([k])=>!['decision','reviewer','notes','supportingReferences'].includes(k))))
 const before=fingerprint(prior),result=reuseOperatingSources(collection,[prior],rules)
 expect(result.savedSourceReviews).toEqual([])
 expect(result.collection.reviewQueue[0].targets.some(t=>t.requestedPeriod==='2026-10-25')).toBe(true)
 expect(result.collection.reviewRevalidations[0].reason).toBe('revalidation_required')
 expect(fingerprint(prior)).toBe(before)
 const unrelated=structuredClone(prior)
 unrelated.review={...unrelated.review,heldStatus:'unrelated',holds:['unrelated'],pipelineVersion:ORIGINAL_NEWS_PIPELINE_VERSION}
 const sameBody=reuseOperatingSources(collection,[unrelated],rules)
 expect(sameBody.savedSourceReviews).toMatchObject([{heldStatus:'unrelated'}])
 expect(sameBody.collection.reviewRevalidations).toEqual([])
})

it('stores formerly oversized proof bundles losslessly without duplicating their JSON in the batch row',async()=>{
 const f=await operatingFixture(),acquire=f.acquire,proof='synthetic-not-a-document-'.repeat(700000)
 f.acquire=async args=>({...await acquire(args),...(args.snapshot.currency==='MXN'?{officialBackground:{captureProofs:{documents:[{rawBase64:proof}]}}}:{} )})
 const r=await runOperatingCycle({...f,execute:true})
 expect(r.status).toBe('completed_with_country_results')
 expect(f.state.batch.payload.version).toBe('operating-frozen-input/2')
 expect(Buffer.byteLength(JSON.stringify(f.state.batch.payload))).toBeLessThan(262144)
})

it('keeps proposals and zero/changed budgets non-executable without inventing recurring consent',async()=>{
 const f=await operatingFixture(),send=vi.fn(),draft=operatingPolicyDraft(f)
 f.state.policy=draft
 const r=await runOperatingCycle({...f,send,execute:true})
 expect(r.holds).toEqual(expect.arrayContaining(['external_processing_configuration_pending','standing_budget_configuration_pending']))
 expect(f.store.jobs).toHaveLength(0);expect(send).not.toHaveBeenCalled()
 const changed=structuredClone(draft);changed.state='operator_configured';delete changed.binding;changed.binding=fingerprint(changed)
 expect(()=>assertOperatingPolicy(changed)).toThrow('explicit_operating_configuration_required')
 const reordered=structuredClone(draft)
 reordered.destination=Object.fromEntries(Object.entries(reordered.destination).reverse())
 delete reordered.binding;reordered.binding=fingerprint(reordered)
 expect(assertOperatingPolicy(reordered).state).toBe('proposal_not_enabled')
 for(const controlChange of [{enabled:false},{monthly_limit_nano:0}]){
  const configured=await operatingFixture(),blockedSend=vi.fn(),originalControl=configured.store.control
  configured.store.control=async()=>({...await originalControl(),...controlChange})
  const held=await runOperatingCycle({...configured,send:blockedSend,execute:true})
  expect(held.status).toBe('configuration_or_input_hold')
  expect(blockedSend).not.toHaveBeenCalled();expect(configured.store.jobs).toHaveLength(0)
 }
})
it('connects all six original extraction/comparison and writing/review stages to unapproved drafts; restart makes no duplicate calls',async()=>{
 const f=await operatingFixture(),r=await runOperatingCycle({...f,execute:true})
 expect(r.status,JSON.stringify(r)).toBe('completed_with_country_results')
 expect(r.rows.map(row=>({currency:row.currency,status:row.status})),JSON.stringify(r)).toEqual(
  ['BRL','MXN','COP','PEN','CLP','ARS'].map(currency=>({currency,status:'pending_admin_review'})))
 expect(f.store.drafts).toHaveLength(6)
 expect(f.state.posts).toHaveLength(24)
 expect(f.state.sourceCache).toHaveLength(6)
 expect(f.store.drafts.every(d=>d.candidate.testOnly&&d.candidate.status==='draft'&&!d.candidate.publishedAt)).toBe(true)
 const again=await runOperatingCycle({...f,execute:true})
 expect(again.status).toBe('completed');expect(f.state.posts).toHaveLength(24)
})
it('does not buy any article analysis for an already processed open case or an exhausted execution window',async()=>{
 const f=await operatingFixture(),r=await runOperatingCycle({...f,execute:true,clock:()=>1000,deadlineMs:125000})
 expect(r.status).toBe('paused');expect(f.state.posts).toHaveLength(0)
 const g=await operatingFixture();g.store.claimCase=async()=>({claimed:false,reason:'pending_admin_review'})
 const held=await runOperatingCycle({...g,execute:true})
 expect(held.rows.every(row=>row.status==='pending_admin_review')).toBe(true)
 expect(g.state.posts).toHaveLength(0)
})
it('reuses an unchanged captured edition with its original time/receipt while rejecting body, date and rule changes',async()=>{
 const f=await operatingFixture();await runOperatingCycle({...f,execute:true})
 const collection=structuredClone(f.collections.COP),original=collection.originals[0]
 const before=operatingMaterialHash({collection,commentaryTarget:{date:'2026-10-27'}})
 collection.asOf='2026-10-29T12:00:00Z'
 expect(operatingMaterialHash({collection,commentaryTarget:{date:'2026-10-27'}})).toBe(before)
 expect(operatingMaterialHash({collection,commentaryTarget:{date:'2026-10-28'}})).toBe(before)
 const cached=reuseOperatingSources(collection,f.state.sourceCache,f.state.policy.processingRulesBinding)
 expect(cached.savedSourceReviews).toHaveLength(1)
 expect(cached.collection.originals[0].collectedAt).toBe(original.collectedAt)
 const oldKey=operatingSourceKey(original,f.state.policy.processingRulesBinding)
 original.blocks[0].text+=' A genuinely revised statement.'
 expect(operatingSourceKey(original,f.state.policy.processingRulesBinding)).not.toBe(oldKey)
 expect(reuseOperatingSources(f.collections.COP,f.state.sourceCache,'changed-rule').savedSourceReviews).toEqual([])
 const prior=structuredClone(f.state.sourceCache.find(c=>c.currency==='COP'))
 // Exercise the compatibility path for immutable pre-v3 records.
 delete prior.sourceKey;prior.key=operatingSourceKey(prior.original,f.state.policy.processingRulesBinding)
 prior.review={cardBinding:prior.card.binding,heldStatus:'original_pipeline_failed',holds:['event_date_evidence_mismatch']}
 expect(reuseOperatingSources(f.collections.COP,[prior],f.state.policy.processingRulesBinding).savedSourceReviews).toEqual([])
 prior.review.dateRuleVersion=NEWS_EVENT_DATE_VERSION
 expect(reuseOperatingSources(f.collections.COP,[prior],f.state.policy.processingRulesBinding).savedSourceReviews).toHaveLength(1)
 delete prior.review.dateRuleVersion;prior.review.holds=['original_event_date_not_supported']
 expect(reuseOperatingSources(f.collections.COP,[prior],f.state.policy.processingRulesBinding).savedSourceReviews).toHaveLength(1)
})
it('confirms same-day dashboard reference dates without pretending to verify a market holiday or local close',async()=>{
 const f=await operatingFixture(),calendar=automaticReferenceCalendars(f.dataset,'2026-10-28T12:00:00Z')
 expect(calendar.CLP).toMatchObject({status:'confirmed',expectedReferenceDate:'2026-10-28'})
 expect(automaticReferenceCalendars(f.dataset,'2026-11-01T03:00:00Z').CLP).toMatchObject({status:'confirmed',referenceState:{holidayConfirmed:false}})
 expect(automaticReferenceCalendars(f.dataset,'2026-11-04T03:00:00Z').CLP.status).toBe('unverified')
})
import {ORIGINAL_NEWS_PIPELINE_VERSION} from './original-news-pipeline.js'
