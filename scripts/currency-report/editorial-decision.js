import { EDITORIAL_CHECKS, EDITORIAL_VERSION, editorialReviewPassed, inspectEditorial, assessReaderReview } from './editorial.js'
import { fingerprint, grade } from './paid-comparison.js'

// A failed human review can be displayed explicitly, but never promoted to the default.
export function editorialDecision(content, review) {
  const readerReview = assessReaderReview(review?.readerReview)
  if (review?.version !== EDITORIAL_VERSION || review.contentHash !== fingerprint(content) ||
    readerReview.status === 'unverified' ||
    !EDITORIAL_CHECKS.every(key => typeof review.checks?.[key]?.passed === 'boolean' && typeof review.checks[key].reason === 'string' && review.checks[key].reason.trim().length >= 10) ||
    !Array.isArray(review.scores) || review.scores.length !== 5 || review.scores.some(n => !Number.isInteger(n) || n < 1 || n > 5) ||
    !Number.isInteger(review.criticalErrors) || review.criticalErrors < 0 ||
    !Array.isArray(review.notes) || !review.notes.length || review.notes.some(n => typeof n !== 'string' || n.trim().length < 10)) throw new Error('incomplete_editorial_review')
  const quality = grade(review.scores, review.criticalErrors)
  const passed = quality.passed && editorialReviewPassed(review) && inspectEditorial(content).blockers.length === 0
  return { passed, average: quality.average, status: passed ? 'pending_review' : 'rejected', preferred: passed, notes: review.notes,
    readerReview, publicationApproved: false }
}
