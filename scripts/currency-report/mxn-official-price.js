// Report-only saved Banxico CA18 observations. No transport or operational writes.
import {createHash} from 'node:crypto'
import {buildPacket,validDate} from './core.js'

export const MXN_PRICE_VERSION='mxn-official-close/1'
export const BANXICO_CLOSE_URL='https://www.banxico.org.mx/SieInternet/consultarDirectorioInternetAction.do?accion=consultarCuadroAnalitico&idCuadro=CA18&locale=es&sector=-1'
export const BANXICO_CLOSE_METHOD=Object.freeze({version:'banxico-close-reviewed/1',provider:'Banco de México',seriesId:'CA18:closing_reference',
 url:'https://www.banxico.org.mx/apps/dao-web/4/60/DETERMINACION_DEL_TIPO_DE_CAMBIO_DE_CIERRE_DE_JORNADA.pdf',
 sha256:'d5e44cbef74df14833d7b2e8117e930614d872319a34da3a01509835d53b91c7'})
const hash=v=>createHash('sha256').update(v).digest('hex')
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const stamp=v=>typeof v==='string'&&validDate(v.slice(0,10))&&/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))
const clean=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim()
const timezone='America/Mexico_City'
function localDay(stamp){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(stamp)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`}
export function mexicoCloseClock(day,clock) {
 if(!validDate(day)||!['13:55','14:05','14:10'].includes(clock))throw new Error('invalid_mxn_clock')
 const target=Date.parse(`${day}T${clock}:00Z`);let guess=target
 for(let i=0;i<3;i++) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess)).map(p=>[p.type,p.value]))
  const displayed=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`)
  if(displayed===target)return new Date(guess).toISOString()
  guess+=target-displayed
 }
 throw new Error('mxn_clock_resolution_failed')
}

export function parseBanxicoCloseTable({raw,url,capturedAt}) {
 if(!Buffer.isBuffer(raw)||raw.length>2_000_000||url!==BANXICO_CLOSE_URL||!stamp(capturedAt))throw new Error('invalid_mxn_close_capture')
 let html;try{html=new TextDecoder('utf-8',{fatal:true}).decode(raw)}catch{html=new TextDecoder('windows-1252').decode(raw)}
 const tables=[...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].filter(m=>/T\.C\. Equilibrio/.test(m[1]))
 if(tables.length!==1||!/CA18/.test(html)||!/Pesos por d[oó]lar/i.test(html))throw new Error('mxn_close_table_identity_changed')
 const rows=[...tables[0][1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>[...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c=>clean(c[1])))
 const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 const header=rows.find(r=>r.includes('T.C. Equilibrio'))
 if(JSON.stringify(header?.slice(-5).map(normalize))!==JSON.stringify(['Compra','Venta','T.C. Equilibrio','Maximo','Minimo']))throw new Error('mxn_close_column_order_changed')
 const recentStart=rows.findIndex(r=>r.some(c=>normalize(c)==='Cinco dias habiles bancarios previos'))
 const latest=rows.findIndex(r=>r.some(c=>normalize(c)==='Ultima observacion'))
 if(recentStart<0||latest<=recentStart||latest-recentStart!==5)throw new Error('mxn_prior_banking_rows_unverified')
 const observations=[]
 for(const row of rows) {
  const dates=row.filter(c=>/^\d{2}\/\d{2}\/\d{4}$/.test(c));if(!dates.length)continue
  if(dates.length!==1)throw new Error('ambiguous_mxn_close_row')
  const date=dates[0].split('/').reverse().join('-'),values=row.slice(row.indexOf(dates[0])+1)
  if(!validDate(date)||[0,6].includes(new Date(date).getUTCDay())||date>localDay(capturedAt)||values.length!==5
   ||values.some(v=>!/^\d+\.\d{4}$/.test(v)||Number(v)<=0))throw new Error('invalid_mxn_close_row')
  const value=Number(values[2])
  if(Date.parse(mexicoCloseClock(date,'14:10'))>Date.parse(capturedAt))throw new Error('mxn_close_before_schedule')
  observations.push({date,value})
 }
 if(observations.length<6||new Set(observations.map(o=>o.date)).size!==observations.length)throw new Error('missing_or_duplicate_mxn_close_rows')
 observations.sort((a,b)=>a.date.localeCompare(b.date))
 const recentSessionDates=rows.slice(recentStart,latest+1).map(r=>r.find(c=>/^\d{2}\/\d{2}\/\d{4}$/.test(c))?.split('/').reverse().join('-'))
 if(recentSessionDates.some(d=>!validDate(d))||JSON.stringify(recentSessionDates)!==JSON.stringify(observations.slice(-6).map(o=>o.date)))throw new Error('mxn_prior_banking_rows_unverified')
 return {version:MXN_PRICE_VERSION,currency:'MXN',url,capturedAt,rawSha256:hash(raw),rowsSha256:hash(JSON.stringify(observations)),observations,recentSessionDates}
}

export function validateMxnPriceBasis(basis,{observedDate,baseDate,facts,series}={}) {
 const pair=basis?.observations
 if(basis?.sourceAdapter!==MXN_PRICE_VERSION||basis.provider!==BANXICO_CLOSE_METHOD.provider||basis.seriesId!==BANXICO_CLOSE_METHOD.seriesId
  ||basis.priceKind!=='official_closing_reference'||basis.dateBasis!=='local_banking_session_day'||basis.unit!=='MXN_per_USD'
  ||basis.timeZone!==timezone||basis.sourceUrl!==BANXICO_CLOSE_URL||!sha(basis.rawSha256)||!sha(basis.rowsSha256)
  ||basis.methodology?.version!==BANXICO_CLOSE_METHOD.version||basis.methodology.sha256!==BANXICO_CLOSE_METHOD.sha256||basis.methodology.url!==BANXICO_CLOSE_METHOD.url
  ||!stamp(basis.asOf)||!stamp(basis.capturedAt)||Date.parse(basis.capturedAt)>Date.parse(basis.asOf)
  ||basis.asOf.slice(0,10)!==baseDate||!Array.isArray(pair)||pair.length!==2||pair[1]?.localSessionDate!==observedDate
  ||basis.calendar?.basis!=='source_table_five_prior_banking_days'||basis.calendar.dates?.length!==6
  ||!Array.isArray(basis.rowSnapshot)||basis.rowsSha256!==hash(JSON.stringify(basis.rowSnapshot))
  ||JSON.stringify(basis.calendar.dates)!==JSON.stringify(basis.rowSnapshot.slice(-6).map(o=>o.date))
  ||JSON.stringify(basis.calendar.dates.slice(-2))!==JSON.stringify(pair.map(o=>o.localSessionDate))
  ||pair[0]?.localSessionDate>=pair[1]?.localSessionDate||observedDate>baseDate||observedDate>localDay(basis.asOf))throw new Error('unverified_mxn_close_basis')
 for(const o of pair) {
  if(!validDate(o.localSessionDate)||[0,6].includes(new Date(o.localSessionDate).getUTCDay())||!Number.isFinite(o.value)||o.value<=0
   ||o.currency!=='MXN'||o.provider!==basis.provider||o.seriesId!==basis.seriesId||o.unit!==basis.unit||o.priceKind!==basis.priceKind
   ||o.effectiveDate!==null||o.settlementDate!==null||o.observedAt!==null||o.publishedAt!==null||o.rawSha256!==basis.rawSha256
   ||o.observationWindow?.startAt!==mexicoCloseClock(o.localSessionDate,'13:55')||o.observationWindow?.endAt!==mexicoCloseClock(o.localSessionDate,'14:05')
   ||o.scheduledWebAvailabilityAt!==mexicoCloseClock(o.localSessionDate,'14:10')||Date.parse(o.scheduledWebAvailabilityAt)>Date.parse(basis.capturedAt))
   throw new Error('mxn_close_session_or_price_mismatch')
 }
 if(basis.rowSnapshot.some((o,i)=>!validDate(o.date)||!Number.isFinite(o.value)||o.value<=0||i>0&&o.date<=basis.rowSnapshot[i-1].date)
  ||pair.some((o,i)=>o.value!==basis.rowSnapshot.at(i-2)?.value)||!Array.isArray(facts)||!Array.isArray(series))throw new Error('mxn_close_snapshot_rows_changed')
 const expected=buildPacket({baseDate,dailyRates:basis.rowSnapshot.map(o=>({currency:'MXN',rateType:'LOCAL_PER_USD',date:o.date,value:o.value,source:'API',imputationMethod:'NONE'}))},'MXN',baseDate)
 if(JSON.stringify(series)!==JSON.stringify(expected.series)||expected.facts.some(f=>facts.filter(r=>r.id===f.id).length!==1
  ||facts.find(r=>r.id===f.id)?.value!==f.value)||facts.some(f=>['spot','day','five','mtd'].includes(f.id)&&!expected.facts.some(e=>e.id===f.id)))
  throw new Error('mxn_close_calculated_facts_changed')
 return pair
}

export function prepareMxnPricePacket(snapshot,{asOf,throughSessionDate}) {
 if(snapshot?.version!==MXN_PRICE_VERSION||snapshot.currency!=='MXN'||snapshot.url!==BANXICO_CLOSE_URL||!stamp(snapshot.capturedAt)
  ||!stamp(asOf)||Date.parse(snapshot.capturedAt)>Date.parse(asOf)||!validDate(throughSessionDate)||!sha(snapshot.rawSha256)
  ||snapshot.rowsSha256!==hash(JSON.stringify(snapshot.observations))||snapshot.recentSessionDates?.length!==6
  ||JSON.stringify(snapshot.recentSessionDates)!==JSON.stringify(snapshot.observations.slice(-6).map(o=>o.date))
  ||throughSessionDate!==snapshot.recentSessionDates.at(-1))throw new Error('invalid_mxn_price_snapshot')
 const observations=snapshot.observations.filter(o=>o.date<=throughSessionDate)
 if(observations.at(-1)?.date!==throughSessionDate||observations.length<6)throw new Error('requested_mxn_close_missing')
 const packet=buildPacket({baseDate:asOf.slice(0,10),fetchedAt:snapshot.capturedAt,dailyRates:observations.map(o=>({currency:'MXN',rateType:'LOCAL_PER_USD',date:o.date,value:o.value,source:'API',imputationMethod:'NONE'}))},'MXN',asOf.slice(0,10))
 packet.observationAt=null;packet.purpose='fx_explanation'
 packet.marketData.reportPriceBasis={sourceAdapter:MXN_PRICE_VERSION,provider:BANXICO_CLOSE_METHOD.provider,seriesId:BANXICO_CLOSE_METHOD.seriesId,
  unit:'MXN_per_USD',priceKind:'official_closing_reference',dateBasis:'local_banking_session_day',timeZone:timezone,methodology:{...BANXICO_CLOSE_METHOD},
  sourceUrl:snapshot.url,rawSha256:snapshot.rawSha256,rowsSha256:snapshot.rowsSha256,rowSnapshot:structuredClone(observations),capturedAt:snapshot.capturedAt,asOf,
  calendar:{basis:'source_table_five_prior_banking_days',dates:[...snapshot.recentSessionDates]},coverage:{kind:'table_summary_reference_dates',dailyHistoryComplete:false},
  vintage:'retrieved_snapshot_not_historical_availability',observations:observations.slice(-2).map(o=>({currency:'MXN',localSessionDate:o.date,effectiveDate:null,settlementDate:null,
   value:o.value,unit:'MXN_per_USD',provider:BANXICO_CLOSE_METHOD.provider,seriesId:BANXICO_CLOSE_METHOD.seriesId,priceKind:'official_closing_reference',observedAt:null,publishedAt:null,
   observationWindow:{startAt:mexicoCloseClock(o.date,'13:55'),endAt:mexicoCloseClock(o.date,'14:05')},scheduledWebAvailabilityAt:mexicoCloseClock(o.date,'14:10'),rawSha256:snapshot.rawSha256}))}
 validateMxnPriceBasis(packet.marketData.reportPriceBasis,packet)
 packet.limitations=['Banxico의 공식 종가 기준이며 FIX·소매 호가·결제 적용 환율과 구분합니다.','산정 구간의 가중평균으로 실제 선택 표본과 개별 관측시각은 확인되지 않았습니다.','확보한 과거 행의 현재 스냅샷으로 검토하며 당시 실시간 자료 가용성을 재현하지 않습니다.']
 return packet
}
