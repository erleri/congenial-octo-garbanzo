import fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { parse } from 'dotenv'
import { buildPacket } from './core.js'
import { fingerprint } from './paid-comparison.js'
const dir = '.local-reports/private/clp-20260911-paid-v1'
const snapshot = JSON.parse(await fs.readFile(`${dir}/snapshot.json`, 'utf8'))
const manifest = JSON.parse(await fs.readFile(`${dir}/finalized-ui.json`, 'utf8'))
const dataset = JSON.parse(await fs.readFile('data/fx-full-history.json', 'utf8'))
// Audit the frozen experiment, not the current editorial input. Prompt/source editing must
// neither rewrite historical records nor make them appear generated under the new rubric.
const inputHash = fingerprint({ packet: snapshot.packet, messages: snapshot.bodies[0].messages, response_format: snapshot.bodies[0].response_format })
if (inputHash !== snapshot.inputHash || inputHash !== manifest.inputHash) throw new Error('frozen_input_hash_mismatch')
const reconstructed = buildPacket(dataset, 'CLP', '2026-09-11', snapshot.packet.evidence)
for (const key of ['facts', 'series', 'evidence']) if (fingerprint(reconstructed[key]) !== fingerprint(snapshot.packet[key])) throw new Error(`snapshot_mismatch_${key}`)
const day = snapshot.packet.facts.find(f => f.id === 'day').value
if (Math.abs(day - 1.487385532814947) > 1e-10 || snapshot.packet.observationAt || snapshot.packet.assessment.publishDecision.eligible) throw new Error('direction_or_time_gate_mismatch')
const env = parse(await fs.readFile('.env.report.local', 'utf8'))
const secrets = ['OPENROUTER_API_KEY', 'ALPHA_VANTAGE_API_KEY'].map(k => env[k]).filter(v => v?.length > 5)
const banned = value => secrets.some(secret => value.includes(secret)) || /"(?:raw|responseId|reasoning_tokens|reasoning_content|Authorization)"\s*:/.test(value)
// Trust only this known workspace for this child process; do not change global Git security settings.
const git = args => execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
async function scanTree(root) {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) await scanTree(file)
    else if (/\.(json|js|css|html|md)$/.test(entry.name) && banned(await fs.readFile(file, 'utf8'))) throw new Error('private_data_in_public_output')
  }
}
await scanTree('dist')
await scanTree('dist-report-ui')
await scanTree('.local-reports/reviewable')
const diff = git(['diff', '--cached']) + git(['diff'])
if (secrets.some(secret => diff.includes(secret))) throw new Error('secret_in_git_diff')
const untracked = git(['ls-files', '--others', '--exclude-standard']).trim().split(/\r?\n/).filter(Boolean)
for (const file of untracked.filter(f => !f.startsWith('artifacts/'))) {
  const value = await fs.readFile(file, 'utf8')
  if (secrets.some(secret => value.includes(secret))) throw new Error('secret_in_untracked_source')
}
const ignored = git(['check-ignore', '.env.report.local', `${dir}/snapshot.json`]).trim().split(/\r?\n/)
if (ignored.length !== 2) throw new Error('private_files_not_ignored')
for (const suffix of ['/.env.report.local', '/.local-reports/private/clp-20260911-paid-v1/snapshot.json', '/@fs/' + path.resolve(dir, 'snapshot.json').replaceAll('\\', '/')]) {
  const r = await fetch('http://127.0.0.1:4175' + suffix)
  if (r.status !== 403) throw new Error('private_route_not_forbidden')
}
for (const row of manifest.rows) {
  const r = await fetch(`http://127.0.0.1:4175/__report/${row.reportId}?mode=live-local`)
  const text = await r.text()
  if (!r.ok || banned(text)) throw new Error('report_http_boundary_failed')
  const report = JSON.parse(text)
  if (report.currency !== 'CLP' || report.baseDate !== '2026-09-11' || report.publishedAt !== null || report.assessment.publishDecision.eligible || fingerprint(report.series) !== fingerprint(snapshot.packet.series)) throw new Error('report_snapshot_or_publication_failed')
}
const correction = JSON.parse(await fs.readFile(`${dir}/routing-correction-authorization.json`, 'utf8'))
if (correction.bodies.some(body => fingerprint(body.messages) !== fingerprint(snapshot.bodies[0].messages) || fingerprint(body.response_format) !== fingerprint(snapshot.bodies[0].response_format))) throw new Error('comparison_input_drift')
console.log(JSON.stringify({ snapshot: 'identical', observations: snapshot.packet.series.length, evidence: reconstructed.evidence.length, direction: 'LOCAL_PER_USD_up_local_weaker', publication: 'blocked', secrets: 'not_found_in_checked_outputs', privateHttpRoutes: '403', comparedInputs: 'identical' }))
