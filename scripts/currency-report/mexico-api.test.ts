import {describe,it,expect,vi} from 'vitest'
import {probeMexicoApi} from './mexico-api.js'
const token='X'.repeat(64),now=()=> '2026-10-27T14:00:00Z'
const banxico={bmx:{series:[{idSerie:'SF61745',datos:[{fecha:'26/10/2026',dato:'6.5'}]}]}}
const inegi={Header:{Email:'institution@example.org'},Series:[{INDICADOR:'1002000001',UNIT:'151',OBSERVATIONS:[{TIME_PERIOD:'2025',OBS_VALUE:'130000000',COBER_GEO:'0'}]}]}

describe('Mexico credential-bearing request boundary',()=>{
  it('uses the Banxico header and persists only validated date/value observations',async()=>{
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify(banxico)))
    const result=await probeMexicoApi({provider:'banxico',token,now,fetchImpl})
    expect(fetchImpl.mock.calls[0][0]).not.toContain(token)
    expect(fetchImpl.mock.calls[0][1].headers['Bmx-Token']).toBe(token)
    expect(result).toMatchObject({status:'ok',authentication:'accepted',observations:[{period:'2026-10-26',value:6.5}],publishedAt:null})
    expect(JSON.stringify(result)).not.toContain(token)
  })
  it('contains the required INEGI path token only inside the request and labels the example outside report inputs',async()=>{
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify(inegi)))
    const result=await probeMexicoApi({provider:'inegi',token,now,fetchImpl})
    expect(fetchImpl.mock.calls[0][0]).toContain(token)
    expect(result).toMatchObject({status:'ok',authentication:'accepted',dataRole:'authentication_sample_not_report_material'})
    expect(JSON.stringify(result)).not.toContain('institution@example.org')
    expect(JSON.stringify(result)).not.toContain(token)
    expect(JSON.stringify(result)).not.toContain('https://')
  })
  it.each([[401,'authentication_failed','rejected'],[403,'access_denied','unknown'],[429,'rate_limited','unknown'],[503,'provider_unavailable','unknown']])(
    'keeps HTTP %s as %s with authentication %s and no error body',async(status,expected,authentication)=>{
      const fetchImpl=vi.fn(async()=>new Response(`Provider error includes ${token}`,{status}))
      const result=await probeMexicoApi({provider:'inegi',token,now,fetchImpl})
      expect(result).toMatchObject({status:expected,authentication,networkCalls:1})
      expect(fetchImpl).toHaveBeenCalledTimes(1);expect(JSON.stringify(result)).not.toContain(token)
    })
  it('does not grant authentication for HTML, credential echoes, redirects or a different series',async()=>{
    const read=body=>probeMexicoApi({provider:'banxico',token,now,fetchImpl:async()=>new Response(body)})
    expect((await read('<html>access blocked</html>')).status).toBe('invalid_json')
    expect((await read(JSON.stringify({token,...banxico}))).status).toBe('credential_echo_blocked')
    expect((await read(JSON.stringify({bmx:{series:[{idSerie:'SF43718',datos:[]}]}}))).status).toBe('schema_changed')
    expect(await read(JSON.stringify({bmx:{series:[{idSerie:'SF61745',datos:[]}]}}))).toMatchObject({status:'empty_result',authentication:'unknown'})
    expect(await read(JSON.stringify({bmx:{series:[{idSerie:'SF61745',datos:[{fecha:'26/10/2026',dato:'N/E'}]}]}}))).toMatchObject({status:'values_missing',authentication:'unknown'})
    const response=new Response(JSON.stringify(banxico));Object.defineProperty(response,'redirected',{value:true})
    expect((await probeMexicoApi({provider:'banxico',token,now,fetchImpl:async()=>response})).status).toBe('redirect_blocked')
  })
  it('does not leak native request URLs on transport failure or call with missing keys',async()=>{
    const fetchImpl=vi.fn(async()=>{throw new Error(`secret request https://example.org/${token}`)})
    const failure=await probeMexicoApi({provider:'inegi',token,now,fetchImpl})
    expect(failure.status).toBe('connection_failed');expect(JSON.stringify(failure)).not.toContain(token)
    const missing=await probeMexicoApi({provider:'banxico',token:'',now,fetchImpl})
    expect(missing).toMatchObject({status:'missing_credentials',networkCalls:0})
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
