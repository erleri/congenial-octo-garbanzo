import {it,expect} from 'vitest'
import {operatingFixture} from './operating-fixture.js'
import {runOperatingCycle} from './operating-cycle.js'
import {inspectSourceAdmission,sourceAdmissionHash} from './source-admission.js'
import {admittedSourceCatalog} from './source-admission-catalog.js'
import {compileResearchSourceCatalog,planResearchSourceSelection} from './research-source-selection.js'
import {runtimeResearchInput} from './runtime-supply.js'
import {collectSelectedResearch} from './selected-source-collection.js'

async function admittedFixture(){
 const f=await operatingFixture(),url='https://operating.example.org/economia/dolar'
 const html=`<script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',url,headline:'El dólar subió durante la sesión',datePublished:'2026-10-27T20:00:00Z',
  publisher:{name:'Operating Example',url:'https://operating.example.org/'},isAccessibleForFree:true,license:'https://creativecommons.org/licenses/by/4.0/',
  articleBody:f.collections.COP.originals[0].blocks.map(b=>b.text).join('\n')})}</script>`
 const robots='User-agent: *\nAllow: /',proof=inspectSourceAdmission({currency:'COP',url,html,robotsText:robots,collectedAt:f.asOf,asOf:f.asOf})
 const admissions={proofs:[proof],decisions:[] as unknown[]}
 f.store.sourceAdmissions=async()=>structuredClone(admissions)
 const expanded=admittedSourceCatalog({...f,state:admissions,asOf:f.asOf}),catalog=compileResearchSourceCatalog(expanded.sourcePlan,expanded.sourceRegister)
 const source=catalog.sources.find(s=>s.admission)
 const input=runtimeResearchInput({snapshot:{currency:'COP',baseDate:'2026-10-28'},asOf:f.asOf,commentaryTarget:{date:'2026-10-27',basis:'test'}})
 const selection=planResearchSourceSelection({input,...expanded})
 const captures=[{url,text:html},{url:'https://operating.example.org/robots.txt',text:robots}].map(c=>({...c,sourceId:source.id,httpStatus:200,collectedAt:f.asOf,sha256:sourceAdmissionHash(c.text)}))
 f.collections.COP=await collectSelectedResearch({input,...expanded,requestIds:selection.sourceRequests.filter(r=>r.sourceId===source.id).map(r=>r.requestId),
  captures,mode:'saved',now:()=>f.asOf})
 expect(f.collections.COP.originals).toHaveLength(1)
 return {...f,admissions,proof,clock:()=>Date.parse(f.asOf)+1000}
}

it('carries a new source through common extraction, comparison, writing and review using the same frozen admission on resume',async()=>{
 const f=await admittedFixture()
 const result=await runOperatingCycle({...f,execute:true})
 expect(result.rows.find(r=>r.currency==='COP')?.status,JSON.stringify(result.rows.find(r=>r.currency==='COP'))).toBe('pending_admin_review')
 expect(result.rows.filter(r=>r.status==='pending_admin_review')).toHaveLength(6)
 expect(f.state.inputs.get('COP')).toBeDefined()
 const calls=f.state.posts.length
 const again=await runOperatingCycle({...f,execute:true})
 expect(again.status).toBe('completed');expect(f.state.posts).toHaveLength(calls)
})

it('honours a source revocation before the next mocked paid reservation without blocking other countries',async()=>{
 const f=await admittedFixture(),send=f.send,posts:string[]=[]
 f.send=async args=>{
  const input=JSON.parse(args.body.messages[1].content)
  if(input.currency==='COP'){
   posts.push(args.body.response_format.json_schema.name)
   f.admissions.decisions=[{currency:'COP',url:f.proof.url,proofBinding:f.proof.binding,captureHash:f.proof.captureHash,revision:1,action:'exclude',scopes:f.proof.scopes}]
  }
  return send(args)
 }
 const result=await runOperatingCycle({...f,execute:true})
 expect(posts).toEqual(['original_news_extract'])
 expect(result.rows.find(r=>r.currency==='COP')?.status).not.toBe('pending_admin_review')
 expect(result.rows.filter(r=>r.status==='pending_admin_review')).toHaveLength(5)
 expect(f.state.inputs.has('COP')).toBe(false)
})
