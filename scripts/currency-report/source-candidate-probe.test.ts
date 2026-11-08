import {it,expect,vi} from 'vitest'
import {originalPipelineFixture} from './original-news-pipeline-fixture.js'
import {compileResearchSourceCatalog} from './research-source-selection.js'
import {updateSourceMonitor} from './source-candidates.js'
import {probeSourceCandidates,publicCandidateAddress,readCandidatePage} from './source-candidate-probe.js'
import {EventEmitter} from 'node:events'

it('aborts a pending DNS lookup at the optional deadline without starting a later HTTP request',async()=>{
 const controller=new AbortController(),request=vi.fn(),resolve=vi.fn(()=>new Promise(()=>{}))
 const pending=readCandidatePage('https://newspaper.example.org/economia/dolar',{signal:controller.signal,resolve,request})
 controller.abort()
 await expect(pending).rejects.toThrow('candidate_aborted')
 expect(request).not.toHaveBeenCalled()
})

async function fixture(){
 const f=await originalPipelineFixture(),catalog=compileResearchSourceCatalog(f.sourcePlan,f.sourceRegister)
 return updateSourceMonitor({currency:'COP',catalog,asOf:'2026-11-01T04:00:00Z',collection:{...f.collection,originals:[],reviewQueue:[],
  sourceCandidates:[{sampleUrl:'https://newspaper.example.org/economia/dolar',discoveredFrom:'https://www.larepublica.co/finanzas/',discoveredSourceId:'cop-larepublica'}]}})
}
it('inspects one candidate only after a gap, honors robots, never stores or sends the body, and does not repeat before the next check',async()=>{
 const state=await fixture(),read=vi.fn(async url=>({status:200,text:url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':
  '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-31T20:00:00Z"}</script><article>PRIVATE BODY</article>'}))
 const result=await probeSourceCandidates(state,{mode:'live',read})
 expect(read).toHaveBeenCalledTimes(2)
 expect(result).toMatchObject({networkCalls:2,modelCalls:0,technicalChecks:1,writingEligible:false,publicationApproved:false})
 expect(result.candidates[0]).toMatchObject({status:'conditions_unconfirmed',access:'public_capture',extraction:'dated_metadata_present',useScope:'unconfirmed'})
 expect(JSON.stringify(result)).not.toContain('PRIVATE BODY')
 await probeSourceCandidates(result,{mode:'live',read});expect(read).toHaveBeenCalledTimes(2)
 await probeSourceCandidates({...state,gaps:[]},{mode:'live',read});expect(read).toHaveBeenCalledTimes(2)
 await probeSourceCandidates(state,{mode:'saved',read});expect(read).toHaveBeenCalledTimes(2)
})
it('stops at a robots denial or missing robots, rejects a paywall and leaves layout failure unverified',async()=>{
 const state=await fixture()
 const denied=vi.fn(async()=>({status:200,text:'User-agent: *\nDisallow: /'}))
 expect((await probeSourceCandidates(state,{mode:'live',read:denied})).candidates[0].status).toBe('processing_excluded')
 expect(denied).toHaveBeenCalledTimes(1)
 const unavailable=vi.fn(async()=>({status:503,text:''}))
 expect((await probeSourceCandidates(state,{mode:'live',read:unavailable})).candidates[0].status).toBe('temporary_failure')
 expect(unavailable).toHaveBeenCalledTimes(1)
 const page=(text:string)=>async(url:string)=>({status:200,text:url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':text})
 expect((await probeSourceCandidates(state,{mode:'live',read:page('<script>{"isAccessibleForFree":false}</script>')})).candidates[0].status).toBe('processing_excluded')
 expect((await probeSourceCandidates(state,{mode:'live',read:page('<div>Layout changed</div>')})).candidates[0]).toMatchObject({extraction:'metadata_missing',useScope:'unconfirmed'})
})
it('does not open a socket to private, mixed public/private, loopback or reserved DNS answers',async()=>{
 const request=vi.fn(()=>{throw Error('socket_must_not_open')})
 for(const address of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.0.1','169.254.169.254','100.64.0.1','198.18.0.1','0.0.0.0','224.0.0.1','::1'])expect(publicCandidateAddress(address)).toBe(false)
 expect(publicCandidateAddress('8.8.8.8')).toBe(true)
 const resolve=vi.fn(async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}])
 await expect(readCandidatePage('https://newspaper.example.org/economia/dolar',{resolve,request})).rejects.toThrow('candidate_private_address')
 expect(request).not.toHaveBeenCalled()
})

it('pins public DNS for HTTPS, refuses redirect bodies and bounds response bytes without a second request',async()=>{
 const resolve=vi.fn(async()=>[{address:'8.8.8.8',family:4}])
 const socket=(status:number,chunks:string[])=>vi.fn((_target,options,onResponse)=>{
  const req=new EventEmitter() as EventEmitter & {destroy:(error?:Error)=>void}
  req.destroy=error=>{if(error)req.emit('error',error);req.emit('close')}
  options.lookup('newspaper.example.org',{all:true},(_err,addresses)=>expect(addresses).toEqual([{address:'8.8.8.8',family:4}]))
  const response=new EventEmitter() as EventEmitter & {statusCode:number;destroy:(error?:Error)=>void}
  response.statusCode=status;let destroyed=false
  response.destroy=error=>{destroyed=true;if(error)response.emit('error',error);req.emit('close')}
  setImmediate(()=>{
   onResponse(response)
   if(destroyed)return
   for(const chunk of chunks){response.emit('data',Buffer.from(chunk));if(destroyed)return}
   response.emit('end');req.emit('close')
  })
  return req
 })
 const request=socket(200,['test'])
 expect(await readCandidatePage('https://newspaper.example.org/economia/dolar',{resolve,request})).toEqual({status:200,text:'test'})
 expect(request.mock.calls[0][1]).toMatchObject({agent:false,headers:{'User-Agent':'LATAM-FX-source-check/1'}})
 const redirect=socket(302,['DO-NOT-FOLLOW'])
 expect(await readCandidatePage('https://newspaper.example.org/economia/dolar',{resolve,request:redirect})).toEqual({status:302,text:''})
 expect(redirect).toHaveBeenCalledTimes(1)
 const large=socket(200,['12345'])
 await expect(readCandidatePage('https://newspaper.example.org/economia/dolar',{resolve,request:large,maxBytes:4})).rejects.toThrow('candidate_response_too_large')
 expect(large).toHaveBeenCalledTimes(1)
})
