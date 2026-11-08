// Offline only: no credential loading, network, DB, or report-generation API calls.
import fs from 'node:fs/promises'
import { attachClpExplanations, clpReferenceDraft } from './clp-explanations.js'
import { composeDraft, requestBody } from './openrouter.js'
import { paidBody, fingerprint, inputUpperBound } from './paid-comparison.js'
import { saveReport } from './storage.js'

const read = async name => JSON.parse(await fs.readFile(name, 'utf8'))
const dir = '.local-reports/private/clp-explanation-reference-v1'
const snapshot = await read('.local-reports/private/clp-20260911-editorial-v2/snapshot.json')
const packet = attachClpExplanations(snapshot.packet)
const { candidate, validation, editorial } = composeDraft(packet, clpReferenceDraft)
if (!validation.valid || editorial.blockers.length) throw new Error('invalid_reference_content')
const body = paidBody(packet, 'openai/gpt-5.4') // Validate preparation only; do NOT send.
const id = 'CLP-2026-09-11-1791198000000'
const report = { ...packet, id, schemaVersion: 'currency-report/1', publishedAt: null,
  generationMode: 'editorial_fixture', status: 'sample', content: candidate,
  comparison: { label: 'explanation-reference-v1', model: 'Codex 편집 기준 예시', inputHash: fingerprint(packet), costUsd: 0, average: null,
    preferred: false, provisional: true, publicationBlocked: true, referenceOnly: true } }
// Exclusive directory prevents overwriting the authored example or prior generation records.
await fs.mkdir(dir)
await fs.writeFile(`${dir}/prepared-input.json`, JSON.stringify({ packet, body, calls: 0, inputUpperBound: inputUpperBound(body) }, null, 2), { flag: 'wx' })
await saveReport(report)
const comparison = await read('.local-reports/reviewable/clp-editorial-comparison.json')
await fs.writeFile('.local-reports/reviewable/clp-explanation-comparison.json', JSON.stringify({
  ...comparison, title: 'AI 원고와 설명 기준 예시', statusLabel: '사용자 내용 검토 대기', winner: null,
  note: '설명 기준 예시는 Codex가 원문을 대조해 작성한 목표 원고이며 OpenRouter의 새 응답이 아닙니다. 같은 환율·차트를 사용하고 원문에서 확인한 설명 경로만 상세화했습니다. 기존 AI 원고와 기본 선택은 보존합니다.',
  rows: [...comparison.rows, { label: 'reference', variant: '설명 기준 예시', model: 'Codex 편집 · API 재호출 없음', generationCostUsd: 0, costUsd: 0,
    average: null, passed: false, reviewLabel: '목표 원고 · 승인 대기', reportId: id,
    notes: ['왜 움직였나는 근거가 있는 두 항목만 작성했습니다. 소비 여력·구매 시점과 관찰 변수를 분리했습니다.', '점수·발행 승인을 부여하지 않았습니다. 이 예시를 읽고 방향을 정한 뒤에만 실제 생성 품질을 다시 시험합니다.'] }],
}, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ id, apiCalls: 0, costUsd: 0, publishedAt: null, referenceOnly: true,
  cards: JSON.parse(requestBody(packet, 'openrouter/free').messages[1].content).explanationCards.length,
  validation: validation.valid, editorialWarnings: editorial.warnings, inputUpperBound: inputUpperBound(body) }))
