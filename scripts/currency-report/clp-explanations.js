import { clpEvidence } from './clp-case.js'
import { explanationSourceHash, projectExplanations } from './explanations.js'

// Curated from the three original articles, re-read 2026-10-05. No new observed prices.
// Paragraph anchors are paraphrases, not copied articles. Review is attribution, not causal proof.
const cards = [
  { id: 'us-core-rates', evidenceId: 'emol-morning', use: 'driver',
    event: '일반 물가는 예상에 부합했지만 근원물가의 월간 변화는 예상보다 높았다는 오전 보도.',
    surprise: '분석가가 주목한 차이는 일반 물가가 아니라 근원물가의 끈질긴 압력이었다.',
    transmission: 'Capitaria 분석가는 이 압력이 연준의 긴축적인 정책 입장을 뒷받침하고 미국 금리를 높은 수준에 머물게 해 달러를 지지할 수 있다고 설명했다.',
    connection: '분석가가 연결한 것은 달러-페소의 상방 압력이다. 이는 칠레만의 사건이 아니라 미국 금리와 달러를 통한 공통 외부 경로다.',
    attribution: 'Emol 오전 보도가 인용한 Capitaria 분석가의 조건부 시장 해석',
    anchor: '근원물가의 예상 차이를 설명한 문단 다음의 연준 정책 입장·미국 금리·달러-페소 연결 문단. 이어 국채 수익률과 DXY 관찰 문단.',
    excluded: ['미국 물가 수치의 독립적 공식 확인 또는 실제 금리·DXY 상승 주장', '대시보드 일간 변동 전체를 해당 발표의 효과로 계산하거나 동일시'] },
  { id: 'copper-support', evidenceId: 'emol-close', use: 'driver',
    event: '마감 기사는 구리가 전 거래일보다 낮게 마감했다고 보도했다.',
    surprise: '확인한 것은 전 거래일 대비 조정이며 시장 예상 대비 차이는 확인하지 않았다.',
    transmission: '기사는 구리 조정을 페소를 떠받치는 힘이 줄어드는 배경으로 설명했다.',
    connection: '미국 요인이 달러 쪽 지지를 설명한다면, 구리 요인은 페소 쪽 지지력 약화를 설명한다. 이는 두 보도의 설명을 구분한 편집적 종합이다.',
    attribution: 'Emol 마감 보도의 구리·페소 연결 및 오전 보도와의 편집적 대조',
    anchor: '구리의 전 거래일 대비 LME 마감 변화를 설명하고 페소 지지력 감소로 연결한 문단.',
    excluded: ['실제 구리 수출액·달러 유입·대외수지 악화가 관측됐다는 주장', '구리 가격·변동률 숫자 및 환율에 대한 기여도 추정'] },
  { id: 'household-purchasing', evidenceId: 'rm-inflation', use: 'sales_context',
    event: '전일 물가 해설은 예상보다 끈질긴 물가와 불확실성이 가계에 미치는 경로를 다뤘다.',
    surprise: '기사 속 경제학자는 예상보다 높은 물가를 해석했다. 이는 다음 날 환율의 직접 원인 자료가 아니다.',
    transmission: '해설은 구매력 약화와 불확실성에 따른 큰 구매의 연기를 구분하고, 물가 부담이 정책금리 인하 여지를 제한한다고 설명했다.',
    connection: '영업 독자는 살 수 있는 여력과 구매 결정을 미루는 시점을 다른 경로로 읽는다. 이는 소비환경 해설이지 실제 가전 판매 결과가 아니다.',
    attribution: 'Reporte Minero가 인용한 UNAB 경제학자의 소비·정책 여건 해설',
    anchor: '금리 조정 여지 소제목 아래 문단, 투자·신뢰 소제목 아래 가계 구매력과 큰 구매 연기 문단, 말미 물가·활동·고용 관찰 문단.',
    excluded: ['실제 가전·TV 판매·할부금리 변화 또는 높은 업종 수입 비중 주장', '소비 요인이 환율보다 먼저 또는 더 크게 작용한다는 비교', '향후 금리 결정 예측이나 특정 가격·판촉 업무 권고'] },
].map(card => ({ ...card, sourceHash: explanationSourceHash(clpEvidence.find(e => e.id === card.evidenceId)) }))

export function attachClpExplanations(packet) {
  if (packet.currency !== 'CLP' || packet.baseDate !== '2026-09-11') throw new Error('wrong_explanation_case')
  const result = { ...packet, explanationCards: structuredClone(cards) }
  projectExplanations(result)
  return result
}

// Editorial target written by Codex, NOT an OpenRouter generation or approved report.
export const clpReferenceDraft = {
  title: '달러를 지지한 물가 해석, 페소의 버팀목을 약하게 한 구리',
  summary: '미국에서는 일반 물가보다 근원물가의 끈질긴 압력이 주목받았다. 칠레 마감 보도는 구리 조정을 페소 지지력을 약하게 한 배경으로 설명했다. 소비 측면에서는 물가 부담이 구매력과 큰 구매의 시점에 미치는 경로를 나누어 읽을 수 있다.',
  drivers: [
    { title: '예상과 달랐던 근원물가가 미국 고금리 지속 해석으로', kind: 'interpretation', evidenceIds: ['emol-morning'],
      text: 'Emol이 인용한 분석가는 일반 물가가 예상에 부합했어도 근원물가의 월간 변화는 예상보다 높았다는 점에 주목했다. 물가 압력이 끈질기면 연준이 긴축적인 입장을 유지하고 미국 금리도 높은 수준에 머물 수 있다는 해석이다. 기사에서 설명한 연결은 높은 미국 금리가 달러를 지지해 달러-페소에도 상방 압력을 줄 수 있다는 것으로, 칠레 밖에서 들어오는 공통 달러 요인이다.' },
    { title: '구리 조정은 페소를 떠받치는 힘이 줄었다는 설명', kind: 'interpretation', evidenceIds: ['emol-close', 'emol-morning'],
      text: 'Emol 마감 기사는 구리가 전 거래일보다 낮게 마감했으며 이것이 페소의 지지력을 줄이는 배경이라고 설명했다. 두 보도를 함께 읽으면 미국 물가 해석은 달러 쪽 지지를, 구리 조정은 페소 쪽 버팀목의 약화를 가리킨다. 같은 환율 움직임을 달러 측 요인과 칠레 측 요인으로 구분해 이해할 수 있다.' },
  ],
  implications: [
    { title: '구매 여력과 구매를 미루는 심리는 서로 다른 경로', kind: 'interpretation', evidenceIds: ['rm-inflation'],
      text: 'Reporte Minero가 인용한 경제학자는 물가 부담이 가계 구매력을 낮추는 경로와, 불확실성이 큰 구매 결정을 늦추는 경로를 구분했다. 영업 관점에서 전자는 구매에 쓸 수 있는 여력, 후자는 구매 시점에 관한 설명이다. 내구재 소비환경을 읽을 때 이 둘을 나누면, 환율 숫자만으로 소비를 판단하는 것보다 무엇을 확인해야 하는지가 명확해진다.' },
  ],
  watch: [
    { title: '미국 금리·달러 반응이 물가 해석과 맞물리는가', kind: 'mechanism', evidenceIds: ['emol-morning'],
      text: '오전 보도는 미국 국채 수익률과 달러 지수, 연준 결정을 후속 관찰 대상으로 제시했다. 미국 금리와 달러의 후속 흐름이 함께 지지력을 보이는지는 기사 속 고금리 지속 해석과 시장 반응이 맞물리는지 확인할 단서다.' },
    { title: '칠레 물가·활동·고용이 소비환경에 주는 단서', kind: 'interpretation', evidenceIds: ['rm-inflation'],
      text: 'Reporte Minero 해설은 다음 물가·경제활동·고용 지표를 관찰 대상으로 꼽았다. 물가 부담이 완화되는지와 활동·고용 여건을 함께 읽으면 구매력 압박과 경기 여건을 구분할 수 있다. 이는 실제 가전 판매를 대신하는 지표가 아니라 소비환경을 설명할 추가 근거다.' },
  ],
}
