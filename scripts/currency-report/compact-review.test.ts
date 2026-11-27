import {expect,it} from 'vitest'
import {runtimeFixture,syntheticRuntimeTransport} from './runtime-fixture.js'
import {prepareRuntimeReview,assessRuntimeReview} from './runtime.js'
import {encodeCompactReview,decodeCompactReview} from './compact-review.js'
import {decodeReviewInput} from './review-transport.js'

it('preserves complete sentence and subclaim verdicts while emitting short original-bound anchor references',()=>{
 const f=runtimeFixture(),t=syntheticRuntimeTransport(f.task),selected=prepareRuntimeReview(f.task,t.compiled)
 const raw=encodeCompactReview(t.compiled.claimReview,t.reviewOutput),before=structuredClone(raw)
 const decoded=decodeCompactReview(t.compiled.claimReview,raw,selected.reviewTransport)
 expect(raw.review.claims.every(r=>r.anchors.every(a=>typeof a==='string'))).toBe(true)
 expect(raw.review.claims).toHaveLength(t.compiled.claimReview.claims.length)
 expect(assessRuntimeReview(t.compiled,{...decoded,review:{...decoded.review,reviewer:'Synthetic test'}}).validation.contentReview).toBe('passed')
 expect(decodeReviewInput(JSON.parse(selected.body.messages[1].content)).sources).toEqual(t.compiled.claimReview.sources)
 const {claims}=decodeReviewInput(JSON.parse(selected.body.messages[1].content))
 for(const claim of t.compiled.claimReview.claims)expect(claims.find(c=>c.id===claim.id).eligibleAnchorRefs).toEqual(
  selected.reviewTransport.anchors.filter(a=>claim.evidenceIds.includes(a.evidenceId)).map(a=>a.ref))
 expect(selected.body.messages[0].content).toContain('unverified/keep/verification_gap')
 expect(raw).toEqual(before);expect(JSON.stringify(raw).length).toBeLessThan(JSON.stringify(t.reviewOutput).length)
})

it('reports missing PEN-style anchors at the exact summary and subclaim positions',()=>{
 const f=runtimeFixture('PEN'),t=syntheticRuntimeTransport(f.task),selected=prepareRuntimeReview(f.task,t.compiled)
 const raw=encodeCompactReview(t.compiled.claimReview,t.reviewOutput)
 const row=raw.review.claims.find(c=>c.id.startsWith('summary:'))
 row.anchors=[]
 row.subclaims[0].anchors=[]
 const assess=()=>assessRuntimeReview(t.compiled,decodeCompactReview(t.compiled.claimReview,raw,selected.reviewTransport),
  {model:selected.body.model,route:selected.profile.route})
 expect(assess().validation.contentReview).toBe('unverified')
 expect(assess().qualityIssues).toEqual([
  {target:'summary',sentence:0,code:'original_support_missing'},
  {target:'summary',sentence:0,subclaim:0,code:'subclaim_support_missing'},
 ])
 row.support='unverified'
 row.issue='verification_gap'
 row.subclaims[0].support='unverified'
 expect(assess().verdict.errors).toEqual([])
 expect(assess()).toMatchObject({validation:{contentReview:'unverified'},
  qualityIssues:[{target:'summary',sentence:0,code:'review_evidence_unverified'}]})
})

it('rejects an otherwise valid anchor from a different source for one clause',()=>{
 const f=runtimeFixture(),t=syntheticRuntimeTransport(f.task),selected=prepareRuntimeReview(f.task,t.compiled)
 const raw=encodeCompactReview(t.compiled.claimReview,t.reviewOutput)
 const claim=t.compiled.claimReview.claims.find(c=>c.target==='drivers.0.text')
 const unrelated=selected.reviewTransport.anchors.find(a=>!claim.evidenceIds.includes(a.evidenceId))
 expect(unrelated).toBeDefined()
 const row=raw.review.claims.find(c=>c.id===claim.id)
 row.subclaims[0].anchors=[unrelated.ref]
 const result=assessRuntimeReview(t.compiled,decodeCompactReview(t.compiled.claimReview,raw,selected.reviewTransport),
  {model:selected.body.model,route:selected.profile.route})
 expect(result.validation.contentReview).toBe('unverified')
 expect(result.qualityIssues).toContainEqual({target:claim.target,sentence:Number(claim.id.split(':').at(-1)),subclaim:0,code:'invalid_original_anchor'})
})

it('rejects unknown anchors and a changed transport table and cannot turn unsupported subclaims into a pass',()=>{
 const f=runtimeFixture(),t=syntheticRuntimeTransport(f.task),selected=prepareRuntimeReview(f.task,t.compiled)
 const raw=encodeCompactReview(t.compiled.claimReview,t.reviewOutput),bad=structuredClone(raw)
 bad.review.claims[0].anchors=['unknown']
 expect(()=>decodeCompactReview(t.compiled.claimReview,bad,selected.reviewTransport)).toThrow('unknown_anchor')
 const changed=structuredClone(selected.reviewTransport);changed.anchors[0].quote+=' silent change'
 expect(()=>decodeCompactReview(t.compiled.claimReview,raw,changed)).toThrow('binding_changed')
 const unsupported=structuredClone(raw),r=unsupported.review.claims[0]
 r.support='unsupported';r.decision='rewrite';r.issue='claim_scope';r.subclaims[0].support='unsupported'
 const decoded=decodeCompactReview(t.compiled.claimReview,unsupported,selected.reviewTransport)
 expect(assessRuntimeReview(t.compiled,{...decoded,review:{...decoded.review,reviewer:'Synthetic test'}}).validation.contentReview).toBe('unverified')
})

it('retains the frozen legacy review wire for saved tasks without a new transport version',()=>{
 const f=runtimeFixture(),t=syntheticRuntimeTransport(f.task),old={...f.task}
 delete old.reviewTransportVersion
 const request=prepareRuntimeReview(old,t.compiled)
 expect(request).not.toHaveProperty('reviewTransport')
 expect(JSON.parse(request.body.messages[1].content).encoding).toBe('review-text-dictionary/1')
 expect(request.localSchema.properties.review.properties.claims.items.properties).toHaveProperty('claimHash')
 const frozen=prepareRuntimeReview({...f.task,reviewCoverageGuideVersion:'coverage-targets/1'},t.compiled)
 const legacyInput=decodeReviewInput(JSON.parse(frozen.body.messages[1].content))
 expect(legacyInput).toHaveProperty('eligibleCoverageTargets')
 expect(legacyInput.claims).toEqual(t.compiled.claimReview.claims)
})
