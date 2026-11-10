import {it,expect,vi} from 'vitest'
import {runtimeSourceTransport} from './runtime-source-transport.js'
import {memoryRuntimeStore,runtimeTestEnv} from './runtime-fixture.js'
import {originalPipelineFixture} from './original-news-pipeline-fixture.js'
import {prepareOriginalNewsCase,prepareOriginalComparison} from './original-news-pipeline.js'
import {NEWS_REVIEW_POLICY as p} from './news-model-review.js'
const metadata={catalog:{data:{endpoints:[{model_id:p.model,tag:p.route,status:0,context_length:100000,max_completion_tokens:8192,
 supported_parameters:['reasoning','response_format','structured_outputs',p.outputField],pricing:{prompt:p.prompt/1e6,completion:p.completion/1e6}}]}},
 zdr:{data:[{model_id:p.model,tag:p.route}]}}
it('requires a bound source budget before reserving or posting',async()=>{
 const f=await originalPipelineFixture(),plan=prepareOriginalNewsCase(f),store=memoryRuntimeStore(),send=vi.fn()
 const t=runtimeSourceTransport({store,env:runtimeTestEnv,preflight:async()=>metadata,send})
 await expect(t.extract(plan.extraction,plan)).rejects.toThrow('source_budget_not_approved')
 expect(store.jobs).toHaveLength(0);expect(send).not.toHaveBeenCalled()
})
it('stores both source stages and their costs without storing the raw request or creating a report',async()=>{
 const f=await originalPipelineFixture(),plan=prepareOriginalNewsCase(f),store=memoryRuntimeStore()
 let n=0
 const t=runtimeSourceTransport({store,env:runtimeTestEnv,approval:{version:'runtime-source-approval/1',planBindings:[plan.binding],maxCalls:2,budgetUsd:1},
  preflight:async()=>metadata,send:async({body})=>({valid:true,actualModel:body.model,costUsd:.01,responseId:'gen-source-'+(++n),
   payload:{choices:[{message:{content:JSON.stringify(n===1?f.candidate:f.comparison)}}]}})})
 const extracted=await t.extract(plan.extraction,plan)
 await t.compare(prepareOriginalComparison(plan,extracted.output),plan)
 expect(t.accounting()).toMatchObject({calls:2,committedUsd:.02,stopped:false})
 expect(store.jobs).toHaveLength(2);expect(store.drafts).toHaveLength(0)
 expect(store.jobs.every(j=>j.context.purpose==='original_source_review'&&j.costState==='confirmed')).toBe(true)
 expect(JSON.stringify(store.jobs.map(j=>j.context))).not.toContain('El dólar subió en el mercado')
 await expect(t.extract(plan.extraction,plan)).rejects.toThrow('source_stage_order_or_binding_changed')
})
it('preserves an unknown source expense and does not retry after transport failure',async()=>{
 const f=await originalPipelineFixture(),plan=prepareOriginalNewsCase(f),store=memoryRuntimeStore(),send=vi.fn(async()=>{throw Error('transport lost')})
 const t=runtimeSourceTransport({store,env:runtimeTestEnv,approval:{version:'runtime-source-approval/1',planBindings:[plan.binding],maxCalls:2,budgetUsd:1},preflight:async()=>metadata,send})
 await expect(t.extract(plan.extraction,plan)).rejects.toThrow('source_cost_unresolved')
 expect(store.jobs[0]).toMatchObject({costState:'unknown',state:'received'})
 await expect(t.extract(plan.extraction,plan)).rejects.toThrow('source_runtime_stopped')
 expect(send).toHaveBeenCalledTimes(1)
})
it('reuses both confirmed source stages during a metadata outage without reserving or sending',async()=>{
 const f=await originalPipelineFixture(),plan=prepareOriginalNewsCase(f),store=memoryRuntimeStore()
 const approval={version:'runtime-source-approval/1',planBindings:[plan.binding],maxCalls:2,budgetUsd:1};let n=0
 const first=runtimeSourceTransport({store,env:runtimeTestEnv,approval,preflight:async()=>metadata,
  send:async({body})=>({valid:true,actualModel:body.model,costUsd:.01,responseId:'cached-'+(++n),payload:{choices:[{message:{content:JSON.stringify(n===1?f.candidate:f.comparison)}}]}})})
 const extracted=await first.extract(plan.extraction,plan);const comparison=prepareOriginalComparison(plan,extracted.output);await first.compare(comparison,plan)
 const preflight=vi.fn(async()=>{throw Error('offline')}),send=vi.fn(),resumed=runtimeSourceTransport({store,env:runtimeTestEnv,approval,preflight,send})
 expect(await resumed.extract(plan.extraction,plan)).toMatchObject({reused:true,generationCalls:0,costUsd:0})
 expect(await resumed.compare(comparison,plan)).toMatchObject({reused:true,generationCalls:0,costUsd:0})
 expect(preflight).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();expect(store.jobs).toHaveLength(2)
})
