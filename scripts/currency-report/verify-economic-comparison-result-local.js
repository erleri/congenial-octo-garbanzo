// Offline guard/privacy checks plus loopback read-only diagnostics. No API POST.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { parse } from 'dotenv'
import { executeApprovedEventTrial } from './lifecycle-control.js'
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const root = path.resolve('.local-reports/private/event-trials')
const input = JSON.parse(await fs.readFile('.local-reports/private/economic-approved-comparisons/run-RSCtjg/trial-input.json', 'utf8'))
const journalBytes = await fs.readFile(path.join(root, 'journal.json')), journal = JSON.parse(journalBytes)
const result = JSON.parse(await fs.readFile(path.join(root, 'run-3zNSmb/result.json'), 'utf8'))
assert.equal(journal.length, 4); assert.equal(result.response.generationCalls, 1); assert.equal(result.response.retries, 0)
assert.equal(hash(input.plan.body), input.plan.requestHash)
assert.equal(journal.at(-1).costUsd, result.costUsd)
const originalFetch = globalThis.fetch
let externalCalls = 0
globalThis.fetch = async () => { externalCalls++; throw new Error('unexpected_network_connection') }
try {
  await assert.rejects(executeApprovedEventTrial({ ...input, journal, trialRoot: root, claim: async () => { throw new Error('unexpected_claim') } }), /scoped_comparison_binding_required/)
} finally { globalThis.fetch = originalFetch }
assert.equal(externalCalls, 0); assert.deepEqual(await fs.readFile(path.join(root, 'journal.json')), journalBytes)
const key = parse(await fs.readFile('.env.report.local', 'utf8')).OPENROUTER_API_KEY
assert.ok(key)
const artifacts = []
async function scan(folder) {
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name)
    if (entry.isDirectory()) await scan(file)
    else {
      const bytes = await fs.readFile(file)
      assert.ok(!bytes.includes(Buffer.from(key)), 'credential must not appear in browser artifacts')
      artifacts.push(file)
    }
  }
}
await scan('dist'); await scan('dist-report-ui')
const publicResponse = await fetch('http://127.0.0.1:4175/__report/CLP-2026-10-09-1791732283970?mode=live-local')
assert.equal(publicResponse.status, 200)
const privateResponse = await fetch('http://127.0.0.1:4175/.local-reports/private/event-trials/journal.json')
assert.equal(privateResponse.status, 403)
const report = JSON.parse(await fs.readFile('.local-reports/reviewable/CLP-2026-10-09-1791732283970.json', 'utf8'))
assert.deepEqual(await publicResponse.json(), report)
const publicText = JSON.stringify(report)
assert.ok(!publicText.includes(key))
for (const field of ['sourceContext', 'claimLedger', 'scopeCards', 'messages', 'partialText', 'responseId', 'usage'])
  assert.ok(!publicText.includes('"' + field + '"'), 'private execution details must stay out of report')
const verification = { version: 'economic-comparison-verification/1', newModelCalls: 0, fifthCallBlockedBeforeConnection: true,
  guardedExternalCalls: externalCalls, journalUnchanged: true, scannedBrowserFiles: artifacts.length, credentialLeak: false,
  privateFileHttpStatus: privateResponse.status, publicReportHttpStatus: publicResponse.status,
  scope: 'Local saved trial and browser artifacts only; does not assert release or publication readiness.' }
await fs.writeFile(path.join(root, 'run-3zNSmb/verification.json'), JSON.stringify(verification, null, 2), { flag: 'wx' })
console.log(JSON.stringify(verification))
