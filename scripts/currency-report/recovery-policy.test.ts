import {it,expect,vi} from 'vitest'
import {recoverOperatingCalls} from './operating-recovery.js'
import {selectRuntimeAttempt} from './runtime-retry.js'
import {reconcileGenerationCost} from './openrouter-stream.js'
import {operatingResultState} from './operating-result.js'
const rejection={id:'old',state:'received',request_hash:'hash',cost_state:'unknown',reserved_nano:100,response:{valid:false,partialText:'',usage:null,providerError:{code:429},errors:['provider_stream_error']}}
it.each([[404,'record_not_found'],[401,'authentication_error'],[403,'permission_error'],[429,'lookup_rate_limited'],[503,'provider_error']])('distinguishes cost lookup HTTP %s without assuming zero or sending a model request',async(status,reason)=>{
 const fetchImpl=vi.fn(async()=>new Response('{}',{status:Number(status)}))
 expect(await reconcileGenerationCost({responseId:'gen-test',apiKey:'synthetic',fetchImpl})).toMatchObject({costUsd:null,lookup:{reason}})
 expect(fetchImpl).toHaveBeenCalledTimes(status===503?2:1)
 expect(fetchImpl.mock.calls.every(c=>!c[1].method)).toBe(true)
})
it.each([
 ['bad','invalid_json'],[JSON.stringify({data:{id:'gen-other'}}),'identity_mismatch'],
 [JSON.stringify({data:{id:'gen-test',finish_reason:null,total_cost:0}}),'completion_not_confirmed'],
 [JSON.stringify({data:{id:'gen-test',finish_reason:'stop',total_cost:-1}}),'cost_missing']
])('preserves expense uncertainty on %s',async(body,reason)=>{
 expect(await reconcileGenerationCost({responseId:'gen-test',apiKey:'synthetic',fetchImpl:async()=>new Response(body)})).toMatchObject({costUsd:null,lookup:{reason}})
})
it('accepts a verified zero receipt and retries only a transient free network lookup',async()=>{
 const fetchImpl=vi.fn().mockRejectedValueOnce(new TypeError('secret must not be returned')).mockResolvedValueOnce(new Response(JSON.stringify({data:{id:'gen-test',finish_reason:'error',total_cost:0}})))
 const r=await reconcileGenerationCost({responseId:'gen-test',apiKey:'synthetic',fetchImpl})
 expect(r).toMatchObject({costUsd:0,costSource:'generation.total_cost',lookup:{reason:'confirmed'}})
 expect(JSON.stringify(r)).not.toContain('secret')
})
it('inspects all recovery pages, skips not-due receipts, and keeps a late ambiguous job globally blocking',async()=>{
 const recordRecoveryLookup=vi.fn(),reconcile=vi.fn(async()=>({costUsd:null,lookup:{reason:'record_not_found',httpStatus:404}}))
 const store={recoveryPolicy:async()=>({enabled:true}),recoveryCandidates:async(cursor)=>cursor
  ?{items:[{id:'late',state:'received',cost_state:'unknown',response_id:'gen-late',lookupDue:false}],nextCursor:null}
  :{items:[{id:'terminal',state:'received',cost_state:'unknown',response_id:'gen-terminal',lookupDue:true}],nextCursor:'page-2'},recordRecoveryLookup,
  decideRecovery:async({id})=>({status:id==='late'?'cost_still_unconfirmed':'recovery_retry_wait',scope:id==='late'?'global':'job'})}
 const r=await recoverOperatingCalls({store,reconcile,executionId:'same-worker'})
 expect(r).toMatchObject({status:'action_required',modelCalls:0});expect(r.items).toHaveLength(2)
 expect(reconcile).toHaveBeenCalledTimes(1);expect(recordRecoveryLookup.mock.calls[0][0].diagnostic).toEqual({version:'generation-cost-lookup/1',reason:'record_not_found',httpStatus:404})
})
it('selects one separately identified next-execution attempt, reuses its paid success, and never selects a third attempt',async()=>{
 const jobs=new Map([['root',rejection]]),store={job:async(k)=>jobs.get(k)??null,recoveryAttempt:async()=>({enabled:true,allowed:true,revision:2})}
 const next=await selectRuntimeAttempt({store,taskKey:'root',requestHash:'hash'})
 expect(next.retry).toMatchObject({retryOf:'old',retryAttempt:1,retryRoot:'root',recoveryRevision:2})
 const completed={...rejection,id:'next',response:{valid:true},cost_state:'confirmed',actual_nano:5}
 jobs.set(next.taskKey,completed)
 expect((await selectRuntimeAttempt({store,taskKey:'root',requestHash:'hash'})).prior.id).toBe('next')
 jobs.set(next.taskKey,{...rejection,id:'failed-next'})
 expect((await selectRuntimeAttempt({store,taskKey:'root',requestHash:'hash'})).hold).toBe('recovery_retry_exhausted')
})
it('honors server cooldown/next-execution holds independently of a legacy retry environment flag',async()=>{
 const r=await selectRuntimeAttempt({store:{job:async()=>rejection,recoveryAttempt:async()=>({enabled:true,allowed:false,reason:'recovery_next_execution_wait'})},taskKey:'root',requestHash:'hash',enabled:true})
 expect(r.hold).toBe('recovery_next_execution_wait');expect(r.taskKey).toBe('root')
})
it('keeps a lease-protected reservation globally blocking instead of reporting recovery clear',async()=>{
 const r=await recoverOperatingCalls({store:{recoveryPolicy:async()=>({enabled:true}),recoveryCandidates:async()=>({items:[{id:'live',state:'reserved'}],nextCursor:null}),
  releaseUnsent:async()=>({released:false,reason:'lease_active'})}})
 expect(r.status).toBe('action_required');expect(r.items[0].scope).toBe('global')
})
it('does not label a funded pending expense as completed recovery',()=>{
 expect(operatingResultState({status:'recovery_checked',recovery:{items:[{status:'recovery_retry_wait',scope:'job'}]}})).toMatchObject({kind:'waiting',exitCode:0})
})
it('permits diagnostic-only cost inspection before activation without automatically changing policy decisions',async()=>{
 const recordRecoveryLookup=vi.fn(),decideRecovery=vi.fn(async()=>({scope:'global',status:'cost_still_unconfirmed',diagnosticOnly:true}))
 const r=await recoverOperatingCalls({diagnosticOnly:true,store:{recoveryPolicy:async()=>({enabled:false}),
  recoveryCandidates:async()=>({items:[{id:'old',state:'received',cost_state:'unknown',response_id:'gen-old',lookupDue:true}],nextCursor:null}),recordRecoveryLookup,decideRecovery},
  reconcile:async()=>({costUsd:null,lookup:{reason:'record_not_found',httpStatus:404}})})
 expect(recordRecoveryLookup).toHaveBeenCalledTimes(1);expect(r.items[0]).toMatchObject({diagnosticOnly:true,lookupReason:'record_not_found'});expect(r.modelCalls).toBe(0)
})
