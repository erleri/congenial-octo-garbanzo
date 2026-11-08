import {readOfficialJson} from './official-json-transport.js'

const clean=value=>typeof value==='string'?value.replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,1600):''
const code=value=>typeof value==='string'&&/^\d{1,12}$/.test(value)
const CATALOGS=['CL_INDICATOR','CL_UNIT','CL_FREQ','CL_SOURCE','CL_NOTE']
export async function fetchInegiMetadata({token,catalog='CL_INDICATOR',id,source='BIE-BISE',filter='all',fetchImpl=fetch,now=()=>new Date().toISOString()}) {
  if(!CATALOGS.includes(catalog)||!(id==='null'||code(id))||!['BIE','BISE','BIE-BISE'].includes(source)||!['all','retail_and_prices'].includes(filter))throw new Error('invalid_inegi_metadata_request')
  const checkedAt=now(),resource={kind:'metadata',catalog,id,source,version:'2.0'}
  if(typeof token!=='string'||!/^[A-Za-z0-9-]{20,128}$/.test(token))return {status:'missing_or_invalid_credentials',resource,checkedAt,rows:[],networkCalls:0}
  const url=`https://www.inegi.org.mx/app/api/indicadores/desarrolladores/jsonxml/${catalog}/${id}/es/${source}/2.0/${token}?type=json`
  // One-time definition discovery has a separate bounded metadata allowance.
  // Ordinary series and single-code metadata retain the smaller transport cap.
  const response=await readOfficialJson({url,secrets:[token],fetchImpl,maxBytes:id==='null'?32_000_000:1_000_000})
  const common={version:'inegi-metadata/1',resource,checkedAt,httpStatus:response.httpStatus,networkCalls:1,modelCalls:0,newPaidCostUsd:0}
  if(response.status!=='ok')return {...common,status:response.status,rows:[]}
  const body=response.payload
  if(body?.id!==catalog||!Array.isArray(body.CODE)||body.CODE.length>200_000)return {...common,status:'schema_changed',rows:[]}
  const rows=body.CODE.flatMap(row=>{
    const value=String(row.value??''),label=clean(row.Description)
    if(!code(value)||!label||id!=='null'&&value!==id)return []
    if(filter==='retail_and_prices'&&!/comercio al por menor|ingresos.*(?:minorista|menor)|precios al consumidor|inflaci[oó]n/i.test(label))return []
    return [{code:value,label}]
  })
  return {...common,status:rows.length?'ok':'empty_result',totalCatalogRows:body.CODE.length,rows:rows.slice(0,500),
    omittedRows:Math.max(0,rows.length-500),rowFieldNames:body.CODE[0]?Object.keys(body.CODE[0]).filter(k=>/^[A-Za-z_]{1,50}$/.test(k)).slice(0,30):[],definitionApproved:false}
}

export async function fetchInegiSeries({token,indicatorId,source='BIE-BISE',recent=true,fetchImpl=fetch,now=()=>new Date().toISOString()}) {
  if(!code(indicatorId)||!['BISE','BIE-BISE'].includes(source)||typeof recent!=='boolean')throw new Error('invalid_inegi_series_request')
  const checkedAt=now(),resource={kind:'indicator',indicatorId,source,version:'2.0',geography:'00',recent}
  const common={version:'inegi-series/1',provider:'inegi',resource,checkedAt,seriesId:indicatorId,modelCalls:0,newPaidCostUsd:0,publicationApproved:false}
  if(typeof token!=='string'||!/^[A-Za-z0-9-]{20,128}$/.test(token))return {...common,status:'missing_or_invalid_credentials',observations:[],networkCalls:0}
  const url=`https://www.inegi.org.mx/app/api/indicadores/desarrolladores/jsonxml/INDICATOR/${indicatorId}/es/00/${recent}/${source}/2.0/${token}?type=json`
  const result=await readOfficialJson({url,secrets:[token],fetchImpl})
  if(result.status!=='ok')return {...common,status:result.status,httpStatus:result.httpStatus,observations:[],networkCalls:1}
  const series=result.payload?.Series
  if(!Array.isArray(series)||series.length!==1||String(series[0].INDICADOR)!==indicatorId||!Array.isArray(series[0].OBSERVATIONS)
    ||series[0].OBSERVATIONS.length>1500)return {...common,status:'schema_changed',httpStatus:result.httpStatus,observations:[],networkCalls:1}
  const record=series[0],observations=[];const seen=new Set()
  for(const row of record.OBSERVATIONS) {
    const raw=String(row.TIME_PERIOD??''),match=/^(\d{4})[\/-](0[1-9]|1[0-2])$/.exec(raw),period=match?`${match[1]}-${match[2]}`:/^\d{4}$/.test(raw)?raw:null
    if(!period||period>checkedAt.slice(0,period.length)||!['0','00'].includes(String(row.COBER_GEO))||seen.has(period))
      return {...common,status:'schema_changed',httpStatus:result.httpStatus,observations:[],networkCalls:1}
    seen.add(period)
    const value=typeof row.OBS_VALUE==='number'&&Number.isFinite(row.OBS_VALUE)?row.OBS_VALUE:
      /^-?\d+(?:\.\d+)?$/.test(String(row.OBS_VALUE??''))?Number(row.OBS_VALUE):null
    observations.push({period,sourcePeriod:raw,value,statusCode:clean(row.OBS_STATUS).slice(0,40)||null})
  }
  observations.sort((a,b)=>a.period.localeCompare(b.period))
  return {...common,status:observations.some(o=>o.value!==null)?'ok':observations.length?'values_missing':'empty_result',httpStatus:result.httpStatus,
    authentication:observations.some(o=>o.value!==null)?'accepted':'unknown',dataStatus:'series_response_pending_definition_review',
    frequencyCode:clean(record.FREQ).slice(0,40),unitCode:clean(record.UNIT).slice(0,160),noteCodes:clean(record.NOTE).slice(0,320),
    sourceCodes:clean(record.SOURCE).slice(0,160),lastUpdateDisplay:clean(record.LASTUPDATE).slice(0,80),
    observations:observations.slice(-25),totalObservations:observations.length,retainedWindow:'last_25_observations',
    publishedAt:null,observedAt:null,sourceVersion:'current_series_not_archived',networkCalls:1}
}
