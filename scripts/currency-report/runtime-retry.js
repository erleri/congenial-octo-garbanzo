// Service opt-in only. An explicit terminal provider rejection is different
// from a disconnected/in-flight request, invalid prose, or a missing cost.
import {fingerprint} from './research-harness.js'
export function terminalRateLimit(job){
 const r=job?.response
 return job?.state==='received'&&r?.valid===false&&r?.providerError?.code===429
  &&r.partialText===''&&r.usage==null&&Array.isArray(r.errors)
  &&(r.errors.includes('provider_stream_error')||r.httpStatus===429&&r.errors.includes('http_429'))
}
export async function selectRuntimeAttempt({store,taskKey,requestHash,enabled=false}){
 let prior=store.job?await store.job(taskKey):null
 const root=taskKey
 if(store.recoveryAttempt){
  const policy=await store.recoveryAttempt({taskKey,requestHash})
  if(policy.enabled){
   if(!prior)return {taskKey,prior,retry:policy.executionId?{recoveryExecutionId:policy.executionId}:{},policyActive:true}
   if(!terminalRateLimit(prior))return {taskKey,prior,retry:prior.context?.recoveryExecutionId?{recoveryExecutionId:prior.context.recoveryExecutionId}:{},policyActive:true}
   // The new ceiling must not hide an already paid successful legacy attempt.
   // This path can only reuse a stored response; it cannot create attempt two.
   if(prior.request_hash===requestHash)for(const attempt of [1,2]){
    const key=fingerprint({version:'runtime-terminal-retry/1',root,attempt}),paid=await store.job(key)
    if(paid?.response?.valid&&paid.cost_state==='confirmed'&&paid.actual_nano<=paid.reserved_nano)
     return {taskKey:key,prior:paid,retry:paid.context??{},policyActive:true}
   }
   if(!policy.allowed)return {taskKey,prior,retry:{},hold:policy.reason}
   const retry={retryOf:prior.id,retryAttempt:1,retryRoot:root,recoveryRevision:policy.revision}
   taskKey=fingerprint({version:'runtime-terminal-retry/1',root,attempt:1})
   const next=await store.job(taskKey)
   if(next&&terminalRateLimit(next))return {taskKey,prior:next,retry,hold:'recovery_retry_exhausted'}
   return {taskKey,prior:next,retry:{...retry,...(next?.context?.recoveryExecutionId?{recoveryExecutionId:next.context.recoveryExecutionId}:{})},policyActive:true}
  }
 }
 if(!enabled)return {taskKey,prior,retry:{}}
 for(let attempt=1;attempt<=2;attempt++){
  if(!terminalRateLimit(prior)||prior.request_hash!==requestHash
   ||!(prior.cost_state==='confirmed'&&prior.actual_nano<=prior.reserved_nano
     ||prior.cost_state==='unknown'&&await store.costEscrow?.(prior.id)===true))break
  const retry={retryOf:prior.id,retryAttempt:attempt,retryRoot:root}
  taskKey=fingerprint({version:'runtime-terminal-retry/1',root,attempt})
  prior=await store.job(taskKey)
  if(!prior)return {taskKey,prior,retry}
 }
 return {taskKey,prior,retry:prior?.context?.retryAttempt
  ?{retryOf:prior.context.retryOf,retryAttempt:prior.context.retryAttempt,retryRoot:root}:{}}
}
