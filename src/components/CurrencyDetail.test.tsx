import {renderToStaticMarkup} from 'react-dom/server'
import {expect,it} from 'vitest'
import CurrencyDetail from './CurrencyDetail'
import type {DailyRate,ExchangeRateDataset} from '../types/exchangeRate'

it('keeps the selected month values and imputation labels inside an initially collapsed table after the report link',()=>{
  const row=(date:string,value:number,imputed=false):DailyRate=>({date,value,currency:'CLP',rateType:'LOCAL_PER_USD',year:2026,month:Number(date.slice(5,7)),day:Number(date.slice(8)),status:'ok',source:imputed?'IMPUTED':'API',imputationMethod:imputed?'FFILL':'NONE'})
  const data={dailyRates:[row('2026-10-31',555.5),row('2026-11-01',987.8,true),row('2026-11-02',993.8)],monthlyRates:[]} as unknown as ExchangeRateDataset
  const html=renderToStaticMarkup(<CurrencyDetail data={data} currencyFilter="CLP" periodFrom="2026-11" periodTo="2026-11" rangeNotice={null} relatedReport={<a href="#report/CLP">관련 리포트 읽기</a>}/>)
  const table=html.slice(html.indexOf('<table'))
  expect(table).toContain('2026.11')
  expect(table).toContain('987.8')
  expect(table).toContain('993.8')
  expect(table).toContain('보정')
  expect(table).not.toContain('555.5')
  expect(html.match(/<details[^>]*>/)?.[0]).not.toContain('open=')
  expect(html.indexOf('관련 리포트 읽기')).toBeLessThan(html.indexOf('<details'))
})
