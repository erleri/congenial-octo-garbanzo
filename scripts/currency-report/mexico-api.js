// Fixed, read-only official probes. Never return URLs containing keys, headers,
// raw bodies, provider error text or native fetch errors to storage/logs/UI.
import {validDate} from './core.js'
import {readOfficialJson} from './official-json-transport.js'

export const MEXICO_PROBES=Object.freeze({
  banxico:{id:'banxico',seriesId:'SF61745',label:'정책 목표금리',dataRole:'policy_background_pending_review'},
  inegi:{id:'inegi',seriesId:'1002000001',label:'공식 API 예제: 인구',dataRole:'authentication_sample_not_report_material'},
})
const number=v=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&/^-?\d+(?:\.\d+)?$/.test(v)?Number(v):null
const fault=(provider,checkedAt,status,httpStatus=null,authentication='unknown')=>({version:'mexico-api-check/1',provider,
  checkedAt,status,httpStatus,authentication,dataStatus:'not_verified',seriesId:MEXICO_PROBES[provider].seriesId,
  label:MEXICO_PROBES[provider].label,dataRole:MEXICO_PROBES[provider].dataRole,observations:[],
  observedAt:null,publishedAt:null,modelCalls:0,newPaidCostUsd:0,publicationApproved:false})

function project(provider,body,checkedAt) {
  const definition=MEXICO_PROBES[provider]
  if(provider==='banxico') {
    const series=body?.bmx?.series
    if(!Array.isArray(series)||series.length!==1||series[0].idSerie!==definition.seriesId||!Array.isArray(series[0].datos)||series[0].datos.length>8)
      throw new Error('schema_changed')
    const observations=series[0].datos.map(row=>{
      const match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(row.fecha??''),date=match?`${match[3]}-${match[2]}-${match[1]}`:null
      if(!validDate(date)||date>checkedAt.slice(0,10))throw new Error('schema_changed')
      return {period:date,value:number(row.dato)}
    })
    return {observations,unit:'percent_per_year',providerReportedUpdate:null}
  }
  if(body?.Header?.[0]?.Msg||body?.ERROR)throw new Error('provider_rejected')
  const series=body?.Series
  if(!Array.isArray(series)||series.length!==1||String(series[0].INDICADOR)!==definition.seriesId
    ||!Array.isArray(series[0].OBSERVATIONS)||series[0].OBSERVATIONS.length>24)throw new Error('schema_changed')
  const observations=series[0].OBSERVATIONS.map(row=>{
    const period=row.TIME_PERIOD
    if(typeof period!=='string'||!/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(period)||period>checkedAt.slice(0,period.length)
      ||!['0','00'].includes(String(row.COBER_GEO)))throw new Error('schema_changed')
    return {period,value:number(row.OBS_VALUE)}
  })
  return {observations,unit:'provider_unit_code_'+String(series[0].UNIT).replace(/[^0-9]/g,'').slice(0,8),
    providerReportedUpdate:null}
}

export async function probeMexicoApi({provider,token,fetchImpl=fetch,now=()=>new Date().toISOString(),timeoutMs=20000}) {
  if(!MEXICO_PROBES[provider]||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>20000)throw new Error('invalid_mexico_probe')
  const checkedAt=now()
  if(typeof checkedAt!=='string'||!validDate(checkedAt.slice(0,10))||!Number.isFinite(Date.parse(checkedAt)))throw new Error('invalid_probe_time')
  const pattern=provider==='banxico'?/^[A-Za-z0-9]{64}$/:/^[A-Za-z0-9-]{20,128}$/
  if(!token)return {...fault(provider,checkedAt,'missing_credentials',null,'not_configured'),networkCalls:0}
  if(typeof token!=='string'||!pattern.test(token))return {...fault(provider,checkedAt,'invalid_local_format',null,'not_tested'),networkCalls:0}
  const url=provider==='banxico'?'https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF61745/datos/oportuno?mediaType=json'
    :`https://www.inegi.org.mx/app/api/indicadores/desarrolladores/jsonxml/INDICATOR/1002000001/es/00/true/BISE/2.0/${token}?type=json`
  const response=await readOfficialJson({url,headers:provider==='banxico'?{'Bmx-Token':token}:{},secrets:[token],fetchImpl,timeoutMs})
  const httpStatus=response.httpStatus
  if(response.status!=='ok')return {...fault(provider,checkedAt,response.status,httpStatus,httpStatus===401?'rejected':'unknown'),networkCalls:1}
  let projected
  try{projected=project(provider,response.payload,checkedAt)}catch(error){return {...fault(provider,checkedAt,error.message==='provider_rejected'?'provider_rejected':'schema_changed',httpStatus),networkCalls:1}}
  const dataStatus=!projected.observations.length?'empty_result':projected.observations.every(o=>o.value===null)?'values_missing':'verified_response'
  return {...fault(provider,checkedAt,dataStatus==='verified_response'?'ok':dataStatus,httpStatus,dataStatus==='verified_response'?'accepted':'unknown'),...projected,
    dataStatus,networkCalls:1,retries:0,limitation:provider==='banxico'
      ?'자료 날짜는 정책금리 적용일이며 정책 발표시각·소비자 대출금리·환율 원인이 아닙니다.'
      :'공식 예제 지표로 인증과 자료 조회만 확인했습니다. 소매·물가 리포트 입력으로 사용하지 않습니다.'}
}
