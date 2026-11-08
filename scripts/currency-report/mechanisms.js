// Editorially reviewed general principles, not observations or trading rules.
// Changes require a registry version bump and new applicability reviews.
export const MECHANISM_VERSION = 'fx-mechanisms/1'
const fedRates = 'https://www.federalreserve.gov/econres/notes/ifdp-notes/the-sensitivity-of-the-us-dollar-exchange-rate-to-changes-in-monetary-policy-expectations-20170922.htm'
const fedRisk = 'https://www.federalreserve.gov/econres/notes/feds-notes/monetary-policy-and-exchange-rates-during-the-global-tightening-20240510.html'
const rba = 'https://www.rba.gov.au/education/resources/explainers/drivers-of-the-aud-exchange-rate.html'
const entry = (id, title, publisher, url, scope, conditions, counterconditions, allowed, prohibited) => ({
  id, version: MECHANISM_VERSION, title, source: { publisher, url, checkedAt: '2026-10-05', scope },
  conditions, counterconditions, allowed, prohibited,
})
export const MECHANISMS = [
  entry('us-rates-dollar', '미국 금리 기대와 달러', 'Federal Reserve staff research', fedRates,
    '정책 발표 전후의 기대 변화 연구. 국가·시기별 차이가 있으며 당일 인과 증거를 대신하지 않음.',
    ['미국 정책 기대에 관한 확인된 새 정보', '해당 통화와 비교 기간의 연결'],
    ['이미 가격에 반영된 결정', '다른 국가 금리 기대 또는 위험 프리미엄 변화'],
    '상대 수익률 기대가 달러 자산 수요에 영향을 줄 수 있는 경로', '미국 금리가 높으므로 오늘 현지통화가 반드시 약세'),
  entry('relative-rates-risk', '상대 금리와 위험 평가', 'Federal Reserve staff research', fedRisk,
    '선진국과 신흥국 결과가 다르며 브라질·칠레에서는 정치 위험이 금리 효과와 반대로 작용한 사례.',
    ['양국 상대 금리 기대 또는 출처의 비교 해석', '해당 국가 위험 평가와 비교 기간'],
    ['인플레이션·정치 위험 프리미엄', '예상된 금리 차이'],
    '수익률 유인과 위험 보상의 경쟁 관계', '금리 인상은 무조건 통화 강세'),
  entry('commodity-exporter', '원자재와 수출국 통화', 'Reserve Bank of Australia', rba,
    '호주 교역조건·자본 흐름 설명에서 일반 경로만 차용. 칠레·브라질의 수출 노출은 별도 입증.',
    ['해당 기간 원자재 가격 변화', '해당 국가 수출 노출 또는 원문의 통화 연결'],
    ['수출 물량·헤지·결제 통화 차이', '동시 달러·위험 요인'],
    '수출 수입·교역조건 기대를 통한 통화 지지 가능성', '구리가 내렸으므로 페소 하락의 전부가 설명됨'),
  entry('risk-aversion', '위험회피와 달러 자산', 'Federal Reserve staff research', fedRisk,
    '위험 지표와 환율의 관계 및 한계. 상관관계를 개별 날짜의 인과로 승격하지 않음.',
    ['해당 기간 위험 지표 변화 또는 출처의 위험회피 해석', '해당 국가·통화와의 연결'],
    ['미국 자체 위험', '국가 고유 요인·정책 개입'],
    '안전자산 수요와 위험 통화 요구수익률의 경로', '모든 불안은 모든 통화에 같은 영향을 줌'),
  entry('inflation-purchasing-power', '물가와 구매력', 'International Monetary Fund',
    'https://www.imf.org/en/Publications/fandd/issues/Series/Back-to-Basics/Inflation',
    '가격과 명목소득의 상대 변화에 관한 일반 원리. 판매량이나 구매 연기 실적의 증거가 아님.',
    ['해당 국가 물가 자료와 지표 대상 기간', '명목소득 조건을 명시하고 실제 소득·판매로 단정하지 않음'],
    ['소득 증가·지원금·가계별 소비 구성', '가격 전가 시차'],
    '소득이 물가를 따라가지 못하는 경우의 실질 구매력 부담', '물가 상승만으로 TV 판매 감소를 단정'),
  entry('usd-payment-conversion', '달러 결제대금 환산', 'Reserve Bank of Australia',
    'https://www.rba.gov.au/education/resources/explainers/exchange-rates-and-their-measurement.html',
    '양자 환율 정의에 근거한 산술적 환산. 회사의 실제 노출을 뜻하지 않음.',
    ['LOCAL_PER_USD 관측값과 비교 기준', '동일 달러 금액·미헤지라는 조건을 명시'],
    ['헤지·선결제·계약 환율', '가격·물량·결제 통화 변화'],
    '같은 미헤지 달러 대금의 현지통화 환산 부담', '특정 업종 수입 비중·회사 마진·소비자가격 효과 추정'),
]
// Freeze nested records too: model-generated data cannot extend or approve this registry.
function freeze(value) { Object.values(value).forEach(v => { if (v && typeof v === 'object') freeze(v) }); return Object.freeze(value) }
freeze(MECHANISMS)
