import {it,expect} from 'vitest'
import {runtimeFixture,memoryRuntimeStore,syntheticRuntimeTransport,runtimeTestEnv} from './runtime-fixture.js'
import {runCurrencyRuntime,prepareRuntimeTask} from './runtime.js'
import {buildSharedDashboardPriceSnapshot} from './shared-price-contract.js'
import {fingerprint} from './research-harness.js'
import {runtimeSourceTransport} from './runtime-source-transport.js'
import {originalPipelineFixture} from './original-news-pipeline-fixture.js'
import {prepareOriginalNewsCase,prepareOriginalComparison} from './original-news-pipeline.js'
import {NEWS_REVIEW_POLICY as p} from './news-model-review.js'

function withJobLookup(store){
 return {...store,job:async key=>{
  const j=store.jobs.find(j=>j.taskKey===key)
  return j?{id:j.id,state:j.state,cost_state:j.costState,actual_nano:j.actual,reserved_nano:j.reservedNano,
   request_hash:j.requestHash,context:j.context,response:j.response}:null
 }}
}
it('resumes a persisted writer using confirmed ledger cost without buying another invocation or rewriting its raw response',async()=>{
 const f=runtimeFixture(),base=memoryRuntimeStore(),store=withJobLookup(base),transport=syntheticRuntimeTransport(f.task)
 let interrupted=false,posts=0
 store.receive=async(...args)=>{await base.receive(...args);if(!interrupted){interrupted=true;throw Error('synthetic_process_interruption')}}
 const send=async args=>{posts++;return transport.send(args)}
 await expect(runCurrencyRuntime({...f,env:runtimeTestEnv,store,...transport,send})).rejects.toThrow('synthetic_process_interruption')
 expect(posts).toBe(1)
 // Simulate a separately reconciled expense: the ledger is confirmed while
 // the original response still honestly contains a missing usage cost.
 base.jobs[0].response.costUsd=null
 expect(await runCurrencyRuntime({...f,env:runtimeTestEnv,store,...transport,send})).toMatchObject({status:'pending_admin_review',modelCalls:1})
 expect(posts).toBe(2);expect(base.jobs).toHaveLength(2);expect(base.drafts).toHaveLength(1)
 expect(base.jobs[0].response.costUsd).toBeNull()
})
it('resumes a source comparison with the exact saved extraction and does not classify confirmed invalid JSON as unknown spending',async()=>{
 const f=await originalPipelineFixture(),plan=prepareOriginalNewsCase(f),store=withJobLookup(memoryRuntimeStore())
 const metadata={catalog:{data:{endpoints:[{model_id:p.model,tag:p.route,status:0,context_length:100000,max_completion_tokens:8192,
  supported_parameters:['reasoning','response_format','structured_outputs',p.outputField],pricing:{prompt:p.prompt/1e6,completion:p.completion/1e6}}]}},zdr:{data:[{model_id:p.model,tag:p.route}]}}
 const args={store,env:runtimeTestEnv,approval:{version:'runtime-source-approval/1',planBindings:[plan.binding],maxCalls:2,budgetUsd:1},preflight:async()=>metadata}
 const response=(body,output)=>({valid:true,actualModel:body.model,costUsd:.01,responseId:'gen-synthetic-'+store.jobs.length,payload:{choices:[{message:{content:JSON.stringify(output)}}]}})
 const first=runtimeSourceTransport({...args,send:async({body})=>response(body,f.candidate)})
 await first.extract(plan.extraction,plan)
 let calls=0
 const next=runtimeSourceTransport({...args,send:async({body})=>{calls++;return response(body,f.comparison)}})
 const reused=await next.extract(plan.extraction,plan)
 expect(reused).toMatchObject({generationCalls:0,reused:true,costUsd:0})
 await next.compare(prepareOriginalComparison(plan,reused.output),plan)
 expect(calls).toBe(1);expect(store.jobs).toHaveLength(2)
 const other=runtimeSourceTransport({...args,store:memoryRuntimeStore(),send:async({body})=>({...response(body,f.candidate),payload:{choices:[{message:{content:'broken json'}}]}})})
 await expect(other.extract(plan.extraction,plan)).rejects.toMatchObject({message:'source_json_hold',recordedCostUsd:.01,recordedGenerationCalls:1})
})
it('builds periodic writing input from a real published anchor and current reviewed material without a hand-authored topic map',()=>{
 const f=runtimeFixture(),oldDate='2026-10-05'
 const dataset={...f.dataset,dailyRates:[{...f.dataset.dailyRates[0],date:'2026-10-02',value:99},{...f.dataset.dailyRates[0],date:oldDate},...f.dataset.dailyRates]}
 const snapshot=buildSharedDashboardPriceSnapshot({dataset,currency:f.currency,asOf:f.asOf,calendar:f.calendar})
 const handoff=structuredClone(f.handoff),c=handoff.materialConnection
 handoff.reportPriceSnapshot=snapshot;c.referenceSnapshotId=snapshot.snapshotId;delete c.binding;c.binding=fingerprint(c)
 const old=buildSharedDashboardPriceSnapshot({dataset:{...dataset,baseDate:oldDate,fetchedAt:oldDate+'T02:00:00Z',dailyRates:dataset.dailyRates.slice(0,2)},currency:f.currency,asOf:oldDate+'T12:00:00Z'})
 const publications=[{id:'published-periodic-anchor',currency:f.currency,publishedAt:oldDate+'T12:00:00Z',kind:'market',state:'published',origin:'published_record',
  stored:true,approved:true,priceReviewed:true,historical:false,editorialOnly:false,withdrawn:false,snapshot:old,
  report:{content:{summary:'전회 보도는 달러 수요에 관한 분석가의 해석을 담았다.',drivers:[],implications:[]}}}]
 const task=prepareRuntimeTask({...f,dataset,handoff,publications})
 expect(task).toMatchObject({status:'prepared',purpose:'periodic',sourceUseReview:{externalModel:'pass'}})
 expect(task.plan.packet.sharedReference.edition).toMatchObject({kind:'periodic_check',previous:{id:'published-periodic-anchor',value:100}})
 const compiled=syntheticRuntimeTransport(task).compiled
 expect(compiled.validation).toMatchObject({valid:true})
 expect(compiled.candidate.change.factIds).toEqual(['spot','published_previous','published_change'])
 expect(compiled.claimReview.writingCoverageRequirements.some(r=>r.id==='shared_periodic_comparison')).toBe(true)
})
