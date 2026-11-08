// Server-only bounded official acquisition. Saved mode never loads credentials
// or makes requests. Raw PDFs/terms remain private and are not writer material.
import fs from 'node:fs/promises'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {fetchInegiSeries} from './inegi-api.js'
import {INEGI_REPORT_INDICATORS} from './inegi-report-indicators.js'
import {INEGI_NUMERIC_USE} from './official-statistic-admission.js'
import {readLocalResearchTokens} from './research-credentials-local.js'
import os from 'node:os'
import {collectOfficialCountryInputs} from './official-country-input-loader.js'
import {officialAccessBarrier} from './official-country-statistics.js'

const run=promisify(execFile),hash=v=>createHash('sha256').update(v).digest('hex')
export function createOfficialInputLoader({workspace,env=process.env,savedByCurrency={},fetchImpl=fetch,extractPdf}={}) {
 const extract=extractPdf??(async(raw,profile='monthly')=>{
  const python=env.FX_REPORT_PDF_PYTHON??(process.platform==='win32'
   ?path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'):'python3')
  const root=await fs.realpath(workspace),parent=path.join(root,'.local-reports/private/official-extractions')
  await fs.mkdir(parent,{recursive:true})
  if(await fs.realpath(parent)!==parent)throw Error('official_private_directory_required')
  const dir=await fs.mkdtemp(path.join(parent,'pdf-')),file=path.join(dir,'source.pdf')
  await fs.writeFile(file,raw,{flag:'wx'})
  try{
   const {stdout}=await run(python,['-X','utf8',fileURLToPath(new URL('./extract-monthly-pdf.py',import.meta.url)),file,
    ...(profile==='statistical-bulletin'?['--profile',profile]:[])],{timeout:20000,maxBuffer:5000000,windowsHide:true,encoding:'utf8'})
   return JSON.parse(stdout)
  }finally{await fs.unlink(file);await fs.rmdir(dir)}
 })
 return async({currency,asOf,mode,now=()=>new Date().toISOString()})=>{
  if(mode==='saved')return savedByCurrency[currency]??{inputState:'saved_official_inputs_missing',inputNetworkCalls:0}
  if(mode!=='live')throw Error('official_acquisition_mode_required')
  if(currency!=='MXN')return collectOfficialCountryInputs({currency,asOf,fetchImpl,extractPdf:extract,now,saved:savedByCurrency[currency]})
  // Credentials stay inside the existing authenticated official API adapter.
  let token=env.INEGI_INDICATORS_TOKEN
  if(!token&&env.GITHUB_ACTIONS!=='true')token=(await readLocalResearchTokens(workspace)).settings.INEGI_INDICATORS_TOKEN
  if(!token)return {inputState:'inegi_credentials_missing',inputNetworkCalls:0}
  const inegiCaptures=[],officialDocuments=[],issues=[],releaseLookups=[];let calls=0
  for(const d of INEGI_REPORT_INDICATORS){
   const result=await fetchInegiSeries({token,indicatorId:d.indicatorId,recent:false,fetchImpl,now})
   calls+=result.networkCalls??0;inegiCaptures.push(result)
   if(result.status!=='ok')issues.push(`official_inegi_${d.id.replaceAll('-','_')}_${result.status}`)
  }
  const read=async(url,maxBytes,expectedPdf=false)=>{
   calls++
   const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(20000)})
   if(r.status===404)throw Error('official_document_not_found')
   if(!r.ok||r.redirected||r.url&&r.url!==url)throw Error('official_document_http_failed')
   if(Number(r.headers.get('content-length'))>maxBytes)throw Error('official_document_too_large')
   const chunks=[];let size=0
   for await(const chunk of r.body){size+=chunk.length;if(size>maxBytes)throw Error('official_document_too_large');chunks.push(Buffer.from(chunk))}
   const raw=Buffer.concat(chunks)
   if(expectedPdf&&!raw.subarray(0,5).equals(Buffer.from('%PDF-'))){
    const text=raw.toString('utf8')
    if(officialAccessBarrier(text))throw Error('official_document_access_barrier')
    // INEGI serves its missing-file page with HTTP 200. A registered URL is
    // not a PDF merely because its name ends in .pdf; no numeric parser runs.
    if(/<title>\s*P[aá]gina no encontrada\s*<\/title>/i.test(text))throw Error('official_document_not_found')
    throw Error('official_document_not_pdf')
   }
   return raw
  }
  let officialTerms
  try{
   const raw=await read(INEGI_NUMERIC_USE.url,200000)
   if(officialAccessBarrier(raw.toString('utf8')))throw Error('official_terms_access_barrier')
   officialTerms={url:INEGI_NUMERIC_USE.url,text:raw.toString('utf8'),sha256:hash(raw),collectedAt:now()}
  }catch{issues.push('official_terms_unavailable')}
  // Two release months for each registered product; a missing/new-layout PDF
  // is a visible hold. No guessed numeric parsing, search subscription or retry.
  if(inegiCaptures.some(c=>c.status==='ok'))for(const product of ['emec','inpc'])for(let offset=0;offset<2;offset++){
   const month=new Date(Date.UTC(Number(asOf.slice(0,4)),Number(asOf.slice(5,7))-1-offset,1)).toISOString().slice(0,7)
   const file=`${product}${product==='inpc'?'_2q':''}${month.replace('-','_')}.pdf`
   const url=`https://www.inegi.org.mx/contenidos/saladeprensa/boletines/${month.slice(0,4)}/${product}/${file}`
   try{
    const raw=await read(url,2000000,true),extraction=await extract(raw)
    officialDocuments.push({url,rawBase64:raw.toString('base64'),sha256:hash(raw),collectedAt:now(),extraction})
    releaseLookups.push({product,publicationMonth:month,status:'captured'})
   }catch(error){
    const missing=error.message==='official_document_not_found'
    issues.push(missing?`official_${product}_release_not_found`:`official_${product}_release_or_extraction_failed`)
    releaseLookups.push({product,publicationMonth:month,status:missing?'not_found':'lookup_or_extraction_failed'})
   }
  }else issues.push('official_series_unavailable_no_release_fetch')
  return {inegiCaptures,officialDocuments,officialTerms,releaseLookups,inputNetworkCalls:calls,
   inputState:issues.length?'official_inputs_partial':'official_inputs_collected',inputIssues:[...new Set(issues)]}
 }
}
