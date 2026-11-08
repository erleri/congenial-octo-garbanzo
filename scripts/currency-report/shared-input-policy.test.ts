import {expect,it} from 'vitest'
import {prepareSharedWriter,compileSharedWriterOutput} from './shared-writer.js'
import {sharedWriterFixture,sharedDraftFixture} from './shared-writer-fixture.js'
import {fingerprint} from './research-harness.js'
import {REASONING_WRITER_INSTRUCTIONS,REASONING_REVIEW_INSTRUCTIONS} from './reasoning-policy.js'
import {claimReviewContract,assessClaimReview,CLAIM_REVIEW_VERSION} from './claim-review.js'
import {applySharedClaimTyping,SHARED_CLAIM_TYPING_VERSION} from './shared-claim-typing.js'
import {sharedMarketHeader} from './shared-writing-contract.js'

const reseal=(h:ReturnType<typeof sharedWriterFixture>)=>{const c=h.materialConnection;delete c.binding;c.binding=fingerprint(c);return h}

it('admits source-linked market directions to content review for every currency while refusing unknown or wrong-session links',()=>{
 for(const currency of ['BRL','MXN','COP','PEN','CLP','ARS']){
  const plan=prepareSharedWriter({handoff:sharedWriterFixture(currency,false)}),raw=sharedDraftFixture(plan)
  raw.summary='기사 대상 거래일의 달러 약세와 현지 수급을 구분한 시장 해설입니다.'
  expect(compileSharedWriterOutput({plan,draft:raw}).validation.valid).toBe(true)
  expect(compileSharedWriterOutput({plan,draft:raw}).contentReview).toBe('pending_separate_review')
  const bad=structuredClone(raw);bad.ruleLedger.claims.find(r=>r.target==='summary').materialClaimIds=['invented']
  expect(compileSharedWriterOutput({plan,draft:bad}).validation.valid).toBe(false)
  expect(sharedMarketHeader(plan.packet,bad,'summary')).toBe(false)
  const packet=structuredClone(plan.packet);packet.sharedReference.commentaryDate='2026-10-26'
  expect(sharedMarketHeader(packet,raw,'summary')).toBe(false)
  Object.assign(packet.sharedReference,{commentaryDate:null})
  packet.evidence.flatMap(e=>e.sharedNotes.claims).forEach(n=>Object.assign(n,{sourceSessionDate:null}))
  expect(sharedMarketHeader(packet,raw,'summary')).toBe(false)
 }
})

it('sends the common instructions once and preserves the same note context and article version for the reviewer',()=>{
 const h=sharedWriterFixture()
 for(const n of Object.values(h.materialConnection.sections).flat())Object.assign(n,{
  writingContext:{periodMeaning:'session',observationWindow:'intraday',constraint:'합성 장중 조건은 실제 마감 확정으로 바꾸지 않는다.'},
  sourceVersion:{publishedAt:'2026-10-27',modifiedAt:null,bodyAvailableBy:'2026-10-28T01:00:00Z'}})
 const p=prepareSharedWriter({handoff:reseal(h)}),result=compileSharedWriterOutput({plan:p,draft:sharedDraftFixture(p)})
 expect(p.body.messages[0].content.split(REASONING_WRITER_INSTRUCTIONS).length-1).toBe(1)
 expect(REASONING_REVIEW_INSTRUCTIONS).not.toContain('칠레')
 for(const e of p.packet.evidence){
  const s=result.claimReview.sources.find(s=>s.id===e.id)!
  expect(s.sourceVersion).toEqual(e.sourceVersion);expect(s.articlePriceBasis).toEqual(e.articlePriceBasis)
  for(const n of e.sharedNotes.claims)expect(s.sourceContext.passages.find(n2=>n2.id===n.passageId)?.writingContext).toEqual(n.writingContext)
 }
 expect(result.claimReview.status).toBe('unverified');expect(result.publicationApproved).toBe(false)
})

it('requires explicit source-linked coverage judgments even when optional background is omitted, without forcing it into the manuscript',()=>{
 const p=prepareSharedWriter({handoff:sharedWriterFixture()}),d=sharedDraftFixture(p)
 d.implications={slot_0:null};d.ruleLedger.claims=d.ruleLedger.claims.filter(r=>!r.target.startsWith('implications.'))
 const compiled=compileSharedWriterOutput({plan:p,draft:d}),input=compiled.claimReview
 expect(compiled.validation.valid).toBe(true)
 expect(input.writingCoverageRequirements.map(r=>r.role)).toContain('consumer_background')
 const schema=claimReviewContract(input).schema.properties.writingCoverage.properties.shared_consumer_background
 expect(schema.required).toEqual(['status','reason','treatment','targets'])
 // A deliberately unverified reviewer double: validates disposition handling,
 // not the factual quality of prose or independent source entailment.
 const r={version:CLAIM_REVIEW_VERSION,binding:input.binding,origin:'agent',reviewer:'synthetic coverage reviewer',
  claims:input.claims.map(c=>({id:c.id,claimHash:c.claimHash,support:'unverified',decision:'keep',issue:'verification_gap',
   reason:'합성 검토는 의미 지지의 실제 판정을 수행하지 않는다.',anchors:[],applicationIds:[],
   subclaims:[{quote:c.quote,support:'unverified',reason:'실제 의미 지지는 별도 검토 대상으로 보존한다.',anchors:[],applicationIds:[]}]})),
  writingCoverage:{shared_consumer_background:{status:'pass',treatment:'omitted',targets:[],reason:'이 합성 원고는 시장 설명만 다루므로 별도 소비 배경 생략을 허용한다.'}}}
 expect(assessClaimReview(input,r).writingCoverage.find(c=>c.id==='shared_consumer_background').status).toBe('pass')
 r.writingCoverage.shared_consumer_background.treatment='used'
 expect(assessClaimReview(input,r).writingCoverage.find(c=>c.id==='shared_consumer_background').status).toBe('unverified')
 r.writingCoverage.shared_consumer_background.targets=['drivers.0.text']
 expect(assessClaimReview(input,r).writingCoverage.find(c=>c.id==='shared_consumer_background').status).toBe('unverified')
})

it('applies one foreign-market scope guard to all six currencies, accepting linked context and rejecting unsupported substitutions',()=>{
 const names={BRL:'브라질',MXN:'멕시코',COP:'콜롬비아',PEN:'페루',CLP:'칠레',ARS:'아르헨티나'}
 const currencies=Object.keys(names)
 for(const [i,currency]of currencies.entries()){
  const foreign=names[currencies[(i+1)%currencies.length]],h=sharedWriterFixture(currency,false)
  h.materialConnection.sections.attributed_fx_explanation[0].text=`분석가는 ${foreign} 시장과 현지 통화의 동행을 설명했다.`
  const p=prepareSharedWriter({handoff:reseal(h)}),d=sharedDraftFixture(p)
  expect(compileSharedWriterOutput({plan:p,draft:d}).validation.valid).toBe(true)
  d.drivers.slot_0.text=`분석가는 ${names[currencies[(i+2)%currencies.length]]}의 통화 동행을 설명했다.`
  expect(compileSharedWriterOutput({plan:p,draft:d}).validation.errors).toContain('unlinked_foreign_currency:drivers.0.text')
 }
})

it('rejects consumer-only headlines and summaries without pretending their underlying statistics are false',()=>{
 const p=prepareSharedWriter({handoff:sharedWriterFixture()}),d=sharedDraftFixture(p)
 d.title='소매 지표 상승과 구매 여건';d.summary='별도 소매 자료는 조사 대상 기간의 구매 여건을 설명합니다.'
 for(const target of ['title','summary'])Object.assign(d.ruleLedger.claims.find(r=>r.target===target)!,{
  kind:'fact',evidenceIds:['news-background'],materialClaimIds:['news-background:n0']})
 const correct=compileSharedWriterOutput({plan:p,draft:d})
 expect(correct.validation.valid).toBe(false);expect(correct.validation.errors).toContain('fx_explanation_link_missing:title');expect(correct.validation.errors).toContain('fx_explanation_link_missing:summary')
 expect(correct.contentReview).toBe('pending_separate_review')
 d.ruleLedger.claims.find(r=>r.target==='title')!.materialClaimIds=['news-synthetic:n1']
 expect(compileSharedWriterOutput({plan:p,draft:d}).validation.errors).toContain('direction_in_unverified_header')
 d.title='달러 흐름의 배경'
 Object.assign(d.ruleLedger.claims.find(r=>r.target==='drivers.0.text')!,{materialClaimIds:['news-background:n0'],evidenceIds:['news-background']})
 expect(compileSharedWriterOutput({plan:p,draft:d}).validation.errors).toContain('background_used_as_fx_driver:drivers.0.text')
})

it('groups related attributions without treating all same-URL indicators or distinct statements as duplicate evidence',()=>{
 const h=sharedWriterFixture(),first=h.materialConnection.sections.attributed_fx_explanation[0]
 first.attributions=[{passageId:'n1',person:'Synthetic Analyst',organization:'Synthetic Institute'}]
 h.materialConnection.sections.attributed_fx_explanation.push({...first,evidenceId:'second-source',text:'같은 분석가는 다른 시점에 별도 조건을 언급했다.'})
 const p=prepareSharedWriter({handoff:reseal(h)}),u=JSON.parse(p.body.messages[1].content)
 expect(u.relatedSourceGroups).toHaveLength(1)
 expect(u.relatedSourceGroups[0]).toMatchObject({type:'shared_attribution',sameEvent:'unverified',independence:'not_established_by_publisher_count'})
 expect(u.evidence).toHaveLength(3)
 expect(u.evidence.flatMap(e=>e.claims)).toHaveLength(4)
 expect(u.evidence[0].claims[1].attributions[0]).toMatchObject({passageId:'p1',sourcePassageId:'n1'})
})

it('only applies a bound conservative fact-to-view correction and invalidates it after any change to the source claim',()=>{
 const h=sharedWriterFixture(),n=h.materialConnection.sections.market_observation[0]
 Object.assign(n,{passageIds:['n0']});reseal(h)
 const before=structuredClone(h)
 const review={version:SHARED_CLAIM_TYPING_VERSION,connectionBinding:h.materialConnection.binding,origin:'agent',
  reason:'저장된 귀속 발언의 해석 유형을 보수적으로 바로잡는다.',changes:[{evidenceId:n.evidenceId,claimId:n.claimId,claimBinding:fingerprint(n),
   fromKind:'source_fact',toKind:'source_interpretation',attributions:[{passageId:'n0',person:'Synthetic Analyst',organization:'Synthetic Institute'}],
   reason:'경제적 경로의 귀속 해석을 확정 사실로 표기하지 않는다.'}]}
 const changed=applySharedClaimTyping(h,review)
 expect(changed.materialConnection.sections.market_observation[0]).toMatchObject({kind:'source_interpretation',text:n.text,role:n.role})
 expect(h).toEqual(before)
 expect(prepareSharedWriter({handoff:h,claimTypingReview:review}).packet.evidence[0].sharedNotes.claims[0].kind).toBe('source_interpretation')
 expect(()=>applySharedClaimTyping(h,{...review,changes:[{...review.changes[0],toKind:'source_fact'}]})).toThrow('conservative_shared_claim_typing_required')
 h.materialConnection.sections.market_observation[0].text+=' 변경'
 expect(()=>applySharedClaimTyping(reseal(h),review)).toThrow('bound_shared_claim_typing_required')
})
