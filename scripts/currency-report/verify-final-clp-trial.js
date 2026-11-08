// Audit this saved run against localhost; no model call and no record mutation.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { fingerprint } from './paid-comparison.js'
import { validateFinalTrial, finalTrialDir } from './run-final-clp-trial.js'
const read = async name => JSON.parse(await fs.readFile(`${finalTrialDir}/${name}.json`, 'utf8'))
const [snapshot, result, projected] = await Promise.all(['snapshot', 'result', 'projected'].map(read))
assert.equal(validateFinalTrial(snapshot).maxCalls, 1)
const changed = structuredClone(snapshot)
changed.body.reasoning.effort = 'high'
assert.throws(() => validateFinalTrial(changed), /approved_input_changed/)
const response = await fetch(`http://127.0.0.1:4175/__report/${projected.id}?mode=live-local`)
assert.equal(response.status, 200)
const report = await response.json()
assert.equal(fingerprint(report.content), fingerprint(result.candidate))
assert.deepEqual(report.facts, snapshot.packet.facts)
assert.deepEqual(report.series, snapshot.packet.series)
assert.equal(report.status, 'rejected')
assert.equal(report.comparison.preferred, false)
assert.equal(report.publishedAt, null)
assert.equal(report.assessment.publishDecision.eligible, false)
assert(!JSON.stringify(report).match(/"(?:raw|responseId|ruleLedger|Authorization)"\s*:/))
const blocked = await fetch('http://127.0.0.1:4175/.local-reports/private/clp-20260911-final-rules-v1/result.json')
assert.equal(blocked.status, 403)
assert.equal(JSON.parse(result.raw).usage.cost, result.costUsd)
assert(result.costUsd <= .18)
console.log(JSON.stringify({ candidate: 'unchanged', factsAndChart: 'identical', budget: 'within_approval',
  costMatchesUsage: true, privateRoute: 403, changedRequest: 'blocked', defaultReport: 'not_replaced', publication: 'blocked' }))
