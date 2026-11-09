import {renderToStaticMarkup} from 'react-dom/server'
import {expect,it} from 'vitest'
import MonthlySummary from './MonthlySummary'
import {formatCellValue} from '../lib/formatters'
import type {ExchangeRateDataset,MonthlyRate} from '../types/exchangeRate'

it('keeps the same year, unit, precision and missing-value meaning in row and comparison views',()=>{
  const row=(currency:'BRL'|'MXN',year:number,month:number,rateType:'LOCAL_PER_USD'|'KRW',value:number|null):MonthlyRate=>({currency,year,month,rateType,value,status:value===null?'empty':'ok',source:'API',imputationMethod:'NONE'})
  const rows=[row('BRL',2025,1,'LOCAL_PER_USD',5.1234),row('MXN',2025,1,'LOCAL_PER_USD',18.4321),row('BRL',2025,1,'KRW',243.36),row('BRL',2025,2,'LOCAL_PER_USD',null),row('BRL',2024,1,'LOCAL_PER_USD',999),row('BRL',2025,1,'LOCAL_PER_USD',777)]
  const data={monthlyRates:rows} as ExchangeRateDataset
  const html=renderToStaticMarkup(<MonthlySummary data={data} currencyFilter="BRL" yearFrom={2025} yearTo={2025}/>)
  const mobile=html.split('monthly-mobile-view')[1].split('monthly-desktop-view')[0]
  expect(mobile).toContain('scope="row">2025.01')
  expect(mobile).toContain('scope="row">2025.02')
  expect(mobile).toContain(formatCellValue(5.1234,'ok','BRL'))
  expect(html).toContain(formatCellValue(243.36,'ok','KRW'))
  expect(mobile).not.toContain('2024.01')
  expect(mobile).not.toContain('18.4321')
  expect(mobile).not.toContain('777')
  expect(mobile).toContain('>-</td>')
  const all=renderToStaticMarkup(<MonthlySummary data={data} currencyFilter="ALL" yearFrom={2025} yearTo={2025}/>)
  expect(all).toContain('MXN/USD')
  expect(all).toContain(formatCellValue(18.4321,'ok','MXN'))
})
