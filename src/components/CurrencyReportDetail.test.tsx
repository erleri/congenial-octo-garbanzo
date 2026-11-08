import {renderToStaticMarkup} from 'react-dom/server'
import {expect,it} from 'vitest'
import CurrencyReportDetail from './CurrencyReportDetail'
import {syntheticDbReport} from '../../scripts/currency-report/local-db.js'
import {REPORT_CURRENCIES,approvedSelection,reportRoute} from '../lib/currencyReportAccess'
import {REPORT_COUNTRIES} from '../local-report/countries'
import type {CurrencyReport, CurrencyReportSummary} from '../types/currencyReport'

it('does not present an empty or causal headline for a periodic check supported only by business context',()=>{
  const report={...syntheticDbReport('PEN','2098-11-28',1),purpose:'periodic_check'} as CurrencyReport
  report.content.implications=[{...report.content.drivers[0],title:'확인한 소비 여건'}]
  report.content.drivers=[]
  const html=renderToStaticMarkup(<CurrencyReportDetail report={report} onBack={()=>{}}/>)
  expect(html).not.toContain('왜 움직였나')
  expect(html).not.toContain('why-column')
  expect(html).toContain('확인한 소비 여건')
  report.content.drivers=[{...report.content.implications[0]}]
  expect(renderToStaticMarkup(<CurrencyReportDetail report={report} onBack={()=>{}}/>)).toContain('이번 점검 배경')
})

it('labels a current report-only verified price separately from the legacy dashboard collection note',()=>{
  const report={...syntheticDbReport('BRL','2098-11-28',1),testOnly:false,observedDate:'2098-11-27',
    marketData:{fetchedAt:'2098-11-28T05:00:00Z',source:'UNKNOWN',rateType:'LOCAL_PER_USD',reportPriceBasis:{sourceAdapter:'brl-publisher-close/1',provider:'CNN Brasil (com informações da Reuters)',priceKind:'reported_spot_close',dateBasis:'publisher_stated_local_session_day',observations:[{localSessionDate:'2098-11-27'}]}},
    comparison:{inputHash:'synthetic',label:'Synthetic current draft',model:'Synthetic model',costUsd:0,average:null,preferred:false,provisional:true,publicationBlocked:true,historicalReview:false}} as unknown as CurrencyReport
  const html=renderToStaticMarkup(<CurrencyReportDetail report={report} onBack={()=>{}}/>)
  expect(html).toContain('리포트용 검증 가격 자료 수집')
  expect(html).toContain('현물시장 종가 보도값')
  expect(html).not.toContain('과거 사례 사후 검토')
  expect(html).not.toContain('운영 환율 수집')
})

it('renders all six approved currency routes while rejecting draft substitution and unsupported currencies',()=>{
  for(const currency of REPORT_CURRENCIES){
    const report={...syntheticDbReport(currency,'2098-11-28',1),status:'approved',publishedAt:'2098-11-28T12:00:00Z'} as CurrencyReport
    report.series=[{date:'2098-11-01',value:100},{date:'2098-11-27',value:102},{date:'2098-11-28',value:101}]
    const summary={...report,title:report.content.title,summary:report.content.summary} as CurrencyReportSummary
    expect(reportRoute(`#report/${currency}/2098-11-28`)?.currency).toBe(currency)
    expect(approvedSelection([summary],`#report/${currency}`)?.id).toBe(report.id)
    expect(approvedSelection([{...summary,status:'pending_review'}],`#report/${currency}`)).toBeUndefined()
    const html=renderToStaticMarkup(<CurrencyReportDetail report={report} onBack={()=>{}}/>)
    expect(html).toContain(REPORT_COUNTRIES[currency].name)
    expect(html).toContain('점 사이의 경로는 추정하지 않습니다')
    expect(html).not.toContain('<path d=')
  }
  expect(reportRoute('#report/ARP')).toBeNull()
  expect(reportRoute('#report/USD')).toBeNull()
})
