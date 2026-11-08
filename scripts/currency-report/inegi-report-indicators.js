// Reviewed official locators. No credentials, automatic evidence admission or FX-cause inference.
import {fingerprint} from './research-harness.js'

export const INEGI_DEFINITION_VERSION='inegi-report-definitions/1'
const api='https://www.inegi.org.mx/servicios/api_indicadores.html'
const emec='https://www.inegi.org.mx/programas/emec/2018/'
const inpc='https://www.inegi.org.mx/programas/inpc/2018/'
const common={source:'BIE-BISE',geography:'00',frequencyCode:'8',publicationTime:'not_supplied',historicalVintage:'current_series_not_archived'}
export const INEGI_REPORT_INDICATORS=Object.freeze([
  {...common,id:'retail',indicatorId:'718506',label:'EMEC 전국 실질 소매 매출 지수',unitCode:'1051',sourceCodes:'3209',
    url:emec,definitionSources:[api,emec,'https://www.inegi.org.mx/app/indicadores/BIE_tabla_equivalencias.xlsx'],
    scope:{subject:'national_total',metric:'retail',unit:'index',comparison:'level',channel:'all',priceBasis:'real',adjustment:'unadjusted',baseYear:'2018'},
    derivedScopes:[{subject:'national_total',metric:'retail',unit:'percent',comparison:'year_over_year',channel:'all',priceBasis:'real',adjustment:'unadjusted',baseYear:'2018'}],
    limitation:'전국 전체 소매업 매출 지수(2018=100). 가전·TV·개별 회사 판매나 계절조정 전월 변화로 확대하지 않는다.'},
  {...common,id:'prices-monthly',indicatorId:'910399',label:'INPC 전체 소비자물가 · 전월 대비',unitCode:'302',sourceCodes:'3371',
    url:inpc,definitionSources:[api,inpc,'https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/inpc/inpc_2q2026_10.pdf'],
    scope:{subject:'national_total',metric:'consumer_prices',unit:'percent',comparison:'month_over_month',channel:'all',priceBasis:'nominal',adjustment:'unadjusted',baseYear:'2018'},
    limitation:'전체 소비 바스켓의 전월 대비 변화율. 연율·근원물가·가전 가격·환율 원인과 구분한다.'},
  {...common,id:'prices-annual',indicatorId:'910406',label:'INPC 전체 소비자물가 · 전년 동월 대비',unitCode:'302',sourceCodes:'3371',
    url:inpc,definitionSources:[api,inpc,'https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/inpc/inpc_2q2026_10.pdf'],
    scope:{subject:'national_total',metric:'consumer_prices',unit:'percent',comparison:'year_over_year',channel:'all',priceBasis:'nominal',adjustment:'unadjusted',baseYear:'2018'},
    limitation:'전체 소비 바스켓의 전년 동월 대비 변화율. 월간 상승률·기대인플레이션·환율 원인과 구분한다.'},
])
export const inegiDefinitionId=definition=>fingerprint({version:INEGI_DEFINITION_VERSION,definition})
export function inegiScopeMatches(scope,definition) {
  return !!scope&&[definition.scope,...(definition.derivedScopes??[])].some(expected=>Object.keys(expected).every(key=>scope[key]===expected[key]))
}
export function verifyInegiReportSeries(result) {
  const definition=INEGI_REPORT_INDICATORS.find(d=>d.indicatorId===result?.seriesId)
  if(!definition||result?.version!=='inegi-series/1')throw new Error('unregistered_inegi_report_series')
  const definitionId=inegiDefinitionId(definition)
  if(result.status!=='ok')return {...result,definitionId,definitionVersion:INEGI_DEFINITION_VERSION}
  if(result.definitionId&&result.definitionId!==definitionId||result.definitionVersion&&result.definitionVersion!==INEGI_DEFINITION_VERSION
    ||result.resource?.source!==definition.source||result.resource?.geography!=='00'||result.resource.indicatorId!==definition.indicatorId
    ||result.httpStatus!==200||result.authentication!=='accepted'||result.frequencyCode!==definition.frequencyCode
    ||result.unitCode!==definition.unitCode||result.sourceCodes!==definition.sourceCodes||result.noteCodes!==''
    ||!Array.isArray(result.observations)||!result.observations.length||result.observations.length>25
    ||result.observations.some(o=>!/^\d{4}-(0[1-9]|1[0-2])$/.test(o.period)||o.value!==null&&!Number.isFinite(o.value)))
    return {...result,status:'definition_mismatch',dataStatus:'definition_review_required',definitionId,definitionVersion:INEGI_DEFINITION_VERSION}
  return {...result,dataStatus:'verified_report_series',definitionId,definitionVersion:INEGI_DEFINITION_VERSION}
}

// Accept only a bounded, safe projection. A saved capture is not an archive of a
// historical release, and its content hash is deliberately not called a raw hash.
export function inegiStatistic(result,requestedScope) {
  const checked=verifyInegiReportSeries(result)
  if(checked.status!=='ok'||checked.dataStatus!=='verified_report_series')throw new Error('inegi_definition_review_required')
  const definition=INEGI_REPORT_INDICATORS.find(d=>d.indicatorId===checked.seriesId)
  const scope=requestedScope??definition.scope
  if(!inegiScopeMatches(scope,definition))throw new Error('unsupported_inegi_scope')
  const derived=scope.comparison!==definition.scope.comparison
  const observations=checked.observations.map(o=>{
    const row={period:o.period,value:o.value,seriesId:checked.seriesId,statusCode:o.statusCode??null}
    if(!derived)return row
    const basePeriod=`${Number(o.period.slice(0,4))-1}${o.period.slice(4)}`,base=checked.observations.find(r=>r.period===basePeriod)
    return {...row,value:o.value!==null&&base?.value>0?(o.value/base.value-1)*100:null,
      basePeriod,baseValue:base?.value??null,indexValue:o.value,calculation:'100 * (current_index / prior_year_same_month_index - 1)'}
  })
  return {kind:'statistic',seriesId:checked.seriesId,url:definition.url,scope:{...scope},unit:scope.unit,
    observations,collectedAt:checked.checkedAt,publishedAt:null,sha256:fingerprint({capture:checked,scope}),hashBasis:'credential_free_series_projection',
    captureMode:'authenticated_official_projection',definitionId:checked.definitionId,definitionVersion:checked.definitionVersion,
    metadata:{indicatorId:checked.seriesId,definitionVersion:checked.definitionVersion,definitionId:checked.definitionId,
      scope:{...scope},derived,definitionSources:[...definition.definitionSources],publishedAt:null,
      lastUpdateDisplay:checked.lastUpdateDisplay,lastUpdateMeaning:'provider_update_label_not_publication_timestamp',
      sourceVersion:'current_series_not_archived'},limitation:definition.limitation}
}
