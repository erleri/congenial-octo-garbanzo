// These are local dry-run defaults. No unlink, cloud call or enforcement hook.
import {REPORT_DATA_POLICY} from '../../src/lib/report-data-policy.js'
export const DATA_OPERATIONS_POLICY=REPORT_DATA_POLICY
const holds=new Set(['published_dependency','pending_review_dependency','correction_or_dispute','unresolved_cost','active_execution','restore_manifest_dependency','explicit_preserve_request'])
export function assessRetention(item,{now=Date.now(),policy=DATA_OPERATIONS_POLICY}={}){
 if(policy.mode!=='dry_run'||policy.deleteEnabled!==false||!Number.isFinite(now)||!item?.id)throw Error('dry_run_policy_required')
 if(item.storageAllowed===false)return {id:item.id,status:'rights_conflict',delete:false,reuseAllowed:false,reason:'explicit_storage_restriction_needs_scoped_action'}
 const reasons=(item.holds??[]).filter(x=>holds.has(x))
 if(item.costState==='unknown')reasons.push('unresolved_cost')
 if(reasons.length)return {id:item.id,status:'protected',reasons:[...new Set(reasons)],delete:false}
 if(item.storageAllowed!==true||item.referenceCount!==0||item.referencesVerified!==true)return {id:item.id,status:'unverified',delete:false}
 const days={temp:policy.tempDays,rejected_original:policy.rejectedOriginalDays,run_detail:policy.detailDays}[item.class]
 const since=Date.parse(item.eligibleFrom)
 if(!days||!Number.isFinite(since)||since>now)return {id:item.id,status:'unverified',delete:false}
 return {id:item.id,status:now-since>=days*86400000?'cleanup_candidate':'keep',delete:false,bytes:item.bytes??null}
}
export function assessCapacity(metrics,{policy=DATA_OPERATIONS_POLICY}={}){
 if(policy.mode!=='dry_run'||policy.deleteEnabled!==false||!Array.isArray(metrics))throw Error('dry_run_policy_required')
 const items=metrics.map(m=>{
  if(m.verified!==true||!Number.isFinite(m.used)||m.used<0||!Number.isFinite(m.limit)||m.limit<=0||m.period!=='current_billing_period')return {id:m.id,status:'unverified'}
  const ratio=m.used/m.limit,projected=Number.isFinite(m.projected)?m.projected/m.limit:null
  return {id:m.id,ratio,status:ratio>=policy.pauseRatio?'would_pause_new_reports':ratio>=policy.warningRatio||projected!==null&&projected>=1?'would_warn':'within_budget'}
 })
 return {mode:'dry_run',items,existingFxPaused:false,newReportsActuallyPaused:false,
  activationReady:items.length>0&&items.every(x=>['within_budget','would_warn'].includes(x.status))}
}
