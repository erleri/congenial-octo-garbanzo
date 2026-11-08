// Service opt-in only. An explicit terminal provider rejection is different
// from a disconnected/in-flight request, invalid prose, or a missing cost.
import {fingerprint} from './research-harness.js'
export function terminalRateLimit(job){
 const r=job?.response
 return job?.state==='received'&&r?.valid===false&&r?.providerError?.code===429
  &&r.partialText===''&&r.usage==null&&Array.isArray(r.errors)&&r.errors.includes('provider_stream_error')
}
export async function selectRuntimeAttempt({store,taskKey,requestHash,enabled=false}){
 let prior=store.job?await store.job(taskKey):null
 const root=taskKey
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
