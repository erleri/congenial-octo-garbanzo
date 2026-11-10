import {it,expect,vi} from 'vitest'
import {createEndpointMetadata} from './endpoint-metadata.js'
import {inspectNewsModelEndpoint,originalReviewPolicy} from './news-model-review.js'
import {prepareOriginalNewsCase,prepareOriginalComparison} from './original-news-pipeline.js'
import {originalPipelineFixture} from './original-news-pipeline-fixture.js'
import {runtimeSourceTransport} from './runtime-source-transport.js'
import {memoryRuntimeStore,runtimeTestEnv} from './runtime-fixture.js'
function metadata(writer='sol') {const p=originalReviewPolicy(writer);return {catalog:{data:{endpoints:[{model_id:p.model,tag:p.route,status:0,context_length:100000,max_completion_tokens:8192,supported_parameters:['reasoning','response_format','structured_outputs',p.outputField],pricing:{prompt:p.prompt/1e6,completion:p.completion/1e6}}]}},zdr:{data:[{model_id:p.model,tag:p.route}]}}}
it('shares concurrent metadata, expires at five minutes and invalidates on route changes',async()=>{
 let now=0;const f=await originalPipelineFixture(),body=prepareOriginalNewsCase(f).extraction.body,data=metadata()
 const fetchImpl=vi.fn(async(url:string)=>({ok:true,status:200,json:async()=>url.endsWith('/zdr')?data.zdr:data.catalog}))
 const get=createEndpointMetadata({fetchImpl,clock:()=>now,sleep:async()=>{}})
 const [a,b]=await Promise.all([get(body),get(body)]);expect(a).toEqual(b);expect(fetchImpl).toHaveBeenCalledTimes(2)
 now=299999;await get(body);expect(fetchImpl).toHaveBeenCalledTimes(2)
 now=300000;await get(body);expect(fetchImpl).toHaveBeenCalledTimes(4)
 await get({...body,provider:{...body.provider,only:['azure/us']}});expect(fetchImpl).toHaveBeenCalledTimes(6)
})
it('retries only transient free GET once, not policy failures or POSTs',async()=>{
 const f=await originalPipelineFixture(),body=prepareOriginalNewsCase(f).extraction.body,data=metadata();let catalogCalls=0
 const fetchImpl=vi.fn(async(url:string)=>url.endsWith('/zdr')?{ok:true,status:200,json:async()=>data.zdr}:++catalogCalls===1?{ok:false,status:503}:{ok:true,status:200,json:async()=>data.catalog})
 const get=createEndpointMetadata({fetchImpl,sleep:async()=>{}});await get(body);expect(catalogCalls).toBe(2)
 const fail=vi.fn(async()=>({ok:false,status:403}));await expect(createEndpointMetadata({fetchImpl:fail,sleep:async()=>{}})(body)).rejects.toThrow('metadata_unavailable');expect(fail).toHaveBeenCalledTimes(2)
})
it('categorizes request, route, features, privacy, price and size without raw content',async()=>{
 const plan=prepareOriginalNewsCase(await originalPipelineFixture()),data=metadata()
 expect(inspectNewsModelEndpoint(plan.extraction,data.catalog,data.zdr)).toMatchObject({route:'azure'})
 for(const [code,modify] of [
  ['route_unavailable',(d:ReturnType<typeof metadata>)=>d.catalog.data.endpoints[0].status=1],
  ['unsupported_parameters',(d:ReturnType<typeof metadata>)=>d.catalog.data.endpoints[0].supported_parameters=[]],
  ['processing_conditions',(d:ReturnType<typeof metadata>)=>d.zdr.data=[]],
  ['price_or_input_limit',(d:ReturnType<typeof metadata>)=>d.catalog.data.endpoints[0].pricing.prompt=1],
 ] as const){const d=structuredClone(data);modify(d);expect(()=>inspectNewsModelEndpoint(plan.extraction,d.catalog,d.zdr)).toThrow(code)}
 expect(()=>inspectNewsModelEndpoint({...plan.extraction,requestHash:'changed'},data.catalog,data.zdr)).toThrow('request_configuration')
})
it('binds a new source profile explicitly; legacy requests stay identical and comparison uses its own plan',async()=>{
 const f=await originalPipelineFixture(),legacy=prepareOriginalNewsCase(f),us=prepareOriginalNewsCase({...f,sourceWriter:'sol-us'})
 expect(prepareOriginalNewsCase({...f,sourceWriter:'sol'})).toEqual(legacy)
 expect(us.binding).not.toBe(legacy.binding);expect(us.maximumUsd).toBeGreaterThan(legacy.maximumUsd)
 const comparison=prepareOriginalComparison(us,f.candidate),data=metadata('sol-us')
 expect(comparison.body.provider.only).toEqual(['azure/us']);expect(inspectNewsModelEndpoint(comparison,data.catalog,data.zdr).route).toBe('azure/us')
 expect(legacy.extraction.body.messages).toEqual(us.extraction.body.messages)
})
it('preflight failure reserves nothing and the next healthy check can dispatch the original request',async()=>{
 const f=await originalPipelineFixture(),plan=prepareOriginalNewsCase(f),store=memoryRuntimeStore(),send=vi.fn(async()=>({valid:true,actualModel:plan.extraction.body.model,costUsd:.01,responseId:'gen-ok',payload:{choices:[{message:{content:JSON.stringify(f.candidate)}}]}}))
 let healthy=false
 const t=runtimeSourceTransport({store,env:runtimeTestEnv,approval:{version:'runtime-source-approval/1',planBindings:[plan.binding],maxCalls:2,budgetUsd:1},preflight:async()=>{if(!healthy)throw Error('token=DO_NOT_LOG');return metadata()},send})
 await expect(t.extract(plan.extraction,plan)).rejects.toMatchObject({beforeDispatch:true,diagnostic:{category:'metadata_unavailable',stage:'extract'}})
 expect(store.jobs).toHaveLength(0);expect(send).not.toHaveBeenCalled();healthy=true;await t.extract(plan.extraction,plan);expect(send).toHaveBeenCalledTimes(1)
})
