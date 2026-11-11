import {it,expect,vi} from 'vitest'
import {runtimeFixture,memoryRuntimeStore,syntheticRuntimeTransport,runtimeTestEnv} from './runtime-fixture.js'
import {runCurrencyRuntime} from './runtime.js'
import {terminalRateLimit} from './runtime-retry.js'
import {operatingFixture} from './operating-fixture.js'
import {runOperatingCycle} from './operating-cycle.js'
import {operatingEntry} from './operating-entry.js'
import {originalPipelineFixture} from './original-news-pipeline-fixture.js'
import {prepareOriginalNewsCase,prepareOriginalComparison} from './original-news-pipeline.js'
import {runtimeSourceTransport} from './runtime-source-transport.js'
import {NEWS_REVIEW_POLICY as p} from './news-model-review.js'
const rejection={valid:false,costUsd:0,responseId:'gen-rejection',partialText:'',usage:null,providerError:{code:429},errors:['provider_stream_error'],generationCalls:1}
function withPolicy(store){
 let nextExecution=false
 store.recoveryPolicy=async()=>({enabled:true})
 store.recoveryCandidates=async()=>({items:[],nextCursor:null})
 store.recoveryAttempt=async()=>({enabled:true,allowed:nextExecution,revision:2,reason:nextExecution?null:'recovery_next_execution_wait'})
 return ()=>{nextExecution=true}
}
for(const currency of ['BRL','MXN','COP','PEN','CLP','ARS'])for(const stage of ['writer','reviewer'])
it(`resumes only a failed ${stage} for ${currency}, preserving paid stages and originals`,async()=>{
 const f=runtimeFixture(currency),store=memoryRuntimeStore(),next=withPolicy(store),transport=syntheticRuntimeTransport(f.task)
 let calls=0
 const send=vi.fn(async args=>{calls++;return calls===(stage==='writer'?1:2)?{...rejection,actualModel:args.body.model}:transport.send(args)})
 await runCurrencyRuntime({...f,env:runtimeTestEnv,store,...transport,send})
 const old=structuredClone(store.jobs)
 expect(old.filter(j=>terminalRateLimit({state:j.state,response:j.response}))).toHaveLength(1)
 next()
 expect(await runCurrencyRuntime({...f,env:runtimeTestEnv,store,...transport,send})).toMatchObject({status:'pending_admin_review',modelCalls:stage==='writer'?2:1})
 expect(calls).toBe(3);expect(store.jobs).toHaveLength(3)
 for(const j of old)expect(store.jobs.find(n=>n.id===j.id)?.response).toEqual(j.response)
 expect(store.jobs.filter(j=>j.context.retryAttempt===1)).toHaveLength(1)
 await runCurrencyRuntime({...f,env:runtimeTestEnv,store,...transport,send})
 expect(calls).toBe(3)
})
it('continues the six-country common coordinator after a terminal extraction rejection without a manual case reset',async()=>{
 const f=await operatingFixture(),next=withPolicy(f.store),original=f.send
 let rejected=false
 const send=vi.fn(async args=>{if(!rejected){rejected=true;return {...rejection,actualModel:args.body.model}}return original(args)})
 await runOperatingCycle({...f,execute:true,send})
 next()
 const r=await runOperatingCycle({...f,execute:true,send})
 expect(r.rows.every(row=>row.status==='pending_admin_review'),JSON.stringify(r.rows)).toBe(true)
 expect(send).toHaveBeenCalledTimes(25)
 await runOperatingCycle({...f,execute:true,send})
 expect(send).toHaveBeenCalledTimes(25)
})
it('cost-only reconciliation never acquires FX, news, official data or model output',async()=>{
 const acquire=vi.fn(),fetchImpl=vi.fn(async()=>new Response('{}',{status:404}))
 const store={recoveryExecutionId:'one',recoveryPolicy:async()=>({enabled:true}),
  recoveryCandidates:async()=>({items:[{id:'old',state:'received',cost_state:'unknown',response_id:'gen-test',lookupDue:true}],nextCursor:null}),
  recordRecoveryLookup:vi.fn(),decideRecovery:async()=>({status:'recovery_retry_wait',scope:'job'})}
 const r=await operatingEntry({action:'reconcile',store,acquire,fetchImpl,env:{OPENROUTER_API_KEY:'synthetic'}})
 expect(r).toMatchObject({modelCalls:0,budgetReserved:false,publicationApproved:false})
 expect(acquire).not.toHaveBeenCalled();expect(fetchImpl).toHaveBeenCalledTimes(1)
 expect(fetchImpl.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/generation?id=gen-test')
})
it('retries only source comparison after reusing the exact paid extraction',async()=>{
 const f=await originalPipelineFixture(),plan=prepareOriginalNewsCase(f),store=memoryRuntimeStore(),next=withPolicy(store)
 const metadata={catalog:{data:{endpoints:[{model_id:p.model,tag:p.route,status:0,context_length:100000,max_completion_tokens:8192,
  supported_parameters:['reasoning','response_format','structured_outputs',p.outputField],pricing:{prompt:p.prompt/1e6,completion:p.completion/1e6}}]}},zdr:{data:[{model_id:p.model,tag:p.route}]}}
 let calls=0
 const send=vi.fn(async({body})=>{calls++;return calls===2?{...rejection,actualModel:body.model}:{valid:true,costUsd:.01,responseId:'gen-source-'+calls,actualModel:body.model,
  payload:{choices:[{message:{content:JSON.stringify(calls===1?f.candidate:f.comparison)}}]}}})
 const args={store,env:runtimeTestEnv,preflight:async()=>metadata,send,approval:{version:'runtime-source-approval/1',planBindings:[plan.binding],maxCalls:2,budgetUsd:1}}
 const first=runtimeSourceTransport(args),extracted=await first.extract(plan.extraction,plan),comparison=prepareOriginalComparison(plan,extracted.output)
 await expect(first.compare(comparison,plan)).rejects.toThrow('recovery_retry_wait')
 const original=structuredClone(store.jobs[0]);next()
 const resumed=runtimeSourceTransport(args)
 expect(await resumed.extract(plan.extraction,plan)).toMatchObject({generationCalls:0,reused:true})
 await resumed.compare(comparison,plan)
 expect(calls).toBe(3);expect(store.jobs[0]).toEqual(original)
 expect(store.jobs.filter(j=>j.context.retryAttempt===1)).toHaveLength(1)
 const repeated=runtimeSourceTransport(args);await repeated.extract(plan.extraction,plan);await repeated.compare(comparison,plan)
 expect(calls).toBe(3);expect(store.drafts).toHaveLength(0)
})
