// Read-only saved-run audit. No generation, mutation or product test count.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { geminiTrialDir, geminiCompatibleDir, prepareGeminiTrial } from './run-gemini-clp-trial.js'
import { finalTrialDir } from './run-final-clp-trial.js'
import { fingerprint } from './paid-comparison.js'
const read = (dir, name) => fs.readFile(`${dir}/${name}.json`, 'utf8').then(JSON.parse)
const old = await read(finalTrialDir, 'snapshot')
const results = []
for (const [dir, compatible] of [[geminiTrialDir, false], [geminiCompatibleDir, true]]) {
  const [snapshot, result, reservation, accounting] = await Promise.all(['snapshot', 'result', 'reservation', 'accounting'].map(name => read(dir, name)))
  assert.deepEqual(snapshot, prepareGeminiTrial(old, compatible))
  assert.equal(fingerprint(snapshot.body.messages), fingerprint(old.body.messages))
  assert.deepEqual(snapshot.packet, old.packet)
  assert.equal(accounting.generationCalls, 1)
  assert.equal(accounting.retries, 0)
  assert.equal(result.candidate, undefined)
  assert.equal(result.costUsd, null)
  assert.equal((await fetch(`http://127.0.0.1:4175/.local-reports/private/${dir.split(/[\\/]/).at(-1)}/result.json`)).status, 403)
  results.push({ error: result.errors[0], reservedUsd: reservation.reservedUsd })
}
assert.deepEqual(results.map(r => r.error), ['http_400', 'timeout'])
assert(results.reduce((s, r) => s + r.reservedUsd, 0) <= .10)
const { id, manifest } = await read(geminiCompatibleDir, 'projected')
assert.equal(id, null)
const rows = manifest.rows.filter(r => r.label.startsWith('gemini38'))
assert.equal(rows.length, 2)
assert(rows.every(r => !r.reportId && r.average === null && r.passed === false && r.costUsd === null))
console.log(JSON.stringify({ inputAndMessages: 'identical', calls: 2, additionalRetries: 0,
  actualCost: 'unknown', reservedTotalUsd: results.reduce((s, r) => s + r.reservedUsd, 0),
  newReport: false, quality: 'not_evaluated', privateHttpRoutes: 403 }))
