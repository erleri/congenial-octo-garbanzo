import {it,expect} from 'vitest'
import fs from 'node:fs'
import {originalPipelineFixture} from './original-news-pipeline-fixture.js'
import {runtimeFixture} from './runtime-fixture.js'
import {inspectSourceAdmission,sourceAdmissionHash} from './source-admission.js'
import {admittedSourceCatalog} from './source-admission-catalog.js'
import {compileResearchSourceCatalog,registeredNewsSourceForUrl,planResearchSourceSelection} from './research-source-selection.js'
import {collectSelectedResearch} from './selected-source-collection.js'
import {proposeOperatingPolicy,prepareOperatingBatch} from './operating-batch-plan.js'
import {runtimeResearchInput,acquireRuntimeResearch} from './runtime-supply.js'
import {collectAdmittedArticle} from './admitted-article-collection.js'
import {fingerprint} from './research-harness.js'

const asOf='2026-11-01T04:00:00Z',url='https://new.example.org/economia/dolar'
const html=`<script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',url,headline:'El dólar sube frente al peso por demanda de divisas',
 datePublished:'2026-10-30T18:00:00Z',publisher:{name:'Economic News',url:'https://new.example.org/'},isAccessibleForFree:true,
 license:'https://creativecommons.org/licenses/by/4.0/',
 articleBody:'El dólar subió 0,5% frente al peso colombiano el 30 de octubre de 2026. El tipo de cambio alcanzó 4.000 pesos por dólar. Según un analista del mercado, la demanda de divisas y el fortalecimiento del dólar global explicaron el movimiento en la sesión. La información corresponde a las operaciones observadas durante la jornada.'})}</script>`
const robots='User-agent: *\nAllow: /'
const capture=(url:string,text:string)=>({sourceId:'unregistered',url,text,sha256:sourceAdmissionHash(text),httpStatus:200,collectedAt:asOf})
async function setup(){
 const original=await originalPipelineFixture(),proof=inspectSourceAdmission({currency:'COP',url,html,robotsText:robots,collectedAt:asOf,asOf})
 const state={proofs:[proof],decisions:[]}
 const expanded=admittedSourceCatalog({...original,state,asOf})
 const catalog=compileResearchSourceCatalog(expanded.sourcePlan,expanded.sourceRegister)
 const source=catalog.sources.find(s=>s.admission)
 const captures=[capture(url,html),capture('https://new.example.org/robots.txt',robots)]
 return {original,proof,state,expanded,catalog,source,captures}
}

it('runs a newly admitted article through the existing selected collector and paid preparation without changing base policy or sending a model request',async()=>{
 const f=await setup(),examples=['BRL','MXN','COP','PEN','CLP','ARS'].map(c=>runtimeFixture(c))
 const snapshot={currency:'COP',baseDate:'2026-10-30'},commentaryTarget={date:'2026-10-30',basis:'test'}
 const input=runtimeResearchInput({snapshot,asOf,commentaryTarget})
 const selection=planResearchSourceSelection({input,...f.expanded})
 const requestIds=selection.sourceRequests.filter(r=>r.sourceId===f.source.id).map(r=>r.requestId)
 const collection=await collectSelectedResearch({input,...f.expanded,requestIds,captures:f.captures,mode:'saved',now:()=>asOf})
 expect(collection.originals).toHaveLength(1)
 expect(collection.modelCalls).toBe(0)
 expect(collection.networkCalls).toBe(0)
 expect(collection.originals[0].sourceAdmission.proofBinding).toBe(f.proof.binding)
 const args={snapshot,asOf,commentaryTarget,mode:'saved',now:()=>asOf}
 const baseline=await acquireRuntimeResearch({...args,...f.original})
 const supplemented=await acquireRuntimeResearch({...args,...f.expanded,captures:f.captures})
 for(const row of baseline.collection.sourceRequestBudgets)
  expect(supplemented.collection.sourceRequestBudgets.find(r=>r.sourceId===row.sourceId)?.limit).toBe(row.limit)
 expect(supplemented.collection.sourceRequestBudgets.find(r=>r.sourceId===f.source.id)?.limit).toBe(2)
 expect(supplemented.collection.originals.some(o=>o.sourceId===f.source.id)).toBe(true)
 expect(registeredNewsSourceForUrl({catalog:f.catalog,currency:'COP',url:'https://new.example.org/another'})).toBeNull()
 const rules=JSON.parse(fs.readFileSync('docs/2.0/material-processing-rules.json','utf8'))
 const registry=JSON.parse(fs.readFileSync('docs/2.0/original-news-source-policy-20261028.json','utf8'))
 const config={sourcePlan:f.original.sourcePlan,sourceRegister:f.original.sourceRegister,processingRules:rules}
 const countries=examples.map(e=>({currency:e.currency,calendar:e.calendar,collection:e.currency==='COP'?collection:
  {version:'selected-source-collection/1',currency:e.currency,asOf,originals:[],reviewQueue:[],outcomes:[]}}))
 const result=prepareOperatingBatch({...config,policy:proposeOperatingPolicy(config),registry,countries,asOf,sourceAdmissionState:f.state,
  dataset:{...examples[0].dataset,dailyRates:examples.flatMap(e=>e.dataset.dailyRates)},
  publicationsByCurrency:Object.fromEntries(examples.map(e=>[e.currency,[]])),control:{enabled:false,review_enabled:false,writer:'sol',monthly_limit_nano:0}})
 expect(result.holds).not.toContain('source_configuration_changed')
 expect(result.holds).toContain('runtime_not_enabled')
 expect(result.sourcePlans).toHaveLength(1)
 expect(result.authorizationCandidate.sourceAdmissionBinding).toBe(result.sourceAdmissionBinding)
 expect(result.sourcePlans[0].job).toBeDefined()
 expect(result.sourcePlans[0].holds).toEqual([])
})

it('exclusion, expiry and limited scopes remove only the new route and preserve every original registered source',async()=>{
 const f=await setup(),before=fingerprint(f.original.sourceRegister),base=compileResearchSourceCatalog(f.original.sourcePlan,f.original.sourceRegister)
 const decision={currency:'COP',url,action:'exclude',proofBinding:f.proof.binding,revision:1,scopes:f.proof.scopes}
 const excluded=admittedSourceCatalog({...f.original,state:{...f.state,decisions:[decision]},asOf})
 expect(excluded.sourceRegister.newsRoutes).toEqual(f.original.sourceRegister.newsRoutes)
 const expired=admittedSourceCatalog({...f.original,state:f.state,asOf:'2026-11-08T04:00:00Z'})
 expect(expired.sourceRegister.newsRoutes).toEqual(f.original.sourceRegister.newsRoutes)
 const narrow=admittedSourceCatalog({...f.original,state:{...f.state,decisions:[{...decision,action:'apply',scopes:{discover:true,collect:true,analyze:false,publishNotes:false}}]},asOf})
 const next=compileResearchSourceCatalog(narrow.sourcePlan,narrow.sourceRegister)
 expect(await collectAdmittedArticle({source:next.sources.find(s=>s.admission),mode:'saved',captures:f.captures,asOf})).toMatchObject({reason:'source_scope_not_for_report_analysis',networkCalls:0})
 for(const s of base.sources)expect(next.sources.find(n=>n.id===s.id)).toEqual(s)
 expect(fingerprint(f.original.sourceRegister)).toBe(before)
})

it('rechecks article content and robots while allowing harmless page chrome changes',async()=>{
 const f=await setup()
 expect(await collectAdmittedArticle({source:f.source,mode:'saved',captures:[...f.captures,capture(url,html+' changed')],asOf})).toMatchObject({reason:'admitted_source_revision_conflict'})
 expect(await collectAdmittedArticle({source:f.source,mode:'saved',captures:[capture(url,html+'<nav>updated navigation</nav>'),f.captures[1]],asOf})).toMatchObject({status:'collected_pending_review'})
 expect(await collectAdmittedArticle({source:f.source,mode:'saved',captures:[capture(url,html.replace('0,5%','5,0%')),f.captures[1]],asOf})).toMatchObject({reason:'admitted_source_conditions_changed'})
 expect(await collectAdmittedArticle({source:f.source,mode:'saved',captures:[f.captures[0],capture(f.captures[1].url,'User-agent: *\nDisallow: /')],asOf})).toMatchObject({reason:'admitted_source_access_restricted'})
 const calls:string[]=[]
 const failed=await collectAdmittedArticle({source:f.source,mode:'live',asOf,read:async target=>{calls.push(target);throw Error('network_failed')}})
 expect(calls).toEqual(['https://new.example.org/robots.txt'])
 expect(failed).toMatchObject({networkCalls:1,reason:'network_failed'})
})
