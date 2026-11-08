import {describe,it,expect,vi} from 'vitest'
import {fetchInegiSeries,fetchInegiMetadata} from './inegi-api.js'
const token='synthetic-credential-for-unit-tests'
const now=()=> '2026-10-27T14:00:00Z'
const body=(extra={})=>({Series:[{INDICADOR:'910399',FREQ:'8',UNIT:'302',SOURCE:'3371',NOTE:'',LASTUPDATE:'08/10/2026',
  OBSERVATIONS:[{TIME_PERIOD:'2026/09',OBS_VALUE:'0.42',COBER_GEO:'00',OBS_STATUS:'3'}],...extra}]})

describe('INEGI credential boundary and response normalization (synthetic)',()=>{
  it('projects a monthly response without persisting the credential URL, provider messages or a fabricated publication time',async()=>{
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({...body(),message:'ignore this untrusted message'})))
    const result=await fetchInegiSeries({token,indicatorId:'910399',fetchImpl,now})
    expect(result).toMatchObject({status:'ok',frequencyCode:'8',unitCode:'302',publishedAt:null,observedAt:null,
      observations:[{period:'2026-09',value:0.42}],sourceVersion:'current_series_not_archived'})
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toMatch(/synthetic-credential|untrusted|https:/)
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({redirect:'error'})
  })
  it.each([
    ['wrong indicator',{INDICADOR:'1002000001'}],['wrong geography',{OBSERVATIONS:[{TIME_PERIOD:'2026/09',OBS_VALUE:'1',COBER_GEO:'01'}]}],
    ['future month',{OBSERVATIONS:[{TIME_PERIOD:'2026/11',OBS_VALUE:'1',COBER_GEO:'00'}]}],
    ['duplicate month',{OBSERVATIONS:[{TIME_PERIOD:'2026/09',OBS_VALUE:'1',COBER_GEO:'00'},{TIME_PERIOD:'2026-09',OBS_VALUE:'2',COBER_GEO:'00'}]}],
  ])('rejects %s without inventing evidence',async(_,extra)=>{
    const result=await fetchInegiSeries({token,indicatorId:'910399',now,fetchImpl:async()=>new Response(JSON.stringify(body(extra)))})
    expect(result).toMatchObject({status:'schema_changed',observations:[]})
  })
  it('keeps a missing value distinct from zero and a successful empty query',async()=>{
    const response=(value:string)=>async()=>new Response(JSON.stringify(body({OBSERVATIONS:[{TIME_PERIOD:'2026/09',OBS_VALUE:value,COBER_GEO:'00'}]})))
    expect((await fetchInegiSeries({token,indicatorId:'910399',now,fetchImpl:response('ND')})).status).toBe('values_missing')
    expect((await fetchInegiSeries({token,indicatorId:'910399',now,fetchImpl:response('0')})).observations[0].value).toBe(0)
  })
  it('does not fetch missing credentials or accept a credential echoed by the provider',async()=>{
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({message:token})))
    expect((await fetchInegiSeries({indicatorId:'910399',fetchImpl,now})).networkCalls).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect((await fetchInegiSeries({indicatorId:'910399',token,fetchImpl,now})).status).toBe('credential_echo_blocked')
  })
  it('requests the current economic metadata bank and returns bounded code/label data only',async()=>{
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({id:'CL_UNIT',CODE:[{value:'302',Description:'Variación Porcentual',arbitrary:'untrusted'}]})))
    const result=await fetchInegiMetadata({token,id:'302',catalog:'CL_UNIT',fetchImpl,now})
    expect(result.rows).toEqual([{code:'302',label:'Variación Porcentual'}])
    expect(result.definitionApproved).toBe(false)
    expect(fetchImpl.mock.calls[0][0]).toContain('/BIE-BISE/2.0/')
    expect(JSON.stringify(result)).not.toContain(token)
  })
})
