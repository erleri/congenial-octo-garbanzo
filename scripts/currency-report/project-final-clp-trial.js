// Project the preserved candidate unchanged; local comparison only, no generation.
import fs from 'node:fs/promises'
import { finalTrialDir, APPROVED_INPUT_HASH } from './run-final-clp-trial.js'
import { saveReport, publicDir } from './storage.js'
import { fingerprint, grade } from './paid-comparison.js'
import { inspectEditorial } from './editorial.js'

const read = name => fs.readFile(`${finalTrialDir}/${name}.json`, 'utf8').then(JSON.parse)
const save = (name, value) => fs.writeFile(`${finalTrialDir}/${name}.json`, JSON.stringify(value, null, 2), { flag: 'wx' })
const [input, result, review, accounting] = await Promise.all(['snapshot', 'result', 'agent-review', 'accounting'].map(read))
if (input.inputHash !== APPROVED_INPUT_HASH || review.inputHash !== input.inputHash ||
  fingerprint({ packet: input.packet, body: input.body }) !== input.inputHash ||
  fingerprint(result.candidate) !== review.contentHash || fingerprint(result.ruleLedger) !== review.ledgerHash ||
  !result.safetyValidation?.valid || review.origin !== 'agent' || review.publicationApproved !== false || review.status !== 'hold' ||
  review.claims.length !== result.ruleLedger.claims.length || review.claims.some((c, i) => c.index !== i || !c.reason)) throw new Error('projection_review_mismatch')
await save('projection-lock', { at: new Date().toISOString() })
const manifestPath = `${publicDir}/clp-rules-comparison.json`
const previousText = await fs.readFile(manifestPath, 'utf8'), previous = JSON.parse(previousText)
await fs.writeFile(`${finalTrialDir}/previous-comparison.json`, previousText, { flag: 'wx' })
const id = `CLP-2026-09-11-${Date.now()}`
const average = grade(review.scores, review.criticalErrors).average
const p = input.packet
const report = { id, schemaVersion: 'currency-report/1', currency: p.currency, baseDate: p.baseDate,
  observedDate: p.observedDate, publishedAt: null, generationMode: 'ai_enhanced', status: 'rejected',
  facts: p.facts, series: p.series, evidence: p.evidence.map(({ review: _review, ...e }) => e),
  limitations: p.limitations, assessment: p.assessment, content: result.candidate,
  comparison: { inputHash: input.inputHash, label: 'final-rules-v1', model: result.actualModel,
    costUsd: result.costUsd, average, preferred: false, provisional: true, publicationBlocked: true,
    rulesReviewOnly: true, reviewNotes: review.notes } }
await saveReport(report)
// Keep earlier rows/scores as historical records. Do not replace the default report.
const manifest = { ...previous, title: '공통 규칙 적용 전후', statusLabel: '최종 입력 실제 생성 · 미채택 비교본', winner: null,
  note: '이번 결과는 고정한 최종 입력으로 실제 생성했습니다. 설명은 개선됐지만 출처 연결·조건 유지·제목 근거가 기준을 충족하지 못해 채택하지 않았습니다. 이전 점수는 당시 잠정 평가입니다.',
  confirmedCostUsd: accounting.confirmedTotalUsd, reservedUnknownUsd: accounting.unknownReservedTotalUsd,
  rows: [...previous.rows, { label: 'final-rules-v1', variant: '최종 입력 실제 생성', model: result.actualModel,
    average, costUsd: result.costUsd, generationCostUsd: result.costUsd, reportId: id, passed: false,
    validationPassed: false, validationErrors: result.errors, reviewLabel: '내용 미통과 · 원문 보존', notes: review.notes }] }
const comparisons = []
for (const row of previous.rows.filter(r => r.reportId)) {
  const old = JSON.parse(await fs.readFile(`${publicDir}/${row.reportId}.json`, 'utf8'))
  comparisons.push({ label: row.variant, id: row.reportId, editorial: inspectEditorial(old.content) })
}
comparisons.push({ label: '최종 입력 실제 생성', id, editorial: result.editorial })
await save('content-comparison', { comparisons, note: 'Heuristic caveat counts are not semantic quality scores.' })
await save('sentence-review', { origin: 'agent', publicationApproved: false, contentHash: review.contentHash,
  claims: review.claims.map((r, i) => ({ ...r, target: result.ruleLedger.claims[i].target,
    quote: result.ruleLedger.claims[i].quote, evidenceIds: result.ruleLedger.claims[i].evidenceIds })) })
await save('projected', { id, contentHash: fingerprint(report.content), manifest })
// The previous manifest is recoverably copied above; private raw/ledger/response IDs are not projected.
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
console.log(JSON.stringify({ id, average, costUsd: result.costUsd, contentUnchanged: true, status: 'rejected',
  url: `http://127.0.0.1:4175/local-experience.html?mode=live-local&design=a&run=${id}#report/CLP/2026-09-11`, comparisons }))
