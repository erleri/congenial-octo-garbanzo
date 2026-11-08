import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
vi.hoisted(()=>vi.stubGlobal('__LOCAL_CURRENCY_REPORTS__',true))
vi.mock('../buildInfo',()=>({buildInfo:{commit:'test',branch:'local',builtAt:'2026-10-31T00:00:00Z'}}))
vi.mock('../hooks/useExchangeData',()=>({useExchangeData:()=>({dataset:null,error:'fixture_fx_failure',datasetSource:'none',businessPlanStatus:{},businessPlan:{},filters:{},refreshData:()=>Promise.resolve()})}))
vi.mock('../hooks/useDashboardReports',()=>({useDashboardReports:()=>({items:[],archives:[],verified:false,now:Date.now(),state:'ready'})}))
import App from '../App'
beforeEach(()=>vi.stubGlobal('__LOCAL_CURRENCY_REPORTS__',true))
describe('independent public screens during an FX outage',()=>{
  it('keeps the report route outside FX failure UI and gives the FX route an explicit retry',async()=>{
    vi.stubGlobal('window',{location:{hash:'#report',href:'http://127.0.0.1/#report'}})
    const reports=renderToString(<App/>)
    expect(reports).not.toContain('환율을 불러오지 못했습니다.')
    expect(reports).not.toContain('정적 데이터와 원격 응답')
    vi.stubGlobal('window',{location:{hash:'#dashboard',href:'http://127.0.0.1/#dashboard'}})
    const dashboard=renderToString(<App/>)
    expect(dashboard).toContain('환율을 불러오지 못했습니다.')
    expect(dashboard).toContain('다시 시도')
    expect(dashboard).toContain('환율 리포트')
  })
})
