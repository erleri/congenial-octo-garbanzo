// Explicit historical replay, not new research or model output. No env/network imports.
import fs from 'node:fs/promises'
import path from 'node:path'
import { HARNESS_VERSION, fingerprint, evidenceBinding, replayResearch } from './research-harness.js'
import { packetBinding } from './rules.js'
import { harnessRequest, auditHarnessReport } from './report-harness.js'
import { requestBody } from './openrouter.js'

const root = '.local-reports/private/clp-20261005-owned-content-trial-v1'
const files = ['snapshot', 'result', 'content-review', 'accounting']
const originals = await Promise.all(files.map(name => fs.readFile(`${root}/${name}.json`, 'utf8')))
const [snapshot, result, previousReview, accounting] = originals.map(JSON.parse)
const packet = snapshot.packet
if (packet.currency !== 'CLP' || packet.baseDate !== '2026-10-05') throw new Error('wrong_historical_case')

// Explicit agent review of preserved original passages. Not model-admitted evidence,
// not human approval and not a replacement for the previous evaluation record.
const definitions = [
  ['market-close', 'market', 'df-close', ['p0', 'p1'], 'fact', 'supports', 'df-market-close', 'df-bloomberg', '',
    'DF는 장중 반전과 Bloomberg 종가를 보도했다. 저장 환율과 기사 종가의 관측 기준은 다르다.',
    '기사 속 시장 움직임으로만 설명한다. 저장된 환율 카드 변동의 직접 원인으로 합치지 않는다.',
    '실제 저장 환율 관측시각은 없고 La Tercera의 판 마감 가격과도 다르다.'],
  ['policy-signal', 'local', 'df-close', ['p2', 'p3'], 'attributed_interpretation', 'supports', 'government-dollar-plan', 'befx-castillo', 'BeFX Rodrigo Castillo',
    '기사에 인용된 분석가는 정부 달러 매각 계획의 규모보다 정책 신호를 강조했다.',
    '정부 계획은 보도에, 규모보다 신호라는 판단은 분석가에게 귀속해 설명한다.',
    '정책 목표를 정부의 직접 발언으로 만들거나 실제 매각 집행을 확인한 것처럼 쓰지 않는다.'],
  ['global-contrast', 'global', 'lt-close', ['p13'], 'attributed_interpretation', 'supports', 'local-global-contrast', 'xtb', 'XTB Felipe Oyarzún',
    '인용된 XTB 분석가는 글로벌 달러가 강한 가운데 나타난 현지 반응을 현지 요인과 연결했다.',
    '대외 달러 흐름과 현지 반응의 대비를 해당 분석가의 해석으로 제시한다.',
    '다른 매체의 XTB 인용과 독립된 기관의 추가 확인이라고 세지 않는다.'],
  ['execution-condition', 'counter', 'lt-close', ['p10', 'p11'], 'fact', 'qualifies', 'government-dollar-plan', 'dipres-via-lt', '',
    '기사에 인용된 예산국 설명은 자금 조달 필요와 시장 여건에 따라 매각 금액이 달라질 수 있다고 밝혔다.',
    '계획과 집행을 분리하고 금액 변경 조건을 정책 신호 설명에 함께 둔다.',
    '정부 원문을 직접 확보한 상태가 아니며 실제 집행액을 검증하지 않았다.'],
  ['copper-not-all-commodities', 'counter', 'df-close', ['p9', 'p10'], 'fact', 'qualifies', 'commodity-divergence', 'df-market-prices', '',
    '기사에는 구리 반등과 원유 하락이 함께 있어 원자재 전반의 동반 상승으로 일반화할 수 없다.',
    '구리라는 대상을 명시하고 반대 방향 상품을 무시한 포괄적 주장을 피한다.',
    '서로 다른 상품과 가격 시점을 하나의 수치로 합치거나 기여도를 계산하지 않는다.'],
  ['position-followup', 'watch', 'df-close', ['p3', 'p4'], 'attributed_interpretation', 'supports', 'government-dollar-plan', 'befx-castillo', 'BeFX Rodrigo Castillo',
    '인용된 분석가는 정책 신호에 따른 비거주자 포지션 조정 여부를 향후 확인할 변수로 제시했다.',
    '포지션 조정이 확인되는 조건과 그때 지지할 정책 신호 설명을 연결한다.',
    '이미 포지션이 청산됐거나 특정 환율로 움직일 것이라고 예측하지 않는다.'],
]
const dossier = { version: HARNESS_VERSION, packetHash: packetBinding(packet),
  provenance: 'agent_review_of_saved_originals_not_human_approval',
  cards: definitions.map(([id, questionId, evidenceId, passageIds, kind, relation, eventKey, independenceKey, attribution, statement, allowedUse, limit]) => ({
    id, questionId, evidenceId, passageIds, kind, relation, eventKey, independenceKey, attribution, statement, allowedUse, limit,
    timeScope: 'same_day_context', evidenceHash: evidenceBinding(packet.evidence.find(e => e.id === evidenceId)),
    review: { origin: 'agent', status: 'checked', reason: '저장된 선택 원문과 이웃 구절을 읽고 이 카드의 설명 범위 및 제한을 대조했다.' },
  })) }
const prepared = harnessRequest(packet, dossier)
// Empty replay results truthfully indicate no saved consumer search, not no public evidence.
const research = await replayResearch({ packet, dossier, search: async () => [] })
const audit = auditHarnessReport({ packet, content: result.generated.candidate,
  ledger: result.generated.ruleLedger, review: previousReview.review })
const bytes = v => Buffer.byteLength(JSON.stringify(v), 'utf8')
const comparison = {
  baseline: { sourceCount: packet.evidence.length, oldSearchLimit: 2, oldFetchLimit: 2, manuscriptHash: fingerprint(result.generated.candidate) },
  harness: { questions: prepared.brief.coverage.questions.map(q => ({ id: q.id, status: q.status })),
    admittedCards: prepared.brief.coverage.cards.length, rejectedCards: prepared.brief.coverage.rejected,
    requestPrepared: prepared.status, manuscriptStatus: audit.status, audit: audit.metrics,
    requestBytesBefore: bytes(requestBody(packet, 'openrouter/free', 'strict')),
    requestBytesAfter: prepared.request ? bytes(prepared.request) : null,
    requestSizeNote: '같은 무료 모델 계약으로 입력 크기만 비교. 토큰 수나 실제 비용의 추정값은 아님.' },
  missing: ['소비·구매력 자료의 원문 조사', '정부 발표 직접 원문과 실제 집행 자료', '저장 환율의 실제 관측시각', '새 입력으로 생성한 원고의 내용·비용 비교'],
  originalCostUsd: accounting.costUsd ?? null,
  newCostUsd: 0, modelCalls: 0, networkCalls: 0, publicationApproved: false,
  limitation: '기존 원고를 새 하네스로 진단하고 입력을 준비했다. 새로운 원고나 품질 향상 실측 결과가 아니다.' }
await fs.mkdir('.local-reports/private/harness-replays', { recursive: true })
const destination = await fs.mkdtemp('.local-reports/private/harness-replays/clp-')
for (const [name, value] of Object.entries({ dossier, prepared, research, audit, comparison }))
  await fs.writeFile(path.join(destination, `${name}.json`), JSON.stringify(value, null, 2), { flag: 'wx' })
for (const [i, name] of files.entries()) if (await fs.readFile(`${root}/${name}.json`, 'utf8') !== originals[i]) throw new Error('original_changed')
console.log(JSON.stringify({ output: destination, ...comparison, originalsPreserved: true }, null, 2))
