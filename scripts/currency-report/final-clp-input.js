// Offline, source-reviewed preparation only. No key loading, API calls or publication.
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { plan } from './trial-common-rules.js'
import { privateDir } from './storage.js'
import { paidBody, fingerprint, inputUpperBound, reservationFor } from './paid-comparison.js'
import { RULE_VERSION, selectMechanisms } from './rules.js'
import { clpEvidence } from './clp-case.js'

export const FINAL_INPUT_VERSION = 'clp-final-input/1'
const destination = `${privateDir}/clp-20260911-final-input-v1`
const amendments = {
  'emol-morning': {
    summary: 'Emol의 오전 보도에서 Capitaria의 Lucas Arana는 미국 일반 물가가 예상에 부합했지만 근원물가의 월간 상승은 예상보다 높았다고 해석했다. 그는 근원 압력의 지속이 연준의 긴축적 정책을 뒷받침하고 미국 금리를 높게 유지시켜 글로벌 달러를 지지할 수 있어 달러-페소에 초기 상승 요인이라고 설명했다. 같은 기사에서 칠레 오전 09:43 달러 매도호가는 940.8페소, 상승폭은 0.68페소였다. 국채 수익률·달러 지수와 다음 연준 결정은 이 금리 해석의 시장 반영을 확인할 관찰 대상이다.',
    scope: '출처가 제시한 예상 대비 근원물가 차이 → 미국 금리 해석 → 달러-페소 연결을 분석가에게 귀속해 설명. 미국 공식 통계 확정이나 대시보드 일간 변동 전체의 인과 증명은 아님. 국채·달러 지수의 실제 등락과 미래 정책 결정을 추가하지 않음. 오전 기사 안의 구리 마감 수치는 시간 기준이 불명확하여 제외.',
    support: '본문의 물가 비교, Lucas Arana의 정책·달러-페소 해석 및 마지막 관찰 항목 문단',
  },
  'emol-close': {
    summary: 'Emol의 마감 보도는 달러 매도호가 943.2페소와 당일 3페소 상승을 전했다. 보도는 구리 가격 조정을 페소 지지 약화와 연결했다. XTB의 Benjamín Neira는 예상 밖 칠레 물가와 낮아진 성장 전망이 국내 거시 여건을 어렵게 했다고 설명했다. 이는 오전 기사의 미국 금리 해석과 구분되는 현지 배경이다. 기사 속 전주 금요일 대비 비교는 일간 비교와 다른 기간이다.',
    scope: '구리 조정과 페소 지지 약화는 Emol의 해석으로 귀속. 국내 물가·성장 전망의 긴장은 XTB 해석으로 귀속. 구리 가격·변동률, 성장 전망·물가 수치와 다른 보도의 불일치 수치는 사용하지 않음. 구리 수출대금·자금 유출·원인별 기여도·효과 우선순위를 추정하지 않음.',
    support: '본문 첫 두 문단, XTB 국내 거시 해석, 구리 조정과 페소 지지 문단; 주간 비교는 별도 기간',
  },
  'rm-inflation': {
    summary: 'Reporte Minero는 UNAB 경제학자 Francisco Ormazábal의 해설을 통해 예상보다 높은 칠레 물가가 금리 인하 여지를 제한한다고 전했다. 기사는 지속적인 물가 부담이 가계 구매력을 낮추는 경로를 설명하면서 일부 소비 부문의 활력이 함께 나타날 가능성도 언급했다. 경제학자는 가계가 미래를 불확실하게 느낄 때 중요한 소비 결정을 미룰 수 있다고 설명했다. 이는 소비 환경의 해설이며 실제 가전 판매나 할부조건을 조사한 결과가 아니다.',
    scope: '물가·금리 인하 여지·구매력·불확실성과 구매 시점의 설명을 기사/경제학자에게 귀속. 실제 판매 감소, 소득 변화, 대출금리 상승, 소비 둔화 크기와 달러 수입대금 환산 경로를 추가하지 않음. 일부 소비 활력 가능성을 숨기지 않음. 환율 당일 원인 블록에는 사용하지 않음.',
    support: '금리 조정 여지 및 투자·경제 신뢰 절의 구매력, 일부 소비 활력, 중요한 소비 결정 연기 문단',
  },
}

export function finalizePacket(source) {
  if (source.currency !== 'CLP' || source.baseDate !== '2026-09-11' || source.observedDate !== source.baseDate ||
    source.observationAt != null || source.assessment?.publishDecision?.eligible !== false)
    throw new Error('final_case_boundary_mismatch')
  if (source.evidence.length !== 3 || new Set(source.evidence.map(e => e.id)).size !== 3 ||
    source.evidence.some(e => !Object.hasOwn(amendments, e.id) || e.review?.originalVerified !== true ||
      e.review?.admission !== 'attributed_context')) throw new Error('final_source_boundary_mismatch')
  const identity = ({ id, url, publisher, country, publishedAt, eventAt, eventDate, period, scope }) =>
    ({ id, url, publisher, country, publishedAt, eventAt, eventDate, period, scope })
  if (source.evidence.some(e => fingerprint(identity(e)) !== fingerprint(identity(clpEvidence.find(original => original.id === e.id)))))
    throw new Error('final_source_boundary_mismatch')
  if (source.mechanismApplications?.length || source.explanationCards?.length)
    throw new Error('final_input_has_unreviewed_additions')
  const packet = structuredClone(source)
  packet.evidence = packet.evidence.map(e => ({ ...e, summary: amendments[e.id].summary,
    review: { ...e.review, checkedAt: '2026-10-05', scope: amendments[e.id].scope } }))
  return packet
}

export function prepareFinalInput(base, lastTrial) {
  const validMoney = n => typeof n === 'number' && Number.isFinite(n) && n >= 0
  if (![base.priorConfirmedUsd, base.priorUnknownUsd, lastTrial.reservedUsd].every(validMoney) ||
    !(lastTrial.costUsd === null || validMoney(lastTrial.costUsd))) throw new Error('final_cost_record_invalid')
  const packet = finalizePacket(base.packet)
  const body = paidBody(packet, 'openai/gpt-5.4')
  const money = n => Number(n.toFixed(9))
  return {
    version: FINAL_INPUT_VERSION, reviewedAt: '2026-10-05', reviewOrigin: 'agent', ruleVersion: RULE_VERSION,
    packet, body, inputHash: fingerprint({ packet, body }),
    marketHash: fingerprint({ facts: packet.facts, series: packet.series }),
    sourceReviews: packet.evidence.map(e => ({ id: e.id, url: e.url, publishedAt: e.publishedAt,
      eventAt: e.eventAt ?? null, period: e.period, originalVerified: true,
      supportedPassage: amendments[e.id].support, admittedScope: e.review.scope })),
    mechanismDecision: { selected: selectMechanisms(packet).selected, reason: 'Only source-attributed explanations. No human application approval fabricated; general principles are not transmitted.' },
    status: { historicalDraftInput: 'ready', publicationApproved: false, paidCallAuthorized: false,
      providerAcceptance: 'unverified', outputQuality: 'unverified' },
    cost: { priorConfirmedUsd: money(base.priorConfirmedUsd + (lastTrial.costUsd ?? 0)),
      priorUnknownReservedUsd: money(base.priorUnknownUsd + (lastTrial.costUsd === null ? lastTrial.reservedUsd : 0)),
      proposedRequestCeilingUsd: reservationFor(body), inputTokenUpperBound: inputUpperBound(body),
      newCalls: 0, newCostUsd: 0, newReservationUsd: 0,
      note: 'Preparation is not a new budget approval or reservation. Refresh endpoint availability and prices before any separately authorized call.' },
  }
}

async function main() {
  if (process.argv.length !== 2) throw new Error('offline_preparation_only')
  const [base, reservation, result] = await Promise.all([plan(),
    fs.readFile(`${privateDir}/clp-20260911-common-rules-v1/reservation.json`, 'utf8').then(JSON.parse),
    fs.readFile(`${privateDir}/clp-20260911-common-rules-v1/result.json`, 'utf8').then(JSON.parse)])
  const prepared = prepareFinalInput(base, { reservedUsd: reservation.reservedUsd, costUsd: result.costUsd })
  await fs.mkdir(destination, { recursive: true })
  // Existing final input is immutable; identical reruns verify it, changed input fails closed.
  const file = `${destination}/input.json`, serialized = JSON.stringify(prepared, null, 2)
  let saved = false
  try { await fs.writeFile(file, serialized, { flag: 'wx' }); saved = true }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    if (await fs.readFile(file, 'utf8') !== serialized) throw new Error('final_input_already_frozen_different_content')
  }
  console.log(JSON.stringify({ saved, file, inputHash: prepared.inputHash, marketHash: prepared.marketHash,
    sources: prepared.sourceReviews.length, ...prepared.status, ...prepared.cost }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(/^[a-z_]+$/.test(error.message ?? '') ? error.message : error.code ?? 'final_input_preparation_failed')
    process.exitCode = 1
  })
}
