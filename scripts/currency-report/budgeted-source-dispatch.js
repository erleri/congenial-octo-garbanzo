// Bound complete two-stage source jobs fairly within one recurring envelope.
// Unselected bodies remain intact in the frozen country; they are not approved
// for dispatch in this envelope. Reviewed editions are reused next cycle.
export function budgetedSourceDispatch(rows,plans,{batchUsd,maxCalls,writerUsd,writerCalls}) {
 const selected=new Set(),deferred=new Set(),byBinding=new Map(plans.map(p=>[p.binding,p]))
 let nano=Math.round(writerUsd*1e9),calls=writerCalls
 const queues=rows.filter(r=>r.status==='planned').map(r=>r.sources.filter(s=>s.status==='request_prepared_not_dispatched'))
 for(let index=0;queues.some(q=>q.length>index);index++)for(const queue of queues){
  const source=queue[index]
  if(!source)continue
  const plan=byBinding.get(source.planBinding)
  if(!plan)throw Error('budgeted_source_plan_missing')
  const cost=Math.ceil(plan.maximumUsd*1e9)
  if(calls+2<=maxCalls&&nano+cost<=Math.round(batchUsd*1e9)){
   selected.add(plan.binding);nano+=cost;calls+=2
  }else deferred.add(plan.binding)
 }
 return {selected,deferred,maximumNano:nano,maxCalls:calls}
}
