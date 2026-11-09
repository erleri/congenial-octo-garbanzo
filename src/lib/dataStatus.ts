import type { ExchangeRateDataset, FxPriceSource } from '../types/exchangeRate'
import {DEFAULT_FRESHNESS_CALENDAR,elapsedBusinessDays,freshnessReferenceDate} from './reference-freshness.js'
export {DEFAULT_FRESHNESS_CALENDAR,elapsedBusinessDays} from './reference-freshness.js'
export type {FreshnessCalendar} from './reference-freshness.js'

const currencies = ['BRL','MXN','CLP','COP','PEN','ARS'] as const
const providers: Record<FxPriceSource['provider'], string> = {
  frankfurter_v1:'Frankfurter', exchange_rate_api:'ExchangeRate-API', open_er_api:'Open ER',
  currency_api:'Currency API', alpha_vantage:'Alpha Vantage', unverified_supplemental:'기존 보조 자료', manual_backfill:'수동 보완',
}
export function datasetStatus(data: ExchangeRateDataset | null, now=Date.now(), calendar=DEFAULT_FRESHNESS_CALENDAR) {
  if(!data)return {state:'unknown' as const,label:'자료 확인 중',quotes:[]}
  const date=freshnessReferenceDate(now,calendar)
  const quotes=currencies.map(currency=>{
    const row=data.dailyRates.find(r=>r.currency===currency&&r.date===data.baseDate&&r.rateType==='LOCAL_PER_USD')
    const binding=data.priceProvenance?.quotesByDate[data.baseDate]?.[currency]
    const source=binding&&binding.value===row?.value?data.priceProvenance?.sources[binding.sourceId]:undefined
    return {currency,source:source?providers[source.provider]:'출처 상세 미기록',providerDate:source?.providerDate??null,
      providerUpdatedAt:source?.providerUpdatedAt??null,price:source?.priceKind==='conversion_reference'?'환산 기준':source?.priceKind==='provider_daily_close'?'공급자 일별 종가':'가격 정의 미확인',
      observed:!!row&&row.value!==null&&row.source!=='IMPUTED',verified:!!source&&source.priceKind!=='unverified'}
  })
  // A scheduled release is a minimum expected date, not a ceiling on valid data.
  // Early same-day data must not become unknown merely because releaseHour is pending.
  const today=freshnessReferenceDate(now,{...calendar,releaseHour:0})
  const future=data.baseDate>today
  const age=elapsedBusinessDays(data.baseDate,data.baseDate>date&&!future?data.baseDate:date,calendar.closedDates)
  const state=future||age===null?'unknown':age>calendar.maxBusinessDays?'late':'unverified'
  return {state,label:state==='late'?'갱신 확인 필요':state==='unknown'?'기준일 확인 필요':'기준시각 미확인',quotes}
}
