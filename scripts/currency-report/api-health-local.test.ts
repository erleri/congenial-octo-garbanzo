import {describe,it,expect} from 'vitest'
import {projectApiHealth,API_SERVICES} from './api-health-local.js'
const check=(extra={})=>({provider:'banxico',seriesId:'SF61745',httpStatus:200,checkedAt:'2026-10-27T13:00:00Z',status:'ok',authentication:'accepted',
  dataStatus:'verified_response',observations:[{period:'2026-10-27',value:6.5}],...extra})
const run=(checks:object[])=>({version:'mexico-api-local-check/1',checks})

describe('Local API health projection',()=>{
  it('projects known labels and safe statuses only, discarding URLs, raw errors, credentials and arbitrary metadata',()=>{
    const secret='private-synthetic-credential'
    const result=projectApiHealth([run([check({token:secret,url:`https://example.org/${secret}`,message:secret,
      label:secret})])],'2026-10-27T14:00:00Z')
    const provider=result.providers.find(p=>p.id==='banxico')!
    expect(provider).toMatchObject({name:'Banxico SIE',status:'sample_ok',errorType:null,sample:{seriesId:'SF61745',observationCount:1}})
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(result.providers.filter(p=>p.status==='not_checked')).toHaveLength(API_SERVICES.length-1)
  })
  it('shows a new failure while preserving prior success and does not call an old successful sample healthy now',()=>{
    const previous=check({checkedAt:'2026-10-25T13:00:00Z'})
    const failure=check({checkedAt:'2026-10-26T13:00:00Z',status:'timeout',authentication:'unknown',dataStatus:'not_verified'})
    const result=projectApiHealth([run([previous]),run([failure])],'2026-10-27T14:00:00Z').providers.find(p=>p.id==='banxico')!
    expect(result).toMatchObject({status:'check_failed',errorType:'timeout',checkedAt:failure.checkedAt,lastSuccessAt:previous.checkedAt,outdated:true,sample:null})
  })
  it('keeps missing configuration, unknown services, future checks and unverified HTTP success distinct',()=>{
    const result=projectApiHealth([run([check({provider:'openrouter'}),check({checkedAt:'2026-10-28T13:00:00Z'}),
      check({provider:'inegi',status:'missing_credentials',authentication:'not_configured'})])],'2026-10-27T14:00:00Z')
    expect(result.providers.find(p=>p.id==='banxico')!.status).toBe('not_checked')
    expect(result.providers.find(p=>p.id==='openrouter')!.status).toBe('not_checked')
    expect(result.providers.find(p=>p.id==='inegi')).toMatchObject({status:'needs_configuration',errorType:'missing_credentials'})
    const invalid=projectApiHealth([run([check({authentication:'unknown'})])],'2026-10-27T14:00:00Z')
    expect(invalid.providers.find(p=>p.id==='banxico')).toMatchObject({status:'check_failed',errorType:'schema_changed',lastSuccessAt:null})
    const wrongSeries=projectApiHealth([run([check({seriesId:'SF43718'})])],'2026-10-27T14:00:00Z')
    expect(wrongSeries.providers.find(p=>p.id==='banxico')!.status).toBe('check_failed')
  })
})
