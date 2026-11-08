// Report-only publisher-stated spot closes. No API substitution, inferred
// prior price, collection, paid call, or publication permission.
import {createHash} from 'node:crypto'
import {validDate} from './core.js'
import {assessEvidencePacket} from './evidence-quality.js'
import {extractPublicArticle,publicationMetadata} from './public-research-adapter.js'
import {marketCalendarDate} from './market-calendar.js'

export const BRL_CLOSE_VERSION='brl-publisher-close/1'
const hash=value=>createHash('sha256').update(value).digest('hex')
const stamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))
const days=['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado']
const months=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro']
const pct=rows=>(rows[1].value/rows[0].value-1)*100
const facts=rows=>[{id:'spot',value:rows[1].value,label:`1 USD = ${rows[1].value} BRL`},
  {id:'day',value:pct(rows),label:`전 관측일 대비 ${pct(rows)>=0?'+':''}${pct(rows).toFixed(2)}%`}]
const limitations=[
  'CNN Brasil이 Reuters 정보를 포함해 보도한 현물시장 종가입니다. 중앙은행 PTAX 평균과 구분합니다.',
  '명시적으로 확인한 전후 거래일만 제공합니다. 장기 차트와 장기 변동률은 산출하지 않습니다.',
  '기사 발행·수정시각은 개별 거래 관측시각이 아닙니다.',
]
export function prepareBrlMarketClosePacket(capture,review,{asOf}) {
  const bytes=Buffer.from(capture?.rawBase64??'','base64'),u=new URL(capture?.url)
  if(capture?.httpStatus!==200||!bytes.length||bytes.length>2_000_000||hash(bytes)!==capture.sha256
    ||!stamp(capture.capturedAt)||!stamp(asOf)||Date.parse(capture.capturedAt)>Date.parse(asOf)
    ||u.origin!=='https://www.cnnbrasil.com.br'||u.search||u.hash
    ||review?.sourceSha256!==capture.sha256||!['agent','human'].includes(review.origin)||review.status!=='checked'
    ||typeof review.reason!=='string'||review.reason.trim().length<10||!validDate(review.checkedOn)||review.checkedOn>asOf.slice(0,10)
    ||!validDate(review.previousSessionDate)||!validDate(review.sessionDate)||review.previousSessionDate>=review.sessionDate
    ||Date.parse(review.sessionDate)-Date.parse(review.previousSessionDate)>7*86400000)
    throw new Error('bound_brl_close_review_required')
  const [year,month,day]=review.sessionDate.split('-')
  if(u.pathname!==`/economia/money/mercado/mercado-financeiro-ibovespa-dolar-${Number(day)}-${months[Number(month)-1]}-${year}/`)
    throw new Error('brl_close_source_session_mismatch')
  const html=new TextDecoder('utf-8',{fatal:true}).decode(bytes),article=extractPublicArticle(capture.url,html),metadata=publicationMetadata(html,capture.url)
  const availableAt=metadata.modifiedAt??metadata.publishedAt
  if(!stamp(availableAt)||Date.parse(availableAt)>Date.parse(asOf)||marketCalendarDate(metadata.publishedAt,'BRL')!==review.sessionDate)
    throw new Error('brl_close_source_after_cutoff')
  const text=article.blocks.map(b=>b.text).join('\n'),one=pattern=>{
    const found=[...text.matchAll(pattern)];if(found.length!==1)throw new Error('brl_close_price_anchor_changed');return found[0]
  }
  const sessionDay=days[new Date(review.sessionDate).getUTCDay()]
  if(!text.includes(`nesta ${sessionDay} (${Number(day)})`))throw new Error('brl_close_source_session_mismatch')
  const current=one(/A moeda norte-americana caiu (\d+,\d+)%, cotada a R\$ (\d+,\d{4})(?!\d)/g)
  const previous=one(/Na ([^,\n]+) \((\d+)\), o dólar disparou (\d+,\d+)% frente ao real, fechando a R\$ (\d+,\d{4})(?!\d)/g)
  if(previous[1]!==days[new Date(review.previousSessionDate).getUTCDay()]||Number(previous[2])!==Number(review.previousSessionDate.slice(8)))
    throw new Error('brl_close_previous_session_mismatch')
  const decimal=v=>/^\d+,\d{4}$/.test(v)?Number(v.replace(',','.')):NaN
  const rows=[{date:review.previousSessionDate,value:decimal(previous[4])},{date:review.sessionDate,value:decimal(current[2])}]
  if(rows.some(r=>!Number.isFinite(r.value)||r.value<=0)||Math.abs(pct(rows)+Number(current[1].replace(',','.')))>.0051)
    throw new Error('brl_close_arithmetic_mismatch')
  const basis={sourceAdapter:BRL_CLOSE_VERSION,provider:'CNN Brasil (com informações da Reuters)',seriesId:'CNN:reported_spot_close',
    priceKind:'reported_spot_close',dateBasis:'publisher_stated_local_session_day',unit:'BRL_per_USD',timeZone:'America/Sao_Paulo',
    sourceUrl:capture.url,rawSha256:capture.sha256,bodyHash:article.bodyHash,capturedAt:capture.capturedAt,asOf,
    publishedAt:metadata.publishedAt,bodyAvailableAt:availableAt,review:structuredClone(review),
    coverage:{kind:'explicit_two_session_pair',dailyHistoryComplete:false},observations:rows.map(r=>({
      localSessionDate:r.date,value:r.value,provider:'CNN Brasil (com informações da Reuters)',seriesId:'CNN:reported_spot_close',
      priceKind:'reported_spot_close',effectiveDate:null,observedAt:null,observationWindow:null}))}
  basis.verificationHash=hash(JSON.stringify(basis))
  const packet={currency:'BRL',baseDate:asOf.slice(0,10),observedDate:review.sessionDate,observationAt:null,
    marketData:{fetchedAt:capture.capturedAt,source:'UNKNOWN',rateType:'LOCAL_PER_USD',reportPriceBasis:basis},
    purpose:'fx_explanation',series:rows,facts:facts(rows),evidence:[],limitations:[...limitations]}
  packet.assessment=assessEvidencePacket(packet)
  validateBrlCloseBasis(basis,packet)
  return packet
}

export function validateBrlCloseBasis(basis,packet) {
  const {verificationHash,...bound}=basis??{},rows=basis?.observations?.map(o=>({date:o.localSessionDate,value:o.value}))
  if(verificationHash!==hash(JSON.stringify(bound))||basis.sourceAdapter!==BRL_CLOSE_VERSION||packet.currency!=='BRL'
    ||basis.provider!=='CNN Brasil (com informações da Reuters)'||basis.seriesId!=='CNN:reported_spot_close'
    ||basis.priceKind!=='reported_spot_close'||basis.dateBasis!=='publisher_stated_local_session_day'||basis.unit!=='BRL_per_USD'
    ||basis.timeZone!=='America/Sao_Paulo'||basis.asOf.slice(0,10)!==packet.baseDate||rows?.length!==2
    ||rows[1].date!==packet.observedDate||packet.observationAt!==null
    ||JSON.stringify(packet.series)!==JSON.stringify(rows)||JSON.stringify(packet.facts)!==JSON.stringify(facts(rows))
    ||basis.observations.some(o=>o.observedAt!==null||o.observationWindow!==null||o.effectiveDate!==null
      ||o.provider!==basis.provider||o.priceKind!==basis.priceKind||o.seriesId!==basis.seriesId))
    throw new Error('unverified_brl_close_basis')
  return basis.observations
}
