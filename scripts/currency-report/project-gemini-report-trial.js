// Local rejected manuscript display, no generation or validation downgrade.
import fs from 'node:fs/promises'
import { geminiReportDir as dir } from './run-gemini-report-trial.js'
import { finalTrialDir } from './run-final-clp-trial.js'
import { inspectRejectedDraft } from './rejected-draft-inspection.js'
import { parsePaidResponse, fingerprint } from './paid-comparison.js'
import { saveReport, publicDir } from './storage.js'

const read = name => fs.readFile(`${dir}/${name}.json`, 'utf8').then(JSON.parse)
const save = (name, data) => fs.writeFile(`${dir}/${name}.json`, JSON.stringify(data, null, 2), { flag: 'wx' })
const [input, result, transport, accounting] = await Promise.all(['snapshot', 'result', 'transport', 'accounting'].map(read))
const original = JSON.parse(await fs.readFile(`${finalTrialDir}/snapshot.json`, 'utf8'))
if (!transport.valid || fingerprint(input.packet) !== fingerprint(original.packet) ||
  fingerprint(input.body.messages) !== fingerprint(original.body.messages) ||
  input.inputHash !== fingerprint({ packet: input.packet, body: input.body })) throw new Error('inspection_input_drift')
const replay = parsePaidResponse(transport.payload, input.packet, input.body.model, true)
if (replay.valid || fingerprint(replay.errors) !== fingerprint(result.errors)) throw new Error('original_verdict_changed')
const draft = JSON.parse(transport.partialText), inspection = inspectRejectedDraft(input.packet, draft)
await save('display-inspection', inspection)
await save('projection-lock', { at: new Date().toISOString(), publicationApproved: false })
const path = `${publicDir}/clp-rules-comparison.json`, previousText = await fs.readFile(path, 'utf8'), previous = JSON.parse(previousText)
await fs.writeFile(`${dir}/previous-comparison.json`, previousText, { flag: 'wx' })
const id = `CLP-2026-09-11-${Date.now()}`
const notes = [
  'Gemini가 실제 생성한 원문입니다. 문장별 대응표의 위치 표기 12건이 규칙과 달라 자동 검사는 미통과입니다. 표시용 본문 안전 검사는 통과했지만 후보로 승인하지 않았습니다.',
  '대응표나 본문을 수정하지 않았습니다. 생성 원문을 읽기 위한 로컬 표시이며 운영 게시·기본 보고서 교체는 차단했습니다.',
  '미국 물가→금리 기대→달러의 연결과 가계 구매력·구매 연기의 불확실성 조건은 확인한 기사 해석과 대체로 부합합니다.',
  '다만 첫 배경은 예상과의 차이 대신 물가의 상승 흐름만 제시하고, 구리·국내 거시 항목은 전달 경로가 짧습니다. 관찰의 높은 수준은 예상 변화와 시장 반응을 구별하는 기준으로 충분하지 않습니다.',
  '근거 원문을 다시 대조했으나 최종 품질 합격·사용자 승인·게시 승인으로 처리하지 않았습니다. 현재 시장이 아닌 과거 사례의 사후 검토입니다.',
]
const p = input.packet
await saveReport({ id, schemaVersion: 'currency-report/1', currency: p.currency, baseDate: p.baseDate,
  observedDate: p.observedDate, publishedAt: null, generationMode: 'ai_enhanced', status: 'rejected',
  facts: p.facts, series: p.series, evidence: p.evidence.map(({ review: _review, ...e }) => e),
  limitations: p.limitations, assessment: p.assessment, content: inspection.contentForInspection,
  comparison: { inputHash: input.inputHash, label: 'gemini38-stream-20261006-v1', model: result.actualModel,
    costUsd: result.costUsd, average: null, preferred: false, provisional: true, publicationBlocked: true,
    rulesReviewOnly: true, reviewNotes: notes } })
const manifest = { ...previous, title: '같은 칠레 근거 · 모델별 원고 비교', statusLabel: 'Gemini 실제 원문 · 규칙 미통과', winner: null,
  note: '새 Gemini 원문이 실제 반환됐습니다. 전체 규칙 검사는 미통과이며, 대응표 표기 오류만 있는 원문의 본문 안전 검사를 별도로 확인해 표시했습니다. 원문·실패 판정은 보존하고 승인·자동 재작성은 하지 않았습니다.',
  confirmedCostUsd: accounting.confirmedTotalUsd, reservedUnknownUsd: accounting.unknownReservedTotalUsd,
  rows: [...previous.rows, { label: 'gemini38-stream-20261006-v1', variant: 'Gemini 실제 원문 · 스트리밍',
    model: result.actualModel, reportId: id, average: null, generationCostUsd: result.costUsd, costUsd: result.costUsd,
    passed: false, validationPassed: false, validationErrors: result.errors, reviewLabel: '규칙 미통과 · 원문 표시 전용', notes }] }
await save('projected', { id, contentHash: fingerprint(inspection.contentForInspection), originalDraftHash: inspection.originalDraftHash,
  manuscriptUnchanged: true, publicationApproved: false, manifest })
await fs.writeFile(path, JSON.stringify(manifest, null, 2))
console.log(JSON.stringify({ id, manuscriptUnchanged: true, candidateAccepted: false,
  costUsd: result.costUsd, status: 'rejected',
  url: `http://127.0.0.1:4175/local-experience.html?mode=live-local&design=a&run=${id}#report/CLP/2026-09-11` }))
