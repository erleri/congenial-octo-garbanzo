import {it,expect} from 'vitest'
import {effectiveSourceReview,SOURCE_REVIEW_VALIDITY_VERSION} from './source-review-validity.js'
it('preserves independently accepted /8 notes across the /9 candidate-selection-only change while rechecking older and held decisions',()=>{
 const r={key:'a'.repeat(64),review:{receipt:{cardBinding:'bound-test'},validity:{version:SOURCE_REVIEW_VALIDITY_VERSION,pipelineVersion:'original-news-pipeline/8',state:'usable',supersedes:[]}}}
 const inspect=x=>effectiveSourceReview([x],{pipelineVersion:'original-news-pipeline/9'}).state
 expect(inspect(r)).toBe('usable')
 const old=structuredClone(r);old.review.validity.pipelineVersion='original-news-pipeline/7'
 expect(inspect(old)).toBe('revalidation_required')
 const missing=structuredClone(r);delete missing.review.receipt
 expect(inspect(missing)).toBe('revalidation_required')
 const held=structuredClone(r);held.review.heldStatus='original_support_hold'
 expect(inspect(held)).toBe('held')
})
