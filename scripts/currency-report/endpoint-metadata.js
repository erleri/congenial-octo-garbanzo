import {fingerprint} from './research-harness.js'

const categories=new Set(['metadata_unavailable','route_unavailable','unsupported_parameters','processing_conditions','price_or_input_limit','request_configuration'])
export function endpointError(category) {
 const error=Error(`source_endpoint_${categories.has(category)?category:'request_configuration'}`)
 error.endpointCategory=categories.has(category)?category:'request_configuration'
 return error
}
// Public GETs only. Cache is private to one coordinator, keyed by model AND route.
// Failed requests are never cached; concurrent callers share the same attempt.
export function createEndpointMetadata({fetchImpl=fetch,clock=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),ttlMs=300000}={}) {
 const cache=new Map(),pending=new Map()
 const get=async url=>{
  for(let attempt=0;attempt<2;attempt++){
   let transient=false
   try {
    const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(15000)})
    transient=response.status===429||response.status===408||response.status>=500
    if(response.ok)return await response.json()
   }catch{transient=true}
   if(!transient||attempt===1)throw endpointError('metadata_unavailable')
   await sleep(1000)
  }
 }
 return async body=>{
  const model=body?.model,route=body?.provider?.only?.[0]
  if(typeof model!=='string'||!/^[-a-zA-Z0-9._]+\/[-a-zA-Z0-9._]+$/.test(model)
   ||typeof route!=='string'||!/^[-a-zA-Z0-9._/]+$/.test(route)||body.provider.only.length!==1)throw endpointError('request_configuration')
  const key=`${model}|${route}`,prior=cache.get(key)
  if(prior&&clock()-prior.at<ttlMs)return prior.value
  if(pending.has(key))return pending.get(key)
  const task=(async()=>{
   const [catalog,zdr]=await Promise.all([get(`https://openrouter.ai/api/v1/models/${model}/endpoints`),get('https://openrouter.ai/api/v1/endpoints/zdr')])
   if(!Array.isArray(catalog?.data?.endpoints)||!Array.isArray(zdr?.data))throw endpointError('metadata_unavailable')
   const value={catalog,zdr,checkedAt:new Date(clock()).toISOString(),metadataHash:fingerprint({catalog,zdr})}
   cache.set(key,{at:clock(),value});return value
  })()
  pending.set(key,task)
  try{return await task}finally{pending.delete(key)}
 }
}
export function endpointDiagnostic(error,request,metadata,clock=Date.now) {
 return {category:categories.has(error?.endpointCategory)?error.endpointCategory:'metadata_unavailable',
  stage:['extract','compare'].includes(error?.endpointStage)?error.endpointStage:['extract','compare'].includes(request?.stage)?request.stage:'preflight',
  model:request?.body?.model,route:request?.body?.provider?.only?.[0],
  checkedAt:metadata?.checkedAt??new Date(clock()).toISOString(),metadataHash:metadata?.metadataHash??null}
}
