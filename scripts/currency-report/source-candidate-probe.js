// Bounded technical inspection, never article admission. HTTPS is pinned to a
// resolved public IPv4 address: no redirects, credentials, cookies or private IPs.
import https from 'node:https'
import {lookup} from 'node:dns/promises'
import {candidateUrl} from './source-candidates.js'
import {sourceStateBinding} from './source-state-binding.js'
import {inspectRobots,publisherAccessBarrier} from './news-publisher-access.js'
import {publicationMetadata} from './public-research-adapter.js'

export function publicCandidateAddress(address) {
 const n=address.split('.').map(Number)
 if(n.length!==4||n.some(v=>!Number.isInteger(v)||v<0||v>255))return false
 const [a,b,c]=n
 return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31
  ||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)
  ||a===203&&b===0&&c===113)
}
export async function readCandidatePage(url,{maxBytes=2_000_000,timeoutMs=6000,resolve=lookup,request=https.get,signal}={}) {
 if(!candidateUrl(url))throw Error('unsafe_candidate_url')
 signal?.throwIfAborted()
 const target=new URL(url),deadline=Date.now()+timeoutMs
 let timer,abortListener
 try{
  const cancelled=signal?new Promise((_,reject)=>{
   abortListener=()=>reject(Error('candidate_aborted'));signal.addEventListener('abort',abortListener,{once:true})
  }):new Promise(()=>{})
  const addresses=await Promise.race([resolve(target.hostname,{family:4,all:true}),cancelled,new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(Error('candidate_dns_timeout')),timeoutMs)
  })])
  clearTimeout(timer)
  if(!addresses.length||addresses.some(r=>!publicCandidateAddress(r.address)))throw Error('candidate_private_address')
  return await new Promise((resolveResult,reject)=>{
   const remaining=deadline-Date.now();if(remaining<=0){reject(Error('candidate_timeout'));return}
   signal?.throwIfAborted()
   const req=request(target,{agent:false,signal,headers:{'User-Agent':'LATAM-FX-source-check/1','Accept':'text/html,text/plain'},
    lookup:(_host,options,callback)=>options.all?callback(null,[{address:addresses[0].address,family:4}]):callback(null,addresses[0].address,4)},response=>{
     if(response.statusCode<200||response.statusCode>=300){response.destroy();resolveResult({status:response.statusCode,text:''});return}
     let bytes=0;const chunks=[]
     response.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes)response.destroy(Error('candidate_response_too_large'));else chunks.push(chunk)})
     response.on('error',reject)
     response.on('end',()=>resolveResult({status:response.statusCode,text:Buffer.concat(chunks).toString('utf8')}))
    })
   const timeout=setTimeout(()=>req.destroy(Error('candidate_timeout')),remaining)
   req.on('error',reject);req.on('close',()=>clearTimeout(timeout))
  })
 }finally{clearTimeout(timer);if(abortListener)signal.removeEventListener('abort',abortListener)}
}

export async function probeSourceCandidates(state,{mode='saved',read=readCandidatePage,observe=async()=>{}}={}) {
 if(mode!=='live'||!state.gaps.length||state.technicalChecks>=2)return state
 const candidate=state.candidates.find(c=>!c.nextCheckAt||c.nextCheckAt<=state.checkedAt)
 if(!candidate)return state
 const next=structuredClone(state),c=next.candidates.find(c=>c.domain===candidate.domain)
 let calls=0,access='access_failed',extraction='not_checked',status='temporary_failure'
 let observation=null
 try{
  calls++;const robots=await read(new URL('/robots.txt',c.sampleUrl).href,{maxBytes:200_000})
  if(robots.status!==200)throw Error('candidate_robots_unavailable')
  const policy=inspectRobots(robots.text,c.sampleUrl)
  if(!policy.allowed||policy.crawlDelaySeconds>0){status='processing_excluded'}
  else{
   calls++;const page=await read(c.sampleUrl,{maxBytes:2_000_000})
   if(page.status>=200&&page.status<300){
    if(publisherAccessBarrier(page.text))status='processing_excluded'
    else{
     access='public_capture';status='conditions_unconfirmed'
     try{extraction=publicationMetadata(page.text,c.sampleUrl)?.publishedAt?'dated_metadata_present':'metadata_missing'}catch{extraction='metadata_missing'}
     observation={url:c.sampleUrl,html:page.text,robotsText:robots.text,collectedAt:new Date().toISOString()}
    }
   }
  }
 }catch{/* Record a technical failure without retrying, body persistence or model calls. */}
 if(observation)await observe(observation)
 Object.assign(c,{access,extraction,status,useScope:'unconfirmed',lastCheckedAt:state.checkedAt,
  attempts:Math.min(1000,c.attempts+1),checkHash:null})
 c.nextCheckAt=new Date(Date.parse(state.checkedAt)+[1,3,7,30][Math.min(c.attempts-1,3)]*86400000).toISOString()
 next.networkCalls=calls;next.technicalChecks++
 const {binding:_,...body}=next
 return {...body,binding:sourceStateBinding(body)}
}
