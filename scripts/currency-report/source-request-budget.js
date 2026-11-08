// Free transport budgets, never model/spending or evidence-approval rules.
// Reserve enough discovery steps for one article at every registered route.
export const MAX_SOURCE_NETWORK_REQUESTS=32
export function sourceAttemptMinimum(recipe,publisherCount=1) {
 if(recipe.kind==='admitted_article')return 2
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

// New optional sources must not take the existing routes' transport allowance.
// When the global ceiling is reached, defer supplements instead of degrading
// the baseline collection and misreporting the resulting gaps as absent news.
export function allocateSupplementalSources({minimums,weights,admitted,maxNetworkRequests}) {
 if(!Array.isArray(admitted)||admitted.length!==minimums.length||admitted.some(a=>typeof a!=='boolean'))throw Error('source_request_budget_invalid')
 // Validate the entire input, including optional routes that may be deferred.
 allocateSourceRequests({minimums,weights,maxNetworkRequests})
 const base=admitted.flatMap((a,i)=>a?[]:[i]),extra=admitted.flatMap((a,i)=>a?[i]:[])
 if(!base.length||!extra.length)return allocateSourceRequests({minimums,weights,maxNetworkRequests})
 const baseLimit=Math.min(maxNetworkRequests,automaticSourceRequestLimit(base.map(i=>minimums[i])))
 const initial=allocateSourceRequests({minimums:base.map(i=>minimums[i]),weights:base.map(i=>weights[i]),maxNetworkRequests:baseLimit})
 const limits=minimums.map(()=>0);base.forEach((i,j)=>{limits[i]=initial.limits[j]})
 let remaining=maxNetworkRequests-baseLimit
 for(const i of extra)if(remaining>=minimums[i]){limits[i]=minimums[i];remaining-=minimums[i]}
 return {limits,minimumCoverage:limits.every((n,i)=>n>=minimums[i]),minimumRequired:minimums.reduce((a,b)=>a+b,0)}
}

export function automaticSupplementalRequestLimit(minimums,admitted) {
 if(!Array.isArray(admitted)||admitted.length!==minimums.length||admitted.some(a=>typeof a!=='boolean'))throw Error('source_request_budget_invalid')
 const ordinary=automaticSourceRequestLimit(minimums)
 const base=minimums.filter((_,i)=>!admitted[i]),extra=minimums.filter((_,i)=>admitted[i])
 return base.length&&extra.length?Math.min(MAX_SOURCE_NETWORK_REQUESTS,
  automaticSourceRequestLimit(base)+extra.reduce((a,b)=>a+b,0)):ordinary
}
