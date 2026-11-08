// Explicit agent review of the captured Reuters article, not human publication approval.
// Identical snapshot for both previously implemented writers. No credentials or AI calls.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { buildPacket } from './core.js'
import { createSourceContext } from './source-context.js'
import { HARNESS_VERSION, evidenceBinding, fingerprint } from './research-harness.js'
import { packetBinding } from './rules.js'
import { prepareHarnessComparison } from './live-research-local.js'

const root = '.local-reports/private/brl-20261007-harness-preparation-v1'
const dataset = JSON.parse(await fs.readFile(`${root}/dataset.json`, 'utf8'))
const captured = JSON.parse(await fs.readFile(`${root}/source-1.json`, 'utf8'))
const html = await fs.readFile(`${root}/source-1.html`, 'utf8')
assert.equal(captured.pageHash, fingerprint(html))
assert.equal(captured.blocks[1].text.includes('SÃO PAULO, 7 Out (Reuters)'), true)
assert.equal(captured.blocks[5].text.includes('não tenha apresentado propostas concretas'), true)
const publishedAt = html.match(/"datePublished":"([^"]+)"/)?.[1]
assert.equal(publishedAt, '2026-10-07T12:16:38.000Z')
const checkedAt = new Date().toISOString()
const evidence = [{ id: 'reuters-brl-adjustment', url: captured.url, country: 'BRL', publishedAt, eventDate: '2026-10-07',
  collectedAt: captured.fetchedAt, title: 'Dólar volta a superar os R$5 depois de rali do real e com exterior no foco', publisher: 'Reuters via UOL',
  period: '당일 오전 장중; 현물 호가 09:11 Brasília. 이전 두 거래일은 선거 이후 배경.',
  provenance: 'market_reporting', scope: 'country', role: 'context', causalStatus: 'source_attributed',
  summary: 'Reuters는 당일 오전 달러가 브라질에서 상승하며 선거 이후 헤알 랠리를 조정하는 흐름을 보였고, 대외적으로도 달러가 다른 신흥국 통화에 대해 강세였다고 보도했다. 직전 두 거래일의 달러 하락은 선거 결과에 따른 시장의 재정 관리 개선 기대와 연결했다. 이는 시장 참여자의 인식이며 후보가 구체적인 재정 조정안을 제시한 것은 아니라는 조건도 명시했다. 기사 장중 호가와 사이트 저장 환율의 가격 기준 및 관측시각은 같다고 확인되지 않았다. 예정된 중앙은행 거래는 정기 스왑 롤오버이며 새로운 현물 달러 공급으로 단정하지 않는다.',
  review: { originalVerified: true, admission: 'attributed_context', checkedAt,
    scope: 'Reuters 원문의 당일 장중 조정·글로벌 달러 동반 강세와 이전 두 거래일의 재정 기대 해석만 귀속해 사용한다. 기대를 정책 확정·실행으로, 당일 장중 기사를 이른 저장 환율의 원인으로 바꾸지 않는다.' },
  sourceContext: createSourceContext({ blocks: captured.blocks, selected: [1, 2, 4, 5, 6, 7], sourceVersion: 'current_page_not_archived' }),
}]
const packet = buildPacket(dataset, 'BRL', dataset.baseDate, evidence)
assert.equal(packet.evidence.length, 1)
assert.equal(packet.observedDate, '2026-10-07')
packet.limitations = [
  '주말·보간값을 제외한 관측일 기준입니다. 국가별 휴일의 API 이월값은 완전히 식별되지 않을 수 있습니다.',
  '저장 환율의 정확한 관측시각은 제공되지 않습니다. 기사 장중 호가와 사이트 저장값은 별개의 가격 기준입니다.',
  '선거 이후 재정 개선 기대는 Reuters가 보도한 시장 인식이며 확정된 정책이나 실제 재정 개선 결과가 아닙니다.',
  '공개 자료로 만든 로컬 비교 초안입니다. 소비·판매 실적 및 기업별 손익 효과는 이 근거로 판단하지 않습니다.',
]
const definitions = [
  ['market-adjustment', 'market', [1, 2], 'fact', 'supports', 'post-election-adjustment', 'same_day_context', '',
    'Reuters는 오전 현물 달러의 상승과 선거 이후 랠리에 대한 조정을 보도했다.',
    '기사 장중 현물 움직임으로만 설명하며 사이트 환율 수치와 별개의 관측 기준을 유지한다.',
    '기사는 오전 장중이며 종가 보고서가 아니다. 저장값의 정확한 관측시각은 없다.'],
  ['election-fiscal-expectation', 'local', [4, 5], 'attributed_interpretation', 'supports', 'election-fiscal-expectations', 'earlier_context', 'Reuters가 보도한 시장의 인식',
    '이전 두 거래일의 반응은 선거 결과에 따른 재정 관리 개선 기대와 연결돼 보도됐다.',
    '이전 거래일의 배경과 시장 기대를 설명한다. 당일 신규 정책 발표로 쓰지 않는다.',
    '기대와 실제 정책은 다르며 구체적인 재정 조정안이 발표된 상태라는 단정은 금지한다.'],
  ['global-dollar-alignment', 'global', [6, 7], 'fact', 'supports', 'post-election-adjustment', 'same_day_context', '',
    '당일 오전 달러는 다른 신흥국 통화에 대해서도 강세였고 달러 지수도 상승했다.',
    '브라질의 오전 달러 반응과 대외 동반 흐름의 일치를 설명한다. 인과 기여도는 계산하지 않는다.',
    '다른 통화의 이름·가격으로 범위를 넓히지 않는다. 연준 새 정책이나 금리 반응을 새로 만들지 않는다.'],
  ['expectation-not-policy', 'counter', [5], 'fact', 'qualifies', 'election-fiscal-expectations', 'earlier_context', '',
    '기사에는 후보가 구체적인 재정 조정안을 제시하지 않았다는 조건이 명시돼 있다.',
    '재정 기대 설명에 중요한 미확정 조건을 함께 둔다. 기대와 정책 실행을 구분한다.',
    '정책의 성공·실패나 당선 가능성을 예측하지 않는다. 조건은 경고 문단을 채우는 재료가 아니다.'],
]
const e = packet.evidence[0]
const dossier = { version: HARNESS_VERSION, packetHash: packetBinding(packet), provenance: 'agent_review_of_captured_original_not_human_approval',
  cards: definitions.map(([id, questionId, indices, kind, relation, eventKey, timeScope, attribution, statement, allowedUse, limit]) => ({
    id, questionId, evidenceId: e.id, evidenceHash: evidenceBinding(e), passageIds: indices.map(i => `p${i}`),
    kind, relation, eventKey, timeScope, attribution, statement, allowedUse, limit, independenceKey: 'reuters-fabricio-de-castro',
    review: { origin: 'agent', status: 'checked', reason: '수집한 Reuters 기사 원문과 이웃 구절을 읽고 시장 기대·이전 기간·당일 장중 반응을 구분해 대조했다.' },
  })) }
const plan = prepareHarnessComparison(packet, dossier)
assert.equal(plan.status, 'prepared_not_called')
assert.ok(plan.totalMaximumUsd <= .18)
for (const [name, value] of Object.entries({ snapshot: { packet, datasetHash: fingerprint(dataset), checkedAt, publicationApproved: false }, dossier, 'comparison-plan': plan,
  'source-review': { originalVerified: true, origin: 'agent', originalReviewIsNotPublicationApproval: true,
    admitted: [captured.url], excluded: [
      { url: 'https://www.infomoney.com.br/mercados/dolar-hoje-abertura-fechamento-comercial-turismo-07102026/', reason: 'http_404' },
      { url: 'https://agenciabrasil.ebc.com.br/economia/noticia/2026-10/dolar-fecha-abaixo-de-r-5-pela-primeira-vez-desde-maio', reason: 'article_body_not_identified_and_metadata_time_inconsistency' },
    ], limitation: '하나의 Reuters 기사 안에서 질문을 나눴으며 네 카드가 네 독립 출처를 뜻하지 않는다. 소비 근거·별도 관찰 사건 및 신규 원리 적용을 승인하지 않았다.' } }))
  await fs.writeFile(`${root}/${name}.json`, JSON.stringify(value, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ root, baseDate: packet.baseDate, facts: packet.facts, admittedSources: packet.evidence.length,
  proposedMaximumUsd: plan.totalMaximumUsd, model: plan.model, modelCalls: 0, publicationBlock: packet.assessment.publishDecision }))
