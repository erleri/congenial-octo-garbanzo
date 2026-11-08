// Verify actual final delivery against bound source-use decisions, not a
// promise made before the report exists. No new permission is inferred.
import {inspectSourceUses,sourceUseBinding} from './source-use.js'
const fields=['sourceUrl','publisher','publishedAt','referencePeriod','attribution','transformation']
export function publicSourceDelivery({task,report,evaluatedOn}){
 if(!task.publicUseProofs?.length)return task.sourceUseReview??{externalModel:'unverified',publicDisplay:'unverified'}
 const checks=[]
 for(const evidence of report.evidence){
  const proof=task.publicUseProofs.find(p=>p.resource.id===evidence.id)
  if(!proof){checks.push(task.plan.packet.evidence.find(e=>e.id===evidence.id)?.officialStatistic&&task.publicUseAllowedIds?.includes(evidence.id));continue}
  // Public projection deliberately strips the internal credit/binding object.
  // Verify its bound template against the fields/text actually delivered.
  const credit=task.plan?.packet?.evidence.find(e=>e.id===evidence.id)?.sourceCredit??evidence.sourceCredit
  if(!credit||credit.resourceBinding!==sourceUseBinding(proof.resource)||credit.resourceId!==evidence.id
   ||credit.sourceUrl!==evidence.url||credit.publisher!==evidence.publisher||credit.publishedAt!==evidence.publishedAt||credit.referencePeriod!==evidence.period
   ||!evidence.summary.includes(credit.attribution)||!evidence.summary.includes(credit.transformation)){checks.push(false);continue}
  try{
   const rendered={resourceId:evidence.id,resourceBinding:credit.resourceBinding,...Object.fromEntries(fields.map(k=>[k,credit[k]]))}
   const result=inspectSourceUses({resources:[proof.resource],reviews:[proof.review],evaluatedOn,renderings:{public_display:[rendered]}})
   checks.push(result.items[0].uses.public_display.status==='allowed')
  }catch{checks.push(false)}
 }
 return {externalModel:task.sourceUseReview.externalModel,publicDisplay:checks.length&&checks.every(Boolean)?'pass':'unverified'}
}
