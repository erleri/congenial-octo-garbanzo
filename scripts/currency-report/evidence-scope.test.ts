import { describe, expect, it } from 'vitest'
import { bindEvidenceScope, projectEvidenceScopes, claimReferenceIssues } from './evidence-scope.js'
import { createSourceContext } from './source-context.js'
import { prepareClaimReview, assessClaimReview, claimReviewContract, CLAIM_REVIEW_VERSION } from './claim-review.js'
import { currentCase } from './test-support.js'
import { requestBody } from './openrouter.js'

function fixture() {
  const x = currentCase('MXN'), evidence = x.packet.evidence[0]
  evidence.review = { originalVerified: true, scope: '합성 물가 지수 구성에 한정하는 검토입니다.' }
  evidence.sourceContext = createSourceContext({ blocks: [{kind:'paragraph',text:'The price index has both positive and negative component contributions.'}],selected:[0] })
  const draft = { passageIds:['p0'],scope:{subject:'물가 지수 구성',metric:'분류 기여도',unit:'percentage_point',comparison:'전월 대비',rankingStatus:'full_division_ranking_unverified'},
    admittedClaims:[{id:'mixed',kind:'source_fact',passageIds:['p0'],text:'물가 지수의 구성 항목은 상승과 하락 기여가 혼재했다.'}],
    allowedUse:'동일 지수 안의 방향과 기여도에 한정해서 설명한다.',countercontext:'실제 가계 부담과 판매량의 변화로 확대하지 않는다.',
    excludedExpansions:['가계별 부담'],coverageGaps:[{subject:'실제 판매',status:'not_in_packet'}],crossSourceClaims:[] }
  const review = {origin:'agent',status:'checked',reason:'합성 원문과 범위 카드의 연결을 확인하는 검토 대역이다.'}
  return { ...x,evidence,draft,review,card:bindEvidenceScope(evidence,draft,review) }
}

describe('source-bound scope cards and references', () => {
  it('uses the same explicit projection in currency generation and sentence review and omits private review fields', () => {
    const x = fixture(), packet = {...x.packet,evidenceScopeCards:[x.card]}
    const body = requestBody(packet,'openrouter/free'), input = JSON.parse(body.messages[1].content)
    const prepared = prepareClaimReview(packet,x.content)
    expect(input.scopeCards).toEqual(prepared.scopeCards)
    expect(input.scopeCards[0].scope.rankingStatus).toBe('full_division_ranking_unverified')
    expect(input.scopeCards[0].review).toBeUndefined()
    expect(claimReviewContract(prepared).messages[0].content).toContain('제목·요약·소제목')
  })
  it('invalidates the source review when passages, periods or reviewed scope are changed', () => {
    const x = fixture(); expect(projectEvidenceScopes(x.packet,[x.card])).toHaveLength(1)
    const altered = structuredClone(x.card); altered.scope.subject = '모든 가구의 실제 소비'
    expect(() => projectEvidenceScopes(x.packet,[altered])).toThrow('unreviewed_or_stale_scope_card')
    x.evidence.period = '다른 조사 기간'
    expect(() => projectEvidenceScopes(x.packet,[x.card])).toThrow('unreviewed_or_stale_scope_card')
    const y = fixture(); y.evidence.sourceContext = createSourceContext({blocks:[{kind:'paragraph',text:'The revised original uses a different component and reference period.'}],selected:[0]})
    expect(() => projectEvidenceScopes(y.packet,[y.card])).toThrow('unreviewed_or_stale_scope_card')
  })
  it('rejects incomplete or invented scope evidence without treating a packet gap as a real-world absence', () => {
    const x = fixture(); expect(projectEvidenceScopes(x.packet,[x.card])[0].coverageGaps[0].status).toBe('not_in_packet')
    const unknown = {...x.draft,admittedClaims:[{...x.draft.admittedClaims[0],passageIds:['missing']}]}
    expect(() => projectEvidenceScopes(x.packet,[bindEvidenceScope(x.evidence,unknown,x.review)])).toThrow('unreviewed_or_stale_scope_card')
    const absent = {...x.draft,coverageGaps:[{subject:'판매 통계',status:'not_published'}]}
    expect(() => projectEvidenceScopes(x.packet,[bindEvidenceScope(x.evidence,absent,x.review)])).toThrow('unreviewed_or_stale_scope_card')
    expect(() => projectEvidenceScopes(x.packet,[],{required:true})).toThrow('scope_cards_required')
  })
  it('holds a missing block reference even if an agent labels every sentence supported, and accepts the repaired mapping', () => {
    const x = fixture(), other = {...x.evidence,id:'other-source'}
    const packet = {...x.packet,evidence:[x.evidence,other]}
    const content = {...x.content,drivers:[{...x.content.drivers[0],title:'서로 다른 대상 기간',text:'서로 다른 월의 지표를 구분한다.',evidenceIds:[x.evidence.id]}]}
    const ledger = [
      {target:'title',quote:content.title,evidenceIds:[x.evidence.id]},
      {target:'summary',quote:content.summary,evidenceIds:[x.evidence.id]},
      {target:'drivers.0.title',quote:content.drivers[0].title,evidenceIds:[x.evidence.id]},
      {target:'drivers.0.text',quote:content.drivers[0].text,evidenceIds:[x.evidence.id,other.id]},
    ]
    const p = prepareClaimReview(packet,content,{claimLedger:ledger})
    expect(p.referenceIssues).toEqual([{code:'block_source_missing',claimId:'drivers.0.text:0',evidenceIds:['other-source']}])
    expect(p.claims.find(c=>c.id==='summary:0')!.evidenceIds).toEqual([x.evidence.id])
    const source = p.sources[0], passage = source.sourceContext!.passages[0]
    const anchor = {evidenceId:source.id,passageId:passage.id,passageHash:source.sourceContext!.passageHash,quote:passage.text}
    const r = {version:CLAIM_REVIEW_VERSION,binding:p.binding,origin:'agent',reviewer:'synthetic contract reviewer',claims:p.claims.map(c=>({
      id:c.id,claimHash:c.claimHash,support:'supported',decision:'keep',issue:'none',reason:'합성 검토자의 명시적 판단을 전달하는 대역이다.',anchors:[anchor],applicationIds:[],
      subclaims:[{quote:c.quote,support:'supported',reason:'합성 인용이 의미 검증을 보장하지 않음을 확인하는 대역이다.',anchors:[anchor],applicationIds:[]}]
    }))}
    expect(assessClaimReview(p,r)).toMatchObject({status:'unverified',errors:['drivers.0.text:0:block_source_missing'],publicationApproved:false})
    content.drivers[0].evidenceIds.push(other.id)
    const repaired = prepareClaimReview(packet,content,{claimLedger:ledger})
    expect(repaired.referenceIssues).toEqual([])
    expect(assessClaimReview(repaired,r).errors).toEqual(['review_binding_or_shape'])
    expect(claimReferenceIssues(packet,content,repaired.claims,ledger)).toEqual([])
  })
})
