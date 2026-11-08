// Read-only projection of completed local execution records; never calls a model.
import fs from 'node:fs/promises'
import { saveReport } from './storage.js'
const dir = '.local-reports/private/clp-20260911-paid-v1'
const load = file => fs.readFile(`${dir}/${file}.json`, 'utf8').then(JSON.parse)
try { await fs.access(`${dir}/finalized-ui.json`); throw new Error('projection_already_saved') } catch (e) { if (e.code !== 'ENOENT') throw e }
const manifest = await load('finalized')
const snapshot = await load('snapshot')
const discovery = JSON.parse(await fs.readFile('.local-reports/review/CLP-2026-09-11.json', 'utf8'))
for (const row of manifest.rows) {
  if (!row.validationPassed || row.reportId) continue
  const blind = await load(`${row.label}-revalidated-blind`)
  if (blind.inputHash !== manifest.inputHash) throw new Error('input_mismatch')
  row.reportId = `CLP-2026-09-11-${Date.now()}`
  await saveReport({ ...snapshot.packet, id: row.reportId, schemaVersion: 'currency-report/1', publishedAt: null, generationMode: 'ai_enhanced', status: 'rejected',
    content: blind.content, comparison: { inputHash: manifest.inputHash, label: row.label, model: row.model, costUsd: row.generationCostUsd, average: row.average, preferred: false, provisional: true, publicationBlocked: true } })
}
manifest.sourceReview = manifest.sourceReview.map(r => {
  const candidate = discovery.candidates.find(c => c.id === r.id)
  return { ...r, url: candidate?.url ?? null, discoveredPublishedAt: candidate?.publishedAt ?? null }
})
await fs.writeFile(`${dir}/finalized-ui.json`, JSON.stringify(manifest, null, 2), { flag: 'wx' })
await fs.writeFile('.local-reports/reviewable/clp-comparison.json', JSON.stringify(manifest, null, 2))
// Portable plain-text review tables, no raw provider response or credentials.
const lines = ['# CLP historical AI comparison — 2026-09-11', '', 'Agent provisional evaluation; NOT publication approval.', '', '| Model | Scores (cause/change/sales/readability/evidence) | Mean | Generation USD | Result |', '|---|---|---:|---:|---|',
  ...manifest.rows.map(r => `| ${r.model} | ${r.scores.join('/')} | ${r.average} | ${r.generationCostUsd} | ${r.passed ? 'local draft selected' : 'rejected for publication'} |`), '',
  `Confirmed generation costs: $${manifest.confirmedCostUsd.toFixed(8)}; unresolved routing-error reservations: $${manifest.reservedUnknownUsd.toFixed(8)}. Prior search costs excluded.`, '', `Frozen packet + prompt + schema hash: ${manifest.inputHash}`, '',
  ...manifest.rows.flatMap(r => ['## ' + r.model, '', r.rationale, '', '| Sentence | Evidence / fact | Assessment |', '|---|---|---|', ...r.claimReview.map(c => `| ${c.sentence.replaceAll('|','/')} | ${[...c.evidenceIds, ...c.factIds].join(', ')} | ${c.verdict}: ${c.reason} |`), '']),
  '## Original source admission', '', ...manifest.sourceReview.map(r => `- ${r.id}: ${r.decision}; original verified=${r.originalVerified}. ${r.reason}\n  ${r.url}`), '']
await fs.writeFile('.local-reports/reviewable/clp-comparison-review.md', lines.join('\n'))
console.log(JSON.stringify({ reports: manifest.rows.map(r => ({ model: r.model, id: r.reportId, selected: r.label === manifest.winner })) }))
