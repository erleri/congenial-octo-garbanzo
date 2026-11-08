import { describe,it,expect } from 'vitest'
import { historyRoute,reportHistoryHash,periodBounds,encodeReportCursor,decodeReportCursor,validReportDate } from './reportHistory'
describe('history addresses and calendar boundaries',()=>{
 it('preserves filters and rejects ambiguous or nonexistent dates rather than choosing another report',()=>{
  expect(historyRoute(reportHistoryHash('PEN',{year:2024,month:2}))).toEqual({currency:'PEN',year:2024,month:2,includeTest:false})
  expect(periodBounds({year:2024,month:2})).toEqual({start:'2024-02-01',end:'2024-02-29'})
  expect(validReportDate('2026-02-29')).toBe(false)
  for(const hash of ['#report/ARP/history','#report/CLP/history?month=2','#report/CLP/history?year=2026&month=13','#report/CLP/history?year=2026&year=2025'])expect(historyRoute(hash)).toBeNull()
 })
 it('binds continuation to currency period and test-data scope',()=>{
  const query={currency:'CLP' as const,year:2026},cursor=encodeReportCursor(query,'2026-09-10')
  expect(decodeReportCursor({...query,cursor})).toBe('2026-09-10')
  for(const change of [{currency:'MXN' as const},{year:2025},{includeTest:true}])expect(()=>decodeReportCursor({...query,...change,cursor})).toThrow('invalid_cursor')
 })
})
