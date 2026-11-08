// Shared standards, not a keyword-based semantic truth detector.
export const REASONING_POLICY_VERSION = 'report-reasoning/5'
export const REASONING_CRITERIA = Object.freeze({
  expertComparison: '발언별 명시적 우선순위·조건을 대조한다. 나열·생략·counter 분류로 대립을 추정하지 않는다. 한쪽의 명시적 우선순위는 해당 배경에 귀속한다.',
  observationScope: '경로 부합 관찰과 경쟁 설명 판별을 구분한다. 판별할 추가 근거가 없으면 변화·반응을 비교하는 편집상 관찰로 한정하거나 생략한다. 변수 나열 대신 관찰 목적을 밝힌다.',
  causalScope: '가격 수준과 당일 등락을 구분한다. 동행·후속 반응만으로 원인·상대 기여·우열을 확정하지 않는다. 조건형에도 같은 기준을 적용한다.',
  caveatPlacement: '본문·요약은 사건과 연결을 설명한다. 기여도 미산출·한 전문가의 해석·입증된 순위 아님 같은 검증 안내로 끝내지 않는다. 발행시각은 sourceTiming과 출처 표시, 공통 한계는 별도 영역의 역할이다. 전문가 이름과 의미를 바꾸는 실제 조건은 유지한다.',
  currencyConnection: '환율 배경을 쓰는 경우 달러 공통 요인은 현지 근거의 연결 또는 승인된 applicableMechanisms로 해당 통화까지 설명한다. 두 기사 ID만 붙여 연결을 입증하지 않는다. 연결 근거가 없으면 기존 배경의 맥락으로 한정하거나 생략한다. 미확인 현지 자금 이동·달러 매수·수출 물량은 금지한다. 경제·소비 업데이트에는 통화 원인 설명을 요구하지 않는다.',
})
export const REASONING_WRITER_INSTRUCTIONS = [
  `## 설명의 범위 ${REASONING_POLICY_VERSION}`,
  ...Object.values(REASONING_CRITERIA),
  '편집상 제안을 전문가의 관찰·예측으로 귀속하지 않는다. 두 결과를 채우려고 양립 가능한 설명을 양자택일로 만들지 않는다.',
].join('\n')
export const REASONING_REVIEW_INSTRUCTIONS = [
  `## 비교·관찰·한계 검토 ${REASONING_POLICY_VERSION}`,
  ...Object.values(REASONING_CRITERIA),
  'reason과 subclaims에 비교 대상별 근거와 실제 허용 범위를 기록한다. 양쪽 출처 ID가 있다는 사실은 두 견해의 대립을 지지하는 증거가 아니다.',
  '상대 우선순위를 주장하지 않는 한쪽의 귀속 견해는 다른 전문가의 반대 발언이 없어도 유지한다. 모든 비교나 조건부 설명을 일괄 차단하지 않는다.',
  '관찰 목적을 설명한 편집상 제안은 기존 경로와 연결되는지 확인한다. 상대 기여의 판별을 주장하면 그 구별을 뒷받침하는 추가 근거를 대조한다. 동행만 있으면 그 우열 판단은 claim_scope의 필수 교정이다.',
  '현재 높은 가격 수준을 변화 없음으로 취급하거나 함께 움직인 사실을 인과 입증으로 바꾸면 필수 교정이다. 조건형으로 썼다는 이유만으로 supported로 처리하지 않는다.',
  '지지된 검증 안내의 본문 반복은 style/refine이다. 독자 품질 점수와 사실 오류를 분리한다. 시점은 sourceTiming·출처 표시와 함께 검토하며 시점 경고 문장 삭제 자체를 오류로 보지 않는다. 사후 해설을 선행 신호로 바꾸거나 실제 조건을 지워 의미가 달라지면 필수 교정이다.',
  '통화 연결은 글자 수나 국가명 유무가 아니라 본문과 채택 근거로 판단한다. 길어도 일반 달러 요인뿐이면 R02 내용 미충족이며, 짧아도 근거 있는 연결이면 유지한다. 지원 없는 현지 수급 추가는 claim_scope/rewrite, 지지되지만 얕은 설명은 style/refine으로 구분한다.',
  '원문 대신 reviewer_authored_notes가 제공되면 해당 검토 요지의 범위만 대조하고 기사 원문을 새로 확인했다고 기록하지 않는다. 판단 자료 자체가 없으면 verification_gap으로 남긴다.',
  '제목·요약에서도 한 전문가의 상대 우선순위를 시장 전체의 중심 요인으로 확대하지 않았는지 확인한다. 국제 요인의 변화와 현지 자금 수급의 변화는 서로 다른 주장이다. 현지 수급을 주장하면 이를 지지하는 해당 시장의 근거를 대조하고, 연결된 출처만으로 지지가 없으면 claim_scope로 남긴다.',
].join('\n')
