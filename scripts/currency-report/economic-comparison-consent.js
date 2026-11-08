// A one-off, explicitly approved comparison, not a higher campaign default.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const bytesHash = value => createHash('sha256').update(value).digest('hex')
export const ECONOMIC_COMPARISON_CONSENT = Object.freeze({
  version: 'economic-editorial-comparison-consent/1', currency: 'CLP', baseDate: '2026-10-09',
  requestHash: 'a2956e8b0d92aa8d685c490267298ef96fa904d2ac23ef81c7b5962a6a6ff2f4',
  newBudgetUsd: .16, maximumCalls: 4,
})

export function scopedComparisonAuthorized(plan, approval, journal) {
  const scope = plan?.scopedComparison, policy = ECONOMIC_COMPARISON_CONSENT
  return Array.isArray(journal) && journal.length === 3 && scope?.version === policy.version
    && plan.currency === policy.currency && plan.baseDate === policy.baseDate && plan.purpose === 'economic_update'
    && plan.requestHash === policy.requestHash && scope.requestHash === policy.requestHash
    && plan.editorialPlan?.version === 'economic-editorial/1' && plan.editorialPlan.watchCandidates?.length === 0
    && approval?.scopedComparisonAuthorized === true && approval.newBudgetUsd === policy.newBudgetUsd
    && scope.journalHash === hash(journal) && scope.maximumCalls === policy.maximumCalls
    && /^[a-f0-9]{64}$/.test(scope.proposalHash ?? '') && typeof scope.proposalFile === 'string'
    && journal.every((r, i) => r.currency === policy.currency && r.baseDate === policy.baseDate
      && Number.isFinite(r.costUsd) && r.costUsd >= 0 && r.reservedUsd === 0
      && r.status === (i === 2 ? 'schema_and_content_review_required' : 'output_hold'))
    && Math.abs(approval.budgetUsd - journal.reduce((n, r) => n + r.costUsd, policy.newBudgetUsd)) < 1e-9
}

export async function verifyScopedComparisonFiles({ data, journal, root }) {
  if (!data.plan?.scopedComparison) return
  if (!scopedComparisonAuthorized(data.plan, data.approval, journal)) throw new Error('scoped_comparison_binding_required')
  const workspace = await fs.realpath(path.resolve(root, '../../..'))
  const privateRoot = await fs.realpath(path.join(workspace, '.local-reports/private'))
  const reviewableRoot = await fs.realpath(path.join(workspace, '.local-reports/reviewable'))
  const readBound = async (file, expected, privateOnly = false) => {
    const target = await fs.realpath(path.resolve(workspace, file))
    if (!(target.startsWith(privateRoot + path.sep) || !privateOnly && target.startsWith(reviewableRoot + path.sep)))
      throw new Error('comparison_artifact_path_required')
    const bytes = await fs.readFile(target)
    if (bytesHash(bytes) !== expected) throw new Error('comparison_artifact_changed')
    return bytes
  }
  const scope = data.plan.scopedComparison
  const proposal = JSON.parse(await readBound(scope.proposalFile, scope.proposalHash, true))
  const { scopedComparison: ignored, ...preparedPlan } = data.plan
  if (!ignored || proposal.version !== 'economic-editorial-comparison-proposal/1'
    || proposal.planHash !== hash(preparedPlan) || proposal.packetHash !== hash(data.packet)
    || proposal.requestHash !== data.plan.requestHash || proposal.baselineRequestHash !== data.plan.retestOf
    || JSON.stringify(proposal.previousRequestHashes) !== JSON.stringify(journal.map(r => r.requestHash))
    || proposal.proposedNewBudgetUsd !== .16 || proposal.requiredConsent?.extraCalls !== 1
    || proposal.requiredConsent?.maximumCallsAfterThisComparison !== 4)
    throw new Error('comparison_proposal_binding_required')
  const required = ['input', 'journal', 'baseline', 'review', 'report', 'comparison', 'ipc', 'wage']
  if (JSON.stringify(Object.keys(proposal.preserved).sort()) !== JSON.stringify(required.sort()))
    throw new Error('comparison_preservation_required')
  const artifacts = Object.fromEntries(await Promise.all(required.map(async key => {
    const entry = proposal.preserved[key]
    return [key, await readBound(entry.file, entry.sha256)]
  })))
  const baseline = JSON.parse(artifacts.baseline), review = JSON.parse(artifacts.review), report = JSON.parse(artifacts.report)
  if (hash(JSON.parse(artifacts.journal)) !== hash(journal) || baseline.costUsd !== journal.at(-1).costUsd
    || review.assessment?.status !== 'needs_revision' || !review.assessment.requiredCorrections?.length
    || report.id !== proposal.baselineReportId || report.status !== 'rejected')
    throw new Error('comparison_review_preservation_required')
}
