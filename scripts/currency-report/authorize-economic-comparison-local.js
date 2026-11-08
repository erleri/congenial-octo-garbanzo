// Run only after explicit consent. This prepares a durable one-call authorization;
// generation remains a separate command, with a campaign lock and reservation.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'
import { ECONOMIC_COMPARISON_CONSENT, verifyScopedComparisonFiles } from './economic-comparison-consent.js'
import { executeEventTrial } from './lifecycle-control.js'
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const bytesHash = value => createHash('sha256').update(value).digest('hex')
const { values } = parseArgs({ options: { proposal: { type: 'string' }, 'approved-new-budget': { type: 'string' } }, strict: true })
async function main() {
  if (values['approved-new-budget'] !== '0.16') throw new Error('explicit_comparison_consent_required')
  const privateRoot = await fs.realpath('.local-reports/private')
  const proposalFile = await fs.realpath(values.proposal)
  if (!proposalFile.startsWith(privateRoot + path.sep)) throw new Error('private_proposal_required')
  const proposalBytes = await fs.readFile(proposalFile), proposal = JSON.parse(proposalBytes)
  const data = JSON.parse(await fs.readFile(path.join(path.dirname(proposalFile), 'trial-input.json'), 'utf8'))
  const journal = JSON.parse(await fs.readFile(path.join(privateRoot, 'event-trials/journal.json'), 'utf8'))
  assert.equal(hash(data.plan), proposal.planHash)
  assert.equal(data.plan.requestHash, ECONOMIC_COMPARISON_CONSENT.requestHash)
  data.plan.scopedComparison = { version: ECONOMIC_COMPARISON_CONSENT.version, requestHash: data.plan.requestHash,
    journalHash: hash(journal), maximumCalls: 4, proposalFile: path.relative(process.cwd(), proposalFile), proposalHash: bytesHash(proposalBytes) }
  data.approval = { authorized: true, planHash: hash(data.plan), budgetUsd: proposal.proposedTotalBudgetUsd, newBudgetUsd: .16,
    retestAuthorized: true, scopedComparisonAuthorized: true, previousRequestHashes: proposal.previousRequestHashes,
    authorization: { origin: 'human_chat', date: '2026-10-12', text: '4번 · 추가 1회·최대 $0.16 승인 — Sol High',
      calls: 1, retries: 0, fallbacks: false, publicationApproved: false } }
  await verifyScopedComparisonFiles({ data, journal, root: path.join(privateRoot, 'event-trials') })
  // Offline proof against the real bound input, no key or fetch. A fifth or a
  // duplicate request fails before even a preflight callback is entered.
  let calls = 0
  const attempt = records => executeEventTrial({ ...data, journal: records,
    preflight: async () => ({ model: data.plan.body.model, route: 'google-vertex/global', zdr: true, dataCollection: 'deny' }),
    claim: async () => {}, invoke: async () => { calls++; return { valid: true, actualModel: data.plan.body.model, costUsd: .03 } } })
  assert.equal((await attempt(journal)).status, 'schema_and_content_review_required')
  await assert.rejects(attempt([...journal, { currency: data.plan.currency, baseDate: data.plan.baseDate,
    requestHash: data.plan.requestHash, costUsd: .03, reservedUsd: 0, status: 'schema_and_content_review_required' }]), /scoped_comparison_binding_required/)
  assert.equal(calls, 1)
  const parent = path.join(privateRoot, 'economic-approved-comparisons')
  await fs.mkdir(parent, { recursive: true })
  const output = await fs.mkdtemp(path.join(parent, 'run-'))
  await fs.writeFile(path.join(output, 'trial-input.json'), JSON.stringify(data, null, 2), { flag: 'wx' })
  await fs.writeFile(path.join(output, 'journal-before.json'), JSON.stringify(journal, null, 2), { flag: 'wx' })
  await fs.writeFile(path.join(output, 'comparison-before.json'), await fs.readFile(proposal.preserved.comparison.file), { flag: 'wx' })
  console.log(JSON.stringify({ output, requestHash: data.plan.requestHash, calculatedMaximumUsd: data.plan.maximumUsd,
    approvedNewBudgetUsd: .16, maximumCalls: 4, preservedAttempts: journal.length, offlineGuardPassed: true, newModelCalls: 0 }))
}
main().catch(e => { console.error(JSON.stringify({ status: 'comparison_authorization_stopped', reason: e.message, code: e.code ?? null })); process.exitCode = 1 })
