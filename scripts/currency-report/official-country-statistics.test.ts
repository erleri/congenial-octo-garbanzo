import {it,expect,vi} from 'vitest'
import {createHash} from 'node:crypto'
import fs from 'node:fs'
import {OFFICIAL_COUNTRY_VERSION,reviewCountryOfficialInputs,officialCountryProfiles,officialAccessBarrier} from './official-country-statistics.js'
import {collectOfficialCountryInputs,ARS_SUPERMARKET_CSV,ARS_SUPERMARKET_SERIES} from './official-country-input-loader.js'
import {IBGE_RETAIL_SIDRA_URL} from './registered-material-adapters.js'
import {reviewOfficialStatistics,attachOfficialBackground} from './official-statistic-admission.js'
import {sharedWriterFixture,sharedDraftFixture} from './shared-writer-fixture.js'
import {prepareSharedWriter,compileSharedWriterOutput} from './shared-writer.js'
import {fingerprint} from './research-harness.js'
import {officialMaterialEditions,operatingMaterialHash,newOfficialMaterialCandidates} from './operating-source-cache.js'
import {acquireOfficialBackground} from './runtime-official-supply.js'
import {bindProcessingRules,restrictCachedHandoff} from './material-processing.js'
import {assertSharedPacket,sealSharedPacket} from './shared-writing-contract.js'

// Synthetic documents and amounts test contracts, not historical quality or
// actual copyright grants. Real captures are replayed in private audit runs.
const asOf='2026-11-01T15:00:00Z',collectedAt='2026-11-01T10:00:00Z'
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex')
function proof(id:string,url:string,body:string){const raw=Buffer.from(body);return {id,url,httpStatus:200,collectedAt,sha256:sha(raw),rawBase64:raw.toString('base64')}}
function pdf(id:string,url:string,texts:string[]){const p=proof(id,url,'%PDF-synthetic only\n%%EOF');return {...p,extraction:{version:'monthly-pdf-text/1',sha256:p.sha256,bytes:Buffer.from(p.rawBase64,'base64').length,
 pages:texts.map((text,i)=>({page:i+1,text,textHash:sha(text)}))}}}
function brl(){return proof('brl-pmc',IBGE_RETAIL_SIDRA_URL,JSON.stringify([{V:'Valor'},...['202607','202608'].map((D3C,i)=>({NC:'1',D1C:'1',D2C:'11708',D4C:'56734',MC:'2',MN:'%',D3C,
 D2N:'com ajuste sazonal',D4N:'volume de vendas',V:String(i?-0.2:0.4)}))]))}
function pen(){return proof('pen-card-rate','https://estadisticas.bcrp.gob.pe/estadisticas/series/api/PN07845NM-PN07846NM-PN07847NM/json/2026-07/2026-11/esp',JSON.stringify({config:{series:[
 {name:'Tarjeta de Crédito'},{name:'Hasta 360 días'},{name:'Más 360 días'}]},periods:[{name:'Sep.2026',values:['65','13','14']}]}))}
function cop(){return pdf('cop-emc','https://www.dane.gov.co/files/operaciones/EMC/bol-EMC-ago2026.pdf',[
 'Encuesta Mensual de Comercio (EMC) Total nacional 16 de octubre de 2026',
 'divisiones 45 y 47 P: provisional',
 'En agosto de 2026, las ventas reales del comercio minorista aumentaron 7,3%. Total ventas reales del comercio al por menor y vehículos 7,3',
 ...Array.from({length:30},()=> 'Other survey content')])}
function cl(){return pdf('cl-iacm','https://www.ine.gob.cl/docs/default-source/actividad-mensual-del-comercio/boletines/2026/retail.pdf',[
 'Base promedio año 2018=100 Edición nº 336 / 30 de octubre de 2026 Índice de Actividad del Comercio al por Menor (IACM) 4,4',
 'En septiembre de 2026, el IACM desestacionalizado cambió. El IACM a precios constantes creció 4,4% en doce meses. La totalidad de la división 47 y solo las ventas minoristas de la división 45. Las cifras del mes en análisis son provisionales.'])}
function ars(){return [proof('ars-definition',`https://apis.datos.gob.ar/series/api/series/?ids=${ARS_SUPERMARKET_SERIES}`,JSON.stringify({meta:[{frequency:'month',end_date:'2026-07-01'},
 {field:{id:ARS_SUPERMARKET_SERIES,units:'Índice base 2017=100'},dataset:{source:'INDEC',title:'Ventas en supermercados'},distribution:{downloadURL:ARS_SUPERMARKET_CSV}}],data:[['2026-07-01',90]]})),
 proof('ars-supermarket',ARS_SUPERMARKET_CSV,'indice_tiempo,ventas_precios_constantes_original,ventas_precios_constantes_desestacionalizada\n2025-07-01,100,400\n2025-08-01,100,400\n2026-07-01,90,450\n2026-08-01,95,460\n')]}
const inputs=(currency:string,proofs:ReturnType<typeof proof>[])=>({version:OFFICIAL_COUNTRY_VERSION,currency,proofs})
const admit=(currency:string,proofs:ReturnType<typeof proof>[])=>reviewOfficialStatistics({currency,countryInputs:inputs(currency,proofs),asOf})
const reason=(currency:string,proofs:ReturnType<typeof proof>[])=>admit(currency,proofs).rows[0].reason
const mutate=(p:ReturnType<typeof proof>,change:(text:string)=>string)=>proof(p.id,p.url,change(Buffer.from(p.rawBase64,'base64').toString('utf8')))

it('uses a single registered definition per country with scope differences explicit, never country-specific FX rules',()=>{
 const profiles=officialCountryProfiles()
 expect(new Set(profiles.map(p=>p.currency)).size).toBe(5)
 expect(profiles.every(p=>p.scope.metric&&p.scope.comparison&&p.termsUrl&&p.credit&&p.useReview)).toBe(true)
 profiles[0].scope.metric='changed'
 expect(officialCountryProfiles()[0].scope.metric).toBe('retail')
})
it('reuses SIDRA exact definition and sign, refusing a changed seasonal category or a missing latest value',()=>{
 expect(admit('BRL',[brl()]).admitted[0]).toMatchObject({value:-0.2,period:'2026-08',scope:{adjustment:'seasonally_adjusted'}})
 expect(reason('BRL',[mutate(brl(),t=>t.replaceAll('com ajuste sazonal','sem ajuste'))])).toBe('sidra_definition_changed')
 expect(reason('BRL',[mutate(brl(),t=>t.replace('"-0.2"','"..."'))])).toBe('official_period_or_value_missing')
})
it('preserves a PEN product level and rejects duplicate periods and HTTP-200 access challenges',()=>{
 const a=admit('PEN',[pen()]).admitted[0]
 expect(a).toMatchObject({value:65,scope:{comparison:'level',unit:'percent_effective_annual',channel:'banks'}})
 const duplicate=mutate(pen(),t=>{const b=JSON.parse(t);b.periods.push(b.periods[0]);return JSON.stringify(b)})
 expect(reason('PEN',[duplicate])).toBe('official_duplicate_period')
 for(const text of ['Pardon Our Interruption','<script src="/_Incapsula_Resource"></script>','Request unsuccessful']){
  expect(officialAccessBarrier(text)).toBe(true)
  expect(reason('PEN',[proof('pen-card-rate',pen().url,text)])).toBe('official_access_barrier_not_statistic')
 }
 expect(officialAccessBarrier('<article>Official statistics</article><div style="display:none" data-sf-role="field-captcha-container">captcha-image</div>')).toBe(false)
})
it('reads a complete 33-page DANE bulletin and crosschecks the same national series without substituting subgroups',()=>{
 expect(admit('COP',[cop()]).admitted[0]).toMatchObject({value:7.3,provisional:true,release:{publishedOn:'2026-10-16'},scope:{subject:'national_retail_and_vehicles_sample'}})
 const changed=cop();changed.extraction.pages[2].text=changed.extraction.pages[2].text.replace('vehículos 7,3','vehículos 9,0');changed.extraction.pages[2].textHash=sha(changed.extraction.pages[2].text)
 expect(reason('COP',[changed])).toBe('official_numeric_crosscheck_conflict')
 const broken=cop();broken.extraction.pages[25].text+=' unbound'
 expect(reason('COP',[broken])).toBe('official_pdf_extraction_binding_required')
})
it('keeps CLP original annual growth separate from seasonal monthly movement, base and survey population',()=>{
 const a=admit('CLP',[cl()]).admitted[0]
 expect(a).toMatchObject({value:4.4,period:'2026-09',scope:{comparison:'year_over_year',adjustment:'unadjusted',baseYear:'2018'}})
 for(const [before,after] of [['2018=100','2020=100'],['división 47','división 46']]){
  const changed=cl();for(const page of changed.extraction.pages){page.text=page.text.replace(before,after);page.textHash=sha(page.text)}
  expect(reason('CLP',[changed])).toBe('official_definition_mismatch')
 }
 const ambiguous=cl();ambiguous.extraction.pages[1].text+=' El IACM a precios constantes creció 2,0% en doce meses';ambiguous.extraction.pages[1].textHash=sha(ambiguous.extraction.pages[1].text)
 expect(reason('CLP',[ambiguous])).toBe('official_product_layout_or_ambiguity')
})
it('accepts a newer ARS government CSV than its API mirror only with matching definition and overlapping values',()=>{
 const a=admit('ARS',ars()).admitted[0]
 expect(a).toMatchObject({period:'2026-08',scope:{channel:'supermarkets',baseYear:'2017'},availability:{providerMirrorPeriod:'2026-07',governmentRedistribution:true},calculation:{currentIndex:95,priorYearIndex:100}})
 expect(a.value).toBeCloseTo(-5)
 const mismatch=ars();mismatch[0]=mutate(mismatch[0],t=>t.replace('2026-07-01",90','2026-07-01",89'))
 expect(reason('ARS',mismatch)).toBe('official_mirror_overlap_conflict')
 const missing=ars();missing[1]=mutate(missing[1],t=>t.replace('2025-08-01,100,400\n',''))
 expect(reason('ARS',missing)).toBe('official_period_or_value_missing')
 const wrong=ars();wrong[1]=mutate(wrong[1],t=>t.replace('ventas_precios_constantes_original','ventas_precios_corrientes_original'))
 expect(reason('ARS',wrong)).toBe('official_csv_definition_mismatch')
})
it('rejects unbound bytes, future captures, unknown definitions and stale inputs instead of changing publication dates',()=>{
 const changed=brl();changed.rawBase64=Buffer.from('changed').toString('base64')
 expect(reason('BRL',[changed])).toBe('official_original_binding_or_clock_invalid')
 const future=pen();future.collectedAt='2026-11-02T00:00:00Z'
 expect(reason('PEN',[future])).toBe('official_original_binding_or_clock_invalid')
 const old=mutate(pen(),t=>t.replace('Sep.2026','Jun.2026'))
 expect(reason('PEN',[old])).toBe('official_background_outside_collection_window')
 const prior=reviewCountryOfficialInputs({currency:'PEN',inputs:inputs('PEN',[pen()]),asOf:'2026-10-31T23:00:00Z'})
 expect(prior.candidates).toEqual([]);expect(prior.rows[0].reason).toBe('official_use_profile_not_available_at_cutoff')
 const sameDay=cl();sameDay.extraction.pages[0].text=sameDay.extraction.pages[0].text.replace('30 de octubre','1 de noviembre');sameDay.extraction.pages[0].textHash=sha(sameDay.extraction.pages[0].text)
 expect(reason('CLP',[sameDay])).toBe('official_release_after_or_without_cutoff')
})
it('projects all five into the shared writer with code-owned publication conditions and unchanged approval/rate boundaries',()=>{
 for(const [currency,proofs] of [['BRL',[brl()]],['COP',[cop()]],['PEN',[pen()]],['CLP',[cl()]],['ARS',ars()]] as const){
  const h=sharedWriterFixture(currency,false),c=h.materialConnection
  c.asOf=asOf;delete c.binding;c.binding=fingerprint(c)
  const before=structuredClone(h),next=attachOfficialBackground(h,admit(currency,[...proofs])),plan=prepareSharedWriter({handoff:next})
  expect(plan.status).toBe('prepared_not_called');expect(plan.packet.facts[0].value).toBe(101)
  const e=plan.packet.evidence.find(e=>e.officialStatistic)
  expect(next.materialConnection.sections.consumer_background[0].sourceUses.public_display.status).toBe('allowed')
  expect(next.materialConnection.sections.consumer_background[0].officialStatistic.publication.publicationApproved).toBe(false)
  expect(JSON.stringify(plan.body)).not.toMatch(/rawBase64|%PDF|source\.pdf|BOLETÍN/)
  const draft=sharedDraftFixture(plan),compiled=compileSharedWriterOutput({plan,draft})
  expect(compiled.validation.errors.filter((s:string)=>/R04|published|cutoff|period/.test(s))).toEqual([])
  const link=draft.ruleLedger.claims.find(r=>r.target==='drivers.0.text');link.materialClaimIds=[e.sharedNotes.claims[0].claimId];link.evidenceIds=[e.id]
  expect(compileSharedWriterOutput({plan,draft}).validation.errors).toContain('background_used_as_fx_driver:drivers.0.text')
  if(currency==='PEN')expect(next.materialConnection.sections.consumer_background[0].text).not.toMatch(/높아|낮아|전월|전년/)
  expect(h).toEqual(before)
  if(e.publishedAt===null){
   const missing=structuredClone(plan.packet);delete missing.evidence.find(e=>e.officialStatistic).officialStatistic.availability
   expect(()=>assertSharedPacket(sealSharedPacket(missing))).toThrow('cutoff')
   const future=structuredClone(plan.packet),source=future.evidence.find(e=>e.officialStatistic)
   source.collectedAt='2026-11-02T00:00:00Z';source.officialStatistic.availability.availableBy=source.collectedAt
   expect(()=>assertSharedPacket(sealSharedPacket(future))).toThrow('cutoff')
  }
 }
})
it('keeps registered definitions immutable and rechecks explicit source restrictions for new official facts',()=>{
 const admission=admit('BRL',[brl()]);admission.admitted[0].scope.metric='changed'
 expect(admit('BRL',[brl()]).admitted[0].scope.metric).toBe('retail')
 const h=sharedWriterFixture('BRL',false),c=h.materialConnection;c.asOf=asOf;delete c.binding;c.binding=fingerprint(c)
 const projected=attachOfficialBackground(h,admit('BRL',[brl()])),base=JSON.parse(fs.readFileSync('docs/2.0/material-processing-rules.json','utf8'))
 delete base.binding
 const rules=bindProcessingRules({...base,restrictions:[...base.restrictions,{id:'synthetic-statistic-restriction',origin:'https://apisidra.ibge.gov.br',pathPrefix:'/',target:'authored_notes',effect:'deny',checkedOn:'2026-11-01',
  evidenceUrl:'https://apisidra.ibge.gov.br/terms',reason:'Synthetic current restriction; confirms a new numeric fact cannot override server restrictions.'}]})
 const r=restrictCachedHandoff(projected,rules,'2026-11-01')
 expect(r.materialConnection.sections.consumer_background).toEqual([])
 expect(r.materialConnection.archive[0].reason).toBe('current_authored_note_processing_restriction')
 expect(projected.materialConnection.sections.consumer_background).toHaveLength(1)
})
it('does not count recapture formatting as a new API edition, but detects an actual value revision',()=>{
 const a=admit('BRL',[brl()]),b=admit('BRL',[mutate(brl(),t=>JSON.stringify(JSON.parse(t),null,2))])
 expect(a.admitted[0].release.sha256).not.toBe(b.admitted[0].release.sha256)
 expect(officialMaterialEditions(a.admitted)).toEqual(officialMaterialEditions(b.admitted))
 const wrap=(admission:typeof a)=>({collection:{originals:[]},officialBackground:{admission}})
 expect(operatingMaterialHash(wrap(a))).toBe(operatingMaterialHash(wrap(b)))
 const publications=[{state:'published',approved:true,publishedAt:asOf,materialEditions:officialMaterialEditions(a.admitted)}]
 expect(newOfficialMaterialCandidates(b,publications)).toEqual([])
 const changed=admit('BRL',[mutate(brl(),t=>t.replace('"-0.2"','"-0.5"'))])
 expect(newOfficialMaterialCandidates(changed,publications)).toHaveLength(1)
})
it('uses registered live URLs, records transport failures and preserves exact cache timestamps on fallback',async()=>{
 const cached={countryOfficialInputs:inputs('PEN',[pen()])},before=structuredClone(cached)
 const fetchImpl=vi.fn(async()=>new Response('Pardon Our Interruption',{status:200}))
 const r=await collectOfficialCountryInputs({currency:'PEN',asOf,fetchImpl,saved:cached,now:()=>asOf})
 expect(r).toMatchObject({inputNetworkCalls:1,inputState:'saved_official_inputs_after_lookup_failure',inputIssues:['official_access_barrier_not_statistic']})
 expect(r.countryOfficialInputs).toEqual(cached.countryOfficialInputs);expect(cached).toEqual(before)
 expect(fetchImpl.mock.calls[0][0]).toMatch(/^https:\/\/estadisticas\.bcrp\.gob\.pe\/estadisticas\/series\/api\//)
 const noCache=await collectOfficialCountryInputs({currency:'PEN',asOf,fetchImpl,now:()=>asOf})
 expect(noCache.countryOfficialInputs.proofs).toEqual([])
})
it('discovers only official COP PDF routes and bounds body size before extraction',async()=>{
 const fetchImpl=vi.fn(async(url:string)=>url.includes('/index.php/')?new Response('<a href="https://evil.invalid/bol-EMC-sep2026.pdf">ignore</a><a href="/files/operaciones/EMC/bol-EMC-ago2026.pdf">Boletín</a>'):
  new Response('%PDF-synthetic\n%%EOF',{headers:{'content-length':'2000001'}}))
 const extractPdf=vi.fn(),r=await collectOfficialCountryInputs({currency:'COP',asOf,fetchImpl,extractPdf,now:()=>asOf})
 expect(r.inputNetworkCalls).toBe(2);expect(r.inputIssues).toEqual(['official_document_too_large'])
 expect(fetchImpl.mock.calls[1][0]).toBe(cop().url);expect(extractPdf).not.toHaveBeenCalled()
})
it('reuses country input in the existing official collector without duplicate retail network requests',async()=>{
 const [sourcePlan,sourceRegister]=['six-currency-explanation-sources-20261027.json','six-currency-source-register-20261027.json'].map(f=>JSON.parse(fs.readFileSync('docs/2.0/'+f,'utf8')))
 const fetchImpl=vi.fn(()=>{throw Error('offline only')})
 for(const [currency,p] of [['BRL',brl()],['CLP',cl()]] as const){
  const r=await acquireOfficialBackground({snapshot:{currency},asOf,sourcePlan,sourceRegister,countryOfficialInputs:inputs(currency,[p]),fetchImpl,mode:'saved'})
  expect(r.admission.admitted).toHaveLength(1);expect(r.networkCalls).toBe(0);expect(fetchImpl).not.toHaveBeenCalled()
  expect(r.states.find(s=>s.metric==='retail')).toMatchObject({numericBackgroundEligible:true,writingEligible:false,
   sourceStates:[{status:'registered_input_reused_without_duplicate_fetch'}]})
  expect(r.collections.flatMap(c=>c.outcomes).some(o=>o.sourceId===(currency==='CLP'?'clp-consumer':'brl-retail'))).toBe(false)
 }
})
