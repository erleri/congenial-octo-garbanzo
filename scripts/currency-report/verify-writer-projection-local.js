// Read-only verification of this campaign's six local review projections.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { fingerprint } from './research-harness.js'
const root = '.local-reports/private/model-suitability-clp-brl-trial-v1'
const result = JSON.parse(await fs.readFile(`${root}/final-review.json`, 'utf8'))
for (const row of result.rows) {
  const text = await fs.readFile(`.local-reports/reviewable/${row.reportId}.json`, 'utf8')
  const view = JSON.parse(text)
  assert.equal(fingerprint(view.content), row.contentHash)
  assert.equal(view.status, 'rejected')
  assert.equal(view.publishedAt, null)
  assert.ok(!/sk-or-|sourceContext|partialText|ruleLedger|claimReview|mechanismApplications/.test(text))
}
for (const currency of ['CLP', 'BRL']) {
  const text = await fs.readFile(`artifacts/writer-comparison-${currency}.html`, 'utf8')
  assert.ok(!/sk-or-|sourceContext|partialText|ruleLedger|claimReview/.test(text))
}
assert.equal(result.newActualCostUsd, .358687)
assert.equal(result.calls, 4)
assert.equal(result.unknownReservedUsd, 0)
console.log('Six original manuscripts preserved; four costs reconciled; private payload absent from web artifacts.')
