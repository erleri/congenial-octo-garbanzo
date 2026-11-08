import { describe, expect, it } from 'vitest'
import { reportBadge } from './reportFreshness'
import type { CurrencyReportSummary } from '../types/currencyReport'
const sample:CurrencyReportSummary={id:'public',currency:'CLP',baseDate:'2026-09-10',observedDate:'2026-09-10',generationMode:'ai_enhanced',status:'approved',title:'Stored report',summary:'Public',publishedAt:'2026-10-30T14:59:00Z'}
describe('public report freshness in Korea',()=>{
  it('uses actual publication time across KST midnight, independently of report date',()=>{
    expect(reportBadge(sample,Date.parse('2026-10-30T14:59:30Z'),true)).toBe('새 리포트')
    expect(reportBadge(sample,Date.parse('2026-10-30T15:00:00Z'),true)).toBeNull()
    expect(reportBadge({...sample,publishedAt:'2026-10-30T23:59:00+09:00'},Date.parse('2026-10-30T14:59:30Z'),true)).toBe('새 리포트')
    expect(reportBadge(sample,Date.parse('2026-10-30T14:58:00Z'),true)).toBeNull()
  })
  it('requires verified public metadata and never infers newness from drafts/fixtures/missing time',()=>{
    const now=Date.parse('2026-10-30T14:59:30Z')
    expect(reportBadge(sample,now,false)).toBeNull()
    for(const modified of [{publishedAt:null},{publishedAt:'2026-10-30'},{publishedAt:'broken'},{testOnly:true},{historicalReview:true},{status:'pending_review' as const},{status:'rejected' as const},{comparison:{editorialRevision:true} as CurrencyReportSummary['comparison']}])expect(reportBadge({...sample,...modified},now,true)).toBeNull()
  })
  it('labels only explicit public corrections as corrections',()=>{
    expect(reportBadge({...sample,revisionKind:'correction'},Date.parse('2026-10-31T00:00:00Z'),true)).toBe('정정')
    expect(reportBadge({...sample,historicalReview:true,revisionKind:'correction'},Date.parse('2026-10-31T00:00:00Z'),true)).toBe('정정')
    expect(reportBadge({...sample,revisionKind:'correction'},Date.parse('2026-10-31T00:00:00Z'),false)).toBeNull()
  })
})
