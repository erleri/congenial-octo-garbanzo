import{it,expect,vi}from'vitest'
import{selectRuntimeAttempt,terminalRateLimit}from'./runtime-retry.js'
import{fingerprint}from'./research-harness.js'
const root='a'.repeat(64),hash='b'.repeat(64)
const rejected={id:'rejected',state:'received',request_hash:hash,cost_state:'unknown',actual_nano:null,reserved_nano:100,
 response:{valid:false,providerError:{code:429},partialText:'',usage:null,errors:['provider_stream_error']}}
it('requires explicit service opt-in and full reservation before retrying a terminal 429 without rewriting its job',async()=>{
 const jobs=new Map([[root,rejected]]),before=structuredClone(rejected),costEscrow=vi.fn(async()=>true)
 const store={job:async(k:string)=>jobs.get(k)??null,costEscrow}
 expect((await selectRuntimeAttempt({store,taskKey:root,requestHash:hash})).taskKey).toBe(root)
 expect(costEscrow).not.toHaveBeenCalled()
 const next=await selectRuntimeAttempt({store,taskKey:root,requestHash:hash,enabled:true})
 expect(next).toMatchObject({prior:null,retry:{retryOf:'rejected',retryAttempt:1,retryRoot:root}})
 expect(next.taskKey).not.toBe(root);expect(rejected).toEqual(before)
 costEscrow.mockResolvedValue(false)
 expect((await selectRuntimeAttempt({store,taskKey:root,requestHash:hash,enabled:true})).taskKey).toBe(root)
})
it('never retries uncertain transport, content failures, changed requests or unlimited failed attempts',async()=>{
 for(const patch of [{state:'calling'},{response:{...rejected.response,partialText:'partial'}},
  {response:{...rejected.response,providerError:{code:503}}},{response:{...rejected.response,valid:true}}]){
  const job={...rejected,...patch};expect(terminalRateLimit(job)).toBe(false)
  expect((await selectRuntimeAttempt({store:{job:async()=>job,costEscrow:async()=>true},taskKey:root,requestHash:hash,enabled:true})).taskKey).toBe(root)
 }
 expect((await selectRuntimeAttempt({store:{job:async()=>rejected,costEscrow:async()=>true},taskKey:root,requestHash:'c'.repeat(64),enabled:true})).taskKey).toBe(root)
 const one=fingerprint({version:'runtime-terminal-retry/1',root,attempt:1}),two=fingerprint({version:'runtime-terminal-retry/1',root,attempt:2})
 const jobs=new Map([[root,rejected],[one,{...rejected,id:'one',context:{retryOf:'rejected',retryAttempt:1,retryRoot:root}}],
  [two,{...rejected,id:'two',context:{retryOf:'one',retryAttempt:2,retryRoot:root}}]])
 const result=await selectRuntimeAttempt({store:{job:async(k:string)=>jobs.get(k)??null,costEscrow:async()=>true},taskKey:root,requestHash:hash,enabled:true})
 expect(result.taskKey).toBe(two);expect(result.prior.id).toBe('two')
})
