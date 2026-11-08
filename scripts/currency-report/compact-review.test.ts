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
 expect(raw).toEqual(before);expect(JSON.stringify(raw).length).toBeLessThan(JSON.stringify(t.reviewOutput).length)
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
})
