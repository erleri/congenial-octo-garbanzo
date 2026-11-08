// One extra, source-bound local comparison. The ordinary three-call cap stays.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const byteHash = value => createHash('sha256').update(value).digest('hex')
export const BOUNDED_RETEST_VERSION = 'bounded-fx-retest/1'
// Separately approved final writer-contract comparison; never reuses fourth-call consent.
export const WRITER_RETEST_VERSION = 'bounded-fx-retest/2'

export function boundedRetestAuthorized(plan, approval, journal) {
  const scope = plan?.boundedRetest
  const previousCount = scope?.version === BOUNDED_RETEST_VERSION ? 3 : scope?.version === WRITER_RETEST_VERSION ? 4 : 0
  return previousCount > 0 && Array.isArray(journal) && journal.length === previousCount && plan.purpose === 'fx_explanation'
    && scope.extraCalls === 1 && scope.maximumCalls === previousCount + 1
    && (previousCount === 3 || approval?.maximumCallsAfterThisTrial === 5 && plan.outputContract?.writingContractVersion === 'writer-links/1')
    && scope.requestHash === plan.requestHash && scope.journalHash === hash(journal)
    && typeof scope.proposalFile === 'string' && /^[a-f0-9]{64}$/.test(scope.proposalSha256 ?? '')
    && approval?.extraTrialAuthorized === true && approval.maximumNewCalls === 1 && approval.retestAuthorized === true
    && approval.authorized === true && approval.planHash === hash(plan)
    && Number.isFinite(approval.newBudgetUsd) && approval.newBudgetUsd > 0 && approval.newBudgetUsd <= .25
    && plan.maximumUsd <= approval.newBudgetUsd && plan.retestOf === journal.at(-1).requestHash
    && JSON.stringify(approval.previousRequestHashes) === JSON.stringify(journal.map(r => r.requestHash))
    && new Set(journal.map(r => r.requestHash)).size === previousCount && !journal.some(r => r.requestHash === plan.requestHash)
    && journal.every((r, i) => r.currency === plan.currency && r.baseDate === plan.baseDate && r.status === 'output_hold'
      && r.reservedUsd === 0 && Number.isFinite(r.costUsd) && r.costUsd >= 0 && (!i || r.retestOf === journal[i - 1].requestHash))
    && Math.abs(approval.budgetUsd - journal.reduce((n, r) => n + r.costUsd, approval.newBudgetUsd)) < 1e-9
}

export async function verifyBoundedRetestFiles({data, journal, root}) {
  if (!data.plan?.boundedRetest) return
  if (!boundedRetestAuthorized(data.plan, data.approval, journal)) throw Error('bounded_retest_consent_required')
  let privateRoot = await fs.realpath(root)
  while (!(path.basename(privateRoot) === 'private' && path.basename(path.dirname(privateRoot)) === '.local-reports')) {
    const parent = path.dirname(privateRoot)
    if (parent === privateRoot) throw Error('private_retest_root_required')
    privateRoot = parent
  }
  const workspace = path.dirname(path.dirname(privateRoot))
  const reviewableRoot = await fs.realpath(path.join(workspace, '.local-reports/reviewable'))
  const readBound = async ({file, sha256}, privateOnly = false) => {
    const target = await fs.realpath(path.resolve(workspace, file))
    if (!(target.startsWith(privateRoot + path.sep) || !privateOnly && target.startsWith(reviewableRoot + path.sep)))
      throw Error('bounded_retest_artifact_path')
    const bytes = await fs.readFile(target)
    if (byteHash(bytes) !== sha256) throw Error('bounded_retest_artifact_changed')
    return JSON.parse(bytes)
  }
  const scope = data.plan.boundedRetest
  const proposal = await readBound({file:scope.proposalFile, sha256:scope.proposalSha256}, true)
  const {boundedRetest: omitted, ...basePlan} = data.plan
  if (!omitted || proposal.version !== scope.version || proposal.basePlanHash !== hash(basePlan)
    || proposal.packetHash !== hash(data.packet) || proposal.dossierHash !== hash(data.dossier)
    || proposal.requestHash !== data.plan.requestHash || proposal.journalHash !== hash(journal)
    || proposal.newBudgetUsd !== data.approval.newBudgetUsd || proposal.extraCalls !== 1 || proposal.maximumCalls !== scope.maximumCalls
    || JSON.stringify(Object.keys(proposal.preserved ?? {}).sort()) !== JSON.stringify(['baselineReport','previousDraft','previousInput','previousJournal']))
    throw Error('bounded_retest_proposal_changed')
  const artifacts = Object.fromEntries(await Promise.all(Object.entries(proposal.preserved).map(async ([key, entry]) => [key, await readBound(entry)])))
  if (hash(artifacts.previousJournal) !== hash(journal) || artifacts.previousInput.plan?.requestHash !== journal.at(-1).requestHash
    || artifacts.baselineReport.id !== proposal.baselineReportId) throw Error('bounded_retest_history_changed')
}
