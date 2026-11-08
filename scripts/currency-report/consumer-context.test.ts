import {afterEach,describe,expect,it,vi} from 'vitest'
import {prepareConsumerContext,projectConsumerContext} from './consumer-context.js'
import {chileConsumptionScopes} from './chile-consumption-scopes.js'
import {bindEvidenceScope} from './evidence-scope.js'
import {createSourceContext} from './source-context.js'
import {ECONOMIC_VERSION,economicPacketBinding,economicUpdateRequest} from './economic-update.js'

// Synthetic source judgments. Values exercise contracts, not historical claims.
function fixture(values=[1,2,3]) {
  const registry=chileConsumptionScopes(), definitions=[registry.pay,...registry.retailRegistry.definitions.slice(0,2)]
  const period='2026-08',review={origin:'agent',status:'checked',reason:'실제 경제자료가 아닌 합성 입력 계약 검토이다.'}
  const sources=definitions.map((d,i)=>{
    const documentId=`pdf-${(i===0?'a':'b').repeat(64)}`
    const e={id:d.id,country:'CLP',period,publishedAt:'2026-10-07',collectedAt:'2026-10-14T20:00:00Z',
      eventDate:'2026-10-07',url:`https://www.ine.gob.cl/synthetic/${d.id}`,title:'합성 지표 계약 시험',publisher:'Synthetic INE',
      review:{originalVerified:true,reuse:'verified'},provenance:{documentId,independenceKey:documentId,provisional:true,receiptHash:'c'.repeat(64)},
      sourceContext:createSourceContext({blocks:[{kind:'paragraph',text:'합성 수치의 정의·범위·조건을 설명하는 시험 자료이다.'}],selected:[0]})}
    const statement=`${period} ${d.label}: 전년 동월 대비 ${values[i]>0?'+':''}${values[i]}%. 실질·계절조정 전 지표.`
    const card=bindEvidenceScope(e,{passageIds:['p0'],scope:d.scope,
      admittedClaims:[{id:`${d.id}-value`,kind:'source_fact',text:statement,passageIds:['p0']}],
      allowedUse:'동일 월의 통계 맥락으로만 읽는 합성 시험이다.',countercontext:'판매량·가계 소득이나 회사 매출로 확대하지 않는다.',
      excludedExpansions:['회사 셀아웃 추정'],coverageGaps:[],crossSourceClaims:[]},review)
    const statistic={evidenceId:e.id,value:values[i],period,scope:d.scope,documentId}
    return {e,card,statistic}
  })
  const packet={currency:'CLP',baseDate:'2026-10-15',purpose:'economic_update',facts:[],series:[],limitations:[],
    evidence:sources.map(s=>s.e),evidenceScopeCards:sources.map(s=>s.card)}
  return {packet,options:{period,asOf:'2026-10-15T20:00:00+09:00',statistics:sources.map(s=>s.statistic)}}
}
afterEach(()=>vi.unstubAllGlobals())

describe('Consumer context opt-in writer bridge',()=>{
  it('prepares only two sourced comparisons with code-owned fact labels and no IO or mutation',()=>{
    const x=fixture(),before=structuredClone(x),network=vi.fn(()=>{throw new Error('network forbidden')})
    vi.stubGlobal('fetch',network)
    const p=prepareConsumerContext(x.packet,x.options),input=projectConsumerContext(p.packet,p.context)
    expect(input.readerContent.angles.map(a=>a.id)).toEqual(['retail-category','pay-retail'])
    expect(input.readerContent.angles[0].evidenceIds).toEqual(['cl-iacm-total','cl-iacm-electronics-home-tech'])
    expect(input.editorialConstraints.angles[1].materialCondition).toContain('월 보수가 같아도')
    expect(JSON.stringify(input.readerContent)).not.toMatch(/나란히 제시|별도 관측으로|reviewOnly|explanatoryUse/)
    expect(input.timing).toMatchObject({reportBaseDate:'2026-10-15',referencePeriod:'2026-08'})
    expect(input.timing.publications.every(p=>p.publishedAt==='2026-10-07' && p.publicationTime===null && !p.publishedOnReportDate)).toBe(true)
    expect(p.packet.facts.map(f=>f.id)).toEqual(['consumer_pay_yoy','consumer_retail_yoy','consumer_category_yoy'])
    expect(p.packet.facts.every(f=>f.label.includes('2026-08')&&f.label.includes('잠정치'))).toBe(true)
    expect(input.documents).toHaveLength(2)
    expect(input.documents[1].evidenceIds).toHaveLength(2)
    expect(p).toMatchObject({status:'prepared_context_not_called',writingEligibility:'not_assessed',networkCalls:0,modelCalls:0,costUsd:0,publicationApproved:false})
    expect(x).toEqual(before);expect(network).not.toHaveBeenCalled()
  })
  it('uses negative and equal observations without hardcoding growth or extrapolating a trend',()=>{
    const x=fixture([-1,-2,-2]),input=prepareConsumerContext(x.packet,x.options).requestInputFragment
    expect(input.readerContent.angles[0].readerTakeaway).toContain('같다')
    expect(input.readerContent.angles[1].readerTakeaway).toContain('마이너스')
    const y=fixture([0,2,-1]),other=prepareConsumerContext(y.packet,y.options).requestInputFragment
    expect(other.readerContent.angles[0].readerTakeaway).toContain('낮다')
    expect(other.readerContent.angles[1].readerTakeaway).toContain('제로')
  })
  it('holds unavailable, historical or unreviewed statistical sources before preparing prose',()=>{
    const historical=fixture();historical.packet.baseDate='2026-10-09';historical.options.asOf='2026-10-09T20:00:00+09:00'
    expect(()=>prepareConsumerContext(historical.packet,historical.options)).toThrow('consumer_sources_not_available')
    const stale=fixture();stale.packet.evidenceScopeCards[0].scope.baseYear='2018'
    expect(()=>prepareConsumerContext(stale.packet,stale.options)).toThrow('consumer_sources_not_available')
    const reuse=fixture();reuse.packet.evidence[0].review.reuse='unverified'
    expect(()=>prepareConsumerContext(reuse.packet,reuse.options)).toThrow('consumer_sources_not_available')
  })
  it('rejects a numeric sidecar mismatch, missing series and a conflicting fact alias',()=>{
    const x=fixture();x.options.statistics[0].value=999
    expect(()=>prepareConsumerContext(x.packet,x.options)).toThrow('consumer_statistic_not_bound')
    const missing=fixture();missing.options.statistics.pop()
    expect(()=>prepareConsumerContext(missing.packet,missing.options)).toThrow('consumer_input_required')
    const y=fixture(),p=prepareConsumerContext(y.packet,y.options)
    p.packet.facts[0].value=888
    expect(()=>projectConsumerContext(p.packet,p.context)).toThrow('consumer_fact_collision')
  })
  it('does not accept edited guidance, changed source metadata or publication authority in a saved attachment',()=>{
    const x=fixture(),p=prepareConsumerContext(x.packet,x.options)
    p.context.input.readerContent.angles[0].readerTakeaway='이 회사의 판매 증가를 확정한 것으로 읽는다.'
    expect(()=>projectConsumerContext(p.packet,p.context)).toThrow('consumer_context_binding')
    const clean=prepareConsumerContext(x.packet,x.options)
    clean.context.publicationApproved=true
    expect(()=>projectConsumerContext(clean.packet,clean.context)).toThrow('consumer_context_binding')
    const changed=prepareConsumerContext(x.packet,x.options)
    changed.packet.evidence[0].title='임의로 바뀐 원문 제목'
    expect(()=>projectConsumerContext(changed.packet,changed.context)).toThrow('consumer_context_binding')
    const timing=prepareConsumerContext(x.packet,x.options)
    timing.context.input.timing.publications[0].publishedOnReportDate=true
    expect(()=>projectConsumerContext(timing.packet,timing.context)).toThrow('consumer_context_binding')
  })
  it('uses the real economic request builder while preserving its event gate and default input',()=>{
    const x=fixture(),p=prepareConsumerContext(x.packet,x.options)
    const decision={events:[{id:'synthetic-release',binding:'test-binding',status:'draft_candidate',purpose:'economic_update'}]}
    const dossier={version:ECONOMIC_VERSION,packetHash:economicPacketBinding(p.packet),scopeCards:p.packet.evidenceScopeCards,
      cards:p.packet.evidenceScopeCards.map(s=>({evidenceId:s.evidenceId,eventId:'synthetic-release',eventBinding:'test-binding',
        passageIds:s.passageIds,newInformation:'합성 신규성 결정이며 실제 사건 승인이 아니다.',allowedUse:s.allowedUse,countercontext:s.countercontext,
        review:{origin:'agent',status:'checked',reason:'요청 경로 연결만 검증하는 합성 사례이다.'}}))}
    const baseline=economicUpdateRequest(p.packet,dossier,decision)
    expect(JSON.parse(baseline.request.messages[1].content)).not.toHaveProperty('consumerContext')
    const linked=economicUpdateRequest(p.packet,{...dossier,consumerContext:p.context},decision)
    const sent=JSON.parse(linked.request.messages[1].content)
    expect(sent.consumerContext).toEqual(p.requestInputFragment)
    expect(linked.request.messages[0].content).not.toContain('첫 문장에서 새로운 발표 내용을')
    expect(linked.request.messages[0].content).toContain('작성·검토 지침이며 본문 원고가 아니다')
    expect(sent.facts.map(f=>f.id)).toEqual(p.packet.facts.map(f=>f.id))
    expect(sent.editorialPlan.watchCandidates).toEqual([])
    expect(linked.status).toBe('prepared_not_called')
    expect(economicUpdateRequest(p.packet,{...dossier,consumerContext:p.context},{events:[]}).request).toBeNull()
    const incomplete={...dossier,cards:dossier.cards.slice(0,1),scopeCards:dossier.scopeCards.slice(0,1),consumerContext:p.context}
    expect(()=>economicUpdateRequest(p.packet,incomplete,decision)).toThrow('consumer_context_source_coverage')
    expect(linked.request.messages[1].content).not.toContain('packetBinding')
    expect(linked.request.messages[1].content).not.toContain('local_research_only')
    expect(linked.request.messages[1].content).not.toContain('receiptHash')
    expect(sent.cards.every(c=>c.publisher==='INE Chile'&&c.sourceType==='official_statistics')).toBe(true)
    const altered = structuredClone(dossier)
    altered.scopeCards[0] = bindEvidenceScope(p.packet.evidence[0],{...altered.scopeCards[0],
      admittedClaims:[{...altered.scopeCards[0].admittedClaims[0],text:'서로 다른 검토 문구로 교체한 합성 주장이다.'}]},altered.cards[0].review)
    expect(()=>economicUpdateRequest(p.packet,{...altered,consumerContext:p.context},decision)).toThrow('consumer_context_scope_mismatch')
  })
  it('reconstructs legacy attachments without migrating their prose or request contract',()=>{
    const x=fixture(),old=prepareConsumerContext(x.packet,{...x.options,version:'consumer-context/1'})
    const before=structuredClone(old)
    expect(projectConsumerContext(old.packet,old.context)).toEqual(old.requestInputFragment)
    expect(old.requestInputFragment.angles[0].explanatoryUse).toContain('나란히 제시')
    expect(old.requestInputFragment).not.toHaveProperty('readerContent')
    expect(old).toEqual(before)
  })
})
