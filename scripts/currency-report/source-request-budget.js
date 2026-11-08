// Free transport budgets, never model/spending or evidence-approval rules.
// Reserve enough discovery steps for one article at every registered route.
export const MAX_SOURCE_NETWORK_REQUESTS=32
export function sourceAttemptMinimum(recipe,publisherCount=1) {
 if(recipe.kind==='existing_chile_publisher')return 2*Math.max(1,publisherCount)
 if(recipe.kind!=='news_listing')return 1
 return 2+Number(Boolean(recipe.access))+Number(Boolean(recipe.access?.indexUrl))
  +2*Number(Boolean(recipe.access?.sitemapUrl))
}
export function allocateSourceRequests({minimums,weights,maxNetworkRequests}) {
 if(!minimums.length||minimums.length!==weights.length||!Number.isInteger(maxNetworkRequests)
  ||maxNetworkRequests<1||maxNetworkRequests>MAX_SOURCE_NETWORK_REQUESTS
  ||[...minimums,...weights].some(n=>!Number.isInteger(n)||n<1))throw Error('source_request_budget_invalid')
 const total=weights.reduce((a,b)=>a+b,0),needed=minimums.reduce((a,b)=>a+b,0)
 const existing=weights.map(n=>Math.floor(maxNetworkRequests*n/total))
 for(let left=maxNetworkRequests-existing.reduce((a,b)=>a+b,0),i=0;left>0;left--,i++)existing[i%existing.length]++
 if(existing.every((n,i)=>n>=minimums[i]))return {limits:existing,minimumCoverage:true,minimumRequired:needed}
 // Small explicit callers retain fair bounded probing. They do not claim that
 // every route can reach an article when the transport ceiling is insufficient.
 const reserved=needed<=maxNetworkRequests?minimums.map(n=>n):minimums.map(()=>0)
 const remainder=maxNetworkRequests-reserved.reduce((a,b)=>a+b,0)
 const limits=weights.map((n,i)=>reserved[i]+Math.floor(remainder*n/total))
 for(let left=maxNetworkRequests-limits.reduce((a,b)=>a+b,0),i=0;left>0;left--,i++)limits[i%limits.length]++
 return {limits,minimumCoverage:needed<=maxNetworkRequests,minimumRequired:needed}
}
export function automaticSourceRequestLimit(minimums,baseline=16) {
 if(!Array.isArray(minimums)||!minimums.length||minimums.some(n=>!Number.isInteger(n)||n<1)
  ||!Number.isInteger(baseline)||baseline<1||baseline>MAX_SOURCE_NETWORK_REQUESTS)throw Error('source_request_budget_invalid')
 return Math.min(MAX_SOURCE_NETWORK_REQUESTS,Math.max(baseline,minimums.reduce((a,b)=>a+b,0)))
}
