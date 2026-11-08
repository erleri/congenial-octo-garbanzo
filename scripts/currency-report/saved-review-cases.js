// Agent-adjudicated cases from the frozen CLP source packet. These are explicit
// review judgments, NOT an automatic semantic classifier or model benchmark.
// refs are evidenceId/passageId; the runner binds them to exact saved passages.
const part = (quote, support, refs, reason) => ({ quote, support, refs, reason })
const ok = (quote, refs, reason) => part(quote, 'supported', refs, reason)
const bad = (quote, refs, reason) => part(quote, 'unsupported', refs, reason)
const row = (id, issue, reason, parts) => ({ id, issue, reason, parts })

export const SAVED_JUDGMENTS = [
  row('title:0', 'style', '정책 신호와 국제 달러 강세의 대비는 근거가 있다. 추상적 제목은 구체화 권고이며 사실 오류가 아니다.', [ok(null, ['df-close/p0', 'lt-close/p13'], '현지 정책 신호와 국제 달러 강세를 대비한 제목으로 읽는다.')]),
  row('summary:0', 'observation_time', '공식성 및 실제 관측의 선후관계를 입증한 메타데이터가 없다. 보도 속 정책 신호는 지지되지만 그 앞 수식어는 제거해야 한다.', [
    bad('공식 관측 이후 ', [], 'observationAt과 공식 제공기관 기록이 없다. 기사 시각이나 수집시각으로 이 두 주장을 보충할 수 없다.'),
    ok('현지 시장에서는 정부의 외환 공급 계획 발표가 정책 신호로 해석되며 장중 흐름에 영향을 주었습니다.', ['df-close/p0', 'df-close/p3'], '정부 발표 뒤 장중 전환과 정책 신호 해석을 전하는 기사 범위다.'),
  ]),
  row('summary:1', 'style', '본문의 달러 강세를 요약한 문맥은 타당하다. 통화 여건이라는 표현을 달러 강세로 좁히면 명확해진다.', [ok(null, ['lt-close/p13'], '현지 요인과 국제 달러 강세의 대비를 기사와 본문 문맥에서 확인했다.')]),
  row('drivers.0.title:0', 'none', '발표와 정책 신호를 표시하며 실제 집행을 주장하지 않는다.', [ok(null, ['df-close/p2', 'df-close/p3'], '발표와 전문가의 신호 해석 모두 직접 확인된다.')]),
  row('drivers.0.text:0', 'none', '정책 신호를 시장의 해석으로 귀속한 문장이다. 당국의 확정된 목표로 단정하지 않는다.', [ok(null, ['df-close/p0', 'df-close/p3'], 'BeFX 발언은 당국의 환율에 대한 관심을 신호로 읽었다고 설명한다.')]),
  row('drivers.0.text:1', 'claim_scope', '원문은 공급 발표와 페소 반등을 연결한다. 외화 확보 압박이 실제 완화됐다는 수요·조달 상태와 그 전문가 귀속까지 입증하지 않는다.', [
    ok('현지 분석가들은 유동성 공급 의지가 확인되면서 ', ['df-close/p3'], '공급 계획 발표를 신호로 받아들였다는 부분은 지지된다.'),
    bad('외화 확보 압박이 일부 완화되고 ', ['df-close/p4', 'df-close/p5'], '원문의 비거주자 포지션 압력 및 공급 해석은 외화 조달 압박의 실제 완화와 다르다.'),
    ok('페소화 가치가 반등하는 계기가 되었다고 전했습니다.', ['df-close/p5'], 'XTB가 발표와 페소 강세를 연결한 인용은 존재한다.'),
  ]),
  row('drivers.0.text:2', 'none', '재정 필요와 시장 조건에 따른 변경 가능성을 그대로 보존했다.', [ok(null, ['lt-close/p10'], '보도에 인용된 변경 조건이며 집행 완료 주장도 없다.')]),
  row('drivers.1.title:0', 'style', '범주를 표시한 제목 자체는 원자재 전체 상승을 단정하지 않는다. 달러와 구리라는 구체 명칭을 권고한다.', [ok(null, ['df-close/p1', 'df-close/p10'], '달러 및 구리라는 해당 절의 주제에 한정해 허용한다.')]),
  row('drivers.1.text:0', 'claim_scope', '연속 상승은 구리 두 거래일에 대한 보도다. 주요 원자재 전반으로 넓힌 표현은 구리로 한정해야 한다. 같은 기사에서 유가는 하락했다.', [
    ok('글로벌 시장에서는 대외 달러화가 견조한 흐름을 이어가는 가운데 ', ['df-close/p1', 'lt-close/p13'], '국제 달러 강세는 두 기사에서 확인된다.'),
    bad('주요 원자재 가격이 연속 상승세를 나타냈습니다.', ['df-close/p10', 'df-close/p9'], '구리의 짧은 상승만 확인됐고 유가는 반대로 하락했다. 원자재 범주 전체의 연속 상승으로 묶을 수 없다.'),
  ]),
  row('drivers.1.text:1', 'style', '이 절의 원자재를 구리로 한정해 읽을 때 XTB의 귀속 해석과 맞는다. 앞 문장의 범위 오류는 별도로 고쳐야 한다.', [ok(null, ['df-close/p5', 'lt-close/p13'], '구리와 정부 발표의 지지 해석 및 국제 달러 강세를 결합한 요약이다. 독립된 두 기관의 검증으로 세지 않는다.')]),
  row('drivers.1.text:2', 'style', '장기 추세를 확정하지 않는 것은 타당하지만 새 정보가 적다. 짧은 관측 기간을 본문에 명시하면 별도 경고를 줄일 수 있다.', [ok(null, ['df-close/p10'], '원문은 두 거래일 상승만 기록한다. 장기 추세 부재가 아니라 확정 근거의 범위를 설명한다.')]),
  row('implications.0.title:0', 'none', '승인된 동일 달러 대금의 조건부 환산이라는 범위다.', [ok(null, ['@usd'], '승인된 환산 원리의 조건과 단위에 한정한다.')]),
  row('implications.0.text:0', 'none', '동일 USD 금액과 미헤지 조건을 명시한 산술 관계다.', [ok(null, ['@usd'], '실제 기업의 결제액이나 손익을 관측했다고 주장하지 않는다.')]),
  row('implications.0.text:1', 'none', '승인된 적용 예외를 명시하며 원리 사용 범위를 유지한다.', [ok(null, ['@usd'], '헤지·선결제·고정 계약 환율이라는 승인된 예외와 일치한다.')]),
  row('watch.0.title:0', 'none', '관찰 변수 절의 제목이므로 집행이나 포지션 변화가 완료됐다는 진술이 아니다.', [ok(null, ['df-close/p3', 'lt-close/p10'], '향후 포지션 조정 여부와 매각 조건을 관찰하는 제목이다.')]),
  row('watch.0.text:0', 'none', '여부와 향후를 명시한 관찰 대상이다. 미래 변화에 대한 확정 예측이 아니다.', [ok(null, ['df-close/p3', 'lt-close/p10'], '비거주자가 신호에 반응할지 관찰한다는 발언과 변경 가능한 매각 계획에 근거한다.')]),
  row('watch.0.text:1', 'none', '확인되면·지연되면이라는 조건부 판단 경로이며 실제 집행·청산의 관측이나 매각 지연 예측이 아니다.', [
    ok('실제 시장 공급과 포지션 완화가 확인되면 정책 신호에 따른 통화 안정 설명을 지지하겠지만 ', ['df-close/p3', 'lt-close/p10'], '계획의 현실화와 포지션 반응이 신호 설명을 뒷받침할 조건을 제시한다.'),
    ok('집행 규모가 축소되거나 시장 조건 변경으로 매각이 지연되면 안정 효과에 대한 기대는 약화될 수 있습니다.', ['lt-close/p10', 'df-close/p3'], '지연은 실제 발생 주장이나 원문 직접 인용이 아닌 명시적 가정이다. 공급 신호가 약해질 때 설명이 약해진다는 해석 범위다.'),
  ]),
]

// Synthetic minimal contrasts use the SAME real source context. They are not
// historical reports, and their expected judgments were assigned by the agent.
export const CONTRASTS = [
  { id: 'attributed-announcement', text: '보도에 따르면 예산 당국은 달러 매각 계획을 발표했습니다.', issue: 'none', refs: ['df-close/p2'], reason: '언론에 귀속한 계획 발표이며 정부 원문 직접 확인이나 집행 완료 주장이 아니다.' },
  { id: 'invented-execution', text: '정부는 달러 매각을 이미 완료했습니다.', issue: 'claim_scope', refs: ['df-close/p2'], reason: '제공 자료는 계획 발표다. 이번 계획의 실제 집행 완료를 확인할 근거가 없다.' },
  { id: 'conditional-positions', text: '비거주자가 포지션을 줄인다면 정책 신호에 대한 반응을 확인하는 단서가 됩니다.', issue: 'none', refs: ['df-close/p3'], reason: '향후 조정 여부를 보는 전문가 발언에 연결된 조건부 관찰이며 실제 청산 주장이 아니다.' },
  { id: 'invented-positions', text: '비거주자는 이미 포지션을 줄였습니다.', issue: 'claim_scope', refs: ['df-close/p3'], reason: '원문은 앞으로 조정 여부를 보자는 발언이다. 완료된 포지션 조정으로 바꿀 수 없다.' },
  { id: 'copper-short-period', text: '기사에 따르면 구리는 두 거래일 연속 상승했습니다.', issue: 'none', refs: ['df-close/p10'], reason: '구리라는 대상과 짧은 기간을 원문 범위 그대로 한정한다.' },
  { id: 'all-commodities', text: '주요 원자재 전반의 장기 상승 추세가 확정됐습니다.', issue: 'claim_scope', refs: ['df-close/p9', 'df-close/p10'], reason: '구리 두 거래일을 원자재 전반과 장기 추세로 확대했고 유가 하락도 누락했다.' },
  { id: 'conditional-usd', text: '같은 달러 결제대금에 헤지를 하지 않았다면 달러당 페소 환율이 낮아질 때 페소 환산액도 줄어듭니다.', issue: 'none', refs: ['@usd'], reason: '승인된 동일 USD·미헤지 조건의 산술 관계이며 실제 기업 노출을 추정하지 않는다.' },
  { id: 'invented-margin', text: '페소 환산액이 줄어 가전업체의 실제 마진이 개선됐습니다.', issue: 'claim_scope', refs: ['@usd'], reason: '환산 원리만으로 업체의 실제 결제·매출·비용·헤지 상태 및 마진을 알 수 없다.' },
  { id: 'ambiguous-currency-in-context', text: '같은 달러 대금을 헤지하지 않고 비교할 때 이 외화 대금의 페소 환산액은 달러당 페소 환율에 비례합니다.', issue: 'none', refs: ['@usd'], reason: '앞에서 달러라고 명시하므로 외화라는 단어만으로 범위 확대를 판정하지 않는다.' },
  { id: 'missing-original', text: '별도의 정부 원문에는 집행 결과가 공개됐습니다.', issue: 'verification_gap', refs: [], reason: '그 별도 원문은 제공되지 않았다. 확인 대기로 기록하며 거짓이나 내용 합격으로 처리하지 않는다.' },
]

export const LEGACY_IMPLICATIONS = [
  row('implications.0.title:0', 'none', '미헤지 결제의 조건부 환산이라는 제목 자체는 실제 노출이나 회계 결과를 단정하지 않는다.', [ok(null, ['@usd'], '승인된 결제금액 환산 원리 범위에서 읽는다.')]),
  row('implications.0.text:0', 'claim_scope', '조건부 달러 결제금액 환산을 장부상 평가로 확대했다. 회계 측정 기준과 기업의 실제 거래를 제공한 근거가 없다.', [
    ok('동일한 외화 금액을 결제해야 하고 환헤지를 하지 않은 조건이라면 현지 통화 가치 변동에 따라 ', ['@usd'], '외화는 이 입력의 USD를 가리키는 문맥이다. 조건부 환산 관계는 허용한다.'),
    bad('장부상 현지통화 환산 부담이 달라집니다.', ['@usd'], '승인된 결제대금 환산 원리가 회계 장부 평가 방식까지 뒷받침하지 않는다.'),
  ]),
  row('implications.0.text:1', 'none', '환율 변화 및 사전 결제·계약 환율에 따른 조건부 차이로 한정한 설명이다.', [ok(null, ['@usd'], '기업의 실제 결과를 확인한 문장이 아니며 승인된 환산 예외와 맞는다.')]),
]
