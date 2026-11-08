// Operational diagnostics only. No inference about relevance, truth, novelty,
// article-use permission or writing eligibility from successful HTTP requests.
const budgetReasons=new Set(['request_budget','source_request_budget','local_request_limit','local_source_request_limit'])
export function collectionDiagnostics(collection) {
 const findings=new Map(),sources=new Map()
 const add=(row,item)=>{
  const reason=item.reason??null,status=item.status??row.status
  const category=budgetReasons.has(reason)?'request_budget'
   :['no_candidates_in_listing','no_candidates_in_index'].includes(status)?'no_matching_candidate'
   :status==='access_failed'?'access_failure':status==='extraction_failed'?'extraction_failure'
   :status==='discovery_incomplete'?'discovery_failure':null
  if(!category)return
  const key=JSON.stringify([row.sourceId,category,reason]),prior=findings.get(key)
  if(prior){if(row.period&&!prior.requestedPeriods.includes(row.period))prior.requestedPeriods.push(row.period);return}
  findings.set(key,{sourceId:row.sourceId,status,category,reason,requestedPeriods:row.period?[row.period]:[]})
 }
 for(const row of collection.outcomes??[]){
  if(!sources.has(row.sourceId))sources.set(row.sourceId,new Set())
  for(const id of row.originalIds??[])sources.get(row.sourceId).add(id)
  add(row,row)
  for(const issue of row.issues??[])if(typeof issue==='object')add(row,issue)
  for(const attempt of row.publisherAttempts??[])for(const issue of attempt.issues??[])add(row,
   {status:issue.stage==='metadata'?'extraction_failed':'access_failed',reason:issue.reason})
 }
 const gaps=[...findings.values()]
 return {lookupFailures:gaps.filter(g=>['access_failure','extraction_failure','discovery_failure'].includes(g.category)),
  collectionGaps:gaps,sourceCoverage:[...sources].map(([sourceId,ids])=>({sourceId,collectedOriginals:ids.size,
   status:ids.size?'collected_pending_review':'no_collected_original',contentReviewed:false})),
  networkCalls:collection.networkCalls??null,budgetCoverage:collection.sourceBudgetCoverage??null,
  contentQualityEvaluated:false,publicationApproved:false}
}
