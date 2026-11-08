import {renderToStaticMarkup} from 'react-dom/server'
import {afterEach,expect,it,vi} from 'vitest'
import PublishedCurrencyReports from './PublishedCurrencyReports'
import {REPORT_CURRENCIES} from '../lib/currencyReportAccess'

afterEach(()=>vi.unstubAllGlobals())
it('country tabs always open country collections from both a list and a report address',()=>{
  vi.stubGlobal('location',{search:''});vi.stubGlobal('history',{state:null})
  for(const hash of ['#report/BRL/history','#report/CLP/2026-10-09']){
    const html=renderToStaticMarkup(<PublishedCurrencyReports hash={hash}/>),nav=html.match(/<nav class="currency-tabs"[\s\S]*?<\/nav>/)?.[0]
    expect(nav).toBeDefined()
    for(const currency of REPORT_CURRENCIES)expect(nav).toContain(`href="#report/${currency}/history"`)
    expect(nav).not.toMatch(/href="#report\/(BRL|MXN|CLP|COP|PEN|ARS)"/)
  }
})
it('names the country collection directly and keeps report navigation inside reports',()=>{
  vi.stubGlobal('location',{search:''});vi.stubGlobal('history',{state:{fxTrendReturn:'#trends?currency=BRL'}})
  const html=renderToStaticMarkup(<PublishedCurrencyReports hash="#report/BRL/history"/>)
  expect(html).toContain('<h1>브라질 리포트</h1>')
  expect(html).not.toContain('지난 리포트')
  expect(html).not.toContain('환율 추이로')
  expect(html).not.toContain('대시보드로')
})
