// Report-only price reconciliation over immutable saved originals. No fetching,
// quote substitution, inferred observations, paid calls or publication approval.
import {createHash} from 'node:crypto'
import {validDate} from './core.js'
import {MARKET_ZONES,marketCalendarDate} from './market-calendar.js'
import {extractPublicArticle,publicationMetadata} from './public-research-adapter.js'
import {fingerprint} from './research-harness.js'

export const COUNTRY_PRICE_CONNECTION_VERSION='country-price-connection/1'
const countries=['BRL','COP','PEN','ARS']
const hash=b=>createHash('sha256').update(b).digest('hex')
const stamp=v=>typeof v==='string'&&validDate(v.slice(0,10))&&/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))
const positive=v=>Number.isFinite(v)&&v>0
const eq=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-8
const decimal=v=>typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v)&&positive(Number(v))?Number(v):null
const latam=v=>/^\d{1,3}(?:\.\d{3})*(?:,\d+)?$/.test(v)?Number(v.replaceAll('.','').replace(',','.')):null
const meaningful=v=>typeof v==='string'&&v.trim().length>=10&&v.length<=480
function boundedHistoryQuery(u,currency) {
 const keys=currency==='BRL'?['@moeda','@dataInicial','@dataFinalCotacao','$top','$format','$orderby']:['Desde','Hasta','Limit','Offset']
 if([...u.searchParams.keys()].length!==keys.length||keys.some(k=>u.searchParams.getAll(k).length!==1))throw new Error('historical_price_query_changed')
 const date=v=>{
  const s=currency==='BRL'?/^'(\d{2})-(\d{2})-(\d{4})'$/.exec(v??''):null
  const d=currency==='BRL'?(s?`${s[3]}-${s[1]}-${s[2]}`:null):v
  if(!validDate(d))throw new Error('historical_price_query_changed')
  return d
 }
 const start=date(u.searchParams.get(currency==='BRL'?'@dataInicial':'Desde')),end=date(u.searchParams.get(currency==='BRL'?'@dataFinalCotacao':'Hasta'))
 const limitText=u.searchParams.get(currency==='BRL'?'$top':'Limit'),limit=Number(limitText)
 if(!/^\d+$/.test(limitText??'')||limit<1||limit>100||start>end||Date.parse(end)-Date.parse(start)>31*86400000
  ||currency==='BRL'&&(u.searchParams.get('@moeda')!=="'USD'"||u.searchParams.get('$format')!=='json'||u.searchParams.get('$orderby')!=='dataHoraCotacao asc')
  ||currency==='ARS'&&u.searchParams.get('Offset')!=='0')throw new Error('historical_price_query_changed')
 return {start,end,limit}
}

function readHistory(currency,capture,asOf,u) {
 const range=boundedHistoryQuery(u,currency),data=JSON.parse(exactText(capture,asOf))
 const dateAllowed=d=>validDate(d)&&d>=range.start&&d<=range.end&&d<=marketCalendarDate(capture.capturedAt,currency)
 if(currency==='ARS') {
  const rows=data.results?.[0]?.detalle
  if(data.status!==200||data.results?.length!==1||data.results[0].idVariable!==5||!Array.isArray(rows)||!rows.length
   ||rows.length>=range.limit||data.metadata?.resultset?.count!==rows.length||data.metadata.resultset.offset!==0
   ||data.metadata.resultset.limit!==range.limit||new Set(rows.map(r=>r.fecha)).size!==rows.length
   ||rows.some(r=>!dateAllowed(r.fecha)||!positive(r.valor)))throw new Error('ars_history_schema_or_coverage_changed')
  return {...officialHeader(currency,capture,'official_wholesale_reference','provider_series_day'),seriesId:5,timeZone:null,
   marketTimeZone:MARKET_ZONES.ARS,captureKind:'historical_series',requestRange:range,
   observations:rows.map(r=>({referenceDate:r.fecha,value:r.valor,localSessionDate:null,observedAt:null})).sort((a,b)=>a.referenceDate.localeCompare(b.referenceDate))}
 }
 const rows=data.value,types=['Abertura','Intermediário','Fechamento Interbancário','Fechamento']
 if(!Array.isArray(rows)||!rows.length||rows.length>=range.limit||data['@odata.nextLink']
  ||new Set(rows.map(r=>`${r.dataHoraCotacao}:${r.tipoBoletim}`)).size!==rows.length
  ||rows.some(r=>!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(r.dataHoraCotacao??'')
   ||r.dataHoraCotacao.slice(11,19).split(':').map(Number).some((n,i)=>n>=(i===0?24:60))
   ||!dateAllowed(r.dataHoraCotacao.slice(0,10))||!types.includes(r.tipoBoletim)||r.paridadeCompra!==1||r.paridadeVenda!==1
   ||!positive(r.cotacaoCompra)||!positive(r.cotacaoVenda)||r.cotacaoCompra>r.cotacaoVenda))throw new Error('brl_history_schema_or_coverage_changed')
 const observations=[...new Set(rows.map(r=>r.dataHoraCotacao.slice(0,10)))].sort().map(date=>{
  const day=rows.filter(r=>r.dataHoraCotacao.startsWith(date)),closes=day.filter(r=>r.tipoBoletim==='Fechamento')
  const samples=day.filter(r=>['Abertura','Intermediário'].includes(r.tipoBoletim))
  if(closes.length!==1||samples.length!==4||samples.filter(r=>r.tipoBoletim==='Abertura').length!==1
   ||samples.filter(r=>r.tipoBoletim==='Intermediário').length!==3||samples.some(r=>r.dataHoraCotacao>closes[0].dataHoraCotacao)
   ||['cotacaoCompra','cotacaoVenda'].some(key=>Math.abs(samples.reduce((n,r)=>n+r[key],0)/4-closes[0][key])>0.000051))
   throw new Error('brl_closing_bulletin_incomplete_or_inconsistent')
  return {referenceDate:date,bid:closes[0].cotacaoCompra,ask:closes[0].cotacaoVenda,
   providerTimestamp:closes[0].dataHoraCotacao,providerTimestampTimeZone:null,localSessionDate:null,observedAt:null}
 })
 return {...officialHeader(currency,capture,'official_ptax_closing_average','provider_closing_bulletin_day'),timeZone:null,
  marketTimeZone:MARKET_ZONES.BRL,captureKind:'historical_bulletins',requestRange:range,observations,
  bulletinType:'Fechamento',sampleMeanChecked:true,providerTimestampIsSpotTradeTime:false}
}
function bytesOf(capture,asOf) {
 if(!capture||capture.httpStatus!==200||typeof capture.rawBase64!=='string'||capture.rawBase64.length>3_000_000||!stamp(capture.capturedAt)
  ||!stamp(asOf)||Date.parse(capture.capturedAt)>Date.parse(asOf))throw new Error('invalid_saved_price_capture')
 const bytes=Buffer.from(capture.rawBase64,'base64'),u=new URL(capture.url)
 if(!bytes.length||bytes.toString('base64')!==capture.rawBase64||hash(bytes)!==capture.sha256||u.protocol!=='https:'
  ||u.username||u.password||u.port||u.hash||[...u.searchParams.keys()].some(k=>/token|api.?key|password|secret|authorization/i.test(k)))throw new Error('invalid_saved_price_capture')
 return bytes
}
function exactText(capture,asOf) {return new TextDecoder('utf-8',{fatal:true}).decode(bytesOf(capture,asOf))}
const officialHeader=(currency,capture,kind,dateBasis)=>({currency,provider:{BRL:'Banco Central do Brasil',COP:'Superintendencia Financiera de Colombia',PEN:'Banco Central de Reserva del Perú',ARS:'Banco Central de la República Argentina'}[currency],
 url:capture.url,rawSha256:capture.sha256,capturedAt:capture.capturedAt,unit:`${currency}_per_USD`,priceKind:kind,dateBasis,
 observedAt:null,publishedAt:null,observations:[]})

export function readSavedCountryOfficialPrice(currency,capture,asOf) {
 if(!countries.includes(currency))throw new Error('unsupported_country_price')
 const u=new URL(capture.url)
 if(currency==='BRL'&&u.origin==='https://olinda.bcb.gov.br'
  &&u.pathname==='/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)')return readHistory(currency,capture,asOf,u)
 if(currency==='ARS'&&u.origin==='https://api.bcra.gob.ar'&&u.pathname==='/estadisticas/v4.0/monetarias/5')return readHistory(currency,capture,asOf,u)
 if(currency==='BRL') {
  if(capture.url!=='https://ptax.bcb.gov.br/ptax_internet/consultarUltimaCotacaoDolar.do')throw new Error('official_price_source_mismatch')
  const html=new TextDecoder('windows-1252',{fatal:true}).decode(bytesOf(capture,asOf))
  const tables=[...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].filter(m=>/Taxa de Compra/.test(m[1])&&/Taxa de Venda/.test(m[1]))
  if(tables.length!==1)throw new Error('ptax_table_changed')
  const headers=[...tables[0][1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m=>m[1].replace(/<[^>]*>/g,'').trim())
  if(JSON.stringify(headers)!==JSON.stringify(['Data','Taxa de Compra','Taxa de Venda']))throw new Error('ptax_table_changed')
  const rows=[...tables[0][1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>[...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c=>c[1].replace(/<[^>]*>/g,'').trim())).filter(r=>r.length)
  if(rows.length!==1||rows[0].length!==3||!/^\d{2}\/\d{2}\/\d{4}$/.test(rows[0][0]))throw new Error('ptax_row_changed')
  const date=rows[0][0].split('/').reverse().join('-'),bid=latam(rows[0][1]),ask=latam(rows[0][2])
  if(!validDate(date)||date>marketCalendarDate(capture.capturedAt,'BRL')||!positive(bid)||!positive(ask)||bid>ask)throw new Error('invalid_ptax_quote')
  return {...officialHeader(currency,capture,'official_ptax_closing_average','local_reference_day'),timeZone:MARKET_ZONES.BRL,
   observations:[{referenceDate:date,bid,ask,observedAt:null,localSessionDate:null}],methodologyReview:'existing_saved_ptax_average_definition_not_spot_close'}
 }
 const text=exactText(capture,asOf),data=JSON.parse(text) // Entire response; never strip an HTML error suffix.
 if(currency==='COP') {
  if(u.origin!=='https://www.datos.gov.co'||u.pathname!=='/resource/32sa-8pi3.json'||!Array.isArray(data)||!data.length||data.length>1000)throw new Error('cop_trm_source_or_schema_changed')
  const observations=data.map(row=>{
   if(row.unidad!=='COP'||!/^\d{4}-\d{2}-\d{2}T00:00:00\.000$/.test(row.vigenciadesde??'')
    ||!/^\d{4}-\d{2}-\d{2}T00:00:00\.000$/.test(row.vigenciahasta??'')||decimal(row.valor)===null)throw new Error('cop_trm_row_changed')
   const validFrom=row.vigenciadesde.slice(0,10),validThrough=row.vigenciahasta.slice(0,10)
   if(!validDate(validFrom)||!validDate(validThrough)||validFrom>validThrough)throw new Error('cop_trm_interval_changed')
   return {validFrom,validThrough,value:decimal(row.valor),localSessionDate:null,observedAt:null}
  }).sort((a,b)=>a.validFrom.localeCompare(b.validFrom))
  if(observations.some((o,i)=>i>0&&observations[i-1].validThrough>=o.validFrom))throw new Error('overlapping_cop_trm_intervals')
  return {...officialHeader(currency,capture,'official_trm','certified_validity_interval'),timeZone:MARKET_ZONES.COP,observations,
   tradeDateProvided:false,midnightIsObservationTime:false}
 }
 if(currency==='PEN') {
  if(u.origin!=='https://estadisticas.bcrp.gob.pe'||!/^\/estadisticas\/series\/api\/PD04645PD-PD04646PD\/json\/\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}\/esp$/.test(u.pathname)||u.search
   ||data.config?.series?.length!==2||!Array.isArray(data.periods)||data.periods.length>400
   ||!data.config.series[0].name.includes('TC Cierre Compra - 01:30 PM (S/ por US$)')
   ||!data.config.series[1].name.includes('TC Cierre Venta - 01:30 PM (S/ por US$)'))throw new Error('pen_closing_side_or_definition_changed')
  const months=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'],seen=new Set()
  const observations=data.periods.map(p=>{
   const m=/^(\d{2})\.([a-z]{3})\.(\d{2}|\d{4})$/i.exec(p.name??''),month=m?months.indexOf(m[2].toLowerCase()):-1
   if(!m||month<0||!Array.isArray(p.values)||p.values.length!==2)throw new Error('pen_price_period_changed')
   const year=m[3].length===2?`20${m[3]}`:m[3],date=`${year}-${String(month+1).padStart(2,'0')}-${m[1]}`
   if(!validDate(date)||seen.has(date)||date>marketCalendarDate(capture.capturedAt,'PEN'))throw new Error('pen_price_date_changed')
   seen.add(date)
   const missing=p.values.every(v=>v==='n.d.')
   if(!missing&&(p.values.some(v=>decimal(v)===null)||Number(p.values[0])>Number(p.values[1])))throw new Error('pen_price_value_changed')
   return {referenceDate:date,bid:missing?null:decimal(p.values[0]),ask:missing?null:decimal(p.values[1]),status:missing?'missing':'observed',localSessionDate:null,observedAt:null}
  }).sort((a,b)=>a.referenceDate.localeCompare(b.referenceDate))
  return {...officialHeader(currency,capture,'official_1330_closing_bid_ask','provider_series_day'),timeZone:null,
   declaredClock:'13:30',declaredClockTimeZone:'not_verified',observations}
 }
 if(capture.url!=='https://api.bcra.gob.ar/estadisticas/v4.0/monetarias?idVariable=5'||data.status!==200||data.results?.length!==1)throw new Error('ars_reference_source_or_schema_changed')
 const row=data.results[0]
 if(row.idVariable!==5||row.descripcion!=='Tipo de cambio mayorista de referencia'||row.unidadExpresion!=='Pesos argentinos por dólar estadounidense'
  ||row.periodicidad!=='D'||!validDate(row.ultFechaInformada)||row.ultFechaInformada>marketCalendarDate(capture.capturedAt,'ARS')||!positive(row.ultValorInformado))throw new Error('ars_reference_definition_changed')
 return {...officialHeader(currency,capture,'official_wholesale_reference','provider_latest_series_date'),timeZone:null,marketTimeZone:MARKET_ZONES.ARS,
  observations:[{referenceDate:row.ultFechaInformada,value:row.ultValorInformado,localSessionDate:null,observedAt:null}],
  seriesId:5,captureKind:'latest_catalog_value_not_historical_pair',methodologyReview:'existing_saved_A8359_review_not_new_policy_or_spot_close'}
}

export function readReviewedCountryArticlePrice(currency,capture,review,asOf) {
 const html=exactText(capture,asOf),url=new URL(capture.url)
 const source=currency==='BRL'&&url.hostname==='agenciabrasil.ebc.com.br'&&url.pathname.startsWith('/economia/noticia/')?'agencia-brasil':
  currency==='COP'&&url.hostname==='www.larepublica.co'&&url.pathname.startsWith('/finanzas/')?'la-republica':
  currency==='PEN'&&url.hostname==='gestion.pe'&&url.pathname.startsWith('/economia/mercados/')?'gestion':
  currency==='ARS'&&url.hostname==='www.infobae.com'&&url.pathname.startsWith('/economia/')?'infobae':null
 if(!source||review?.sourceSha256!==capture.sha256||!validDate(review.sessionDate)||!validDate(review.checkedOn)
  ||review.checkedOn>asOf.slice(0,10)||!['agent','human'].includes(review.origin)||review.status!=='checked'||!meaningful(review.reason)
  ||!Array.isArray(review.blockPositions)||!review.blockPositions.length||review.blockPositions.length>4
  ||new Set(review.blockPositions).size!==review.blockPositions.length||typeof review.sessionAnchor!=='string'||review.sessionAnchor.length<10)throw new Error('bound_article_price_review_required')
 const article=extractPublicArticle(capture.url,html),metadata=publicationMetadata(html,capture.url)
 if(review.blockPositions.some(i=>!Number.isInteger(i)||i<0||!article.blocks[i]))throw new Error('article_price_passage_missing')
 const selected=review.blockPositions.map(i=>article.blocks[i].text).join('\n'),publicationDay=marketCalendarDate(metadata.publishedAt,currency)
 if(!selected.includes(review.sessionAnchor)||!publicationDay||publicationDay<review.sessionDate
  ||Date.parse(publicationDay)-Date.parse(review.sessionDate)>7*86400000)throw new Error('article_price_session_review_mismatch')
 const [year,month,day]=review.sessionDate.split('-'),dayNumber=String(Number(day))
 const spanishMonths=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
 const dateAnchor=source==='agencia-brasil'?url.pathname.includes(`/noticia/${year}-${month}/`)&&selected.includes(`(${dayNumber})`)
  :source==='la-republica'?url.pathname.includes(`-${dayNumber}-de-${spanishMonths[Number(month)-1]}-de-${year}-`)
   :source==='gestion'?url.pathname.includes(`-${dayNumber}-de-${spanishMonths[Number(month)-1]}-`)&&publicationDay===review.sessionDate
    :url.pathname.includes(`/economia/${year}/${month}/${day}/`)
 if(!dateAnchor)throw new Error('article_price_date_anchor_changed')
 const availability=metadata.modifiedAt??metadata.publishedAt
 if(!stamp(availability)||Date.parse(availability)>Date.parse(asOf))throw new Error('article_price_body_after_cutoff')
 const one=pattern=>{const found=[...selected.matchAll(pattern)];if(found.length!==1)throw new Error('article_price_anchor_changed');return found[0]}
 let quotes=[],reportedChange=null,comparison=null
 if(source==='agencia-brasil') {
  const m=one(/O dólar fechou em alta de ([\d,]+)%, a R\$ ([\d,]+)/g)
  quotes=[{date:review.sessionDate,value:Number(m[2].replace(',','.')),priceKind:'reported_spot_close',side:'unspecified'}]
  reportedChange={pct:Number(m[1].replace(',','.')),delta:null,previousObservedValue:null}
 } else if(source==='la-republica') {
  const m=one(/La divisa cerró a la baja en \$(\d{1,3}(?:\.\d{3})*,\d{2}), con una diferencia de \$(\d{1,3}(?:\.\d{3})*,\d{2}) frente a la TRM del día, que se (?:ubica|ubicó) en \$(\d{1,3}(?:\.\d{3})*,\d{2})(?!\d)/g)
  quotes=[{date:review.sessionDate,value:latam(m[1]),priceKind:'reported_spot_close',side:'unspecified'},
   {date:review.sessionDate,value:latam(m[3]),priceKind:'reported_same_day_trm',side:'reference'}]
  if(!eq(quotes[1].value-quotes[0].value,latam(m[2])))throw new Error('article_trm_difference_changed')
  comparison={kind:'spot_vs_same_day_trm',difference:quotes[0].value-quotes[1].value,dailyChangeClaimAllowed:false}
 } else if(source==='gestion') {
  const m=one(/El tipo de cambio terminó el día en S\/ ([\d.]+)\. Cabe mencionar que el viernes pasado cerró la jornada S\/ ([\d.]+)/g)
  const previous=review.previousSessionDate
  if(!validDate(previous)||new Date(`${previous}T00:00:00Z`).getUTCDay()!==5||previous>=review.sessionDate
   ||Date.parse(review.sessionDate)-Date.parse(previous)>7*86400000)throw new Error('article_previous_session_review_required')
  quotes=[{date:previous,value:Number(m[2]),priceKind:'reported_interbank_close',side:'unspecified'},
   {date:review.sessionDate,value:Number(m[1]),priceKind:'reported_interbank_close',side:'unspecified'}]
  comparison={kind:'same_publisher_stated_session_interval',intervalPct:(quotes[1].value/quotes[0].value-1)*100,dailyChangeClaimAllowed:false}
 } else {
  const current=[...selected.matchAll(/En la plaza mayorista la divisa interbancaria aumentó ([\d,]+) pesos o ([\d,]+)%, a ([\d.]+) pesos/g)]
  const prior=[...selected.matchAll(/El dólar mayorista ganó ([\d,]+) peso(?:s)? o ([\d,]+)%, a \$(\d{1,3}(?:\.\d{3})*,\d{2})(?!\d)/g)]
  if(current.length+prior.length!==1)throw new Error('article_price_anchor_changed')
  const m=current[0]??prior[0]
  quotes=[{date:review.sessionDate,value:latam(m[3]),priceKind:'reported_wholesale_close',side:'unspecified'}]
  reportedChange={delta:Number(m[1].replace(',','.')),pct:Number(m[2].replace(',','.')),previousObservedValue:null}
 }
 if(quotes.some(q=>!positive(q.value)))throw new Error('invalid_reported_price')
 return {source,currency,url:capture.url,evidenceId:review.evidenceId,rawSha256:capture.sha256,bodyHash:article.bodyHash,
  sessionDate:review.sessionDate,publishedAt:metadata.publishedAt,bodyAvailableAt:availability,publicationDay,
  timeZone:MARKET_ZONES[currency],observedAt:null,quotes,reportedChange,comparison,
  reviewOrigin:review.origin,semanticSupport:'explicit_saved_original_review_not_independent_review'}
}

export function prepareCountryPriceConnection({currency,sessionDate,asOf,officialCaptures,articleCapture,articleReview}) {
 if(!countries.includes(currency)||!validDate(sessionDate)||!stamp(asOf)||sessionDate>marketCalendarDate(asOf,currency)
  ||!Array.isArray(officialCaptures)||!officialCaptures.length||officialCaptures.length>3)throw new Error('country_price_connection_input_required')
 const inputBinding=fingerprint({currency,sessionDate,asOf,officialCaptures,articleCapture,articleReview})
 const officialAttempts=officialCaptures.map(capture=>{
  try{return {status:'parsed',snapshot:readSavedCountryOfficialPrice(currency,capture,asOf)}}catch(e){
   return {status:'rejected',rawSha256:capture.sha256??null,reason:e instanceof SyntaxError?'full_response_invalid_json':
    ['invalid_saved_price_capture','official_price_source_mismatch','cop_trm_source_or_schema_changed','cop_trm_row_changed','cop_trm_interval_changed','overlapping_cop_trm_intervals','pen_closing_side_or_definition_changed','pen_price_period_changed','pen_price_date_changed','pen_price_value_changed','ars_reference_source_or_schema_changed','ars_reference_definition_changed','ptax_table_changed','ptax_row_changed','invalid_ptax_quote',
     'historical_price_query_changed','ars_history_schema_or_coverage_changed','brl_history_schema_or_coverage_changed','brl_closing_bulletin_incomplete_or_inconsistent'].includes(e.message)?e.message:'saved_price_capture_invalid'}
  }
 })
 let article
 try{article=readReviewedCountryArticlePrice(currency,articleCapture,articleReview,asOf)}catch(error){
  // A newly recognized access barrier invalidates the article connection, not
  // all other countries. Do not fall back to hidden text or a saved quote.
  if(error.message!=='publisher_paywall')throw error
  return {version:COUNTRY_PRICE_CONNECTION_VERSION,currency,sessionDate,asOf,inputBinding,
   status:'article_access_review_required',article:null,officialAttempts,links:[],holds:['article_access_review_required'],pairPreparation:null,
   generationMovement:null,caseDailyChange:null,articleAndOfficialInterchangeable:false,directCausalityEstablished:false,
   networkCalls:0,modelCalls:0,newPaidCostUsd:0,publicationApproved:false}
 }
 if(article.sessionDate!==sessionDate)throw new Error('article_case_session_mismatch')
 const snapshots=officialAttempts.filter(a=>a.status==='parsed').map(a=>a.snapshot),links=[],holds=[]
 if(!snapshots.length)holds.push('no_valid_official_capture')
 for(const snapshot of snapshots)for(const quote of article.quotes) {
  const rows=snapshot.observations.filter(o=>o.referenceDate===quote.date||o.validFrom<=quote.date&&quote.date<=o.validThrough)
  const row=rows[0],numericMatches=row?Object.entries(row).filter(([k,v])=>['bid','ask','value'].includes(k)&&eq(v,quote.value)).map(([k])=>k):[]
  let status='different_price_basis'
  if(!row||row.status==='missing')status='official_date_missing'
  else if(snapshot.priceKind==='official_trm'&&quote.priceKind==='reported_same_day_trm'&&numericMatches.includes('value'))status='same_effective_reference_value'
  else if(snapshot.priceKind==='official_1330_closing_bid_ask')status=numericMatches.length?'numeric_match_side_or_clock_unverified':'different_value_and_unverified_side'
  links.push({quoteDate:quote.date,articleKind:quote.priceKind,articleValue:quote.value,officialKind:snapshot.priceKind,status,
   numericMatches,official:row??null,articleAndOfficialInterchangeable:false})
 }
 const pairs=snapshots.filter(s=>['historical_series','historical_bulletins'].includes(s.captureKind)).map(s=>{
  const current=s.observations.find(o=>o.referenceDate===sessionDate),previous=s.observations.filter(o=>o.referenceDate<sessionDate).at(-1)
  return current&&previous?{provider:s.provider,priceKind:s.priceKind,seriesId:s.seriesId??null,
   previous,current,sourceSha256:s.rawSha256,dateBasis:s.dateBasis,transactionSessionsVerified:false,
   referenceIntervalChange:currency==='BRL'?{bidPct:(current.bid/previous.bid-1)*100,askPct:(current.ask/previous.ask-1)*100}
    :{pct:(current.value/previous.value-1)*100}}:null
 }).filter(Boolean)
 const conflict=pairs.length>1&&pairs.some(p=>fingerprint({previous:p.previous,current:p.current})!==fingerprint({previous:pairs[0].previous,current:pairs[0].current}))
 const observedReferencePair=conflict?null:pairs[0]??null
 if(conflict)holds.push('conflicting_official_reference_pairs')
 if(currency==='BRL')holds.push('ptax_average_not_article_spot_close',...(observedReferencePair?[]:['same_basis_official_pair_missing']))
 if(currency==='COP')holds.push('trm_validity_not_certified_trade_date','spot_vs_trm_not_previous_close','underlying_trade_calendar_not_verified')
 if(currency==='PEN')holds.push('official_case_value_missing_or_quote_side_unverified','declared_1330_timezone_not_verified')
 if(currency==='ARS')holds.push('weighted_reference_not_article_wholesale_close',...(observedReferencePair?[]:['latest_catalog_value_not_verified_session_pair']))
 if(observedReferencePair)holds.push('reference_session_mapping_and_fx_cause_review_required')
 // Saved BRL and ARS originals contain a latest value, not a verified pair.
 // Name the precise missing inputs rather than claiming country support by
 // adding a currency code to the strict CLP/MXN validator.
 const pairPreparation=['BRL','ARS'].includes(currency)?{
  status:observedReferencePair?'observed_pair_requires_session_and_cause_review':'held_missing_verified_pair',scope:'saved_observations_only',
  provider:officialHeader(currency,{},null,null).provider,
  priceKind:currency==='BRL'?'official_ptax_closing_average':'official_wholesale_reference',
  seriesId:currency==='ARS'?5:null,requiredCount:2,caseSessionDate:sessionDate,
  previousSessionDate:null,previousSessionPolicy:'verify_provider_calendar_do_not_infer_from_publication',
  availableReferenceDates:[...new Set(snapshots.flatMap(s=>s.observations.map(o=>o.referenceDate)).filter(Boolean))].sort(),
  observedReferencePair,
  quoteSide:currency==='BRL'?'must_select_and_preserve_bid_or_ask':'reference',
  requiredChecks:['same_series_and_price_kind','two_original_observations','underlying_session_mapping',
   'methodology_and_source_use_review','bound_currency_explanation_review'],
  strictWriterSupported:false,articleCloseSubstitutionAllowed:false,
  suppliedValuesMayBeBackCalculated:false,publicationApproved:false,
 }:null
 return {version:COUNTRY_PRICE_CONNECTION_VERSION,currency,sessionDate,asOf,inputBinding,
  status:'connected_separate_bases_generation_held',article,officialAttempts,links,holds,pairPreparation,
  generationMovement:null,caseDailyChange:null,articleAndOfficialInterchangeable:false,directCausalityEstablished:false,
  networkCalls:0,modelCalls:0,newPaidCostUsd:0,publicationApproved:false}
}
