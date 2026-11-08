// Public registered routes only. No model, credentials, browser, retry or
// arbitrary URLs from source prose. A 200 challenge page is a failed lookup.
import {createHash} from 'node:crypto'
import {OFFICIAL_COUNTRY_VERSION,officialAccessBarrier} from './official-country-statistics.js'
import {IBGE_RETAIL_SIDRA_URL} from './registered-material-adapters.js'
import {discoverLatestMonthlyPdfs} from './chile-monthly-originals.js'
import {decodeEntities} from './local-source-discovery.js'

const digest=v=>createHash('sha256').update(v).digest('hex')
export const ARS_SUPERMARKET_CSV='https://infra.datos.gob.ar/catalog/sspm/dataset/455/distribution/455.1/download/ventas-totales-supermercados-2.csv'
export const ARS_SUPERMARKET_SERIES='455.1_VENTAS_PRENAL_0_M_34_10'
export async function collectOfficialCountryInputs({currency,asOf,fetchImpl=fetch,extractPdf,now=()=>new Date().toISOString(),saved}={}) {
 if(!['BRL','COP','PEN','CLP','ARS'].includes(currency))throw Error('registered_official_country_required')
 const proofs=[],issues=[];let calls=0
 const read=async(id,url,{pdf=false}={})=>{
  calls++
  const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(20000)})
  if(!response.ok||response.redirected||response.url&&response.url!==url)throw Error('official_http_lookup_failed')
  if(Number(response.headers.get('content-length'))>2000000)throw Error('official_document_too_large')
  const parts=[];let bytes=0
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>2000000)throw Error('official_document_too_large');parts.push(Buffer.from(chunk))}
  const raw=Buffer.concat(parts)
  if(!pdf&&officialAccessBarrier(raw.toString('utf8')))throw Error('official_access_barrier_not_statistic')
  if(pdf&&!raw.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('official_pdf_content_mismatch')
  const proof={id,url,httpStatus:response.status,collectedAt:now(),sha256:digest(raw),rawBase64:raw.toString('base64')}
  // Capture before extraction, so a parser failure does not discard a valid
  // original or force another download just to diagnose/replay it.
  proofs.push(proof)
  if(pdf){
   if(typeof extractPdf!=='function')throw Error('official_pdf_extractor_not_configured')
   try{proof.extraction=await extractPdf(raw,'statistical-bulletin')}
   catch{proof.extractionFailure='official_pdf_extraction_failed';throw Error('official_pdf_extraction_failed')}
  }
  return raw.toString('utf8')
 }
 try{
  if(currency==='BRL')await read('brl-pmc',IBGE_RETAIL_SIDRA_URL)
  if(currency==='PEN'){
   const start=new Date(Date.UTC(Number(asOf.slice(0,4)),Number(asOf.slice(5,7))-4,1)).toISOString().slice(0,7)
   await read('pen-card-rate',`https://estadisticas.bcrp.gob.pe/estadisticas/series/api/PN07845NM-PN07846NM-PN07847NM/json/${start}/${asOf.slice(0,7)}/esp`)
  }
  if(currency==='CLP'){
   const html=await read('cl-index','https://www.ine.gob.cl/estadisticas-por-tema/comercio-y-servicios/actividad-mensual-del-comercio')
   const found=discoverLatestMonthlyPdfs(html,'cl-retail',asOf.slice(0,10))
   if(!found.candidates.length)throw Error('official_release_not_found_in_index')
   for(const candidate of found.candidates)await read('cl-iacm',candidate.url,{pdf:true})
  }
  if(currency==='COP'){
   const html=await read('cop-index','https://www.dane.gov.co/index.php/estadisticas-por-tema/comercio-interno/encuesta-mensual-de-comercio-emc')
   const months=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
   const candidates=[...html.matchAll(/href=["']([^"']+)["']/gi)].flatMap(m=>{
    try{const u=new URL(decodeEntities(m[1]),'https://www.dane.gov.co'),p=/^\/files\/operaciones\/EMC\/bol-EMC-([a-z]{3})(\d{4})\.pdf$/.exec(u.pathname)
     const period=p&&months.includes(p[1])?`${p[2]}-${String(months.indexOf(p[1])+1).padStart(2,'0')}`:null
     return u.protocol==='https:'&&u.hostname==='www.dane.gov.co'&&!u.search&&!u.hash&&period&&period<=asOf.slice(0,7)?[{url:u.href,period}]:[]
    }catch{return []}
   }).sort((a,b)=>b.period.localeCompare(a.period))
   if(!candidates.length)throw Error('official_release_not_found_in_index')
   await read('cop-emc',candidates[0].url,{pdf:true})
  }
  if(currency==='ARS'){
   const start=`${Number(asOf.slice(0,4))-2}-01-01`
   const api=`https://apis.datos.gob.ar/series/api/series/?ids=${ARS_SUPERMARKET_SERIES}&start_date=${start}&end_date=${asOf.slice(0,10)}&limit=100`
   await read('ars-definition',api)
   await read('ars-supermarket',ARS_SUPERMARKET_CSV)
  }
 }catch(e){issues.push(/^[a-z0-9_]+$/.test(e.message)?e.message:'official_transport_or_extraction_failed')}
 // Optional exact stored source inventory is a cache, never a new capture or a
 // reason to hide current lookup failures. All scope/time/use checks rerun.
 let countryOfficialInputs={version:OFFICIAL_COUNTRY_VERSION,currency,proofs}
 let inputState=issues.length?'official_inputs_partial':'official_inputs_collected'
 if(issues.length&&saved?.countryOfficialInputs?.version===OFFICIAL_COUNTRY_VERSION&&saved.countryOfficialInputs.currency===currency){
  countryOfficialInputs=structuredClone(saved.countryOfficialInputs);inputState='saved_official_inputs_after_lookup_failure'
 }
 return {countryOfficialInputs,inputNetworkCalls:calls,inputState,inputIssues:issues}
}
