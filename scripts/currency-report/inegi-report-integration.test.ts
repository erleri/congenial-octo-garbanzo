import fs from 'node:fs'
import {describe,it,expect,vi} from 'vitest'
import {sourceSelectionFixture} from './research-source-selection-fixtures.js'
import {planResearchSourceSelection} from './research-source-selection.js'
import {collectSelectedResearch} from './selected-source-collection.js'
import {reviewSelectedStatisticMaterial} from './selected-material-review.js'
import {INEGI_REPORT_INDICATORS,inegiDefinitionId,verifyInegiReportSeries,inegiStatistic} from './inegi-report-indicators.js'
import {projectApiHealth} from './api-health-local.js'
const sourcePlan=JSON.parse(fs.readFileSync('docs/2.0/six-currency-explanation-sources-20261027.json','utf8'))
const sourceRegister=JSON.parse(fs.readFileSync('docs/2.0/six-currency-source-register-20261027.json','utf8'))
const captured=(id='retail',extra={})=>{
  const d=INEGI_REPORT_INDICATORS.find(d=>d.id===id)!
  return {version:'inegi-series/1',provider:'inegi',seriesId:d.indicatorId,status:'ok',httpStatus:200,authentication:'accepted',
    resource:{indicatorId:d.indicatorId,source:'BIE-BISE',geography:'00'},checkedAt:'2026-10-27T14:00:00Z',
    frequencyCode:'8',unitCode:d.unitCode,sourceCodes:d.sourceCodes,noteCodes:'',lastUpdateDisplay:'21/10/2026',
    observations:[{period:'2026-08',value:121,statusCode:'1'}],...extra}
}
const args=()=>{
  const input=sourceSelectionFixture('MXN',{period:'2026-08'})
  const scope={...INEGI_REPORT_INDICATORS[0].scope}
  Object.values(input.requirements).forEach(r=>r[0].scope=scope)
  const selection=planResearchSourceSelection({input,sourcePlan,sourceRegister})
  return {input,sourcePlan,sourceRegister,requestIds:selection.sourceRequests.filter(r=>r.sourceId==='mxn-consumer').map(r=>r.requestId),
    now:()=> '2026-10-27T15:00:00Z'}
}

describe('INEGI definitions -> selected collection -> evidence review (synthetic)',()=>{
  it('calculates retail year-over-year from the exact prior-year month and leaves a missing baseline null',()=>{
    const scope=INEGI_REPORT_INDICATORS[0].derivedScopes![0]
    const result=inegiStatistic(captured('retail',{observations:[{period:'2025-08',value:100},{period:'2026-08',value:103}]}),scope)
    expect(result.observations[1]).toMatchObject({period:'2026-08',basePeriod:'2025-08',baseValue:100,indexValue:103})
    expect(result.observations[1].value).toBeCloseTo(3)
    expect(result.observations[0].value).toBeNull()
    expect(result.scope).toMatchObject({comparison:'year_over_year',adjustment:'unadjusted'})
    expect(verifyInegiReportSeries(captured('retail',{definitionId:'stale'})).status).toBe('definition_mismatch')
  })
  it('binds the reviewed definition and period into the existing pending card, with no external or paid call',async()=>{
    const fetchImpl=vi.fn(()=>{throw new Error('forbidden')})
    const result=await collectSelectedResearch({...args(),fetchImpl,inegiCaptures:[captured()]})
    const card=result.reviewQueue[0]
    expect(result).toMatchObject({networkCalls:0,modelCalls:0,newPaidCostUsd:0,publicationApproved:false})
    expect(result.outcomes[0].status).toBe('collected_pending_review')
    expect(card).toMatchObject({actualPeriods:['2026-08'],status:'pending',writingEligible:false,publicationStatus:'unverified'})
    const receipt={cardBinding:card.binding,definitionId:inegiDefinitionId(INEGI_REPORT_INDICATORS[0]),checkedChecks:card.requiredChecks,observationIndexes:[0],
      review:{origin:'agent',status:'checked',checkedOn:'2026-10-27',reason:'Synthetic assertion of source scope for integration boundaries only.'},
      scopeDraft:{passageIds:['p0'],scope:{...INEGI_REPORT_INDICATORS[0].scope},admittedClaims:[{id:'synthetic-retail',kind:'source_fact',text:'합성 사례의 8월 소매 지수는 121이다.',passageIds:['p0']}],
        allowedUse:'합성 전국 실질 소매 지수만 확인한다.',countercontext:'환율 원인이나 회사 매출로 확대하지 않는다.',excludedExpansions:[],coverageGaps:[],crossSourceClaims:[]}}
    const reviewed=reviewSelectedStatisticMaterial({collection:result,card,receipt})
    expect(reviewed).toMatchObject({sourceUseStatus:'not_assessed',writingEligibility:'not_assessed',publicationApproved:false})
    expect(reviewed.evidence[0].provenance).toHaveProperty('projectionSha256')
    expect(reviewed.evidence[0].provenance).not.toHaveProperty('rawSha256')
    expect(()=>reviewSelectedStatisticMaterial({collection:result,card,receipt:{...receipt,definitionId:'stale'}})).toThrow('definition_scope')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it.each([
    ['missing month',captured('retail',{observations:[{period:'2026-07',value:121}]}),'period_mismatch'],
    ['transport failure',captured('retail',{status:'timeout',observations:[]}),'access_failed'],
    ['changed unit',captured('retail',{unitCode:'302'}),'extraction_failed'],
    ['credential not configured',captured('retail',{status:'missing_or_invalid_credentials',observations:[]}),'configuration_required'],
    ['successful empty response',captured('retail',{status:'empty_result',observations:[]}),'empty_result'],
    ['provider missing values',captured('retail',{status:'values_missing',observations:[]}),'values_missing'],
  ])('distinguishes %s from sufficient current material',async(_,capture,status)=>{
    const result=await collectSelectedResearch({...args(),inegiCaptures:[capture]})
    expect(result.outcomes[0].status).toBe(status)
    expect(result.publicationApproved).toBe(false)
  })
  it('does not match an inflation series to a retail scope or accept an undeclared seasonal adjustment',async()=>{
    const wrong=await collectSelectedResearch({...args(),inegiCaptures:[captured('prices-annual')]})
    expect(wrong.outcomes[0]).toMatchObject({status:'not_attempted',originalIds:[]})
    const changed=args();Object.values(changed.input.requirements).forEach(r=>r[0].scope.adjustment='seasonally_adjusted')
    changed.requestIds=planResearchSourceSelection(changed).sourceRequests.filter(r=>r.sourceId==='mxn-consumer').map(r=>r.requestId)
    const unsupported=await collectSelectedResearch({...changed,inegiCaptures:[captured()]})
    expect(unsupported.outcomes[0].status).toBe('configuration_required')
  })
  it('keeps authentication examples, real report series, replay and the latest definition failure separate on the status board',()=>{
    const good=captured(),bad={...good,checkedAt:'2026-10-27T14:30:00Z',sourceCodes:'changed'}
    const run=(checks:object[],mode='live')=>({version:'inegi-report-local-check/1',mode,checks})
    const providers=projectApiHealth([run([good]),run([bad])],'2026-10-27T15:00:00Z').providers
    expect(providers.find(p=>p.id==='inegi-retail')).toMatchObject({status:'check_failed',errorType:'definition_mismatch',lastSuccessAt:good.checkedAt})
    expect(providers.find(p=>p.id==='inegi')!.status).toBe('not_checked')
    expect(providers.find(p=>p.id==='inegi-prices-annual')!.status).toBe('not_checked')
    const replay=projectApiHealth([run([good],'saved')],'2026-10-27T15:00:00Z')
    expect(replay.providers.find(p=>p.id==='inegi-retail')!.status).toBe('not_checked')
    expect(verifyInegiReportSeries(good).dataStatus).toBe('verified_report_series')
  })
})
