import {renderToStaticMarkup} from 'react-dom/server'
import {expect,it} from 'vitest'
import MovingComparisonTable from './MovingComparisonTable'
import {comparisonPresentationRows} from '../lib/comparisonPresentation'
import {buildMovingComparisonRows} from '../lib/moving'
import type {ExchangeRateDataset,MovingComparisonRow} from '../types/exchangeRate'
it('keeps shared calculations and admin order while readers get summary first and valid dates only',()=>{
 const data={baseDate:'2026-02-08',fetchedAt:'2026-02-08T12:00:00Z',movingComparison:[],dailyRates:[{date:'2026-02-01',currency:'BRL',year:2026,month:2,day:1,rateType:'LOCAL_PER_USD',value:5,status:'ok',source:'API',imputationMethod:'NONE'}],monthlyRates:[]} as ExchangeRateDataset
 const rows=buildMovingComparisonRows(data,2026,2,{leading:{},moving:{}})
 const before=JSON.stringify(rows)
 const grouped=comparisonPresentationRows(rows,data.baseDate)
 expect(grouped.summary.map(r=>r.label)).toEqual(['평균(실적)','누적(1월~현재)','선행','선행 대비','이동','이동 대비','전년 동월 누적','전년 동월 대비'])
 expect(grouped.daily.map(r=>r.label)).toEqual(Array.from({length:8},(_,i)=>`${i+1}일`))
 expect(JSON.stringify(rows)).toBe(before)
 const admin=renderToStaticMarkup(<MovingComparisonTable data={data} businessPlan={{leading:{},moving:{}}}/>)
 const reader=renderToStaticMarkup(<MovingComparisonTable data={data} businessPlan={{leading:{},moving:{}}} presentation="summary-first"/>)
 expect(admin.indexOf('>1일<')).toBeLessThan(admin.indexOf('평균(실적)'))
 expect(admin).toContain('>31일<')
 expect(reader.indexOf('평균(실적)')).toBeLessThan(reader.indexOf('>1일<'))
 expect(reader).not.toMatch(/<details[^>]* open/)
 expect(reader).not.toContain('>29일<')
 expect(comparisonPresentationRows([{...rows[0],label:'12일',values:{BRL:5}} as MovingComparisonRow],data.baseDate).daily).toHaveLength(1)
})
