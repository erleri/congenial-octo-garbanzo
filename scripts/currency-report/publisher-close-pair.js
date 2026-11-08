// Two explicit, same-publisher observations. Reuses the registered article
// parser/access checks; never back-calculates a price or grants source use.
import {createHash} from 'node:crypto'
import {validDate} from './core.js'
import {MARKET_ZONES,marketCalendarDate} from './market-calendar.js'
import {assessEvidencePacket} from './evidence-quality.js'
import {readReviewedCountryArticlePrice} from './country-price-connection.js'

export const PUBLISHER_CLOSE_PAIR_VERSION='country-publisher-close/1'
const definitions={
 COP:{provider:'La República',host:'www.larepublica.co',seriesId:'LaRepublica:reported_spot_close',priceKind:'reported_spot_close'},
 ARS:{provider:'Infobae',host:'www.infobae.com',seriesId:'Infobae:reported_wholesale_close',priceKind:'reported_wholesale_close'},
}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const stamp=v=>typeof v==='string'&&validDate(v.slice(0,10))&&/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))
const sourceUrl=(value,host)=>{try{const u=new URL(value);return u.origin===`https://${host}`&&!u.search&&!u.hash&&!u.username&&!u.password}catch{return false}}
const pct=rows=>(rows[1].value/rows[0].value-1)*100
const facts=(currency,rows)=>[{id:'spot',value:rows[1].value,label:`1 USD = ${rows[1].value} ${currency}`},
 {id:'day',value:pct(rows),label:`확인한 전후 거래일 사이 ${pct(rows)>=0?'+':''}${pct(rows).toFixed(2)}%`}]

export function preparePublisherClosePair({currency,captures,reviews,asOf}) {
 const definition=definitions[currency]
 if(!definition||!stamp(asOf)||!Array.isArray(captures)||captures.length!==2||!Array.isArray(reviews)||reviews.length!==2)
  throw new Error('publisher_close_pair_input_required')
 const originals=captures.map((c,i)=>{
  const parsed=readReviewedCountryArticlePrice(currency,c,reviews[i],asOf)
  const quotes=parsed.quotes.filter(q=>q.priceKind===definition.priceKind)
  if(quotes.length!==1||!sourceUrl(c.url,definition.host)||!stamp(c.capturedAt)||!stamp(parsed.publishedAt)||!stamp(parsed.bodyAvailableAt)
   ||Date.parse(parsed.bodyAvailableAt)<Date.parse(parsed.publishedAt)
   ||Date.parse(parsed.bodyAvailableAt)>Date.parse(c.capturedAt)
   ||parsed.publicationDay!==parsed.sessionDate||parsed.sessionDate>marketCalendarDate(asOf,currency))
   throw new Error('explicit_session_close_required')
  return {capture:c,review:reviews[i],parsed,quote:quotes[0]}
 })
 if(originals[0].parsed.sessionDate>=originals[1].parsed.sessionDate
  ||Date.parse(originals[1].parsed.sessionDate)-Date.parse(originals[0].parsed.sessionDate)>7*86400000
  ||captures[0].url===captures[1].url||captures[0].sha256===captures[1].sha256)
  throw new Error('ordered_distinct_session_closes_required')
 const rows=originals.map(o=>({date:o.quote.date,value:o.quote.value}))
 const basis={sourceAdapter:PUBLISHER_CLOSE_PAIR_VERSION,provider:definition.provider,seriesId:definition.seriesId,
  priceKind:definition.priceKind,dateBasis:'publisher_stated_local_session_day',unit:`${currency}_per_USD`,timeZone:MARKET_ZONES[currency],asOf,
  coverage:{kind:'explicit_two_session_interval',dailyHistoryComplete:false,consecutiveSessionsCertified:false,dailyChangeClaimAllowed:false},
  sources:originals.map(o=>({url:o.capture.url,rawSha256:o.capture.sha256,bodyHash:o.parsed.bodyHash,capturedAt:o.capture.capturedAt,
   sessionDate:o.parsed.sessionDate,publishedAt:o.parsed.publishedAt,bodyAvailableAt:o.parsed.bodyAvailableAt,
   review:structuredClone(o.review)})),
  observations:rows.map(r=>({localSessionDate:r.date,value:r.value,provider:definition.provider,seriesId:definition.seriesId,
   priceKind:definition.priceKind,effectiveDate:null,observedAt:null,observationWindow:null}))}
 basis.verificationHash=hash(basis)
 const packet={currency,baseDate:asOf.slice(0,10),observedDate:rows[1].date,observationAt:null,purpose:'fx_explanation',
  marketData:{fetchedAt:originals.map(o=>o.capture.capturedAt).sort().at(-1),source:'UNKNOWN',rateType:'LOCAL_PER_USD',reportPriceBasis:basis},
  series:rows,facts:facts(currency,rows),evidence:[],limitations:[
   `${definition.provider} 기사에서 각각 확인한 시장 가격입니다. 중앙은행·감독기관의 공식 참고환율과 구분합니다.`,
   '두 보도 거래일 사이의 변화이며 거래일 연속성과 전체 이력을 인증하지 않습니다. 일간·장기 변동으로 확대하지 않습니다.',
   '발행·수정시각은 개별 거래 관측시각이 아닙니다. 요인별 환율 기여도는 산출하지 않습니다.',
  ]}
 packet.assessment=assessEvidencePacket(packet)
 validatePublisherCloseBasis(basis,packet)
 return {packet,comparison:{kind:'two_reported_session_closes',changePct:pct(rows),dailyChangeClaimAllowed:false,
  comparisonsWithTrm:originals.flatMap(o=>o.parsed.comparison?[{sessionDate:o.parsed.sessionDate,...o.parsed.comparison}]:[])},
  sourceUse:'not_assessed_by_price_validation',fxCauseReview:'not_assessed_by_price_validation',
  paidCallAuthorized:false,publicationApproved:false,networkCalls:0,modelCalls:0,newPaidCostUsd:0}
}

export function validatePublisherCloseBasis(basis,packet) {
 const d=definitions[packet?.currency],{verificationHash,...bound}=basis??{},rows=basis?.observations?.map(o=>({date:o.localSessionDate,value:o.value}))
 if(!d||basis?.sourceAdapter!==PUBLISHER_CLOSE_PAIR_VERSION||verificationHash!==hash(bound)
  ||basis.provider!==d.provider||basis.seriesId!==d.seriesId||basis.priceKind!==d.priceKind
  ||basis.unit!==`${packet.currency}_per_USD`||basis.timeZone!==MARKET_ZONES[packet.currency]
  ||basis.dateBasis!=='publisher_stated_local_session_day'||!stamp(basis.asOf)||basis.asOf.slice(0,10)!==packet.baseDate
  ||rows?.length!==2||rows.some(r=>!validDate(r.date)||!Number.isFinite(r.value)||r.value<=0)
  ||rows[0].date>=rows[1].date||Date.parse(rows[1].date)-Date.parse(rows[0].date)>7*86400000
  ||rows[1].date!==packet.observedDate||packet.observedDate>packet.baseDate||packet.observationAt!==null
  ||JSON.stringify(packet.series)!==JSON.stringify(rows)||JSON.stringify(packet.facts)!==JSON.stringify(facts(packet.currency,rows))
  ||JSON.stringify(basis.coverage)!==JSON.stringify({kind:'explicit_two_session_interval',dailyHistoryComplete:false,consecutiveSessionsCertified:false,dailyChangeClaimAllowed:false})
  ||!Array.isArray(basis.sources)||basis.sources.length!==2
  ||basis.sources.some((s,i)=>!s||!sourceUrl(s.url,d.host)||s.sessionDate!==rows[i].date||!stamp(s.publishedAt)||!stamp(s.bodyAvailableAt)
   ||Date.parse(s.bodyAvailableAt)<Date.parse(s.publishedAt)||!stamp(s.capturedAt)
   ||Date.parse(s.bodyAvailableAt)>Date.parse(s.capturedAt)||Date.parse(s.capturedAt)>Date.parse(basis.asOf))
  ||basis.observations.some(o=>o.provider!==d.provider||o.seriesId!==d.seriesId||o.priceKind!==d.priceKind
   ||o.observedAt!==null||o.observationWindow!==null||o.effectiveDate!==null))
  throw new Error('unverified_publisher_close_pair')
 return basis.observations
}
