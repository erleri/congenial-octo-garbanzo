import fs from 'node:fs'
import {describe,it,expect,vi} from 'vitest'
import {sourceSelectionFixture} from './research-source-selection-fixtures.js'
import {planResearchSourceSelection} from './research-source-selection.js'
import {collectSelectedResearch} from './selected-source-collection.js'
import {INEGI_REPORT_INDICATORS,inegiDefinitionId} from './inegi-report-indicators.js'
import {sourceUseBinding} from './source-use.js'
import {prepareInegiWritingSources,prepareInegiConsumerContext,projectInegiConsumerContext,selectInegiWritingFacts,inegiReleaseBinding,INEGI_TERMS_URL,INEGI_USE_CONDITIONS} from './inegi-writing-context.js'
import {ECONOMIC_VERSION,economicPacketBinding,economicUpdateRequest,previewEconomicConsumerInput} from './economic-update.js'
import {bindFxWritingBackground,projectFxWritingBackground} from './fx-writing-background.js'
import {evaluateRules} from './rules.js'
import {syntheticLedger} from './rule-fixtures.js'
import {validateContent} from './core.js'

// Synthetic observations and reviewer judgments. These are not historical reports.
async function fixture() {
  const d=INEGI_REPORT_INDICATORS[0],input=sourceSelectionFixture('MXN',{period:'2026-08'})
  Object.values(input.requirements).forEach(r=>r[0].scope={...d.scope})
  const sourcePlan=JSON.parse(fs.readFileSync('docs/2.0/six-currency-explanation-sources-20261027.json','utf8'))
  const sourceRegister=JSON.parse(fs.readFileSync('docs/2.0/six-currency-source-register-20261027.json','utf8'))
  const requestIds=planResearchSourceSelection({input,sourcePlan,sourceRegister}).sourceRequests.filter(r=>r.sourceId==='mxn-consumer').map(r=>r.requestId)
  const capture={version:'inegi-series/1',seriesId:d.indicatorId,status:'ok',httpStatus:200,authentication:'accepted',
    resource:{indicatorId:d.indicatorId,source:'BIE-BISE',geography:'00'},checkedAt:'2026-10-27T13:00:00Z',
    frequencyCode:'8',unitCode:d.unitCode,sourceCodes:d.sourceCodes,noteCodes:'',lastUpdateDisplay:'21/10/2026',observations:[{period:'2026-08',value:103}]}
  const collection=await collectSelectedResearch({input,sourcePlan,sourceRegister,requestIds,inegiCaptures:[capture],now:()=> '2026-10-27T14:00:00Z'})
  const card=collection.reviewQueue[0],original=collection.originals[0]
  const review={origin:'agent',status:'checked',checkedOn:'2026-10-27',reason:'합성 자료의 범위·수치·기간 검토이며 실제 출처 승인 결과가 아니다.'}
  const statisticReviews=[{cardId:card.id,receipt:{cardBinding:card.binding,definitionId:inegiDefinitionId(d),checkedChecks:card.requiredChecks,observationIndexes:[0],review,
    scopeDraft:{passageIds:['p0'],scope:{...d.scope},admittedClaims:[{id:'retail-value',kind:'source_fact',text:'합성 8월 전국 실질 소매 매출 지수는 103이다.',passageIds:['p0']}],
      allowedUse:'해당 월의 소매 실질 매출 지수 관측에만 사용한다.',countercontext:'가전·회사 셀아웃·환율 원인으로 확대하지 않는다.',excludedExpansions:[],coverageGaps:[],crossSourceClaims:[]}}}]
  const releaseReviews=[{cardId:card.id,binding:inegiReleaseBinding(original,card),period:'2026-08',publishedOn:'2026-10-21',checkedOn:'2026-10-27',
    url:'https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/emec/emec2026_10.pdf',documentSha256:'a'.repeat(64),publicationPrecision:'day',review}]
  const sources=prepareInegiWritingSources({collection,statisticReviews,releaseReviews})
  const sourceUse={evaluatedOn:'2026-10-27',reviews:sources.evidence.map(e=>({version:'source-use/1',resourceId:e.id,resourceBinding:sourceUseBinding(e),
    terms:{url:INEGI_TERMS_URL,version:'synthetic-terms',reviewedOn:'2026-10-27'},scope:'합성 수치와 메타데이터만 외부 모델 입력으로 사용한다.',review,
    conditions:INEGI_USE_CONDITIONS.map(id=>({id,text:'출처·가공·공식 견해 분리를 입력에 보존하는 합성 조건이다.',status:'satisfied'})),
    uses:{local_analysis:{status:'allowed',reason:'합성 로컬 분석 조건을 확인했다.',conditionIds:INEGI_USE_CONDITIONS},
      external_model:{status:'allowed',reason:'합성 모델 입력에 한정한 조건을 확인했다.',conditionIds:INEGI_USE_CONDITIONS},
      public_display:{status:'pending',reason:'공개 화면의 실제 출처·가공 고지는 별도 확인한다.',conditionIds:[]}}}))}
  const packet={currency:'MXN',baseDate:'2026-10-27',observedDate:null,purpose:'economic_update',facts:[],series:[],limitations:[],evidence:[],evidenceScopeCards:[]}
  return {packet,options:{collection,statisticReviews,releaseReviews,sourceUse,asOf:'2026-10-27T14:00:00Z'}}
}

describe('INEGI use/time admission to the existing economic writer (synthetic)',()=>{
  it('accepts a bound monthly period only in business context and keeps day-cause and changed-binding checks active',async()=>{
    const x=await fixture(),built=prepareInegiConsumerContext(x.packet,x.options),p={...built.packet,purpose:'fx_explanation',observedDate:x.packet.baseDate}
    // This unit isolates period roles; verified FX price admission is tested separately.
    p.fxWritingBackground=bindFxWritingBackground({consumerContext:built.context,asOf:undefined})
    expect(()=>projectFxWritingBackground(p)).not.toThrow()
    const source=p.evidence[0].id,block={title:'합성 소비 자료의 기간',text:'확인한 대상 월의 실질 소매 지수를 설명한다.',kind:'fact',factIds:['mxn_retail_index'],evidenceIds:[source]}
    // Deliberately reuse the same statistic in a day-cause position as a negative control.
    const content={title:'합성 검토 자료',summary:'대상 월과 발표일을 구분하는 경계 시험이다.',change:block,drivers:[block],implications:[block],watch:[],limitations:['합성 경계 시험이며 실제 보고서가 아니다.']}
    const assess=packet=>evaluateRules({packet,content,ledger:syntheticLedger(packet,content),safety:validateContent(content,packet)})
    const result=assess(p)
    expect(result.checks.some(c=>c.ruleId==='R04'&&c.location.startsWith('implications.'))).toBe(false)
    expect(result.checks.some(c=>c.ruleId==='R04'&&c.location.startsWith('drivers.'))).toBe(true)
    expect(result.publicationApproved).toBe(false)
    const unbound=structuredClone(p);delete unbound.fxWritingBackground
    expect(assess(unbound).checks.some(c=>c.ruleId==='R04'&&c.location.startsWith('implications.'))).toBe(true)
    const changed=structuredClone(p);changed.fxWritingBackground.consumerContext.input.timing.publications[0].referencePeriod='2026-09'
    expect(assess(changed).checks.some(c=>c.ruleId==='R12')).toBe(true)
    expect(assess(changed).checks.some(c=>c.ruleId==='R04'&&c.location.startsWith('implications.'))).toBe(true)
  })
  it('selects only reviewed fact identities, retains their use/time receipts and does not mutate the saved source options',async()=>{
    const x=await fixture(),before=structuredClone(x)
    const selected=selectInegiWritingFacts(x.options,['mxn_retail_index'])
    expect(prepareInegiConsumerContext(x.packet,selected).holds).toEqual([])
    expect(selected.statisticReviews).toEqual(x.options.statisticReviews)
    expect(selected.sourceUse).toEqual(x.options.sourceUse)
    expect(()=>selectInegiWritingFacts(x.options,['mxn_retail_yoy'])).toThrow('fact_selection')
    expect(()=>selectInegiWritingFacts(x.options,['mxn_retail_index','mxn_retail_index'])).toThrow('fact_selection')
    selected.releaseReviews[0].period='2026-09'
    selected.sourceUse.reviews[0].uses.external_model.status='pending'
    expect(x).toEqual(before)
  })
  it('prepares the common prompt without a fake generation decision, private receipts, Chile attribution or external calls',async()=>{
    const x=await fixture(),before=structuredClone(x),network=vi.fn(()=>{throw new Error('forbidden')})
    vi.stubGlobal('fetch',network)
    try {
      const result=prepareInegiConsumerContext(x.packet,x.options)
      expect(result).toMatchObject({status:'prepared_consumer_context_not_called',nextStage:{consumerInputReady:true,fxExplanationReady:false,paidTrialAuthorized:false}})
      expect(result.researchNeeds).toMatchObject({dataStatus:'metadata_compatible',writingEligibility:'not_assessed',networkCalls:0})
      const preview=previewEconomicConsumerInput(result.packet,result.context),input=JSON.parse(preview.messages[1].content)
      expect(preview).toMatchObject({generationRequest:null,paidCallAuthorized:false,publicationApproved:false})
      expect(input.cards[0]).toMatchObject({publisher:'INEGI',sourceType:'official_statistics',publishedAt:'2026-10-21',period:'2026-08'})
      expect(input.consumerContext.timing.publications[0].publicationTime).toBeNull()
      expect(input.consumerContext.sourceAttributions[0].scope).toMatchObject({priceBasis:'real',adjustment:'unadjusted',baseYear:'2018'})
      expect(input.consumerContext.sourceAttributions[0].providerReportedUpdate).toEqual({display:'21/10/2026',meaning:'provider_update_label_not_release_timestamp'})
      expect(input.consumerContext.sourceGroups).toHaveLength(1)
      expect(input.consumerContext.sourceGroups[0].independentVerificationCount).toBeNull()
      expect(input.editorialPlan.codeOwnedLimitations.some(t=>t.includes('Fuente: INEGI')&&t.includes('LATAM FX'))).toBe(true)
      expect(JSON.stringify(preview)).not.toMatch(/INE Chile|cardBinding|documentSha256|statisticReviews/)
      expect(preview.messages[0].content).toContain('환율 변화의 원인이나 당일 시장 반응으로 사용하지 않는다')
      expect(economicUpdateRequest(result.packet,{version:ECONOMIC_VERSION},{events:[]}).request).toBeNull()
      expect(network).not.toHaveBeenCalled();expect(x).toEqual(before)
    }finally{vi.unstubAllGlobals()}
  })
  it.each([
    ['missing source-use approval',x=>{x.options.sourceUse.reviews=[]},'source_use_review_missing'],
    ['unmet metadata condition',x=>{x.options.sourceUse.reviews[0].conditions[0].status='pending'},'inegi_conditions_pending'],
    ['same-day date-only publication',x=>{x.options.releaseReviews[0].publishedOn='2026-10-27'},'publication_time_unverified'],
    ['snapshot collected after cutoff',x=>{x.options.asOf='2026-10-27T12:00:00Z'},'historical_version_unverified'],
  ] as const)('holds %s instead of silently preparing an input',async(_,change,reason)=>{
    const x=await fixture();change(x)
    const result=prepareInegiConsumerContext(x.packet,x.options)
    expect(result.status).toBe('hold_before_writer');expect(result.requestInputFragment).toBeNull()
    expect(result.holds.some(r=>r.includes(reason))).toBe(true)
    expect(()=>projectInegiConsumerContext(result.packet,result.context)).toThrow('review_or_binding')
  })
  it('rejects a swapped release, a relabeled fact, a changed bound context and an FX-purpose packet',async()=>{
    const x=await fixture(),bad=structuredClone(x.options)
    bad.releaseReviews[0].url='https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/inpc/inpc_2q2026_10.pdf'
    expect(()=>prepareInegiConsumerContext(x.packet,bad)).toThrow('release_review')
    const result=prepareInegiConsumerContext(x.packet,x.options)
    result.context.input.readerContent.angles[0].readerTakeaway='환율 원인으로 바꾼 잘못된 문자열이다.'
    expect(()=>projectInegiConsumerContext(result.packet,result.context)).toThrow('binding')
    const collision={...x.packet,facts:[{id:'mxn_retail_index',value:999,label:'wrong'}]}
    expect(()=>prepareInegiConsumerContext(collision,x.options)).toThrow('collision')
    expect(()=>prepareInegiConsumerContext({...x.packet,purpose:'fx_explanation'},x.options)).toThrow('consumer_packet')
  })
  it('uses the same context in the existing qualified economic-request path while preserving the generation gate',async()=>{
    const x=await fixture(),result=prepareInegiConsumerContext(x.packet,x.options),packet=result.packet
    const event={id:'synthetic-economic-candidate',binding:'synthetic-binding',status:'draft_candidate',purpose:'economic_update'}
    const scope=packet.evidenceScopeCards[0]
    const dossier={version:ECONOMIC_VERSION,packetHash:economicPacketBinding(packet),scopeCards:packet.evidenceScopeCards,consumerContext:result.context,
      cards:[{evidenceId:scope.evidenceId,eventId:event.id,eventBinding:event.binding,passageIds:scope.passageIds,
        newInformation:'실제 신규성 승인이 아닌 합성 연결 검사용 검토이다.',allowedUse:scope.allowedUse,countercontext:scope.countercontext,review:{origin:'agent',status:'checked',reason:'기존 집필 경로에 같은 입력이 연결되는지 확인하는 합성 판단이다.'}}]}
    const request=economicUpdateRequest(packet,dossier,{events:[event]})
    expect(request.status).toBe('prepared_not_called')
    expect(JSON.parse(request.request.messages[1].content).cards[0].publisher).toBe('INEGI')
    expect(JSON.parse(request.request.messages[1].content).consumerContext.role).toBe('consumer_environment_only')
    expect(request.publicationApproved).toBe(false)
  })
})
