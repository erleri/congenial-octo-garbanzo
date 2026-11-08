// Service-owned immutable history and currently effective judgments are distinct.
export const SOURCE_REVIEW_VALIDITY_VERSION='source-review-validity/1'
const groupKey=r=>r.sourceKey??r.key??r.original?.url
export function effectiveSourceReview(records,{pipelineVersion}={}) {
 const unique=[...new Map(records.map(r=>[r.key??r,r])).values()]
 if(!unique.length)return {state:'missing',records:[],priorKeys:[]}
 const keys=new Set(unique.map(r=>r.key).filter(Boolean)),superseded=new Set()
 for(const record of unique){
  const links=record.review?.validity?.supersedes??[]
  if(!Array.isArray(links)||links.some(k=>k===record.key||!/^[a-f0-9]{64}$/.test(k)))return {state:'conflict',records:unique,priorKeys:[...keys].sort()}
  for(const key of links)superseded.add(key)
 }
 const active=unique.filter(r=>!superseded.has(r.key)),priorKeys=[...keys].sort()
 if(active.length!==1)return {state:'conflict',records:active.length?active:unique,priorKeys}
 const record=active[0],validity=record.review?.validity
 if(validity?.state==='withdrawn')return {state:'withdrawn',record,records:active,priorKeys}
 if(record.review?.heldStatus)return {state:'held',record,records:active,priorKeys}
 // /9 changes candidate session selection guidance, not the support contract
 // of already independently accepted /8 notes. Held /8 notes must revalidate.
 const compatibleAccepted= pipelineVersion==='original-news-pipeline/9'&&validity?.pipelineVersion==='original-news-pipeline/8'
  &&validity.version===SOURCE_REVIEW_VALIDITY_VERSION&&validity.state==='usable'&&!!record.review?.receipt
 if(pipelineVersion&&!compatibleAccepted&&(validity?.version!==SOURCE_REVIEW_VALIDITY_VERSION||validity.pipelineVersion!==pipelineVersion))
  return {state:'revalidation_required',record,records:active,priorKeys}
 return {state:'usable',record,records:active,priorKeys}
}
export function effectiveSourceGroups(records,options={}) {
 const groups=new Map()
 for(const record of records){const key=groupKey(record);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(record)}
 return [...groups.values()].map(group=>effectiveSourceReview(group,options))
}
