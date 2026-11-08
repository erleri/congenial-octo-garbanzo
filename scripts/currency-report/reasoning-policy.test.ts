import fs from 'node:fs'
import {afterEach,expect,it,vi} from 'vitest'
import {replayReasoningCases} from './reasoning-replay.js'
import {REASONING_CRITERIA,REASONING_POLICY_VERSION,REASONING_WRITER_INSTRUCTIONS,REASONING_REVIEW_INSTRUCTIONS} from './reasoning-policy.js'
import {requestBody,PROMPT_VERSION} from './openrouter.js'
import {paidBody} from './paid-comparison.js'
import {comparisonPacket} from './test-support.js'
import {assessClaimReview,correctionPlan,applyCorrections,prepareClaimReview,claimReviewContract} from './claim-review.js'

const bundle=JSON.parse(fs.readFileSync('docs/2.0/clp-news-notes-20260910.json','utf8'))
afterEach(()=>vi.unstubAllGlobals())

it('carries one reasoning policy through free, paid, review and bounded correction contracts without network access',()=>{
  const network=vi.fn(()=>{throw Error('offline_only')});vi.stubGlobal('fetch',network)
  const packet=comparisonPacket(),bodies=[requestBody(packet,'openrouter/free'),paidBody(packet,'openai/gpt-5.4')]
  const replay=replayReasoningCases(bundle),changed=replay.cases.find(c=>c.id==='expert-priority-expanded')!
  for(const body of bodies){
    const input=JSON.parse(body.messages[1].content)
    expect(input).toMatchObject({promptVersion:PROMPT_VERSION,reasoningPolicyVersion:REASONING_POLICY_VERSION})
    expect(body.messages[0].content).toContain(REASONING_WRITER_INSTRUCTIONS)
  }
  expect(changed.prepared.reasoningCriteria).toEqual(REASONING_CRITERIA)
  expect(changed.reviewContract.messages[0].content).toContain(REASONING_REVIEW_INSTRUCTIONS)
  expect(changed.correctionContract!.messages[0].content).toContain(REASONING_WRITER_INSTRUCTIONS)
  expect(JSON.parse(changed.correctionContract!.messages[1].content).reasoningPolicyVersion).toBe(REASONING_POLICY_VERSION)
  expect(network).not.toHaveBeenCalled()
})

it('routes fixed gold judgments into correction, retention or style refinement without calling them model predictions',()=>{
  const network=vi.fn(()=>{throw Error('offline_only')});vi.stubGlobal('fetch',network)
  const before=JSON.stringify(bundle),result=replayReasoningCases(bundle)
  // Reach semantic review with a valid report baseline; unrelated schema failure
  // must never make the recurrence check appear to have caught its target error.
  expect(result.cases.map(c=>c.prepared.automatic)).toEqual(Array.from({length:11},()=>({valid:true,errors:[]})))
  expect(result.cases.every(c=>c.prepared.editorial.blockers.length===0)).toBe(true)
  expect(result.cases.map(c=>[c.id,c.disposition,c.correctionRequired,c.optionalRefinement])).toEqual([
    ['expert-priority-expanded','required_correction',true,false],
    ['expert-priority-attributed','no_issue',false,false],
    ['expert-comparison-without-invented-rank','no_issue',false,false],
    ['level-ranks-causes','required_correction',true,false],
    ['watch-as-editorial-observation','no_issue',false,false],
    ['co-movement-proves-cause','required_correction',true,false],
    ['co-movement-kept-conditional','no_issue',false,false],
    ['repeated-generic-caveat','optional_refinement',false,true],
    ['material-qualification-kept','no_issue',false,false],
    ['headline-promotes-aggregate-priority','required_correction',true,false],
    ['external-pressure-becomes-local-demand','required_correction',true,false],
  ])
  expect(result.cases.every(c=>c.errors.length===0&&!c.publicationApproved)).toBe(true)
  expect(result.cases.filter(c=>c.origin==='synthetic_boundary')).toHaveLength(3)
  expect(result).toMatchObject({modelCalls:0,newApiCostUsd:0,publicationApproved:false})
  expect(JSON.stringify(bundle)).toBe(before);expect(network).not.toHaveBeenCalled()
})

it('cannot relabel an unsupported comparison as style or keep when its adjudicated subclaim needs correction',()=>{
  const sample=replayReasoningCases(bundle).cases.find(c=>c.id==='expert-priority-expanded')!
  const review=structuredClone(sample.review),row=review.claims.find(c=>c.id==='drivers.0.text:0')!
  Object.assign(row,{support:'supported',issue:'style',decision:'refine'})
  const result=assessClaimReview(sample.prepared,review)
  expect(result.errors).toContain('drivers.0.text:0:subclaim_support_overstated')
  expect(()=>correctionPlan(sample.prepared,review)).toThrow('incomplete_claim_review')
  expect(assessClaimReview(sample.prepared,{...sample.review,version:'claim-review/4'}).errors).toEqual(['review_binding_or_shape'])
  const stale=structuredClone(sample.prepared);stale.reasoningPolicyVersion='report-reasoning/0'
  expect(assessClaimReview(stale,sample.review).errors).toEqual(['review_binding_or_shape'])
  expect(()=>claimReviewContract(stale)).toThrow('obsolete_claim_review_input')
})

it('keeps corrected-copy rechecks pending and invalidates the old comparison review after an authorized exact edit',()=>{
  const sample=replayReasoningCases(bundle).cases.find(c=>c.id==='expert-priority-expanded')!
  const item=sample.plan!.items[0]
  const before=structuredClone(sample.content)
  const edited=applyCorrections({packet:sample.packet,content:sample.content,plan:sample.plan,
    patches:[{id:item.id,target:item.target,claimHash:item.claimHash,before:item.quote,after:'Vantrust는 국채금리를 더 중요한 압력으로 평가했다.'}]})
  expect(edited).toMatchObject({status:'requires_recheck',humanReviewStatus:'unverified',publicationApproved:false})
  expect(edited.content.drivers[0].text).toBe('Vantrust는 국채금리를 더 중요한 압력으로 평가했다.')
  expect(sample.content).toEqual(before)
  const recheck=prepareClaimReview(sample.packet,edited.content)
  expect(assessClaimReview(recheck,sample.review).errors).toEqual(['review_binding_or_shape'])
})
