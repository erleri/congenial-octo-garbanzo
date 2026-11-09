import { describe, expect, it } from 'vitest'
import { initialFxNavigation, parseFxNavigation, selectTrendCurrency, trendHash, safeTrendReturn } from './fxNavigation'

describe('shared FX navigation contract',()=>{
  it('round-trips both date granularities and a separate monthly ALL selection',()=>{
    const current={...initialFxNavigation,screen:'trends' as const,view:'monthly' as const,currency:'CLP' as const,monthlyCurrency:'ALL' as const,from:'2026-08',to:'2026-09',yearFrom:2025,yearTo:2026}
    expect(parseFxNavigation(trendHash(current))).toEqual(current)
    const individual=selectTrendCurrency(current,'MXN')
    expect(individual).toMatchObject({currency:'MXN',monthlyCurrency:'MXN'})
    expect(selectTrendCurrency(individual,'ALL')).toMatchObject({currency:'MXN',monthlyCurrency:'ALL'})
  })
  it('keeps trend memory while moving through existing report/mail/admin routes',()=>{
    const previous={...initialFxNavigation,currency:'PEN' as const,from:'2026-08',to:'2026-09'}
    for(const [hash,screen] of [['#report/CLP/2026-10-09','reports'],['#mailing','admin'],['#admin/plan','plan'],['#dashboard','dashboard']]){
      expect(parseFxNavigation(hash,previous)).toMatchObject({...previous,screen})
    }
  })
  it('rejects unsupported filter values and external return destinations',()=>{
    expect(parseFxNavigation('#trends?currency=ARP&monthly=private&from=2026-99&to=wrong&yearFrom=secret&view=unknown')).toMatchObject({currency:'BRL',monthlyCurrency:'BRL',from:'',to:'',yearFrom:null,view:'daily'})
    for(const target of [null,123,'https://example.com','#report/CLP',`#trends?${'x'.repeat(513)}`])expect(safeTrendReturn(target)).toBeNull()
    expect(safeTrendReturn('#trends?view=monthly&currency=CLP')).toBe('#trends?view=monthly&currency=CLP')
  })
})

it('shares a single-currency URL while respecting explicit dual selections and period memory',()=>{
  expect(initialFxNavigation).toMatchObject({currency:'BRL',monthlyCurrency:'BRL'})
  expect(parseFxNavigation('#trends?currency=MXN')).toMatchObject({currency:'MXN',monthlyCurrency:'MXN'})
  const explicit=parseFxNavigation('#trends?view=monthly&currency=CLP&monthly=ALL&from=2026-09&to=2026-11&yearFrom=2025&yearTo=2026')
  expect(parseFxNavigation(trendHash({...explicit,view:'daily'}))).toMatchObject({currency:'CLP',monthlyCurrency:'ALL'})
  expect(selectTrendCurrency(explicit,'PEN')).toMatchObject({currency:'PEN',monthlyCurrency:'PEN',from:'2026-09',to:'2026-11',yearFrom:2025,yearTo:2026})
})
