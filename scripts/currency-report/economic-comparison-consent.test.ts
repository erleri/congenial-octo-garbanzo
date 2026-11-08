import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { ECONOMIC_COMPARISON_CONSENT, scopedComparisonAuthorized, verifyScopedComparisonFiles } from './economic-comparison-consent.js'
import { runLocalTrial } from './run-event-trial.js'
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const bytesHash = (v: string) => createHash('sha256').update(v).digest('hex')
function comparison() {
  const journal = ['one', 'two', 'three'].map((requestHash, i) => ({ currency: 'CLP', baseDate: '2026-10-09', requestHash,
    retestOf: i ? ['one', 'two'][i - 1] : null, costUsd: .02, reservedUsd: 0, status: i === 2 ? 'schema_and_content_review_required' : 'output_hold' }))
  const packet = { currency: 'CLP', baseDate: '2026-10-09' }
  const preparedPlan = { purpose: 'economic_update', currency: packet.currency, baseDate: packet.baseDate,
    requestHash: ECONOMIC_COMPARISON_CONSENT.requestHash, retestOf: 'three', editorialPlan: { version: 'economic-editorial/1', watchCandidates: [] } }
  const plan = { ...preparedPlan, scopedComparison: { version: ECONOMIC_COMPARISON_CONSENT.version, requestHash: preparedPlan.requestHash,
    journalHash: hash(journal), maximumCalls: 4, proposalFile: '.local-reports/private/proposal.json', proposalHash: '0'.repeat(64) } }
  const approval = { authorized: true, planHash: hash(plan), scopedComparisonAuthorized: true, budgetUsd: .22, newBudgetUsd: .16 }
  return { packet, plan, preparedPlan, approval, journal }
}
describe('one-off approved economic comparison', () => {
  it('binds exactly one fourth request without raising the default or reopening unknown costs', () => {
    const { plan, approval, journal } = comparison()
    expect(scopedComparisonAuthorized(plan, approval, journal)).toBe(true)
    for (const change of [
      { plan: { ...plan, requestHash: 'another-request' }, approval, journal },
      { plan, approval: { ...approval, scopedComparisonAuthorized: false }, journal },
      { plan, approval: { ...approval, newBudgetUsd: .17 }, journal },
      { plan, approval, journal: [...journal, { ...journal[2], requestHash: plan.requestHash }] },
      { plan, approval, journal: journal.map((r, i) => i === 2 ? { ...r, costUsd: null, status: 'cost_unresolved' } : r) },
      { plan, approval, journal: journal.map((r, i) => i === 0 ? { ...r, costUsd: .03 } : r) },
    ]) expect(scopedComparisonAuthorized(change.plan, change.approval, change.journal)).toBe(false)
  })
  it('checks all immutable originals and rejects changed review/source files before invoking a transport', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'latamfx-comparison-proof-'))
    const root = path.join(workspace, '.local-reports/private/event-trials')
    await fs.mkdir(root, { recursive: true }); await fs.mkdir(path.join(workspace, '.local-reports/reviewable'))
    const data = comparison(), preserved: Record<string, { file: string; sha256: string }> = {}
    const values = { input: '{}', journal: JSON.stringify(data.journal), baseline: '{"costUsd":0.02}',
      review: '{"assessment":{"status":"needs_revision","requiredCorrections":["summary:1"]}}',
      report: '{"id":"old","status":"rejected"}', comparison: '{}', ipc: '<p>original IPC</p>', wage: '<p>original wages</p>' }
    for (const [key, text] of Object.entries(values)) {
      const file = key === 'journal' ? '.local-reports/private/event-trials/journal.json' : `.local-reports/private/${key}.json`
      await fs.writeFile(path.join(workspace, file), text); preserved[key] = { file, sha256: bytesHash(text) }
    }
    const proposal = { version: 'economic-editorial-comparison-proposal/1', planHash: hash(data.preparedPlan), packetHash: hash(data.packet),
      requestHash: data.plan.requestHash, baselineRequestHash: 'three', baselineReportId: 'old', previousRequestHashes: ['one', 'two', 'three'],
      proposedNewBudgetUsd: .16, requiredConsent: { extraCalls: 1, maximumCallsAfterThisComparison: 4 }, preserved }
    const text = JSON.stringify(proposal)
    await fs.writeFile(path.join(workspace, data.plan.scopedComparison.proposalFile), text)
    data.plan.scopedComparison.proposalHash = bytesHash(text); data.approval.planHash = hash(data.plan)
    await expect(verifyScopedComparisonFiles({ data, journal: data.journal, root })).resolves.toBeUndefined()
    const invoke = vi.fn()
    await fs.writeFile(path.join(workspace, preserved.ipc.file), '<p>changed source</p>')
    await expect(runLocalTrial({ data, root, apiKey: 'test-key', invoke })).rejects.toThrow('comparison_artifact_changed')
    expect(invoke).not.toHaveBeenCalled()
    expect(JSON.parse(await fs.readFile(path.join(root, 'journal.json'), 'utf8'))).toEqual(data.journal)
    await fs.writeFile(path.join(workspace, preserved.ipc.file), values.ipc)
    await fs.unlink(path.join(workspace, preserved.review.file))
    await expect(verifyScopedComparisonFiles({ data, journal: data.journal, root })).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
