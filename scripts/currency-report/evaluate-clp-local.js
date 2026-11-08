// Explicit agent judgement recorded BEFORE revealing the anonymous model mapping.
// Not an automatic score, human approval, or general-purpose production evaluator.
// LEGACY v1 assessment only: frozen historical judgement, not a template for new candidates.
// Editorial v2 requires a fresh content-bound checklist; these scores do not satisfy it.
import fs from 'node:fs/promises'
import { fingerprint } from './paid-comparison.js'
const dir = '.local-reports/private/clp-20260911-paid-v1'
const reviewedHashes = { A: 'e3a8c81a0693b167666f5a290f2ae80c74103092a0ba8e629183884c2b9b3b93', B: 'a379397162f00d29f491534e5a7582ef05ed1d5c92cdd6b6a96e2aa161c47080' }
const decisions = {
  A: { scores: [4, 4, 4, 4, 4], criticalErrors: 0,
    rationale: '원인 범위와 비교 기준 차이를 명시하고 수입환산·구매력을 조건부 경로로 구분한다. 직접 원인 규명은 아니며 한계 문장이 반복되어 원인 설명·가독성 만점은 부여하지 않았다. 내구재 민감도는 관측 사실이 아닌 일반 경로다.',
    reviews: [
      ['title', '통과', 'Emol 두 보도의 미국·국내 요인 범위를 요약한다.'],
      ['summary', '통과', 'Emol 오전·마감에 귀속된 요인을 묶되 대시보드 관측시각 부재와 비교 기준 차이를 명시한다.'],
      ['change', '통과', '환율 원자료 스냅샷에서 코드가 산출한 사실 ID만 사용한다.'],
      ['drivers.0', '통과', 'Emol 오전의 분석가 해석과 부합. 단일 발표로 전체 변동을 설명하지 않는다는 문장은 리포트의 한계 판단이다.'],
      ['drivers.1', '통과', 'Emol 마감이 구리·국내 거시·물가·성장 전망을 함께 다룬다. 직접 원인으로 확정하지 않는다.'],
      ['drivers.2', '통과', 'Emol 오전과 마감의 가격 기준 및 코드 관측시각 누락을 대조했다. 특정 뉴스의 인과관계를 주장하지 않는다.'],
      ['implications.0', '통과·일반 경로', '동일 달러가격 조건의 환산 산술이다. 기사에서 실제 원가·마진·재고를 관측했다는 주장이 아님을 명시한다.'],
      ['implications.1', '통과·일반 경로', 'Reporte Minero 전문가의 구매력·큰 구매 연기 해설과 부합. 내구재의 상대 민감도는 정량 검증된 비교가 아니므로 일반 경로로만 허용한다.'],
      ['watch.0', '통과·표현 유의', 'Emol 오전의 미국 국채·달러·통화정책 관심과 부합. 마지막 문장은 일반 해석 관점이며 구체적 가격·판촉 업무 지시는 아니다.'],
      ['watch.1', '통과·일반 경로', 'Reporte Minero의 정책 여지·가계 부담 해설을 인용. 가격 민감도·구매 지연은 실제 회사 판매 관측이 아닌 배경 신호로 한정한다.'],
    ] },
  B: { scores: [4, 4, 4, 4, 3], criticalErrors: 1,
    rationale: '전체 구조와 출처 연결은 명료하다. 다만 소비 영향 문장의 실제 판매나 할부조건 변화는 관측되지 않았다는 단정은 이 근거 패킷에 관측 자료가 없다는 사실을 시장 변화가 없었다는 판단으로 읽히게 한다. 근거 충실도 기준 미달로 채택하지 않는다.',
    reviews: [
      ['title', '통과', 'Emol 보도의 미국·국내 변수 범위와 부합한다.'],
      ['summary', '통과', '오전 소폭 호가 변화와 마감의 국내 거시 해석을 분리한다.'],
      ['change', '통과', '코드 계산의 사실 ID를 사용한다.'],
      ['drivers.0', '주의', '근원물가 해석은 Emol과 일치. 단정할 수 없다고 덧붙였다는 표현은 원문의 일중 반응 유보보다 넓게 요약했으므로 출처 귀속 범위에 주의가 필요하다.'],
      ['drivers.1', '통과', 'Emol 마감의 정성적 해석임을 명시한다.'],
      ['drivers.2', '주의', '물가 부담과 구매력·구매 지연 경로는 출처에 있으나 금리 인하 여지 제한이 구매력을 직접 낮춘다고 읽히지 않게 분리할 필요가 있다.'],
      ['implications.0', '통과·일반 경로', '같은 달러가격이라는 조건 아래 환산 부담을 설명하고 실적을 확인한 것은 아니라고 한정한다.'],
      ['implications.1', '미통과', '마지막 문장: 자료가 없다는 것과 실제 판매·할부조건 변화가 관측되지 않았다는 것은 같지 않다. 변화 부재를 입증할 판매·금융 자료는 제공되지 않았다.'],
      ['watch.0', '통과', 'Emol 마감이 다음 주 연준 결정을 관찰 대상으로 제시한다.'],
      ['watch.1', '통과', 'Emol 오전이 국채 수익률과 달러 지수를 관찰 대상으로 제시한다.'],
    ] },
}
const rows = []
let inputHash
for (const label of ['A', 'B']) {
  const blind = JSON.parse(await fs.readFile(`${dir}/${label}-revalidated-blind.json`, 'utf8'))
  if (!blind.validationPassed || !blind.content) throw new Error('blind_content_unavailable')
  if (fingerprint(blind.content) !== reviewedHashes[label]) throw new Error('content_not_manually_reviewed')
  if (inputHash && inputHash !== blind.inputHash) throw new Error('input_mismatch')
  inputHash = blind.inputHash
  const d = decisions[label], claimReview = []
  for (const [section, verdict, reason] of d.reviews) {
    const value = section.split('.').reduce((value, key) => value[key], blind.content)
    const text = typeof value === 'string' ? value : value.text
    for (const sentence of text.match(/[^.!?]+[.!?]?/g) ?? [text]) {
      claimReview.push({ section, sentence: sentence.trim(), evidenceIds: value.evidenceIds ?? (section === 'summary' || section === 'title' ? ['emol-close', 'emol-morning'] : []), factIds: value.factIds ?? [], verdict, reason })
    }
  }
  rows.push({ label, scores: d.scores, criticalErrors: d.criticalErrors, rationale: d.rationale, claimReview })
}
await fs.writeFile(`${dir}/evaluation.json`, JSON.stringify({ inputHash, provisional: true, assessedBlind: true, rubric: ['원인 설명', '변화 전달', '영업 관련성', '가독성', '근거 충실도'], rows }, null, 2), { flag: 'wx' })
console.log('Anonymous content assessment saved. Model identities have not been read by this evaluator.')
