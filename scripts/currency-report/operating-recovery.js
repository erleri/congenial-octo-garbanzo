// Only reconcile existing generation IDs. Never dispatch a model request here.
// The DB owns lease checks and cancellation of reservations never begun.
export async function recoverOperatingCalls({store,reconcile}) {
 if(!store.recoverableCalls)return {status:'adapter_not_available',modelCalls:0,items:[]}
 const jobs=await store.recoverableCalls(),items=[]
 for(const job of jobs){
  if(job.state==='reserved'){
   const r=await store.releaseUnsent(job.id)
   items.push({id:job.id,status:r.released?'unsent_reservation_released':r.reason});continue
  }
  if(job.cost_state!=='unknown'){items.push({id:job.id,status:'existing_call_requires_review'});continue}
  if(job.escrowed===true){items.push({id:job.id,status:'cost_fully_reserved_unconfirmed'});continue}
  if(!job.response_id||!reconcile){items.push({id:job.id,status:'cost_lookup_id_or_adapter_missing'});continue}
  let cost
  try{cost=await reconcile({responseId:job.response_id})}catch{cost={costUsd:null}}
  if(!Number.isFinite(cost.costUsd)||cost.costUsd<0||cost.costSource!=='generation.total_cost'){
   items.push({id:job.id,status:'cost_still_unconfirmed'});continue
  }
  const nano=Math.ceil(cost.costUsd*1e9-1e-6)
  await store.reconcile(job.id,job.response_id,nano,{source:'generation.total_cost',responseId:job.response_id,costNano:String(nano)})
  // A cost receipt does not restore a missing/invalid manuscript response.
  items.push({id:job.id,status:nano>job.reserved_nano?'cost_exceeded':job.state==='received'&&job.valid_response
   ?'expense_reconciled_valid_response':'expense_reconciled_response_review_required'})
 }
 return {status:items.some(i=>!['unsent_reservation_released','expense_reconciled_valid_response','cost_fully_reserved_unconfirmed'].includes(i.status))?'action_required':'clear',items,modelCalls:0}
}
