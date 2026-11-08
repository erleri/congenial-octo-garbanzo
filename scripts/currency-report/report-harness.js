// Opt-in compiler/inspector over the existing writer and review contracts.
// Does not load environment, call models, alter old reports or approve publication.
import { compileBrief, HARNESS_VERSION, fingerprint } from './research-harness.js'
import { requestBody } from './openrouter.js'
import { prepareClaimReview, assessClaimReview, claimReviewContract } from './claim-review.js'
import { READER_CRITERIA, inspectEditorial } from './editorial.js'
import {writerProfile} from './writer-policy.js'

export function harnessRequest(packet, dossier, writer) {
  const brief = compileBrief(packet, dossier)
  if (brief.status !== 'ready_for_draft') return { status: 'research_needed', brief, request: null, publicationApproved: false }
  // Local compiler default only; deployed free/optional-AI transport is separate.
  // The paid runner still binds the profile, budget, approval and live preflight.
  const request = requestBody(packet, 'openrouter/free', 'strict', dossier)
  request.model=writerProfile(writer).model
  return { version: HARNESS_VERSION, status: 'prepared_not_called', brief, request,
    requestHash: fingerprint(request), publicationApproved: false }
}

// Every sentence remains in the denominator, including malformed/missing reviews.
// Citation linkage, source entailment and reader value are separate measurements.
export function auditHarnessReport({ packet, content, ledger, review }) {
  const prepared = prepareClaimReview(packet, content)
  const assessment = assessClaimReview(prepared, review)
  const normalize = text => text.replace(/\s/gu, '')
  const sentences = prepared.claims.map(c => {
    const explicit = (ledger?.claims ?? []).filter(row => row.target === c.target &&
      typeof row.quote === 'string' && normalize(row.quote) === normalize(c.quote))
    const refs = [...new Set(explicit.flatMap(row => row.evidenceIds ?? []))]
    const applications = [...new Set(explicit.map(row => row.applicationId).filter(Boolean))]
    const idsValid = refs.every(id => packet.evidence.some(e => e.id === id)) &&
      applications.every(id => prepared.applicableMechanisms.some(a => a.applicationId === id))
    const row = assessment.rows.find(row => row.id === c.id)
    const category = c.owner === 'code' ? 'code_owned' : explicit.length !== 1 ? 'unmapped' :
      !idsValid ? 'invalid_reference' : refs.length || applications.length ? 'linked' : 'uncited'
    // An invalid review cannot count as successful semantic verification.
    const support = assessment.errors.length ? 'unverified' : row?.support ?? 'unverified'
    return { id: c.id, quote: c.quote, category, referenceIds: refs, applicationIds: applications,
      support, disposition: assessment.errors.length ? 'verification_pending' : row?.disposition ?? 'verification_pending',
      reason: assessment.errors.length ? '검토 계약 또는 원문 연결이 불완전하여 의미 검증 성공으로 집계하지 않음.' : row?.reason ?? '검토 기록 없음.' }
  })
  const count = predicate => sentences.filter(predicate).length
  const sourceLinked = count(s => s.category === 'linked'), total = sentences.length
  return { version: HARNESS_VERSION, contentHash: fingerprint(content), binding: prepared.binding, sentences,
    status: !prepared.automatic.valid || prepared.editorial.blockers.length ? 'safety_hold' :
      count(s => s.disposition === 'required_correction') ? 'needs_revision' :
        count(s => s.support === 'unverified') ? 'verification_pending' :
          count(s => ['unmapped', 'uncited', 'invalid_reference'].includes(s.category)) ? 'mapping_needed' : 'reader_review_pending',
    metrics: { totalSentences: total, codeOwned: count(s => s.category === 'code_owned'), sourceLinked,
      unmapped: count(s => s.category === 'unmapped'), uncited: count(s => s.category === 'uncited'),
      invalidReferences: count(s => s.category === 'invalid_reference'),
      supported: count(s => s.support === 'supported'), unverified: count(s => s.support === 'unverified'),
      requiredCorrections: count(s => s.disposition === 'required_correction'),
      optionalRefinements: count(s => s.disposition === 'optional_refinement'),
      supportedShareOfAllSentences: total ? count(s => s.support === 'supported') / total : null },
    automatic: prepared.automatic, editorialSignals: inspectEditorial(content), sourceReview: assessment,
    readerReview: { status: 'unverified', criteria: READER_CRITERIA },
    reviewerContract: claimReviewContract(prepared),
    note: '연결 비율은 사실 정확도가 아니다. 검토자의 supported 판단도 별도 사람 승인이나 객관적 정답이 아니다.',
    publicationApproved: false }
}
