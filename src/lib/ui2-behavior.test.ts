import { describe, expect, it } from 'vitest'
import { datasetStatus, elapsedBusinessDays } from './dataStatus'
import { pageTitle, recentMonthRange } from './pageContext'
import { parseFxNavigation } from './fxNavigation'
import { claimPresentation } from './reports/claimPresentation'
import { usagePayload, pageUsage } from './usage'
import type { ExchangeRateDataset } from '../types/exchangeRate'
import type { CurrencyReport, ReportClaim } from '../types/currencyReport'

describe('UI 2.0 trust and navigation rules',()=>{
  it('does not certify a successful old or unproven dataset as fresh, and respects supplied closures',()=>{
    const data={baseDate:'2026-09-12',dailyRates:[]} as unknown as ExchangeRateDataset
    expect(datasetStatus(data,Date.parse('2026-10-31T01:00:00Z')).state).toBe('late')
    expect(datasetStatus({...data,baseDate:'2026-10-30'},Date.parse('2026-10-31T01:00:00Z')).state).toBe('unverified')
    expect(elapsedBusinessDays('2026-10-30','2026-11-02',['2026-11-02'])).toBe(0)
    expect(datasetStatus({...data,baseDate:'2099-01-01'}).state).toBe('unknown')
    expect(datasetStatus(null).state).toBe('unknown')
  })
  it('accepts early same-day data without changing the release calendar or certifying its price basis',()=>{
    const data={baseDate:'2026-11-09',dailyRates:[]} as unknown as ExchangeRateDataset
    const calendar={timeZone:'UTC',closedDates:[],releaseHour:18,maxBusinessDays:2}
    for(const instant of ['2026-11-09T00:00:00Z','2026-11-09T12:07:00Z','2026-11-09T18:01:00Z']){
      expect(datasetStatus(data,Date.parse(instant),calendar).state).toBe('unverified')
    }
    expect(datasetStatus({...data,baseDate:'2026-11-10'},Date.parse('2026-11-09T23:59:00Z'),calendar).state).toBe('unknown')
    expect(datasetStatus({...data,baseDate:'invalid'},Date.parse('2026-11-09T12:00:00Z'),calendar).state).toBe('unknown')
    expect(datasetStatus({...data,baseDate:'2026-11-06'},Date.parse('2026-11-09T12:00:00Z'),calendar).state).toBe('unverified')
    expect(datasetStatus({...data,baseDate:'2026-11-02'},Date.parse('2026-11-09T12:00:00Z'),calendar).state).toBe('late')
    expect(calendar.releaseHour).toBe(18)
  })
  it('preserves currency and report context in titles and clamps quick periods at the available start',()=>{
    const hash='#report/CLP/history'
    expect(pageTitle(parseFxNavigation(hash),hash)).toBe('CLP 리포트 목록 · LATAM FX')
    expect(pageTitle(parseFxNavigation('#report/MXN/2026-10-28'),'#report/MXN/2026-10-28')).toContain('MXN 2026-10-28')
    expect(recentMonthRange('2026-02',3,'2020-01')).toEqual({from:'2025-12',to:'2026-02'})
    expect(recentMonthRange('2026-02',12,'2026-01')).toEqual({from:'2026-01',to:'2026-02'})
  })
  it('renders linked fact bases equally across currencies without changing the preserved sentence',()=>{
    const claim:ReportClaim={title:'통계',text:'기존 문장',kind:'interpretation',factIds:['retail_basis'],evidenceIds:['source']}
    for(const currency of ['BRL','MXN','CLP','COP','PEN','ARS'] as const){
      const report={currency,facts:[{id:'retail_basis',value:1,label:'8월 · 실질 · 전년 대비'}],content:{implications:[claim]}} as CurrencyReport
      expect(claimPresentation(claim,report)).toEqual({text:'기존 문장',bases:['8월 · 실질 · 전년 대비'],evidenceIds:['source']})
      expect(claim.text).toBe('기존 문장')
    }
  })
  it('restricts anonymous metrics to public dimensions and excludes management routes',()=>{
    expect(pageUsage(parseFxNavigation('#admin'))).toBeNull()
    expect(pageUsage(parseFxNavigation('#admin/plan'))).toBeNull()
    expect(usagePayload({event:'report_open',screen:'reports',currency:'CLP'})).toBeNull()
    expect(usagePayload({event:'report_open',screen:'reports',currency:'CLP',reportId:'<script>'})).toBeNull()
    const input={event:'report_open' as const,screen:'reports' as const,currency:'CLP' as const,reportId:'CLP-2026-10-09-1791893507884',email:'never-send@example.test',url:'https://private.test/?key=secret'}
    const payload=usagePayload(input)
    expect(payload).toEqual({p_event:'report_open',p_screen:'reports',p_currency:'CLP',p_report_id:input.reportId,p_view:'',p_entry_source:'direct_or_unknown'})
    expect(JSON.stringify(payload)).not.toMatch(/email|private|secret/)
  })
})
