import {describe,it,expect} from 'vitest'
import {prepareMxnPolicyBackground,BANXICO_POLICY_REVIEWED} from './mxn-writing-input.js'
import {bindFxWritingBackground,projectFxWritingBackground,fxBackgroundClaimIssues,FX_BACKGROUND_INSTRUCTIONS,backgroundFactIds} from './fx-writing-background.js'
import {INEGI_CONSUMER_INSTRUCTIONS} from './inegi-writing-context.js'

// Synthetic reviewer records over a registered document identity, not a new content review.
function fixture() {
 const policy=prepareMxnPolicyBackground({documentSha256:BANXICO_POLICY_REVIEWED.sha256,collectedAt:'2026-10-27T15:31:05Z',
  review:{origin:'agent',status:'checked',reason:'합성 정책 범위와 공통 입력 경계만 검증한다.'}})
 return {currency:'MXN',purpose:'fx_explanation',baseDate:'2026-10-28',facts:[policy.fact],evidence:[policy.evidence],evidenceScopeCards:[policy.scope],
  marketData:{reportPriceBasis:{asOf:'2026-10-28T00:40:00+09:00'}},
  fxWritingBackground:bindFxWritingBackground({asOf:'2026-10-28T00:40:00+09:00',policyEvidenceIds:[policy.evidence.id]})}
}
describe('FX writer background projection',()=>{
 it('keeps numeric slots in the economic contract while the FX writer uses code-owned background facts',()=>{
  expect(INEGI_CONSUMER_INSTRUCTIONS).toContain('{{fact_id}}')
  expect(FX_BACKGROUND_INSTRUCTIONS).not.toContain('{{fact_id}}')
  expect(FX_BACKGROUND_INSTRUCTIONS).toContain('정성적 설명과 evidenceIds만')
  const p=fixture(),before=structuredClone(p)
  expect(backgroundFactIds(p,[p.evidence[0].id])).toEqual(['mxn_policy_rate'])
  expect(backgroundFactIds(p,['unregistered-neighbour'])).toEqual([])
  expect(p).toEqual(before)
 })
 it('preserves an earlier policy decision as background without a fabricated event time, private receipt or publication approval',()=>{
  const p=fixture(),before=structuredClone(p),sent=projectFxWritingBackground(p)
  expect(sent).toMatchObject({role:'background_only',directCauseAllowed:false,consumerContext:null})
  expect(sent.policyBackground[0]).toMatchObject({role:'policy_background_only',publishedAt:'2026-09-24',decisionAt:null,publisher:'Banco de México'})
  expect(sent.policyBackground[0].scope.scope.comparison).toBe('decision_level_not_market_reaction')
  expect(JSON.stringify(sent)).not.toMatch(/rawSha256|checkedOn|documentSha256/)
  expect(p).toEqual(before)
 })
 it('rejects an altered context, unregistered neighbouring material or scope changed after review',()=>{
  const changed=fixture();changed.fxWritingBackground.asOf='2026-10-28T02:00:00+09:00'
  expect(()=>projectFxWritingBackground(changed)).toThrow('binding')
  const adjacent=fixture();adjacent.evidence.push({...adjacent.evidence[0],id:'unregistered-neighbour'})
  expect(()=>projectFxWritingBackground(adjacent)).toThrow('background_source')
  const scope=fixture();scope.evidenceScopeCards[0].scope.metric='consumer_loan_rate'
  expect(()=>projectFxWritingBackground(scope)).toThrow('scope_card')
 })
 it('allows reviewed background in business context and rejects its use as an FX driver',()=>{
  const p=fixture(),id=p.evidence[0].id
  expect(fxBackgroundClaimIssues(p,{drivers:[],implications:[{evidenceIds:[id]}]})).toEqual([])
  expect(fxBackgroundClaimIssues(p,{drivers:[{evidenceIds:[id]}],implications:[]})).toEqual(['background_used_as_fx_driver:0'])
  expect(fxBackgroundClaimIssues(p,{drivers:[],implications:[{evidenceIds:['market-source']}]})).toEqual(['unreviewed_business_background:0'])
 })
})
