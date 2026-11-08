// Local presentation of the preserved response; never generates or edits prose.
import fs from 'node:fs/promises'
import { geminiCompatibleDir as dir, geminiTrialDir, GEMINI_MODEL } from './run-gemini-clp-trial.js'
import { finalTrialDir } from './run-final-clp-trial.js'
import { publicDir, saveReport } from './storage.js'
import { fingerprint, grade } from './paid-comparison.js'
import { draftAssessment } from './trial-common-rules.js'

const read = name => fs.readFile(`${dir}/${name}.json`, 'utf8').then(JSON.parse)
const save = (name, value) => fs.writeFile(`${dir}/${name}.json`, JSON.stringify(value, null, 2), { flag: 'wx' })
const [input, result, accounting] = await Promise.all(['snapshot', 'result', 'accounting'].map(read))
const old = JSON.parse(await fs.readFile(`${finalTrialDir}/snapshot.json`, 'utf8'))
if (fingerprint(input.body.messages) !== fingerprint(old.body.messages) || fingerprint(input.packet) !== fingerprint(old.packet) ||
  input.inputHash !== fingerprint({ packet: input.packet, body: input.body })) throw new Error('comparison_input_drift')
const draft = draftAssessment(result)
let review = null, average = null, id = null
if (draft.viewable) {
  review = await read('agent-review')
  if (review.origin !== 'agent' || review.publicationApproved !== false || review.inputHash !== input.inputHash ||
    review.contentHash !== fingerprint(result.candidate) || review.ledgerHash !== fingerprint(result.ruleLedger) ||
    review.claims.length !== result.ruleLedger.claims.length || review.claims.some((c, i) => c.index !== i || !c.reason)) throw new Error('projection_review_mismatch')
  average = grade(review.scores, review.criticalErrors).average
  id = `CLP-2026-09-11-${Date.now()}`
}
await save('projection-lock', { at: new Date().toISOString() })
const path = `${publicDir}/clp-rules-comparison.json`, previousText = await fs.readFile(path, 'utf8'), previous = JSON.parse(previousText)
await fs.writeFile(`${dir}/previous-comparison.json`, previousText, { flag: 'wx' })
const notes = [draft.viewable ? `자동 원고 검사: ${draft.automaticDraftStatus === 'pass' ? '통과' : '보류'}. 내용 평가는 에이전트 잠정 평가이며 사용자 승인은 별도입니다.` : `새 원고 없음: ${result.errors.join(', ')}.`,
  ...draft.holds.map(c => `${c.ruleId} ${c.location}: ${c.reason}`), ...(review?.notes ?? [])]
const passed = draft.automaticDraftStatus === 'pass' && review?.status === 'pass' && grade(review.scores, review.criticalErrors).passed
if (id) {
  const p = input.packet
  await saveReport({ id, schemaVersion: 'currency-report/1', currency: p.currency, baseDate: p.baseDate,
    observedDate: p.observedDate, publishedAt: null, generationMode: 'ai_enhanced', status: passed ? 'pending_review' : 'rejected',
    facts: p.facts, series: p.series, evidence: p.evidence.map(({ review: _review, ...e }) => e),
    limitations: p.limitations, assessment: p.assessment, content: result.candidate,
    comparison: { inputHash: input.inputHash, label: 'gemini38-medium-v1', model: result.actualModel,
      costUsd: result.costUsd, average, preferred: false, provisional: true, publicationBlocked: true, rulesReviewOnly: true, reviewNotes: notes } })
  await save('sentence-review', { origin: 'agent', publicationApproved: false, contentHash: review.contentHash,
    claims: review.claims.map((r, i) => ({ ...r, target: result.ruleLedger.claims[i].target,
      quote: result.ruleLedger.claims[i].quote, evidenceIds: result.ruleLedger.claims[i].evidenceIds })) })
}
const first = JSON.parse(await fs.readFile(`${geminiTrialDir}/result.json`, 'utf8'))
const manifest = { ...previous, title: '같은 칠레 근거 · 모델별 원고 비교',
  statusLabel: id ? 'Gemini 실제 생성 · 검토 비교본' : 'Gemini 생성 실패 · 기존 원고 유지', winner: null,
  note: 'GPT-5.4와 Gemini에 같은 근거·프롬프트를 제공했습니다. Gemini 요청의 출력 제약 일부는 간소화했지만 원고가 반환되면 동일한 공통 규칙으로 검사하는 구조를 유지했습니다. 이번 Gemini 원고는 반환되지 않아 내용 평가는 하지 않았습니다. 기존 품질 점수는 에이전트 잠정 평가입니다.',
  confirmedCostUsd: accounting.confirmedTotalUsd, reservedUnknownUsd: accounting.unknownReservedTotalUsd,
  rows: [...previous.rows,
    { label: 'gemini38-rejected-request', variant: 'Gemini 최초 요청', model: GEMINI_MODEL, average: null, generationCostUsd: first.costUsd,
      costUsd: first.costUsd, passed: false, validationPassed: false, validationErrors: first.errors, reviewLabel: '생성 전 형식 거부', notes: ['INVALID_ARGUMENT. 토큰·비용 미반환, 비용 예약 유지.'] },
    { label: 'gemini38-medium-v1', variant: 'Gemini Flash · medium', model: result.actualModel ?? GEMINI_MODEL, average,
      generationCostUsd: result.costUsd, costUsd: result.costUsd, ...(id ? { reportId: id } : {}),
      passed, validationPassed: draft.automaticDraftStatus === 'pass', validationErrors: result.errors,
      reviewLabel: id ? (passed ? '잠정 통과 · 사용자 검토 대기' : '미채택 비교본 · 원문 보존') : '원고 없음', notes }] }
await save('projected', { id, contentHash: id ? fingerprint(result.candidate) : null, manifest })
await fs.writeFile(path, JSON.stringify(manifest, null, 2))
console.log(JSON.stringify({ id, average, costUsd: result.costUsd, passed, contentUnchanged: true, publicationBlocked: true,
  url: id ? `http://127.0.0.1:4175/local-experience.html?mode=live-local&design=a&run=${id}#report/CLP/2026-09-11` : null }))
