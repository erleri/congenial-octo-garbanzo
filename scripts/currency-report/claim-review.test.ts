import { describe, expect, it, vi } from 'vitest'
import { currentCase } from './test-support.js'
import { syntheticApplication, syntheticUsdApplication } from './rule-fixtures.js'
import { ownedImplications } from './owned-content.js'
import { createSourceContext } from './source-context.js'
import { assertProviderSchema } from './paid-comparison.js'
import { CLAIM_REVIEW_VERSION, prepareClaimReview, claimReviewContract, assessClaimReview, correctionPlan, applyCorrections, runEditorialWorkflow } from './claim-review.js'

function setup(currency = 'BRL') {
  const a = currentCase(currency)
  Object.assign(a.packet.evidence[0], { review: { originalVerified: true }, sourceContext: createSourceContext({
    blocks: [{ kind: 'quote', text: 'The analyst explained the new policy expectations and the relative return channel.' }], selected: [0],
  }) })
  return a
}
// Reviewer doubles establish interface behavior, not historical claim accuracy.
function reviewFor(p) {
  const s = p.sources[0], passage = s.sourceContext.passages[0]
  return { version: CLAIM_REVIEW_VERSION, binding: p.binding, origin: 'agent', reviewer: 'synthetic offline reviewer',
    claims: p.claims.map(c => ({ id: c.id, claimHash: c.claimHash, support: 'supported', decision: 'keep',
      issue: 'none', reason: '합성 원문과 합성 주장 연결을 검토하는 테스트 대역이다.', applicationIds: [],
      anchors: [{ evidenceId: s.id, passageId: passage.id, passageHash: s.sourceContext.passageHash, quote: passage.text }],
      subclaims: [{ quote: c.quote, support: 'supported', reason: '합성 주장의 전체 범위를 대조하는 검토 대역이다.', applicationIds: [],
        anchors: [{ evidenceId: s.id, passageId: passage.id, passageHash: s.sourceContext.passageHash, quote: passage.text }] }],
    })) }
}
function editCase() {
  const a = setup(), p = prepareClaimReview(a.packet, a.content), r = reviewFor(p)
  const row = r.claims.find(c => c.id === 'drivers.0.text:0')
  Object.assign(row, { support: 'unsupported', decision: 'rewrite', issue: 'claim_scope', reason: '이 문장의 표현 강도가 원문에서 확인된 범위를 초과한다.' })
  row.subclaims[0].support = 'unsupported'
  const plan = correctionPlan(p, r), item = plan.items[0]
  const patches = [{ id: item.id, target: item.target, claimHash: item.claimHash, before: item.quote,
    after: '보도는 새 정책 기대의 재평가를 전했다.' }]
  return { ...a, p, r, plan, patches }
}

it('requires explicit business/current-dollar completeness judgments separately from factual sentence errors',()=>{
 const a=setup(),p=prepareClaimReview(a.packet,a.content)
 // Synthetic review-contract requirements; not a real source/quality review.
 p.writingCoverageRequirements=[{id:'same_session_dollar_connection',status:'unverified',question:'합성 당일 달러 연결 설명의 누락을 별도로 확인한다.'}]
 const r=reviewFor(p),contract=claimReviewContract(p)
 expect(contract.schema.required).toContain('writingCoverage')
 expect(assessClaimReview(p,r)).toMatchObject({status:'unverified',publicationApproved:false,
  writingCoverage:[{id:'same_session_dollar_connection',status:'unverified'}]})
 r.writingCoverage={same_session_dollar_connection:{status:'refine',reason:'합성 문장에 허위 사실은 없으나 검토된 현재 흐름의 설명이 빠져 있다.'}}
 const omitted=assessClaimReview(p,r)
 expect(omitted).toMatchObject({status:'reviewed',needsRefinement:true,requiredCorrections:[],publicationApproved:false})
 r.writingCoverage.same_session_dollar_connection={status:'hold',reason:'합성 장중 관측을 종가의 확정 원인으로 바꾼 실제 범위 오류다.'}
 expect(assessClaimReview(p,r).status).toBe('needs_revision')
 r.writingCoverage.same_session_dollar_connection={status:'pass',reason:'합성 출처와 조건부 연결을 대조했으며 장중·종가 기준은 분리되어 있다.'}
 expect(assessClaimReview(p,r)).toMatchObject({status:'reviewed',needsRefinement:false,publicationApproved:false})
})

it('uses the same quoted sentence boundaries for review and an explicit correction without changing adjacent prose', () => {
  const a = setup()
  a.content.drivers[0].text = '정책 신호를 검토했다. “조건의 의미를 살폈다.” 후속 흐름을 비교했다.'
  const before = structuredClone(a.content), p = prepareClaimReview(a.packet, a.content), r = reviewFor(p)
  const row = r.claims.find(c => c.id === 'drivers.0.text:1')!
  expect(p.claims.find(c => c.id === row.id)!.quote).toBe('“조건의 의미를 살폈다.”')
  row.decision = 'refine'; row.issue = 'style'
  const plan = correctionPlan(p, r, { includeRefinements: true }), item = plan.items[0]
  const result = applyCorrections({ packet: a.packet, content: a.content, plan,
    patches: [{ id: item.id, target: item.target, claimHash: item.claimHash, before: item.quote, after: '조건의 적용 범위를 살폈다.' }] })
  expect(result.content.drivers[0].text).toBe('정책 신호를 검토했다. 조건의 적용 범위를 살폈다. 후속 흐름을 비교했다.')
  expect(result.status).toBe('requires_recheck')
  expect(result.publicationApproved).toBe(false)
  expect(a.content).toEqual(before)
})
describe('sentence review and bounded revision owner', () => {
  it.each(['BRL', 'MXN', 'CLP'])('uses the same anchored review contract for %s without human approval', currency => {
    const a = setup(currency), p = prepareClaimReview(a.packet, a.content)
    expect(p.claims.map(c => c.id)).toEqual(['title:0', 'summary:0', 'drivers.0.title:0', 'drivers.0.text:0', 'drivers.0.text:1'])
    const assessed = assessClaimReview(p, reviewFor(p))
    expect(assessed).toMatchObject({ status: 'reviewed', errors: [], origin: 'agent', publicationApproved: false })
  })
  it('invalidates reviews when the original source or manuscript changes', () => {
    const a = setup(), p = prepareClaimReview(a.packet, a.content), r = reviewFor(p)
    a.content.summary = '수정된 요약은 새로운 검토를 필요로 한다.'
    expect(assessClaimReview(prepareClaimReview(a.packet, a.content), r).errors).toEqual(['review_binding_or_shape'])
    const b = setup(); b.packet.evidence[0].period = '다른 비교 기간'
    expect(assessClaimReview(prepareClaimReview(b.packet, b.content), r).errors).toEqual(['review_binding_or_shape'])
  })
  it('rejects a valid source ID with an invented original quotation', () => {
    const a = setup(), p = prepareClaimReview(a.packet, a.content), r = reviewFor(p)
    r.claims[0].anchors[0].quote = 'Actual sell order volume surged after the announcement.'
    expect(assessClaimReview(p, r).errors).toContain('title:0:invalid_original_anchor')
    expect(() => correctionPlan(p, r)).toThrow('incomplete_claim_review')
  })
  it('requires application conditions for mechanisms even with a real article anchor', () => {
    const a = setup(); a.content.drivers[0].kind = 'mechanism'
    const p = prepareClaimReview(a.packet, a.content), r = reviewFor(p)
    expect(assessClaimReview(p, r).errors).toContain('drivers.0.text:0:mechanism_conditions_missing')
    a.packet.mechanismApplications = [syntheticApplication(a.packet)]
    const next = prepareClaimReview(a.packet, a.content), supported = reviewFor(next)
    for (const row of supported.claims.filter(c => c.id.startsWith('drivers.0.'))) { row.applicationIds = ['test-application']; row.subclaims[0].applicationIds = ['test-application'] }
    expect(assessClaimReview(next, supported).errors).toEqual([])
  })
  it('keeps readability refinements optional while requiring evidence corrections', () => {
    const a = editCase(); Object.assign(a.r.claims[0], { decision: 'refine', issue: 'style' })
    expect(assessClaimReview(a.p, a.r)).toMatchObject({ requiredCorrections: ['drivers.0.text:0'], optionalRefinements: ['title:0'], verificationPending: [] })
    expect(correctionPlan(a.p, a.r).items.map(i => i.id)).toEqual(['drivers.0.text:0'])
    expect(correctionPlan(a.p, a.r, { includeRefinements: true }).items.map(i => i.id)).toEqual(['title:0', 'drivers.0.text:0'])
    a.r.claims.find(c => c.id === 'drivers.0.text:0').decision = 'keep'
    expect(assessClaimReview(a.p, a.r).errors).toContain('drivers.0.text:0:required_correction_missing')
  })
  it('leaves absent original context unverified rather than trusting a summary', () => {
    const a = setup(); delete a.packet.evidence[0].sourceContext
    const p = prepareClaimReview(a.packet, a.content)
    const r = { version: CLAIM_REVIEW_VERSION, binding: p.binding, origin: 'agent', reviewer: 'synthetic offline reviewer',
      claims: p.claims.map(c => ({ id: c.id, claimHash: c.claimHash, support: 'unverified', decision: 'keep',
        issue: 'verification_gap', reason: '원문을 확보하지 않아 실제 문장 지지 여부를 확인할 수 없다.', anchors: [], applicationIds: [],
        subclaims: [{ quote: c.quote, support: 'unverified', reason: '원문이 없어 전체 주장의 지지를 확인하지 못했다.', anchors: [], applicationIds: [] }] })) }
    expect(assessClaimReview(p, r)).toMatchObject({ status: 'unverified', errors: [], requiredCorrections: [], verificationPending: p.claims.map(c => c.id) })
    expect(correctionPlan(p, r).items).toEqual([])
  })
  it('patches only the flagged sentence and preserves source, facts and other prose', () => {
    const a = editCase(), before = structuredClone(a)
    const result = applyCorrections({ packet: a.packet, content: a.content, plan: a.plan, patches: a.patches })
    expect(result.status).toBe('requires_recheck')
    expect(result.content.drivers[0].text).toBe('보도는 새 정책 기대의 재평가를 전했다. 상대 수익률 기대를 통해 해당 통화 자산 수요에 연결될 수 있다는 해석이다.')
    expect(result.content.change).toEqual(before.content.change)
    expect(result.content.summary).toBe(before.content.summary)
    expect(a.content).toEqual(before.content)
    expect(a.packet).toEqual(before.packet)
    expect(result).toMatchObject({ revisionDepth: 1, ruleLedgerStatus: 'invalidated_by_revision', humanReviewStatus: 'unverified', publicationApproved: false })
  })
  it('rejects edits to unflagged text and a second correction round', () => {
    const a = editCase(), unauthorized = { ...a.patches[0], target: 'summary' }
    expect(() => applyCorrections({ packet: a.packet, content: a.content, plan: a.plan, patches: [unauthorized] })).toThrow('unauthorized_correction')
    expect(() => applyCorrections({ packet: a.packet, content: a.content, plan: a.plan, patches: a.patches, revisionDepth: 1 })).toThrow('revision_limit_reached')
  })
  it('stops when the editor introduces an instruction and never calls the second reviewer', async () => {
    const a = editCase(), reviewer = vi.fn().mockResolvedValue(a.r)
    const editor = vi.fn().mockResolvedValue([{ ...a.patches[0], after: '달러를 매도하는 것을 추천합니다.' }])
    const result = await runEditorialWorkflow({ packet: a.packet, content: a.content, reviewer, editor })
    expect(result).toMatchObject({ status: 'hold', safety: { errors: ['advice_or_instruction'] } })
    expect(reviewer).toHaveBeenCalledTimes(1)
  })
  it('rechecks the revised manuscript once and does not loop on a second defect', async () => {
    const a = editCase()
    const reviewer = vi.fn().mockResolvedValueOnce(a.r).mockImplementationOnce(async p => {
      const r = reviewFor(p); Object.assign(r.claims[0], { support: 'limited', decision: 'rewrite', issue: 'claim_scope' }); r.claims[0].subclaims[0].support = 'limited'; return r
    })
    const editor = vi.fn().mockResolvedValue(a.patches)
    const result = await runEditorialWorkflow({ packet: a.packet, content: a.content, reviewer, editor })
    expect(result).toMatchObject({ status: 'hold', calls: { reviews: 2, edits: 1 }, publicationApproved: false })
    expect(reviewer).toHaveBeenCalledTimes(2)
    expect(editor).toHaveBeenCalledTimes(1)
  })
  it('provides strict stage contracts and accepts a reviewed revision without publication permission', async () => {
    const a = editCase()
    const reviewer = vi.fn().mockImplementationOnce(async (_p, contract) => {
      assertProviderSchema(contract.schema)
      expect(contract.schema.properties.origin.enum).toEqual(['agent'])
      expect(contract.messages[0].content).toContain('문장별로 대조')
      return a.r
    }).mockImplementationOnce(async p => reviewFor(p))
    const editor = vi.fn().mockImplementation(async (_plan, contract) => {
      assertProviderSchema(contract.schema)
      expect(contract.schema.required).toEqual(['patches'])
      return { patches: a.patches }
    })
    const result = await runEditorialWorkflow({ packet: a.packet, content: a.content, reviewer, editor })
    expect(result).toMatchObject({ status: 'reviewed_revision', recheck: { origin: 'agent' }, publicationApproved: false })
    expect(result.content.change).toEqual(a.content.change)
  })
  // Classification inputs are explicit reviewer judgments, not a language understanding benchmark.
  it.each([
    ['observation_time', 'unsupported', 'rewrite', 'required_correction'],
    ['source_authority', 'limited', 'rewrite', 'required_correction'],
    ['claim_scope', 'unsupported', 'rewrite', 'required_correction'],
    ['evidence_conflict', 'conflicting', 'rewrite', 'required_correction'],
    ['advice', 'supported', 'rewrite', 'required_correction'],
    ['style', 'supported', 'refine', 'optional_refinement'],
    ['none', 'supported', 'keep', 'no_issue'],
  ])('routes reviewer finding %s to %s/%s without approving publication', (issue, support, decision, expected) => {
    const a = setup(), p = prepareClaimReview(a.packet, a.content), r = reviewFor(p)
    Object.assign(r.claims[0], { issue, support, decision })
    r.claims[0].subclaims[0].support = support
    const result = assessClaimReview(p, r)
    expect(result.errors).toEqual([])
    expect(result.rows[0].disposition).toBe(expected)
    expect(result.publicationApproved).toBe(false)
    expect(correctionPlan(p, r).items.map(i => i.id)).toEqual(expected === 'required_correction' ? ['title:0'] : [])
  })
  it.each([
    ['style', 'unsupported', 'refine'],
    ['style', 'supported', 'rewrite'],
    ['observation_time', 'unverified', 'rewrite'],
    ['source_authority', 'limited', 'refine'],
    ['unknown_issue', 'supported', 'keep'],
  ])('rejects inconsistent finding %s/%s/%s before editing', (issue, support, decision) => {
    const a = setup(), p = prepareClaimReview(a.packet, a.content), r = reviewFor(p)
    Object.assign(r.claims[0], { issue, support, decision })
    r.claims[0].subclaims[0].support = support
    expect(assessClaimReview(p, r).errors).toContain('title:0:issue_disposition_mismatch')
    expect(() => correctionPlan(p, r)).toThrow('incomplete_claim_review')
  })
  it('does not promote optional style refinement into a paid correction step', async () => {
    const a = setup(), p = prepareClaimReview(a.packet, a.content), r = reviewFor(p)
    Object.assign(r.claims[0], { issue: 'style', support: 'supported', decision: 'refine' })
    const editor = vi.fn()
    const result = await runEditorialWorkflow({ packet: a.packet, content: a.content, reviewer: async () => r, editor })
    expect(result).toMatchObject({ status: 'reviewed', publicationApproved: false, assessment: { requiredCorrections: [], optionalRefinements: ['title:0'] } })
    expect(editor).not.toHaveBeenCalled()
  })
  it('requires every subclaim to be covered and supported, even when the sentence has a valid citation', () => {
    const a = setup(); a.content.summary = '정부는 공급 계획을 발표했고 실제 매각도 완료했다.'
    const p = prepareClaimReview(a.packet, a.content), r = reviewFor(p), row = r.claims.find(c => c.id === 'summary:0')!
    Object.assign(row, { support: 'unsupported', decision: 'rewrite', issue: 'claim_scope' })
    row.subclaims = [
      { ...row.subclaims[0], quote: '정부는 공급 계획을 발표했고 ', support: 'supported' },
      { ...row.subclaims[0], quote: '실제 매각도 완료했다.', support: 'unsupported', anchors: [] },
    ]
    expect(assessClaimReview(p, r)).toMatchObject({ status: 'needs_revision', errors: [] })
    row.support = 'supported'
    expect(assessClaimReview(p, r).errors).toContain('summary:0:subclaim_support_overstated')
    row.support = 'unsupported'; row.subclaims.pop()
    expect(assessClaimReview(p, r).errors).toContain('summary:0:subclaim_coverage_missing')
  })
  it('rejects a missing or invented per-subclaim anchor despite valid sentence-level anchors', () => {
    const a = setup(), p = prepareClaimReview(a.packet, a.content), r = reviewFor(p)
    r.claims[0].subclaims[0].anchors = []
    expect(assessClaimReview(p, r).errors).toContain('title:0:0:subclaim_support_missing')
    r.claims[0].subclaims[0].anchors = [{ ...r.claims[0].anchors[0], quote: 'An invented quotation not found in the original.' }]
    expect(assessClaimReview(p, r).errors).toContain('title:0:0:invalid_original_anchor')
  })
  it('keeps an approved code-owned conversion in the review and rejects model correction of it', () => {
    const a = setup()
    a.packet.mechanismApplications = [syntheticUsdApplication(a.packet)]
    a.content.implications = ownedImplications(a.packet)
    const p = prepareClaimReview(a.packet, a.content), r = reviewFor(p)
    for (const row of r.claims.filter(c => p.claims.find(x => x.id === c.id)?.owner === 'code')) {
      row.anchors = []; row.applicationIds = ['test-application']
      row.subclaims[0].anchors = []; row.subclaims[0].applicationIds = ['test-application']
    }
    expect(assessClaimReview(p, r).errors).toEqual([])
    const row = r.claims.find(c => c.id === 'implications.0.text:0')!
    Object.assign(row, { issue: 'style', decision: 'refine' })
    expect(assessClaimReview(p, r).errors).toContain('implications.0.text:0:code_owned_correction_forbidden')
    expect(() => correctionPlan(p, r, { includeRefinements: true })).toThrow('incomplete_claim_review')
  })
})
