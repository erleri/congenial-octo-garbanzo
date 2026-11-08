import {it,expect} from 'vitest'
import {createHash} from 'node:crypto'
import {originalPipelineFixture} from './original-news-pipeline-fixture.js'
import {compileResearchSourceCatalog} from './research-source-selection.js'
import {candidateUrl,discoverSourceCandidates,updateSourceMonitor} from './source-candidates.js'

const asOf='2026-11-01T04:00:00Z'
const candidate={sampleUrl:'https://newspaper.example.org/economia/dolar',discoveredFrom:'https://www.larepublica.co/finanzas/',discoveredSourceId:'cop-larepublica'}
async function fixture(){
 const f=await originalPipelineFixture(),catalog=compileResearchSourceCatalog(f.sourcePlan,f.sourceRegister)
 return {currency:'COP',catalog,asOf,collection:{...f.collection,sourceCandidates:[candidate]}}
}
const capture=(text:string)=>({url:candidate.sampleUrl,text,httpStatus:200,collectedAt:asOf,
 sha256:createHash('sha256').update(text).digest('hex')})

it('records only economic external link metadata, merges www aliases and rejects credentials, private hosts and query links',async()=>{
 const f=await fixture()
 const html=`<a href="${candidate.sampleUrl}">El dólar sube ante nuevas noticias</a>
  <a href="https://www.newspaper.example.org/otra">El dólar cae por oferta de divisas</a>
  <a href="https://www.larepublica.co/finanzas/otra">El dólar cae por oferta de divisas</a>
  <a href="https://ads.example.org/ad">Publicidad</a>
  <a href="https://secret.example.org/path?token=PRIVATE">El dólar sube ante nuevas noticias</a>`
 const result=discoverSourceCandidates({text:html,url:candidate.discoveredFrom,sourceId:candidate.discoveredSourceId,...f})
 expect(result).toHaveLength(1)
 expect(result[0]).toMatchObject({domain:'newspaper.example.org',writingEligible:false})
 expect(JSON.stringify(result)).not.toMatch(/Publicidad|PRIVATE|El dólar/)
 for(const url of ['http://example.org/x','https://127.0.0.1/x','https://server.internal/x','https://u:p@example.org/x','https://example.org/%40private','https://example.org/path?key=x'])expect(candidateUrl(url)).toBeNull()
})

it('checks an available capture only for an actual collection or reviewed explanation gap, never grants permission and preserves input',async()=>{
 const f=await fixture(),before=JSON.stringify(f),text='<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-31T20:00:00Z"}</script><article>PRIVATE BODY</article>'
 const captures=[capture(text)]
 const enough=updateSourceMonitor({...f,captures})
 expect(enough.technicalChecks).toBe(0)
 const missing=updateSourceMonitor({...f,captures,researchFeedback:{preferAlternativeIndex:true}})
 expect(missing).toMatchObject({technicalChecks:1,networkCalls:0,modelCalls:0,writingEligible:false,publicationApproved:false})
 expect(missing.candidates[0]).toMatchObject({status:'conditions_unconfirmed',access:'public_capture',extraction:'dated_metadata_present',useScope:'unconfirmed'})
 expect(JSON.stringify(missing)).not.toContain('PRIVATE BODY')
 const again=updateSourceMonitor({...f,captures,previous:missing,asOf:'2026-11-02T04:00:00Z',researchFeedback:{preferAlternativeIndex:true}})
 expect(again.technicalChecks).toBe(0)
 expect(again.candidates[0].firstSeenAt).toBe(new Date(asOf).toISOString())
 expect(JSON.stringify(f)).toBe(before)
})

it('preserves explicit access barriers and does not treat a missing date or changed body as verified evidence',async()=>{
 const f=await fixture(),collection={...f.collection,originals:[],reviewQueue:[]}
 const locked=updateSourceMonitor({...f,collection,captures:[capture('<script>{"isAccessibleForFree":false}</script>')]})
 expect(locked.candidates[0]).toMatchObject({status:'processing_excluded',access:'access_failed',useScope:'unconfirmed'})
 const partial=updateSourceMonitor({...f,collection,captures:[capture('<article>Unverified undated text</article>')]})
 expect(partial.candidates[0]).toMatchObject({status:'conditions_unconfirmed',extraction:'metadata_missing'})
 const corrupt=updateSourceMonitor({...f,collection,captures:[{...capture('text'),sha256:'f'.repeat(64)}]})
 expect(corrupt.technicalChecks).toBe(0)
})

it('counts repeated source failure on distinct days and keeps it visible when another registered article succeeds',async()=>{
 const f=await fixture(),failed={sourceId:'cop-larepublica',status:'access_failed',originalIds:[]}
 const collection={...f.collection,originals:[],reviewQueue:[],outcomes:[failed]}
 let previous=updateSourceMonitor({...f,collection})
 previous=updateSourceMonitor({...f,collection,previous,asOf:'2026-11-01T05:00:00Z'})
 expect(previous.sources[0].failureDays).toBe(1)
 previous=updateSourceMonitor({...f,collection,previous,asOf:'2026-11-02T04:00:00Z'})
 previous=updateSourceMonitor({...f,collection,previous,asOf:'2026-11-03T04:00:00Z'})
 expect(previous.sources[0].repeatedFailure).toBe(true)
 const paused=updateSourceMonitor({...f,previous,asOf:'2026-11-04T04:00:00Z',collection:{...f.collection,outcomes:[]}})
 expect(paused.gaps).toContain('repeated_source_failure')
 const recovered=updateSourceMonitor({...f,previous:paused,asOf:'2026-11-05T04:00:00Z',collection:{...f.collection,outcomes:[{...failed,status:'collected_pending_review',originalIds:['one']}]}})
 expect(recovered.sources[0]).toMatchObject({failureDays:0,repeatedFailure:false})
})

it('bounds the candidate queue and technical work, preserves candidates across empty collection and never approves a syndicated group',async()=>{
 const f=await fixture(),collection={...f.collection,originals:[],reviewQueue:[],sourceCandidates:Array.from({length:35},(_,i)=>({...candidate,sampleUrl:`https://outlet${i}.example.org/economia/dolar`}))}
 const first=updateSourceMonitor({...f,collection})
 expect(first.candidates).toHaveLength(32)
 expect(first.omittedCandidates).toBe(3)
 const next=updateSourceMonitor({...f,previous:first,asOf:'2026-11-02T04:00:00Z',collection:{...collection,sourceCandidates:[]}})
 expect(next.candidates).toHaveLength(32)
 const originals=[...f.collection.originals,...f.collection.originals].map(o=>({...o,originHints:{creditedOrigins:['Reuters']}}))
 const duplicate=updateSourceMonitor({...f,collection:{...f.collection,originals}})
 expect(duplicate.gaps).toEqual(expect.arrayContaining(['identical_capture_only','shared_credited_origin_only']))
 expect(duplicate.publicationApproved).toBe(false)
 const tampered={...first,candidates:[]}
 expect(()=>updateSourceMonitor({...f,previous:tampered})).toThrow('source_monitor_state_invalid')
})
