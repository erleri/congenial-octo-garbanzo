import {describe,expect,it} from 'vitest'
import {parseBcchTokenFile,validateProbeRange,projectBcchApiResponse} from './bcch-api-probe-local.js'

// Invented token and response; no local secret file or external request is read.
const token='SYNTHETIC_token_FOR_TEST_ONLY'
const options={firstDate:'2026-10-14',lastDate:'2026-10-18',token,capturedAt:'2026-10-18T18:00:00Z'}
const payload=()=>({Codigo:0,Descripcion:'Success',Series:{seriesId:'F073.TCO.PRE.Z.D',Obs:[
  {indexDateString:'14-10-2026',value:'980.79',statusCode:'OK'},
  {indexDateString:'15-10-2026',value:'987.03',statusCode:'OK'},
  {indexDateString:'16-10-2026',value:'984.09',statusCode:'OK'},
  {indexDateString:'17-10-2026',value:'NaN',statusCode:'ND'},
]}})
const body=(p=payload())=>Buffer.from(JSON.stringify(p))

describe('local BCCh token probe safety and projection',()=>{
  it('reads only the explicit token field and does not allow browser-prefixed or unrelated configuration',()=>{
    expect(parseBcchTokenFile(`BCCH_API_TOKEN="${token}"`)).toBe(token)
    expect(()=>parseBcchTokenFile('BCCH_API_TOKEN=')).toThrow('token_missing')
    expect(()=>parseBcchTokenFile(`BCCH_API_TOKEN=${token}\nVITE_BCCH_TOKEN=unsafe`)).toThrow('unexpected_config_field')
    expect(()=>parseBcchTokenFile('BCCH_API_TOKEN="token with spaces"')).toThrow('invalid_token_format')
  })
  it('bounds the requested interval rather than accepting arbitrary history or nonexistent dates',()=>{
    expect(()=>validateProbeRange('2026-10-01','2026-10-26')).not.toThrow()
    for(const [first,last] of [['2026-02-30','2026-03-01'],['2026-10-16','2026-10-15'],['2026-01-01','2026-10-26']])
      expect(()=>validateProbeRange(first,last)).toThrow('invalid_probe_range')
  })
  it('keeps effective date and prior transaction day separate and leaves ND entries missing',()=>{
    const r=projectBcchApiResponse(body(),options)
    expect(r).toMatchObject({authentication:'accepted',seriesId:'F073.TCO.PRE.Z.D',publicationApproved:false})
    expect(r.observations.at(-1)).toMatchObject({effectiveDate:'2026-10-16',localSessionDate:'2026-10-15',value:984.09,
      observationWindowEndAt:'2026-10-15T19:00:00.000Z',observedAt:null,publishedAt:null})
    expect(r.missingDates).toEqual(['2026-10-17'])
    expect(JSON.stringify(r)).not.toContain(token)
    expect(JSON.stringify(r)).not.toContain('Descripcion')
  })
  it('rejects a credential echo or rejected request without forwarding the server error description',()=>{
    const echoed={...payload(),Descripcion:token}
    expect(()=>projectBcchApiResponse(body(echoed),options)).toThrow('credential_echo_in_response')
    const rejected={...payload(),Codigo:-1,Descripcion:'untrusted failure URL'}
    expect(()=>projectBcchApiResponse(body(rejected),options)).toThrow('api_rejected_request')
  })
  it('rejects duplicate dates, wrong series and successful-status NaN instead of silently accepting partial corruption',()=>{
    const duplicate=payload();duplicate.Series.Obs.push({...duplicate.Series.Obs[0]})
    expect(()=>projectBcchApiResponse(body(duplicate),options)).toThrow('invalid_api_observation_date')
    const wrong=payload();wrong.Series.seriesId='OTHER'
    expect(()=>projectBcchApiResponse(body(wrong),options)).toThrow('unexpected_api_series')
    const corrupt=payload();corrupt.Series.Obs[0].value='NaN'
    expect(()=>projectBcchApiResponse(body(corrupt),options)).toThrow('invalid_api_observation_value')
  })
})
