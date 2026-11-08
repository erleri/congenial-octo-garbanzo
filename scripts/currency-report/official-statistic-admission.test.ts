import {it,expect,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {fingerprint} from './research-harness.js'
import {inegiStatistic,INEGI_REPORT_INDICATORS} from './inegi-report-indicators.js'
import {bindSelectedOriginalReview} from './selected-source-collection.js'
import {inspectInegiRelease,reviewOfficialStatistics,attachOfficialBackground,INEGI_NUMERIC_USE} from './official-statistic-admission.js'
import {createOfficialInputLoader} from './official-input-loader.js'
import {sharedWriterFixture,sharedDraftFixture} from './shared-writer-fixture.js'
import {prepareSharedWriter,compileSharedWriterOutput} from './shared-writer.js'
import {sourceSelectionFixture} from './research-source-selection-fixtures.js'
import {acquireOfficialBackground} from './runtime-official-supply.js'
import {operatingMaterialHash,officialMaterialEditions,newOfficialMaterialCandidates} from './operating-source-cache.js'
import {runtimeFixture} from './runtime-fixture.js'
import {supplyRuntimeInput} from './runtime-supply.js'
import fs from 'node:fs'

const hash=v=>createHash('sha256').update(v).digest('hex'),asOf='2026-11-01T08:00:00Z'
// Entirely synthetic source data. No real PDF, numeric-use grant or API call.
function document(text='BOLETÍN DE INDICADOR 1/26 ENCUESTA MENSUAL SOBRE EMPRESAS COMERCIALES (EMEC) INDICADORES DE EMPRESAS COMERCIALES 21 de octubre de 2026 Página 1/2 Próxima publicación: 20 de noviembre de 2026 En agosto de 2026, los ingresos variaron.') {
 const raw=Buffer.from('%PDF-synthetic only\n%%EOF')
 return {url:'https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/emec/emec2026_10.pdf',rawBase64:raw.toString('base64'),sha256:hash(raw),collectedAt:'2026-10-27T14:00:00Z',
  extraction:{version:'monthly-pdf-text/1',sha256:hash(raw),bytes:raw.length,pages:[{page:1,text,textHash:hash(text)}]}}
}
function capture(){const d=INEGI_REPORT_INDICATORS[0];return {version:'inegi-series/1',seriesId:d.indicatorId,status:'ok',httpStatus:200,authentication:'accepted',
 resource:{indicatorId:d.indicatorId,source:'BIE-BISE',geography:'00'},checkedAt:'2026-10-27T13:00:00Z',frequencyCode:'8',unitCode:d.unitCode,
 sourceCodes:d.sourceCodes,noteCodes:'',lastUpdateDisplay:'21/10/2026',observations:[{period:'2025-08',value:100},{period:'2026-08',value:103}]}}
function collection(comparison='year_over_year'){
 const d=INEGI_REPORT_INDICATORS[0],scope=comparison==='level'?d.scope:d.derivedScopes[0],stat=inegiStatistic(capture(),scope)
 const {original,review}=bindSelectedOriginalReview({request:{sourceId:'mxn-consumer',period:'2026-08'},record:{...stat,requestedPeriod:'2026-08'},
  adapter:'statistic_scope_and_source_use',requestIds:['synthetic-request'],targets:[{requestedPeriod:'2026-08',requestedScope:scope}],currency:'MXN',asOf})
 return {version:'selected-source-collection/1',currency:'MXN',asOf,originals:[original],reviewQueue:[review],outcomes:[]}
}
// This seam lets positive projections be tested without inventing real terms.
// Production admission cannot be made ready by this seam: it has no injection.
function projectedAdmission(){const c=collection(),o=c.originals[0],r=inspectInegiRelease(document(),asOf)
 const s={key:'718506:2026-08:year_over_year',sourceId:o.sourceId,seriesId:o.seriesId,definitionId:o.definitionId,definitionVersion:o.definitionVersion,
  scope:o.scope,period:'2026-08',value:o.observations[1].value,label:INEGI_REPORT_INDICATORS[0].label,collectedAt:o.collectedAt,sourceUrl:o.url,
  release:r,originalBinding:fingerprint(o),cardBinding:c.reviewQueue[0].binding,derived:true,providerUpdateDisplay:'21/10/2026',archivedAsOfRelease:false}
 const body={version:'official-statistic-admission/1',currency:'MXN',asOf,admitted:[s],rows:[],status:'numeric_background_ready_for_manuscript_review'}
 return {...body,binding:fingerprint(body)}
}
it('parses publication and target separately, ignoring next publication and never extracting a PDF numeric table',()=>{
 const d=document(),before=structuredClone(d),r=inspectInegiRelease(d,asOf)
 expect(r).toMatchObject({product:'emec',period:'2026-08',publishedOn:'2026-10-21',publicationTime:null})
 expect(r).not.toHaveProperty('value');expect(d).toEqual(before)
})
it('holds changed extraction bytes, date/product layouts and unavailable-at-cutoff releases',()=>{
 const d=document(),changed=structuredClone(d);changed.extraction.pages[0].text+=' changed'
 expect(()=>inspectInegiRelease(changed,asOf)).toThrow('binding')
 expect(()=>inspectInegiRelease(document('unrecognized PDF layout'),asOf)).toThrow('header_changed')
 expect(()=>inspectInegiRelease(d,'2026-10-20T00:00:00Z')).toThrow('binding')
 const wrong=structuredClone(d);wrong.url=wrong.url.replace('2026_10','2026_09')
 expect(()=>inspectInegiRelease(wrong,asOf)).toThrow('time_or_period')
 const sameDay=document(d.extraction.pages[0].text.replace('21 de octubre','27 de octubre'))
 expect(()=>inspectInegiRelease(sameDay,'2026-10-27T23:00:00Z')).toThrow('publication_time_unverified')
 const conflict=document(d.extraction.pages[0].text+' En septiembre de 2026, los ingresos variaron.')
 expect(()=>inspectInegiRelease(conflict,asOf)).toThrow('time_or_period')
})
it('does not treat an API update label or synthetic terms as release/use permission',()=>{
 const c=collection(),before=structuredClone(c)
 const noRelease=reviewOfficialStatistics({currency:'MXN',collections:[c],asOf})
 expect(noRelease.admitted).toEqual([]);expect(noRelease.rows[0].reason).toBe('official_release_missing_not_provider_update')
 const invalidTerms={url:INEGI_NUMERIC_USE.url,text:'synthetic not approved',sha256:hash('synthetic not approved'),collectedAt:asOf}
 const result=reviewOfficialStatistics({currency:'MXN',collections:[c],documents:[document()],terms:invalidTerms,asOf})
 expect(result.rows.some(r=>r.reason==='official_numeric_use_terms_missing_or_changed')).toBe(true)
 expect(result.admitted).toEqual([]);expect(result.semanticReview).toBe('not_performed');expect(c).toEqual(before)
})
it('catches changed scope/value bindings and refuses unsupported countries through the same gate',()=>{
 const changed=collection();changed.originals[0].scope.unit='percent_effective_annual'
 const result=reviewOfficialStatistics({currency:'MXN',collections:[changed],asOf})
 expect(result.admitted).toEqual([]);expect(result.rows[0].reason).not.toBeNull()
 for(const currency of ['BRL','COP','PEN','CLP','ARS']){
  const c=collection();c.currency=currency
  expect(reviewOfficialStatistics({currency,collections:[c],asOf}).admitted).toEqual([])
 }
})
it('projects numeric facts through the shared writer, preserves rates and blocks statistical causes',()=>{
 const h=sharedWriterFixture('MXN',false),{binding,...body}=h.materialConnection
 expect(binding).toBeTruthy();body.asOf=asOf;h.materialConnection={...body,binding:fingerprint(body)}
 const before=structuredClone(h),next=attachOfficialBackground(h,projectedAdmission()),plan=prepareSharedWriter({handoff:next})
 expect(plan.packet.facts.slice(0,3).map(f=>f.value)).toEqual([101,100,1]);expect(plan.packet.facts[3].value).toBeCloseTo(3)
 const source=plan.packet.evidence.find(e=>e.officialStatistic),sent=JSON.parse(plan.body.messages[1].content)
 expect(sent.evidence.find(e=>e.id===source.id).officialStatistic).toMatchObject({publicationTime:null,archivedAsOfRelease:false})
 expect(JSON.stringify(plan.body)).not.toContain('rawBase64');expect(JSON.stringify(plan.body)).not.toContain('BOLETÍN')
 const draft=sharedDraftFixture(plan),compiled=compileSharedWriterOutput({plan,draft})
 expect(compiled.candidate.implications[0].factIds).toEqual([source.officialStatistic.fact.id])
 const link=draft.ruleLedger.claims.find(r=>r.target==='drivers.0.text');link.materialClaimIds=[source.sharedNotes.claims[0].claimId];link.evidenceIds=[source.id]
 expect(compileSharedWriterOutput({plan,draft}).validation.errors).toContain('background_used_as_fx_driver:drivers.0.text')
 expect(h).toEqual(before);expect(next.materialConnection.officialBackground.semanticReview).toBe('pending_manuscript_review')
})
it('replaces this adapter projection on fresh failure without deleting other existing background or rewriting old input',()=>{
 const h=sharedWriterFixture('MXN'),{binding,...body}=h.materialConnection;expect(binding).toBeTruthy();body.asOf=asOf
 h.materialConnection={...body,binding:fingerprint(body)}
 const first=attachOfficialBackground(h,projectedAdmission()),empty=reviewOfficialStatistics({currency:'MXN',asOf})
 const next=attachOfficialBackground(first,empty)
 expect(next.materialConnection.sections.consumer_background.map(r=>r.evidenceId)).toEqual(['news-background'])
 expect(first.materialConnection.sections.consumer_background).toHaveLength(2)
 const tampered=projectedAdmission();tampered.admitted[0].value=999
 expect(()=>attachOfficialBackground(first,tampered)).toThrow('bound_official_admission')
})
it('collects registered exact INEGI scopes using the existing collector with no network in saved mode',async()=>{
 const fetchImpl=vi.fn(()=>{throw Error('network forbidden')})
 const sourcePlan=JSON.parse(fs.readFileSync('docs/2.0/six-currency-explanation-sources-20261027.json','utf8'))
 const sourceRegister=JSON.parse(fs.readFileSync('docs/2.0/six-currency-source-register-20261027.json','utf8'))
 const f=sourceSelectionFixture('MXN')
 const r=await acquireOfficialBackground({snapshot:{currency:'MXN'},asOf:f.asOf,sourcePlan,sourceRegister,inegiCaptures:[capture()],fetchImpl,now:()=>asOf})
 expect(r.collections.length).toBe(5);expect(r.collections.some(c=>c.originals.some(o=>o.seriesId==='718506'))).toBe(true)
 expect(r.networkCalls).toBe(0);expect(fetchImpl).not.toHaveBeenCalled();expect(r.admission.admitted).toEqual([])
})
it('keeps saved input loading offline and records missing token rather than reading a model key',async()=>{
 const fetchImpl=vi.fn(),saved={MXN:{inegiCaptures:[capture()]}}
 const loader=createOfficialInputLoader({workspace:process.cwd(),env:{GITHUB_ACTIONS:'true'},savedByCurrency:saved,fetchImpl})
 expect(await loader({currency:'MXN',mode:'saved',asOf})).toEqual(saved.MXN)
 expect(await loader({currency:'MXN',mode:'live',asOf})).toMatchObject({inputState:'inegi_credentials_missing',inputNetworkCalls:0})
 expect(fetchImpl).not.toHaveBeenCalled()
})
it('bounds live official acquisition to registered API/PDF/terms URLs, hides credentials and never calls a model',async()=>{
 const token='synthetic-token-only-1234567890',fetchImpl=vi.fn(async url=>{
  if(String(url).includes('/INDICATOR/')){
   const d=INEGI_REPORT_INDICATORS.find(d=>String(url).includes('/'+d.indicatorId+'/'))
   return new Response(JSON.stringify({Series:[{INDICADOR:d.indicatorId,FREQ:'8',UNIT:d.unitCode,NOTE:'',SOURCE:d.sourceCodes,LASTUPDATE:'21/10/2026',
    OBSERVATIONS:[{TIME_PERIOD:'2026/08',COBER_GEO:'00',OBS_VALUE:'103'}]}]}),{status:200})
  }
  if(String(url)===INEGI_NUMERIC_USE.url)return new Response('synthetic terms, not an approved hash')
  return new Response('%PDF-synthetic only\n%%EOF')
 })
 const loader=createOfficialInputLoader({workspace:process.cwd(),env:{GITHUB_ACTIONS:'true',INEGI_INDICATORS_TOKEN:token},fetchImpl,
  extractPdf:async()=>document().extraction})
 const result=await loader({currency:'MXN',mode:'live',asOf,now:()=>asOf})
 expect(fetchImpl).toHaveBeenCalledTimes(8);expect(result.inputNetworkCalls).toBe(8)
 expect(result.inegiCaptures).toHaveLength(3);expect(result.officialDocuments).toHaveLength(4)
 expect(fetchImpl.mock.calls.every(([u])=>new URL(u).hostname==='www.inegi.org.mx')).toBe(true)
 expect(JSON.stringify(result)).not.toContain(token)
 const failed=vi.fn(async()=>new Response('',{status:503}))
 const unavailable=await createOfficialInputLoader({workspace:process.cwd(),env:{GITHUB_ACTIONS:'true',INEGI_INDICATORS_TOKEN:token},fetchImpl:failed})({currency:'MXN',mode:'live',asOf,now:()=>asOf})
 expect(failed).toHaveBeenCalledTimes(4);expect(unavailable.inputState).toBe('official_inputs_partial')
 expect(unavailable.inputIssues).toContain('official_series_unavailable_no_release_fetch')
})
it('recognizes an official missing-file HTML page returned with HTTP 200 and never passes it to the PDF extractor',async()=>{
 const extractPdf=vi.fn(()=>{throw Error('not_a_pdf')})
 const fetchImpl=vi.fn(async url=>{
  if(String(url).includes('/INDICATOR/')){
   const d=INEGI_REPORT_INDICATORS.find(d=>String(url).includes('/'+d.indicatorId+'/'))
   return new Response(JSON.stringify({Series:[{INDICADOR:d.indicatorId,FREQ:'8',UNIT:d.unitCode,NOTE:'',SOURCE:d.sourceCodes,LASTUPDATE:'21/10/2026',
    OBSERVATIONS:[{TIME_PERIOD:'2026/08',COBER_GEO:'00',OBS_VALUE:'103'}]}]}))
  }
  if(String(url)===INEGI_NUMERIC_USE.url)return new Response('synthetic terms')
  return new Response('<html><title>Página no encontrada</title></html>',{status:200,headers:{'content-type':'text/html'}})
 })
 const loader=createOfficialInputLoader({workspace:process.cwd(),env:{GITHUB_ACTIONS:'true',INEGI_INDICATORS_TOKEN:'synthetic-token-only-1234567890'},fetchImpl,extractPdf})
 const result=await loader({currency:'MXN',mode:'live',asOf,now:()=>asOf})
 expect(result.officialDocuments).toEqual([])
 expect(result.releaseLookups.every(r=>r.status==='not_found')).toBe(true)
 expect(result.inputIssues).toContain('official_emec_release_not_found')
 expect(result.inputIssues).not.toContain('official_emec_release_or_extraction_failed')
 expect(extractPdf).not.toHaveBeenCalled()
})

it('includes actual official editions in operating identity while ignoring a recapture clock',()=>{
 const country={collection:{originals:[]},officialBackground:{admission:projectedAdmission()}}
 const recaptured=structuredClone(country);recaptured.officialBackground.admission.admitted[0].collectedAt=asOf
 expect(operatingMaterialHash(recaptured)).toBe(operatingMaterialHash(country))
 recaptured.officialBackground.admission.admitted[0].value=8
 expect(operatingMaterialHash(recaptured)).not.toBe(operatingMaterialHash(country))
})
it('distinguishes an unobserved requested month from an explicitly missing latest observation',()=>{
 const d=INEGI_REPORT_INDICATORS[0],scope=d.scope
 const bind=(period:string,observations:{period:string;value:number|null}[])=>{
  const stat=inegiStatistic({...capture(),observations},scope)
  const {original,review}=bindSelectedOriginalReview({request:{sourceId:'mxn-consumer',period},record:{...stat,requestedPeriod:period},
   adapter:'statistic_scope_and_source_use',requestIds:['synthetic-period'],targets:[{requestedPeriod:period,requestedScope:scope}],currency:'MXN',asOf})
  return {version:'selected-source-collection/1',currency:'MXN',asOf,originals:[original],reviewQueue:[review]}
 }
 const values=[{period:'2025-08',value:100},{period:'2026-08',value:103}]
 const future=reviewOfficialStatistics({currency:'MXN',collections:[bind('2026-11',values)],asOf})
 expect(future.rows[0]).toMatchObject({status:'requested_period_not_in_captured_series',latestCapturedPeriod:'2026-08',reason:null})
 const missing=reviewOfficialStatistics({currency:'MXN',collections:[bind('2026-08',[values[0],{period:'2026-08',value:null}])],asOf})
 expect(missing.rows[0]).toMatchObject({latestObservationMissing:true,reason:'official_period_or_value_missing'})
 expect(missing.admitted).toEqual([])
})
it('groups a release once and distinguishes already used releases, real revisions and newly published releases',()=>{
 const admission=projectedAdmission(),editions=officialMaterialEditions(admission.admitted)
 const publications=[{state:'published',approved:true,withdrawn:false,publishedAt:'2026-10-28T00:00:00Z',materialEditions:editions}]
 expect(newOfficialMaterialCandidates(admission,publications)).toEqual([])
 const changed=structuredClone(admission);changed.admitted[0].value=5
 expect(newOfficialMaterialCandidates(changed,publications)).toHaveLength(1)
 const oldUnknown=structuredClone(publications);oldUnknown[0].materialEditions=[]
 expect(newOfficialMaterialCandidates(admission,oldUnknown)).toEqual([])
 changed.admitted[0].release.publishedOn='2026-10-29'
 expect(newOfficialMaterialCandidates(changed,oldUnknown)).toHaveLength(1)
 const second=structuredClone(admission.admitted[0]);second.seriesId='different-series'
 expect(officialMaterialEditions([...admission.admitted,second])).toHaveLength(1)
})
it('stages accepted official background through the existing supply path without a model call or a public-use upgrade',async()=>{
 const f=runtimeFixture('MXN'),c=f.handoff.materialConnection
 for(const role of ['global_context','countercontext','policy_background','watch_context'])c.sections[role]=[]
 for(const row of Object.values(c.sections).flat())row.eventDate=row.sourceSessionDate
 delete c.binding;c.binding=fingerprint(c)
 const admission=projectedAdmission();admission.asOf=f.asOf;delete admission.binding;admission.binding=fingerprint(admission)
 const stage=vi.fn(async()=> 'synthetic-input')
 const result=await supplyRuntimeInput({...f,commentaryTarget:{date:'2026-10-27',basis:'synthetic'},store:{stage},
  connect:({handoff})=>({handoff,summary:{sources:[],pendingArticles:0}}),
  acquire:async()=>({collection:null,networkCalls:0,officialBackground:{admission}})})
 expect(result.status).toBe('input_staged');expect(result.modelCalls).toBe(0);expect(stage).toHaveBeenCalledTimes(1)
 expect(result.task.plan.packet.evidence.some(e=>e.officialStatistic)).toBe(true)
 expect(result.task.sourceUseReview.publicDisplay).toBe('unverified')
 expect(result.task.materialEditions).toHaveLength(1)
})
