import {expect,it,vi} from 'vitest'
import {fingerprint} from './research-harness.js'
import {assertProviderSchema} from './paid-comparison.js'
import {originalPipelineFixture} from './original-news-pipeline-fixture.js'
import {collectSelectedResearch} from './selected-source-collection.js'
import {planResearchSourceSelection} from './research-source-selection.js'
import {prepareOriginalNewsCase,prepareOriginalComparison,inspectExtractedNews,completeOriginalNewsReview,runOriginalNewsCase,originalNewsModelAdapter} from './original-news-pipeline.js'
import {NEWS_REVIEW_POLICY} from './news-model-review.js'

it('permits a whole-article comparison context wider than direct citations while rejecting duplicate and nonexistent locations',async()=>{
 const f=await originalPipelineFixture('whole-context',false,false,12),plan=prepareOriginalNewsCase(f)
 const comparison=structuredClone(f.comparison)
 comparison.claims.forEach(r=>{r.contextBlockPositions=plan.job.blocks.map((_,i)=>i)})
 const result=completeOriginalNewsReview({...f,plan,comparison})
 expect(result.status).toBe('source_card_prepared')
 expect(result.receipt.supportingReferences[1].blockPositions).toEqual([1,2])
 for(const bad of [[0,0],[plan.job.blocks.length]]){
  const changed=structuredClone(comparison);changed.claims[0].contextBlockPositions=bad
  expect(()=>completeOriginalNewsReview({...f,plan,comparison:changed})).toThrow('invalid_original_comparison')
 }
 const unsupported=structuredClone(comparison);unsupported.claims[0].allSubclaimsSupported=false
 expect(completeOriginalNewsReview({...f,plan,comparison:unsupported}).status).toBe('original_support_hold')
})

it('turns a registered supplied URL into two separate original-backed stages and an existing bound note/scope receipt',async()=>{
 const f=await originalPipelineFixture(),before=structuredClone(f.collection),plan=prepareOriginalNewsCase(f)
 expect(f.collection.networkCalls).toBe(0)
 expect(f.collection.outcomes.every(o=>o.discoveryMode==='explicit_url_not_publisher_listing')).toBe(true)
 assertProviderSchema(plan.extraction.body.response_format.json_schema.schema)
 const extract=vi.fn(async r=>({requestHash:r.requestHash,responseId:'gen-extract',output:f.candidate}))
 const compare=vi.fn(async r=>{
   const input=JSON.parse(r.body.messages[1].content)
   expect(input).not.toHaveProperty('targets')
   expect(JSON.stringify(input)).not.toContain('baseYear')
   expect(input.blocks).toEqual(plan.job.blocks)
   expect(input.candidate).not.toHaveProperty('reason')
   expect(JSON.stringify(input)).not.toContain(f.candidate.reason)
   return {requestHash:r.requestHash,responseId:'gen-compare',output:f.comparison}
 })
 const result=await runOriginalNewsCase({...f,extract,compare})
 expect(result).toMatchObject({status:'source_card_prepared',stageInvocations:2,originalComparisonPerformed:true,originalSupportProven:false,
   sourceUseStatus:'notes_use_not_assessed',writingEligibility:'not_assessed',publicationApproved:false})
 expect(result.receipt.supportingReferences[1].blockPositions).toEqual([1,2])
 expect(result.evidence.evidence[0].newsNotes.notes[1].attribution.person).toBe('María Pérez')
 expect(result.receipt.notes.every(n=>n.reportedPrice===null)).toBe(true)
 expect(f.collection).toEqual(before);expect(extract).toHaveBeenCalledTimes(1);expect(compare).toHaveBeenCalledTimes(1)
})

it('blocks missing source-use permission and changed originals before either stage, without manual-user work',async()=>{
 const f=await originalPipelineFixture(),extract=vi.fn(),compare=vi.fn()
 const result=await runOriginalNewsCase({...f,sourceUse:{...f.sourceUse,reviews:[]},extract,compare})
 expect(result).toMatchObject({status:'original_review_hold',holds:['source_use_review_missing'],stageInvocations:0})
 expect(extract).not.toHaveBeenCalled();expect(compare).not.toHaveBeenCalled()
 const changed=structuredClone(f.collection);changed.originals[0].blocks[0].text+=' revised'
 await expect(runOriginalNewsCase({...f,collection:changed,extract,compare})).rejects.toThrow('stale')
})

it('enforces measurement scope without requiring a quoted exchange-rate number or reclassifying a failed independent review',async()=>{
 const f=await originalPipelineFixture(),plan=prepareOriginalNewsCase(f),before=fingerprint(f.collection)
 expect(inspectExtractedNews(plan.job,f.candidate).status).toBe('candidate_requires_original_comparison') // no numeric price, kind not_stated
 for(const role of ['market_explanation','price_only'])expect(()=>inspectExtractedNews(plan.job,{...f.candidate,role,priceKind:'not_applicable'})).toThrow('market_measurement_not_applicable')
 const comparison=structuredClone(f.comparison);comparison.claims[1].scopeMatches=false
 expect(completeOriginalNewsReview({...f,plan,comparison})).toMatchObject({status:'original_support_hold',failedClaimIds:['n1'],publicationApproved:false})
 expect(fingerprint(f.collection)).toBe(before)
})

it('rejects a different publisher or country path before a direct URL can trigger network access',async()=>{
 const f=await originalPipelineFixture(),fetchImpl=vi.fn()
 const ids=planResearchSourceSelection({input:f.input,sourcePlan:f.sourcePlan,sourceRegister:f.sourceRegister}).sourceRequests
   .filter(r=>r.sourceId==='cop-larepublica').map(r=>r.requestId)
 for(const url of ['https://example.org/dolar','https://www.larepublica.co/politica/not-an-allowed-finance-path']){
   await expect(collectSelectedResearch({input:f.input,sourcePlan:f.sourcePlan,sourceRegister:f.sourceRegister,requestIds:ids,
     articleUrls:[{sourceId:'cop-larepublica',url}],mode:'live',fetchImpl})).rejects.toThrow('explicit_article_source_or_path_mismatch')
 }
 expect(fetchImpl).not.toHaveBeenCalled()
})

it('does not create a card if comparison finds a lost condition or unsupported subclaim',async()=>{
 const f=await originalPipelineFixture(),comparison=structuredClone(f.comparison)
 comparison.claims[1].conditionsPreserved=false
 const result=await runOriginalNewsCase({...f,extract:async r=>({requestHash:r.requestHash,output:f.candidate}),
   compare:async r=>({requestHash:r.requestHash,output:comparison})})
 expect(result).toMatchObject({status:'original_support_hold',failedClaimIds:['n1'],originalComparisonPerformed:true,publicationApproved:false})
 expect(result).not.toHaveProperty('receipt')
 const unresolved=structuredClone(f.comparison);unresolved.claims[1].allSubclaimsSupported=false
 const held=await runOriginalNewsCase({...f,extract:async r=>({requestHash:r.requestHash,output:f.candidate}),
   compare:async r=>({requestHash:r.requestHash,output:unresolved})})
 expect(held.status).toBe('original_support_hold')
 const wrongDate=structuredClone(f.comparison);wrongDate.decision='hold';wrongDate.eventDate=''
 wrongDate.limitations=[{blocking:true,kind:'period',reason:'The cited passage concerns a future event, not the quoted market session.'}]
 const dated=await runOriginalNewsCase({...f,extract:async r=>({requestHash:r.requestHash,output:f.candidate}),
  compare:async r=>({requestHash:r.requestHash,output:wrongDate})})
 expect(dated).toMatchObject({status:'original_support_hold',reason:'original_event_date_not_supported'})
 expect(dated).not.toHaveProperty('receipt')
 wrongDate.decision='supported'
 const falselySupported=await runOriginalNewsCase({...f,extract:async r=>({requestHash:r.requestHash,output:f.candidate}),
  compare:async r=>({requestHash:r.requestHash,output:wrongDate})})
 expect(falselySupported).toMatchObject({status:'original_pipeline_failed',reason:'invalid_original_comparison'})
 const dropped=structuredClone(f.comparison);dropped.claims[1].conditionBlockPositions=[];dropped.claims[1].contextBlockPositions=[]
 const missing=await runOriginalNewsCase({...f,extract:async r=>({requestHash:r.requestHash,output:f.candidate}),
   compare:async r=>({requestHash:r.requestHash,output:dropped})})
 expect(missing).toMatchObject({status:'original_pipeline_failed',reason:'comparison_dropped_candidate_context'})
})

it('rejects invented speakers, event-day changes, copied paragraphs and global-to-local promotion',async()=>{
 const f=await originalPipelineFixture(),plan=prepareOriginalNewsCase(f)
 const speaker=structuredClone(f.candidate);speaker.claims[1].person='Invented analyst'
 expect(()=>inspectExtractedNews(plan.job,speaker)).toThrow('attribution_not_in_original')
 const date=structuredClone(f.candidate);date.eventDate='2026-10-25'
 expect(()=>inspectExtractedNews(plan.job,date)).toThrow('explicit_event_date_not_supported')
 const global=structuredClone(f.candidate);global.role='global_context'
 expect(()=>inspectExtractedNews(plan.job,global)).toThrow('promoted_to_local')
 const copied=structuredClone(f.candidate);copied.claims[0].text=plan.job.blocks[0].text
 expect(()=>inspectExtractedNews(plan.job,copied)).toThrow('copies_original')
})

it('does not reuse extraction as a comparison result or an unrelated response as support',async()=>{
 const f=await originalPipelineFixture(),plan=prepareOriginalNewsCase(f)
 const result=await runOriginalNewsCase({...f,extract:async r=>({requestHash:r.requestHash,responseId:'gen-same',output:f.candidate}),
   compare:async r=>({requestHash:r.requestHash,responseId:'gen-same',output:f.comparison})})
 expect(result).toMatchObject({status:'original_pipeline_failed',reason:'comparison_not_a_separate_bound_response'})
 const wrong=await runOriginalNewsCase({...f,extract:async()=>({requestHash:'wrong',output:f.candidate}),compare:vi.fn()})
 expect(wrong).toMatchObject({status:'original_pipeline_failed',stageInvocations:1,reason:'extraction_response_binding_mismatch'})
 expect(prepareOriginalComparison(plan,f.candidate).requestHash).not.toBe(plan.extraction.requestHash)
})

it('versions new date instructions without rebinding historical requests or turning out-of-window evidence into current support',async()=>{
 const f=await originalPipelineFixture(),legacy=prepareOriginalNewsCase({...f,version:'original-news-pipeline/2'}),current=prepareOriginalNewsCase(f)
 const before=fingerprint(legacy)
 expect(current.version).toBe('original-news-pipeline/9')
 const contextLegacy=prepareOriginalNewsCase({...f,version:'original-news-pipeline/8'})
 expect(contextLegacy.extraction.body.messages[0].content).not.toContain('먼저 사건·거래일별로 묶고')
 expect(current.extraction.body.messages[0].content).toContain('먼저 사건·거래일별로 묶고')
 expect(completeOriginalNewsReview({...f,plan:contextLegacy}).status).toBe('source_card_prepared')
 const periodLegacy=prepareOriginalNewsCase({...f,version:'original-news-pipeline/6'})
 expect(periodLegacy.extraction.body.messages[0].content).not.toContain('명목환율, 실질환율 지수, 국가위험 프리미엄')
 expect(current.extraction.body.messages[0].content).toContain('명목환율, 실질환율 지수, 국가위험 프리미엄')
 expect(prepareOriginalComparison(current,f.candidate).body.messages[0].content).toContain('scopeMatches=false')
 expect(current.extraction.requestHash).not.toBe(periodLegacy.extraction.requestHash)
 expect(legacy.extraction.requestHash).not.toBe(current.extraction.requestHash)
 const legacyComparison=structuredClone(f.comparison);delete legacyComparison.marketPeriod
 legacyComparison.claims.forEach(r=>delete r.contextBlockPositions)
 expect(completeOriginalNewsReview({...f,comparison:legacyComparison,plan:legacy}).status).toBe('source_card_prepared')
 expect(fingerprint(legacy)).toBe(before)
 expect(prepareOriginalComparison(legacy,f.candidate).body.messages[0].content).toContain('발행일과 같은 날의 다른 사건이나 회고·예정 표현이면 period 보류다.')
 expect(prepareOriginalComparison(current,f.candidate).body.messages[0].content).toContain('예정이라는 이유만으로 반려하지 않는다')
 expect(()=>prepareOriginalNewsCase({...f,version:'invented'})).toThrow('unsupported_original_pipeline_version')
 for(const currency of ['BRL','MXN','CLP','COP','PEN','ARS']){
  const job={...current.job,currency,time:{...current.job.time,requestedDates:['2026-10-27']}}
  expect(()=>inspectExtractedNews(job,f.candidate)).toThrow('extraction_event_outside_research_window')
  expect(()=>inspectExtractedNews(job,{...f.candidate,role:'price_only'})).toThrow('extraction_event_outside_research_window')
 }
})

function stream(output:unknown,id:string,cost:number|null){
 const payload={id,model:NEWS_REVIEW_POLICY.model,choices:[{index:0,delta:{content:JSON.stringify(output)},finish_reason:'stop'}],
   ...(cost!==null?{usage:{cost,prompt_tokens:100,completion_tokens:100}}:{})}
 return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}})
}
function preflight(){return Promise.resolve({catalog:{data:{endpoints:[{tag:'azure',model_id:NEWS_REVIEW_POLICY.model,status:0,
 supported_parameters:['reasoning','response_format','structured_outputs','max_completion_tokens'],context_length:100000,max_completion_tokens:8192,
 pricing:{prompt:'0.000002',completion:'0.00001'}}]}},zdr:{data:[{tag:'azure',model_id:NEWS_REVIEW_POLICY.model}]}})}

it('reuses the protected stream with exact approval, two reservations, known costs and no generation retry',async()=>{
 const f=await originalPipelineFixture(),plan=prepareOriginalNewsCase(f),reserve=vi.fn(async()=>{}),saveResult=vi.fn(async()=>{})
 const fetchImpl=vi.fn().mockResolvedValueOnce(stream(f.candidate,'gen-synthetic-extract',.001)).mockResolvedValueOnce(stream(f.comparison,'gen-synthetic-compare',.002))
 const adapter=originalNewsModelAdapter({plan,approval:{authorized:true,planBinding:plan.binding,budgetUsd:.25},apiKey:'synthetic-test-key',preflight,
   reserve,saveResult,fetchImpl})
 expect(plan.maximumUsd).toBeLessThan(.25)
 const result=await runOriginalNewsCase({...f,...adapter})
 expect(result.status).toBe('source_card_prepared')
 expect(adapter.getAccounting()).toEqual({calls:2,committedUsd:.003,stopped:false,retries:0})
 expect(reserve).toHaveBeenCalledTimes(2);expect(saveResult).toHaveBeenCalledTimes(2);expect(fetchImpl).toHaveBeenCalledTimes(2)
 expect(fingerprint(JSON.parse(fetchImpl.mock.calls[0][1].body))).toBe(plan.extraction.requestHash)
})

it('keeps an unknown first-stage cost reserved and never sends a comparison',async()=>{
 const f=await originalPipelineFixture(),plan=prepareOriginalNewsCase(f),saveResult=vi.fn(async()=>{})
 const fetchImpl=vi.fn().mockResolvedValueOnce(stream(f.candidate,'gen-synthetic-unknown',null))
   .mockResolvedValueOnce(new Response(JSON.stringify({data:{id:'gen-synthetic-unknown',finish_reason:'stop'}})))
 const adapter=originalNewsModelAdapter({plan,approval:{authorized:true,planBinding:plan.binding,budgetUsd:.25},apiKey:'synthetic-test-key',preflight,
   reserve:vi.fn(async()=>{}),saveResult,fetchImpl})
 const result=await runOriginalNewsCase({...f,...adapter})
 expect(result).toMatchObject({status:'original_pipeline_failed',stageInvocations:1,reason:'original_trial_cost_hold'})
 expect(adapter.getAccounting()).toEqual({calls:1,committedUsd:plan.extraction.maximumUsd,stopped:true,retries:0})
 expect(saveResult.mock.calls[0][0]).toMatchObject({costUsd:null,reservedUsd:plan.extraction.maximumUsd})
 // One generation and one read-only cost lookup; no second generation.
 expect(fetchImpl.mock.calls.filter(c=>c[0].endsWith('/chat/completions'))).toHaveLength(1)
})
