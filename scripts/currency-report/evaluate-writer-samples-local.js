// Offline agent judgments made on masked prose. No model call or publication.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { assessClaimReview, CLAIM_REVIEW_VERSION } from './claim-review.js'
import { fingerprint } from './research-harness.js'

const root = '.local-reports/private/model-suitability-clp-brl-trial-v1/masked-review'
// Explicit passage-level judgments, not automatic approval based on citation IDs.
const definitions = {
  '1A': [
    ['title:0','none',['df-close/p3'],'규모보다 신호를 중요하게 읽었다는 BeFX 해석에 제목을 한정했다.'],
    ['summary:0','none',['df-close/p0','df-close/p2'],'당월의 주간 한도 계획과 기사 장중 반전은 원문과 맞는다. 숫자 월 표기는 생성 계약 위반이지 허위 월이 아니다.'],
    ['summary:1','style',['df-close/p3','df-close/p5','lt-close/p10'],'공급·신호 해석과 계획 조건은 맞고 관측시각 미상은 입력 메타데이터에서 확인했다. 공통 시각 한계를 요약에 다시 길게 넣었다.'],
    ['drivers.0.title:0','none',['df-close/p0'],'발표 후 장중 반전이라는 기사 범위를 유지한다.'],
    ['drivers.0.text:0','none',['df-close/p0'],'기사의 장중 방향 전환을 DF 보도로 귀속한다. 저장값의 원인이라고 단정하지 않는다.'],
    ['drivers.0.text:1','none',['df-close/p3'],'BeFX의 중요성 판단과 적정 범위 신호 해석에 맞으며 공식 정책 목표로 단정하지 않았다.'],
    ['drivers.0.text:2','style',['df-close/p0'],'시각 미상은 입력 observationAt에서 직접 확인했다. 기사와 저장 기준 분리는 맞으나 공통 한계의 본문 반복이다.'],
    ['drivers.1.title:0','none',['lt-close/p10'],'예산국이 명시한 계획 금액의 변경 조건에 맞는다.'],
    ['drivers.1.text:0','none',['lt-close/p10'],'자금 조달 필요와 시장 여건에 따른 금액 변경 조건을 그대로 보존한다.'],
    ['drivers.1.text:1','none',['lt-close/p10','lt-close/p11'],'조건부 계획과 미래 집행 방식을 실제 집행액과 구분한다. 원문에는 실제 이번 집행액이 없다.'],
    ['drivers.1.text:2','style',['lt-close/p10'],'계획 해석에 조건이 필요하다는 뜻은 타당하지만 직전 문장의 주의사항을 다시 말한다.'],
    ['drivers.2.title:0','none',['lt-close/p13'],'글로벌 달러 강세와 현지 반응의 대비는 인용 분석가의 설명이다.'],
    ['drivers.2.text:0','none',['lt-close/p13'],'움직임의 주된 요인을 현지로 보는 XTB 해석을 귀속했다.'],
    ['drivers.2.text:1','style',['df-close/p5','lt-close/p9'],'같은 XTB 기관의 해석임을 확인했다. 독립성 검토용 문장을 본문에 노출해 독자의 설명 흐름을 끊는다.'],
    ['drivers.2.text:2','style',['df-close/p9','df-close/p10'],'구리와 원유의 다른 방향은 원문에 있다. 일반화 금지 검토 조건을 보고서 설명으로 반복한다.'],
    ['implications.0.title:0','none',['@usd'],'승인된 동일 달러 결제대금 환산이라는 코드 소유 범위다.'],
    ['implications.0.text:0','none',['@usd'],'동일 달러 금액과 미헤지 조건의 산술 관계를 보존했다.'],
    ['implications.0.text:1','none',['@usd'],'헤지·선결제·계약 환율 예외를 보존했다.'],
    ['watch.0.title:0','none',['df-close/p3'],'분석가가 앞으로 확인할 변수로 비거주자 포지션을 언급했다.'],
    ['watch.0.text:0','none',['df-close/p3'],'포지션을 줄이는지 앞으로 본다는 원문이다. 확인해야라는 단어는 독자 가격·매매 업무 지시가 아니라 인용 관찰이므로 의미상 금지 업무 권고로 분류하지 않는다.'],
    ['watch.0.text:1','claim_scope',['df-close/p3','lt-close/p10'],'포지션 변화 부재는 그 집단의 반응 미확인이지 전체 신호 해석의 반증이 아니다. 공급 금액 축소도 규모보다 신호가 중요했다는 해석을 그 자체로 약화한다고 원문이 말하지 않는다.'],
  ],
  '1B': [
    ['title:0','style',['df-close/p3','lt-close/p13'],'원문 요인을 묶었으나 시장 해석이라는 제목은 결론이 추상적이다.'],
    ['summary:0','none',['df-close/p3'],'규모보다 신호라는 BeFX 해석에 시각으로 귀속했다.'],
    ['summary:1','none',['lt-close/p13','lt-close/p10'],'현지와 대외 대비 및 실제 금액 변경 조건에 맞는다.'],
    ['drivers.0.title:0','style',['df-close/p2','df-close/p3'],'공급 계획을 정책 신호로 읽는 맥락이며 실제 집행 선언은 아니다. 구체 명칭이 더 명료하다.'],
    ['drivers.0.text:0','style',['df-close/p3'],'적정 환율 범위에 대한 관심이라는 분석가의 신호 해석이다. 외환시장 안정이라는 말은 더 넓고 추상적이다.'],
    ['drivers.0.text:1','none',['lt-close/p10'],'매각 변경 조건을 보존했다.'],
    ['drivers.0.text:2','style',['df-close/p9','df-close/p10'],'구리와 원유 방향은 맞지만 정부 정책 문단과 연결 없이 끼워 넣었다.'],
    ['drivers.1.title:0','none',['lt-close/p13'],'대외 달러와 현지 반응의 대비라는 원문 범위를 유지했다.'],
    ['drivers.1.text:0','none',['lt-close/p9','lt-close/p13'],'인용 분석가가 현지 요인을 주된 배경으로 연결한 설명이다.'],
    ['drivers.1.text:1','claim_scope',['lt-close/p9','lt-close/p13'],'원문은 가격 반응과 현지 요인 설명이다. 단기 심리에 직접 영향을 미쳤다는 별도 분석가 평가로 확대했다.'],
    ['implications.0.title:0','none',['@usd'],'코드 소유 동일 달러 결제 환산 범위에 맞는다.'],
    ['implications.0.text:0','none',['@usd'],'동일 금액·미헤지 조건의 환산 관계다.'],
    ['implications.0.text:1','none',['@usd'],'승인된 예외 조건을 유지한다.'],
    ['watch.0.title:0','none',['df-close/p3'],'비거주자 포지션은 실제 원문이 제시한 관찰 대상이다.'],
    ['watch.0.text:0','none',['df-close/p3'],'포지션 변화 확인을 신호 해석을 지지하는 재료로 읽는 조건부 설명이다.'],
    ['watch.0.text:1','claim_scope',['df-close/p3','df-close/p4'],'한 투자자 집단의 포지션 변화가 없다는 것만으로 전체 정부 신호 효과가 제한적이라고 평가할 수 없다.'],
  ],
  '1C': [
    ['title:0','none',['df-close/p3'],'규모보다 신호로 읽혔다는 원문의 중요한 구분을 구체적으로 드러낸다.'],
    ['summary:0','none',['df-close/p0','lt-close/p0'],'정부 계획 발표 뒤 장중 흐름 반전을 현지 언론에 귀속했다.'],
    ['summary:1','source_authority',['df-close/p3','df-close/p5','lt-close/p9'],'규모보다 신호의 중요성을 비교한 것은 BeFX다. XTB는 공급 확대·구리를 설명했지 공급 가능성을 매각 규모보다 더 중요하게 비교하지 않았다. 둘을 묶어 공통 평가처럼 귀속했다.'],
    ['summary:2','none',['lt-close/p10'],'자금 조달과 시장 여건에 따른 금액 변경 조건에 맞는다.'],
    ['summary:3','style',['lt-close/p10','lt-close/p11'],'계획·집행 구분은 타당하다. 직전 문장 뒤 독자에게 다시 주의하는 문장으로 이어져 요약이 길다.'],
    ['drivers.0.title:0','style',['df-close/p3'],'정책 신호 해석은 맞으나 먼저라는 말은 두 효과의 선후를 확정하기보다 편집상 첫 번째 해석으로 읽어야 한다.'],
    ['drivers.0.text:0','none',['df-close/p0'],'장중 반전을 DF 보도로 귀속했다.'],
    ['drivers.0.text:1','none',['df-close/p3','lt-close/p10'],'분석가의 신호 해석과 예산국의 금액 변경 조건을 각각 분리해 귀속한다.'],
    ['drivers.1.title:0','none',['lt-close/p13'],'해당 분석가가 국제 달러 대비 현지 요인을 주된 배경으로 읽었다. 새 기여도 수치가 아니다.'],
    ['drivers.1.text:0','none',['lt-close/p13'],'현지 요인 중심이라는 XTB 해석을 정확히 귀속했다.'],
    ['drivers.1.text:1','style',['df-close/p5','df-close/p9','df-close/p10'],'추가 공급과 구리 반등을 언급한 XTB 해석은 있다. 뒤의 원자재 일반화 금지는 오류가 아니라 검토용 조건을 본문에 재진술한 편집 문제다.'],
    ['implications.0.title:0','none',['@usd'],'코드 소유 결제대금 환산 범위다.'],
    ['implications.0.text:0','none',['@usd'],'동일 금액·미헤지 조건을 보존했다.'],
    ['implications.0.text:1','none',['@usd'],'승인된 예외 조건을 보존했다.'],
    ['watch.0.title:0','none',['df-close/p3'],'원문이 확인 변수로 제시한 비거주자 포지션이다.'],
    ['watch.0.text:0','none',['df-close/p3'],'앞으로 포지션을 줄일지 확인한다는 원문을 유지한다.'],
    ['watch.0.text:1','none',['df-close/p3'],'확인하면 신호 해석을 지지하는 재료라는 조건이며, 확인 전 이미 청산됐다는 단정을 금지한다. 반응이 없으면 정책 실패라는 역추론은 하지 않는다.'],
  ],
  '2A': [
    ['title:0','none',['reuters-brl-adjustment/p1','reuters-brl-adjustment/p6'],'선거 이후 반응과 당일 대외 달러 동반 흐름을 구분했다.'],
    ['summary:0','none',['reuters-brl-adjustment/p1','reuters-brl-adjustment/p6'],'Reuters가 보도한 당일 조정과 대외 방향 일치를 귀속한다.'],
    ['summary:1','none',['reuters-brl-adjustment/p4','reuters-brl-adjustment/p5'],'이전 두 거래일의 기대와 구체안 부재를 분리했다.'],
    ['drivers.0.title:0','none',['reuters-brl-adjustment/p4','reuters-brl-adjustment/p5'],'선거 결과와 재정 기대가 기사에 제시된 배경이다.'],
    ['drivers.0.text:0','none',['reuters-brl-adjustment/p4'],'직전 두 거래일의 선거 결과 반응이라는 범위에 맞는다. 일차 표기는 허위 수치가 아닌 생성 계약의 표기 위반이다.'],
    ['drivers.0.text:1','claim_scope',['reuters-brl-adjustment/p4','reuters-brl-adjustment/p5'],'재정 개선 기대와 통화 반응은 있지만 실제 헤알 매수 반응을 따로 관측하거나 그렇게 설명하지 않았다. 가격 반응에서 거래 동기·수급 설명으로 확장했다.'],
    ['drivers.0.text:2','none',['reuters-brl-adjustment/p5'],'구체안 부재에 따라 시장 기대와 신규 정책을 구분했다.'],
    ['drivers.1.title:0','none',['reuters-brl-adjustment/p1','reuters-brl-adjustment/p6'],'오전 조정과 대외 방향이 같다는 기사 내용이다.'],
    ['drivers.1.text:0','none',['reuters-brl-adjustment/p1','reuters-brl-adjustment/p2'],'기사 장중 달러 반등과 랠리 조정을 Reuters에 귀속했다.'],
    ['drivers.1.text:1','none',['reuters-brl-adjustment/p6','reuters-brl-adjustment/p7'],'다른 통화 이름·달러 지수는 실제 원문에 있다. 생성 계약은 이를 금지했으나 다른 통화를 대상 통화로 잘못 계산한 사실 오류는 아니다.'],
    ['drivers.1.text:2','style',['reuters-brl-adjustment/p1','reuters-brl-adjustment/p6'],'공통 요인과의 동행 가능성으로 한정했고 기여도 분해를 하지 않았다. 관측시각 부재는 입력에서 확인했으며 가격 기준의 공통 한계가 본문을 길게 만든다.'],
  ],
  '2B': [
    ['title:0','style',['reuters-brl-adjustment/p1','reuters-brl-adjustment/p6'],'근거 범위에 맞지만 숨고르기와 동조라는 추상어가 결론을 약하게 한다.'],
    ['summary:0','none',['reuters-brl-adjustment/p1','reuters-brl-adjustment/p4','reuters-brl-adjustment/p5','reuters-brl-adjustment/p6'],'기대 반응 이후 조정과 대외 방향 일치를 원문 범위에서 요약한다.'],
    ['summary:1','none',['reuters-brl-adjustment/p5'],'구체적 조정안 부재 조건을 보존한다.'],
    ['drivers.0.title:0','none',['reuters-brl-adjustment/p4','reuters-brl-adjustment/p5'],'기대와 미확정 조건은 기사 내용이다.'],
    ['drivers.0.text:0','none',['reuters-brl-adjustment/p4','reuters-brl-adjustment/p5'],'이전 거래일의 시장 기대를 외신에 귀속했다.'],
    ['drivers.0.text:1','none',['reuters-brl-adjustment/p5'],'구체적 재정 방안 부재이며 Reuters를 정부 원문으로 표시하지 않았다.'],
    ['drivers.1.title:0','style',['reuters-brl-adjustment/p6'],'대외 동반 방향은 맞지만 동조화는 무엇이 달라졌는지 직접 설명하지 않는다.'],
    ['drivers.1.text:0','none',['reuters-brl-adjustment/p6','reuters-brl-adjustment/p7'],'다른 신흥국 통화와 달러 지수의 방향이 기사에 있다.'],
    ['drivers.1.text:1','style',['reuters-brl-adjustment/p1','reuters-brl-adjustment/p6'],'조정과 대외 동행이라는 내용은 맞지만 조율·궤라는 비유가 새로운 연결을 더하지 않는다.'],
  ],
  '2C': [
    ['title:0','claim_scope',['reuters-brl-adjustment/p1','reuters-brl-adjustment/p5'],'원문은 랠리 뒤 조정과 대외 동반 흐름이다. 재정 기대 자체가 당일 재평가됐다고 확인하지 않았다. 제목에서 재평가를 현재 배경으로 확장했다.'],
    ['summary:0','none',['reuters-brl-adjustment/p1','reuters-brl-adjustment/p6'],'당일 조정과 다른 신흥국 통화의 달러 방향 동행에 맞는다. 쏠림을 실제 자금 유입 계량으로 해석하지 않는다.'],
    ['summary:1','none',['reuters-brl-adjustment/p4','reuters-brl-adjustment/p5'],'이전 거래일의 반응을 시장 인식에 귀속했다.'],
    ['summary:2','style',['reuters-brl-adjustment/p5'],'구체안 부재와 기대·정책 구분은 맞지만 주의 문장이 요약을 길게 만든다.'],
    ['drivers.0.title:0','style',['reuters-brl-adjustment/p1','reuters-brl-adjustment/p5'],'기대에 기대던이라는 반복은 내용 오류가 아니라 문체 문제다.'],
    ['drivers.0.text:0','none',['reuters-brl-adjustment/p1'],'오전 랠리 조정을 Reuters에 귀속한다.'],
    ['drivers.0.text:1','none',['reuters-brl-adjustment/p4','reuters-brl-adjustment/p5'],'이전 두 거래일의 재정 기대 반응은 기사에 있다.'],
    ['drivers.0.text:2','none',['reuters-brl-adjustment/p5'],'구체적 조정안 부재를 정확히 유지했다.'],
    ['drivers.1.title:0','none',['reuters-brl-adjustment/p6'],'다른 통화에서도 달러의 같은 방향이 관측된 기사 범위다.'],
    ['drivers.1.text:0','none',['reuters-brl-adjustment/p6','reuters-brl-adjustment/p7'],'대외 달러와 지수 방향에 맞는다.'],
    ['drivers.1.text:1','none',['reuters-brl-adjustment/p1','reuters-brl-adjustment/p6'],'국내 사건만이 아닌 외부 달러와의 동행이라는 제한된 설명이다. 기여도를 계산하지 않는다.'],
    ['watch.0.title:0','style',['reuters-brl-adjustment/p1','reuters-brl-adjustment/p6'],'대외·현지 경로의 구분은 확인 질문으로 유용하다. 재평가 여부를 이미 확인한 것처럼 읽히지 않게 해야 한다.'],
    ['watch.0.text:0','style',['reuters-brl-adjustment/p1','reuters-brl-adjustment/p6'],'계속 동행하면 대외 맥락 설명을 대조하는 관찰 질문은 허용된다. 이후 자료가 과거 인과를 증명하는 것으로 읽히지 않게 당일에서 이후 관찰 범위를 분리하는 편이 명료하다.'],
    ['watch.0.text:1','claim_scope',['reuters-brl-adjustment/p1','reuters-brl-adjustment/p5','reuters-brl-adjustment/p6'],'다른 통화와 동조하지 않는다는 것만으로 재정 기대의 재평가라는 특정 국내 원인의 비중을 높일 수 없다. 다른 국내 요인을 배제할 근거가 없고 기사도 그런 기여도 판단을 제시하지 않는다.'],
  ],
}
const scores = { '1A': [3,4,3,2,3], '1B': [3,3,3,3,4], '1C': [4,4,3,4,3], '2A': [4,4,2,3,3], '2B': [3,3,2,4,4], '2C': [4,4,2,4,3] }
const evaluations = []
for (const label of Object.keys(definitions)) {
  const card = JSON.parse(await fs.readFile(`${root}/${label}.json`, 'utf8')), input = card.input
  assert.equal(definitions[label].length, input.claims.length)
  const refs = keys => ({ applicationIds: keys.includes('@usd') ? [input.applicableMechanisms.find(a => a.mechanismId === 'usd-payment-conversion').applicationId] : [],
    anchors: keys.filter(k => k !== '@usd').map(k => { const [evidenceId, passageId] = k.split('/'), s = input.sources.find(s => s.id === evidenceId)
      return { evidenceId, passageId, passageHash: s.sourceContext.passageHash,
        quote: s.sourceContext.passages.find(p => p.id === passageId).text.slice(0, 450) }
    }) })
  const review = { version: CLAIM_REVIEW_VERSION, binding: input.binding, origin: 'agent', reviewer: 'Codex masked writer comparison original passage review 2026-10-08',
    claims: input.claims.map(c => {
      const [, issue, keys, reason] = definitions[label].find(d => d[0] === c.id)
      const required = ['claim_scope','source_authority'].includes(issue), support = required ? 'limited' : 'supported'
      return { id: c.id, claimHash: c.claimHash, issue, reason, support, decision: required ? 'rewrite' : issue === 'style' ? 'refine' : 'keep',
        ...refs(keys), subclaims: [{ quote: c.quote, support, reason, ...refs(keys) }] }
    }) }
  const assessment = assessClaimReview(input, review)
  assert.deepEqual(assessment.errors, [])
  evaluations.push({ label, currency: card.currency, contentHash: fingerprint(card.content), review, assessment,
    quality: { criteria: ['원인 설명','변화 전달','영업 관련성','가독성','근거 충실도'], scores: scores[label],
      average: scores[label].reduce((n,v)=>n+v,0)/5, origin: 'agent', modelAndCostHiddenAtAssessment: true, fullyBlind: false,
      limitation: '이전 Gemini 원고는 이미 열람했다. 한 표본씩의 잠정 평가이며 일반 모델 순위가 아니다.',
      passed: false, publicationApproved: false } })
}
await fs.writeFile(`${root}/evaluations-before-unmasking.json`, JSON.stringify(evaluations, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ evaluations: evaluations.map(e=>({label:e.label,average:e.quality.average,requiredCorrections:e.assessment.requiredCorrections})),
  modelCalls:0, publicationApproved:false },null,2))
