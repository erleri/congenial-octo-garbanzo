// Server policy only. None of these decisions confirms a missing expense or
// authorizes a model request. The database rechecks every transition and cap.
import {randomUUID} from 'node:crypto'
const reasons=new Set(['confirmed','record_not_found','authentication_error','permission_error','lookup_rate_limited',
 'provider_error','http_error','timeout','network_error','invalid_json','identity_mismatch','completion_not_confirmed','cost_missing','lookup_error'])
export const recoveryLookup=cost=>({version:'generation-cost-lookup/1',reason:reasons.has(cost?.lookup?.reason)?cost.lookup.reason:'lookup_error',
 httpStatus:Number.isInteger(cost?.lookup?.httpStatus)?cost.lookup.httpStatus:null})
async function recoveryJobs(store){
 const jobs=[];let cursor=null
 do{const page=await store.recoveryCandidates(cursor);jobs.push(...page.items);cursor=page.nextCursor}while(cursor)
 return jobs
}
export async function inspectRecoveryPolicy(store){
 const policy=await store.recoveryPolicy()
 if(!policy.enabled)return {status:'clear',version:'runtime-recovery/1',enabled:false,modelCalls:0}
 const jobs=await recoveryJobs(store),globalHold=jobs.some(j=>j.scope==='global'||j.cost_state==='unknown'&&!j.escrowed||['reserved','calling'].includes(j.state)||j.actual_nano>j.reserved_nano)
 return {status:globalHold?'action_required':'clear',version:'runtime-recovery/1',inspectionOnly:true,modelCalls:0,
  items:jobs.map(j=>({id:j.id,currency:j.currency,status:j.recoveryStatus??'recovery_not_yet_decided',scope:j.scope??'global'}))}
}
export async function recoverWithPolicy({store,reconcile,executionId=randomUUID(),diagnosticOnly=false}){
 const policy=await store.recoveryPolicy()
 if(!policy?.enabled&&!diagnosticOnly)return null
 const items=[];let globalHold=false,lookups=0
 const jobs=(await recoveryJobs(store)).sort((a,b)=>(Date.parse(a.checkedAt??'')||0)-(Date.parse(b.checkedAt??'')||0))
  for(const job of jobs){
   if(job.state==='reserved'){
    const r=await store.releaseUnsent(job.id);items.push({id:job.id,status:r.released?'unsent_reservation_released':r.reason,scope:r.released?'job':'global'});
    if(!r.released)globalHold=true
    continue
   }
   let cost=null
   if(job.cost_state==='unknown'&&job.lookupDue&&job.response_id&&reconcile&&lookups<20){
    lookups++
    try{cost=await reconcile({responseId:job.response_id})}catch{cost={costUsd:null}}
    const receipt=Number.isFinite(cost.costUsd)&&cost.costUsd>=0&&cost.costSource==='generation.total_cost'
      ?{source:'generation.total_cost',responseId:job.response_id,costNano:String(Math.ceil(cost.costUsd*1e9-1e-6))}:null
    await store.recordRecoveryLookup({id:job.id,executionId,diagnostic:recoveryLookup(cost),receipt})
   }
   const decision=await store.decideRecovery({id:job.id,executionId})
   items.push({id:job.id,currency:job.currency,...decision,...(cost?.lookup?{lookupReason:recoveryLookup(cost).reason}:{})})
   if(decision.scope==='global')globalHold=true
  }
 return {status:globalHold?'action_required':'clear',version:'runtime-recovery/1',items,modelCalls:0,executionId}
}
