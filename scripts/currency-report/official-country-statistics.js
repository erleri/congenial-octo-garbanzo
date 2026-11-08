// Registered official aggregate products. Source differences live here; the
// caller applies the same age, edition, use, role and publication gates to all.
import {createHash} from 'node:crypto'
import {fingerprint} from './research-harness.js'
import {parseRegisteredStatistic,IBGE_RETAIL_SIDRA_URL} from './registered-material-adapters.js'
import {validDate} from './core.js'

export const OFFICIAL_COUNTRY_VERSION='official-country-statistics/1'
const hash=v=>createHash('sha256').update(v).digest('hex')
const stamp=v=>typeof v==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))
const normalize=t=>t.normalize('NFD').replace(/\p{M}/gu,'').replace(/[´˜]\s*/gu,'').replace(/\s+/gu,' ').trim()
const compact=t=>normalize(t).replace(/\s+/gu,'').toLowerCase()
const monthNames=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const monthPattern=monthNames.join('|')
const month=(name,year)=>`${year}-${String(monthNames.indexOf(name.toLowerCase())+1).padStart(2,'0')}`
const number=v=>/^[+-]?\d+(?:[.,]\d+)?$/.test(v)?Number(v.replace(',','.')):NaN
const scope=(subject,metric,comparison,extras={})=>({subject,metric,unit:'percent',comparison,channel:'all',priceBasis:'real',adjustment:'unadjusted',baseYear:'not_applicable',...extras})
const attribution='숫자 정리·계산·해석: LATAM FX. 원 기관의 공식 견해나 보증이 아닙니다.'
const profiles=[
 {id:'brl-pmc',currency:'BRL',sourceId:'brl-retail',seriesId:'PMC11708',publisher:'IBGE',label:'전국 실질 소매 판매량 · 전월 대비',
  subjectLabel:'전국 실질 소매 판매량',scope:scope('national_total','retail','month_over_month',{adjustment:'seasonally_adjusted'}),
  termsUrl:'https://www.ibge.gov.br/np_download/novoportal/documentos_institucionais/Plano_de_Dados_Abertos_IBGE_2024_2025.pdf',
  licence:'IBGE aggregate open-data numerical use; no nominal CC licence inferred',credit:'Fonte: IBGE, SIDRA tabela 8880, variável 11708.',
  useReview:'Official IBGE open-data plan identifies SIDRA/APISIDRA and services built from published aggregate data; admit numerical facts/metadata only, not report prose or database republication.'},
 {id:'pen-card-rate',currency:'PEN',sourceId:'pen-financing',seriesId:'PN07845NM',publisher:'Banco Central de Reserva del Perú',label:'은행권 현지통화 신용카드 금리 · 월 관측 수준',
  subjectLabel:'은행권 현지통화 신용카드 금리',scope:scope('banking_companies_domestic_currency','consumer_credit','level',{unit:'percent_effective_annual',channel:'banks',priceBasis:'nominal'}),
  termsUrl:'https://estadisticas.bcrp.gob.pe/estadisticas/series/ayuda/condiciones-de-uso',licence:'BCRP reproduction with source attribution',
  credit:'Fuente: BCRP, serie PN07845NM. Datos del sistema bancario en moneda nacional; no es la tasa de política monetaria.',
  useReview:'Reuse the recorded official BCRP permission for partial reproduction with source credit; only the named aggregate product series is admitted.'},
 {id:'cop-emc',currency:'COP',sourceId:'cop-retail',seriesId:'EMC_TOTAL',publisher:'DANE',label:'전국 소매·차량 실질 매출 · 전년 동월 대비',
  subjectLabel:'전국 소매·차량 실질 매출',scope:scope('national_retail_and_vehicles_sample','retail','year_over_year'),
  termsUrl:'https://www.dane.gov.co/index.php/terminos-y-condiciones',licence:'DANE information use/transformation with prescribed source credit',
  credit:'Fuente: Departamento Administrativo Nacional de Estadística: www.dane.gov.co',
  useReview:'Official DANE terms section 2 permits use, transformation and analysis with the prescribed attribution; keep the provisional survey population and source credit.'},
 {id:'cl-iacm',currency:'CLP',sourceId:'clp-consumer',seriesId:'CL_IACM',publisher:'INE Chile',label:'IACM 실질 소매 활동 · 전년 동월 대비',
  subjectLabel:'IACM 실질 소매 활동',scope:scope('cl_iacm_total','retail','year_over_year',{baseYear:'2018'}),
  termsUrl:'https://www.ine.gob.cl/terminos-de-uso-y-licencia-de-datos-abiertos',licence:'CC-BY-SA-4.0',
  credit:'Fuente: INE Chile, Índice de Actividad del Comercio al por Menor (IACM). CC BY-SA 4.0.',
  useReview:'INE section III permits extraction/transformation including commercial purposes, subject to attribution, licence/change notices, no endorsement and share-alike at public distribution.'},
 {id:'ars-supermarket',currency:'ARS',sourceId:'ars-retail-appliances',seriesId:'INDEC_SUPER',publisher:'Datos Argentina / INDEC',label:'슈퍼마켓 실질 매출 지수 · 전년 동월 대비',
  subjectLabel:'슈퍼마켓 실질 매출',scope:scope('supermarket_survey','retail','year_over_year',{channel:'supermarkets',baseYear:'2017'}),
  termsUrl:'https://www.datos.gob.ar/dataset/sspm-ventas-supermercados',licence:'CC-BY-4.0',
  credit:'Fuente: INDEC, Encuesta de supermercados; distribución oficial: Datos Argentina / Subsecretaría de Programación Macroeconómica. CC BY 4.0.',
  useReview:'Official dataset identifies INDEC as primary source and CC Attribution 4.0. Preserve government redistribution, index basis, original series and calculation disclosure; do not call it a fresh INDEC release.'},
]
export const officialCountryProfiles=()=>structuredClone(profiles)
export const countryDefinitionId=p=>fingerprint({version:OFFICIAL_COUNTRY_VERSION,profile:p})
// A normal statistical page may include a contact-form CAPTCHA in its footer.
// Match actual challenge markers/instructions, never the bare word "captcha".
export const officialAccessBarrier=text=>/Pardon Our Interruption|<title[^>]*>\s*Just a moment|cf-chl-|(?:complete|solve|verify)[^<.]{0,45}(?:captcha|human)|Access Denied|Esta requisi[cç][aã]o foi bloqueada|enable JavaScript and cookies|_Incapsula_Resource|Request unsuccessful|distil_referrer/i.test(text)

function captured(proof,asOf) {
 const raw=Buffer.from(proof?.rawBase64??'','base64'),u=new URL(proof?.url)
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||[...u.searchParams.keys()].some(k=>/token|api.?key|secret|password/i.test(k))
  ||proof.httpStatus!==200||raw.length<2||raw.length>2000000||hash(raw)!==proof.sha256
  ||!stamp(proof.collectedAt)||Date.parse(proof.collectedAt)>Date.parse(asOf))throw Error('official_original_binding_or_clock_invalid')
 if(!raw.subarray(0,5).equals(Buffer.from('%PDF-'))&&officialAccessBarrier(raw.toString('utf8')))throw Error('official_access_barrier_not_statistic')
 return {raw,text:raw.toString('utf8'),url:u}
}
function pdf(proof,asOf) {
 const {raw}=captured(proof,asOf),x=proof.extraction
 if(!raw.subarray(0,5).equals(Buffer.from('%PDF-'))||!raw.subarray(-2048).includes(Buffer.from('%%EOF'))||x?.version!=='monthly-pdf-text/1'
  ||x.sha256!==proof.sha256||x.bytes!==raw.length||!Array.isArray(x.pages)||!x.pages.length||x.pages.length>96
  ||x.pages.some((p,i)=>p.page!==i+1||typeof p.text!=='string'||p.text.length>40000||hash(p.text)!==p.textHash))throw Error('official_pdf_extraction_binding_required')
 return x.pages.map(p=>normalize(p.text))
}
const uniqueMatch=(text,pattern)=>{
 const rows=[...text.matchAll(pattern)]
 if(rows.length!==1)throw Error('official_product_layout_or_ambiguity')
 return rows[0]
}
function parsedPdf(profile,proof,asOf) {
 const pages=pdf(proof,asOf),first=pages[0],all=pages.join(' '),u=new URL(proof.url)
 let period,publishedOn,value,provisional=false
 if(profile.id==='cop-emc'){
  if(u.hostname!=='www.dane.gov.co'||!/^\/files\/operaciones\/EMC\/bol-EMC-[a-z]{3}\d{4}\.pdf$/.test(u.pathname)
   ||!all.includes('Encuesta Mensual de Comercio (EMC)')||!all.includes('Total nacional')
   ||!all.includes('divisiones 45 y 47'))throw Error('official_definition_mismatch')
  const date=uniqueMatch(first,new RegExp(`(\\d{1,2}) de (${monthPattern}) de (\\d{4})`,'g'))
  publishedOn=`${date[3]}-${String(monthNames.indexOf(date[2])+1).padStart(2,'0')}-${date[1].padStart(2,'0')}`
  const m=uniqueMatch(pages[2]??'',new RegExp(`En (${monthPattern}) de (\\d{4}), las ventas reales del comercio minorista (aumentaron|disminuyeron|crecieron|decrecieron) (-?\\d+,\\d+)%`,'g'))
  period=month(m[1],m[2]);value=number(m[4]);if(/disminuyeron|decrecieron/.test(m[3]))value=-Math.abs(value)
  const table=uniqueMatch(pages[2]??'',/Total ventas reales del comercio al por menor y vehiculos (-?\d+,\d+)/g)
  if(Math.abs(number(table[1])-value)>1e-9)throw Error('official_numeric_crosscheck_conflict')
  provisional=/P: provisional/i.test(all)
 }else if(profile.id==='cl-iacm'){
  if(u.hostname!=='www.ine.gob.cl'||!decodeURIComponent(u.pathname).startsWith('/docs/default-source/actividad-mensual-del-comercio/boletines/')
   ||!compact(first).includes('basepromedioano2018=100')||!compact(all).includes('latotalidaddeladivision47ysololasventasminoristasdeladivision45'))throw Error('official_definition_mismatch')
  const date=uniqueMatch(first,new RegExp(`Edicion n[oº°]?\\s*\\d+ / (\\d{1,2}) de (${monthPattern}) de (\\d{4})`,'gi'))
  publishedOn=`${date[3]}-${String(monthNames.indexOf(date[2])+1).padStart(2,'0')}-${date[1].padStart(2,'0')}`
  const p=uniqueMatch(pages[1]??'',new RegExp(`En (${monthPattern}) de (\\d{4}), el IACM desestacionalizado`,'g'))
  period=month(p[1],p[2])
  const m=uniqueMatch(pages[1]??'',/El IACM a precios constantes (crecio|decrecio|disminuyo)\s*(-?\d+,\d+)% en doce meses/g)
  value=number(m[2]);if(/decrecio|disminuyo/.test(m[1]))value=-Math.abs(value)
  const table=uniqueMatch(first,/Indice de Actividad del Comercio al por Menor \(IACM\)\s*(-?\d+,\d+)/g)
  if(Math.abs(number(table[1])-value)>1e-9)throw Error('official_numeric_crosscheck_conflict')
  provisional=/cifras del mes en analisis son provisionales/i.test(all)
 }else throw Error('official_pdf_profile_required')
 if(!validDate(publishedOn)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)||`${period}-01`>publishedOn||!Number.isFinite(value))throw Error('official_release_or_value_invalid')
 return [{period,value,publishedOn,provisional}]
}
function csvRows(text) {
 if(text.includes('"')||text.includes('\r')&&!text.includes('\r\n'))throw Error('official_csv_layout_changed')
 const lines=text.replace(/^\uFEFF/u,'').trim().split(/\r?\n/),headers=lines.shift().split(',')
 if(new Set(headers).size!==headers.length||lines.length>400)throw Error('official_csv_schema_changed')
 const date=headers.indexOf('indice_tiempo'),value=headers.indexOf('ventas_precios_constantes_original')
 if(date!==0||value<1||!headers.includes('ventas_precios_constantes_desestacionalizada'))throw Error('official_csv_definition_mismatch')
 const rows=lines.map(l=>{const r=l.split(',');if(r.length!==headers.length||!validDate(r[0])||!r[0].endsWith('-01'))throw Error('official_csv_schema_changed')
  return {period:r[0].slice(0,7),value:number(r[value])}})
 if(new Set(rows.map(r=>r.period)).size!==rows.length)throw Error('official_duplicate_period')
 return rows
}
function parsedJson(profile,proof,proofs,asOf) {
 const {text,url}=captured(proof,asOf)
 if(profile.id==='brl-pmc'){
  if(proof.url!==IBGE_RETAIL_SIDRA_URL)throw Error('official_product_url_mismatch')
  return parseRegisteredStatistic({kind:'ibge_sidra_json'},text,asOf.slice(0,10)).observations
 }
 if(profile.id==='pen-card-rate'){
  if(url.hostname!=='estadisticas.bcrp.gob.pe'||!/^\/estadisticas\/series\/api\/PN07845NM-PN07846NM-PN07847NM\/json\/\d{4}-\d{2}\/\d{4}-\d{2}\/esp$/.test(url.pathname))throw Error('official_product_url_mismatch')
  const parsed=parseRegisteredStatistic({kind:'bcrp_credit_json'},text,asOf.slice(0,10))
  return parsed.observations.filter(o=>o.seriesId===profile.seriesId).map(o=>({...o,transportWarnings:parsed.transportWarnings}))
 }
 if(profile.id==='ars-supermarket'){
  if(proof.url!=='https://infra.datos.gob.ar/catalog/sspm/dataset/455/distribution/455.1/download/ventas-totales-supermercados-2.csv')throw Error('official_product_url_mismatch')
  const definition=proofs.find(p=>p.id==='ars-definition')
  const d=definition&&JSON.parse(captured(definition,asOf).text),metadata=d?.meta?.[1]
  if(new URL(definition?.url).hostname!=='apis.datos.gob.ar'||metadata?.field?.id!=='455.1_VENTAS_PRENAL_0_M_34_10'
   ||normalize(metadata.field.units)!=='Indice base 2017=100'||!metadata.dataset?.source?.includes('INDEC')
   ||metadata.distribution?.downloadURL!==proof.url||metadata.dataset?.title!=='Ventas en supermercados'
   ||d.meta[0]?.frequency!=='month'||!Array.isArray(d.data)||!d.data.length||d.data.length>100)throw Error('official_government_mirror_definition_required')
  const rows=csvRows(text)
  if(new Set(d.data.map(r=>r[0])).size!==d.data.length)throw Error('official_duplicate_period')
  for(const [date,v] of d.data){const r=rows.find(r=>r.period===String(date).slice(0,7));if(!validDate(date)||!date.endsWith('-01')||!r||!Number.isFinite(r.value)||!Number.isFinite(v)||Math.abs(v-r.value)>1e-8)throw Error('official_mirror_overlap_conflict')}
  return rows.map(r=>{const previous=rows.find(p=>p.period===`${Number(r.period.slice(0,4))-1}${r.period.slice(4)}`)
   return {...r,indexValue:r.value,baseValue:previous?.value??null,value:r.value!==null&&previous?.value>0?100*(r.value/previous.value-1):null,
    providerMirrorPeriod:d.meta[0].end_date?.slice(0,7)??null,governmentRedistribution:true}})
 }
 throw Error('official_json_profile_required')
}

export function reviewCountryOfficialInputs({currency,inputs,asOf}) {
 const rows=[],candidates=[]
 if(inputs===undefined)return {rows,candidates}
 if(!stamp(asOf)||inputs?.version!==OFFICIAL_COUNTRY_VERSION||inputs.currency!==currency||!Array.isArray(inputs.proofs)||inputs.proofs.length>10)throw Error('registered_official_inputs_required')
 for(const profile of profiles.filter(p=>p.currency===currency)){
  const row={sourceId:profile.sourceId,profileId:profile.id,status:'held',reason:null};rows.push(row)
  try{
   if(asOf.slice(0,10)<'2026-11-01')throw Error('official_use_profile_not_available_at_cutoff')
   const matching=inputs.proofs.filter(p=>p.id===profile.id)
   if(!matching.length)throw Error('official_profile_capture_missing')
   if(new Set(matching.map(p=>p.sha256)).size>1)throw Error('official_release_revision_unresolved')
   const proof=matching[0]
   const observations=['cop-emc','cl-iacm'].includes(profile.id)?parsedPdf(profile,proof,asOf):parsedJson(profile,proof,inputs.proofs,asOf)
   if(new Set(observations.map(o=>o.period)).size!==observations.length)throw Error('official_duplicate_period')
   const latest=[...observations].filter(o=>o.period<=asOf.slice(0,7)).sort((a,b)=>b.period.localeCompare(a.period))[0]
   if(!latest||!Number.isFinite(latest.value))throw Error('official_period_or_value_missing')
   const {period,value}=latest,age=(Number(asOf.slice(0,4))-Number(period.slice(0,4)))*12+Number(asOf.slice(5,7))-Number(period.slice(5,7))
   if(age<0||age>3)throw Error('official_background_outside_collection_window')
   if(latest.publishedOn&&(latest.publishedOn>=asOf.slice(0,10)||latest.publishedOn>proof.collectedAt.slice(0,10)))throw Error('official_release_after_or_without_cutoff')
   const publishedOn=latest.publishedOn??null,definitionId=countryDefinitionId(profile)
   candidates.push({key:`${profile.seriesId}:${period}:${profile.scope.comparison}`,sourceId:profile.sourceId,seriesId:profile.seriesId,
    profileId:profile.id,definitionId,definitionVersion:OFFICIAL_COUNTRY_VERSION,scope:structuredClone(profile.scope),period,value,label:profile.label,
    subjectLabel:profile.subjectLabel,publisher:profile.publisher,collectedAt:proof.collectedAt,sourceUrl:proof.url,
    release:{period,publishedOn,url:proof.url,sha256:proof.sha256,editionHash:publishedOn?proof.sha256:fingerprint({definitionId,period,value}),publicationTime:null},
    originalBinding:fingerprint(proof),cardBinding:fingerprint({profile:definitionId,proof:proof.sha256,period,value}),derived:profile.id==='ars-supermarket',
    providerUpdateDisplay:null,archivedAsOfRelease:false,provisional:latest.provisional??null,
    ...(latest.indexValue!==undefined?{calculation:{currentIndex:latest.indexValue,priorYearIndex:latest.baseValue,formula:'100*(current/prior_year_same_month-1)'}}:{}),
    availability:{version:'official-snapshot-availability/1',basis:publishedOn?'published_release':'captured_series_only',availableBy:proof.collectedAt,
     publicationDateKnown:!!publishedOn,providerMirrorPeriod:latest.providerMirrorPeriod??null,governmentRedistribution:latest.governmentRedistribution??false},
    usePolicy:{version:OFFICIAL_COUNTRY_VERSION,reviewedOn:'2026-11-01',termsUrl:profile.termsUrl,licence:profile.licence,
     credit:profile.credit,transformation:attribution,reviewBasis:profile.useReview,numericOnly:true,local_analysis:'allowed',external_model:'allowed',public_display:'pending'}})
   row.status='numeric_candidate';row.period=period
   if(latest.transportWarnings?.length)row.transportWarnings=latest.transportWarnings
  }catch(e){row.reason=/^[a-z0-9_]+$/.test(e.message)?e.message:'official_profile_extraction_failed'}
 }
 return {rows,candidates}
}

export {isOfficialSnapshotBackground} from './official-statistic-availability.js'
