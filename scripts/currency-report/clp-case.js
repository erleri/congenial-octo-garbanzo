// Original pages reviewed 2026-10-05. Short paraphrases, not article reproductions.
// This is an explicitly curated historical experiment, not an automatic admission rule.
const review = scope => ({ originalVerified: true, admission: 'attributed_context', checkedAt: '2026-10-05', scope })
const common = { country: 'CLP', collectedAt: '2026-10-05', role: 'context', causalStatus: 'source_attributed', provenance: 'market_reporting' }
export const clpEvidence = [
  { ...common, id: 'emol-close', publisher: 'Emol', scope: 'country',
    url: 'https://www.emol.com/noticias/Economia/2026/09/11/1211251/dolar-mercado-cambiario-local.html',
    title: '칠레 외환시장 주간 마감 보도', publishedAt: '2026-09-11T15:10:00-03:00', eventDate: '2026-09-11', period: '당일 유동성 높은 거래 마감 및 전주 금요일 대비; 시각 미명시',
    summary: 'Emol은 달러 매도호가 943.2페소와 당일 3페소 상승을 보도했다. 구리 조정과 취약한 국내 거시 여건을 배경으로 설명했으며, 인용된 XTB 분석가는 국내 물가의 예상 밖 결과와 성장 전망 약화를 함께 거론했다. 다음 주 미국 연준 결정을 관찰 대상으로 들었다.',
    review: review('당일 구리 조정·국내 거시 배경 및 연준 결정 주목이라는 출처 귀속 설명만 채택. 기사 호가와 대시보드는 비교 기준이 다름. 구리·거시 수치는 제외. 기사 상승분을 대시보드 변동률의 원인·분해값으로 취급하지 않음. 환율 변화 전체의 직접 원인 확정, 수치 전망 제외.') },
  { ...common, id: 'emol-morning', publisher: 'Emol', scope: 'global',
    url: 'https://www.emol.com/noticias/Economia/2026/09/11/1211198/dolar-mercado-cambiario-local.html',
    title: '미국 물가 발표 후 칠레 시장의 오전 반응', publishedAt: '2026-09-11T10:12:00-03:00', eventDate: '2026-09-11', eventAt: '2026-09-11T09:43:00-03:00', period: '칠레 오전 09:43 호가; 미국 물가 지표 대상은 8월',
    summary: 'Emol은 오전 9시43분 달러 매도호가 940.8페소, 소폭 변동을 보도했다. 인용된 Capitaria 분석가는 미국 일반 물가는 예상에 부합하지만 근원물가에는 예상보다 끈질긴 압력이 보였다고 해석했다. 이 해석은 미국 금리와 달러 지지 가능성에 관한 것이다. 국채 수익률·달러 지수·연준 결정이 이어지는 관찰 변수다.',
    review: review('미국 물가에 대한 기사 속 분석가의 해석과 오전의 제한된 반응만 채택. 미국 물가 수치는 공식 검증하지 않아 제외. 큰 환율 변동을 해당 발표 하나의 충격으로 단정하지 않음. 국채·달러 지수의 실제 등락은 입력에 없음. 대시보드 일간 변동과 동일시하지 않음.') },
  { ...common, id: 'rm-inflation', publisher: 'Reporte Minero', scope: 'sales_context',
    url: 'https://www.reporteminero.cl/noticia/noticias/2026/09/inflacion-agosto-retasa-convergencia-meta-banco-central-chile',
    title: '칠레 물가와 가계 구매력에 대한 전문가 해설', publishedAt: '2026-09-10T22:27:00-03:00', eventDate: '2026-09-10', period: '8월 소비자물가 관련 해설; 발표 다음 날의 직접 원인 아님',
    summary: 'Reporte Minero가 인용한 대학 경제학자는 예상보다 높은 칠레 물가가 금리 인하 여지를 제한할 수 있다고 해석했다. 물가 부담이 가계 구매력을 약화시키고 불확실성이 큰 구매를 늦추는 경로를 설명했다. 별도의 조건부 산술 경로: 달러 결제가격이 같을 때 현지통화 약세는 수입대금의 페소 환산 부담을 늘린다.',
    review: review('물가·구매력·구매 연기의 출처 귀속 해설만 채택. 마지막 수입환산 설명은 기사 사실이 아닌 조건부 일반 경로임을 명시. 실제 가전 판매·할부금리·소비자가격 전가·기업 실적은 미확인. 물가 수치와 향후 금리 결정 예측 제외.') },
]
export const clpSourceDecisions = [
  ['local-9da4c24fd57c', true, 'admit', 'emol-close: 당일 마감·주간 비교 분리; 거시 수치 제외'],
  ['local-9bb9cb176dbb', true, 'exclude', 'Reporte Minero 당일 구리 기사: 가격 수준과 미국 지표 발표 전후가 Emol과 불일치; 원인 입력에서 전부 제외'],
  ['local-45173a0d27f5', true, 'admit', 'emol-morning: 관측시각 있는 오전 보도; 대시보드 시각은 여전히 없음'],
  ['local-7d0258a231be', true, 'exclude', '전일 마감 보도; 당일 보도와 중복되는 배경이며 비교 기준 혼합 방지'],
  ['local-f4896f718211', true, 'exclude', '전일 오전 호가; 당일 원인으로 재사용하지 않음'],
  ['local-8bb3c5c3fa5d', true, 'exclude', '7월 구리 생산 지표; 당일 외환시장 인과관계 미입증'],
  ['local-e19cdbd69d5d', true, 'admit', 'rm-inflation: 현지 날짜는 9월10일; 구매력 해설에 한정'],
  ['openrouter-dba5617254b9', true, 'corroboration_only', 'BCCh IPoM 본문 p4-5의 수요 둔화·성장 범위는 대조됨. 후보에 정확한 발행일 없어 입력 제외'],
  ['openrouter-df655f6a4e52', false, 'exclude', '일반 홈페이지로 열림; 해당 날짜 시계열 원문 아님'],
  ['openrouter-7cc4e3e17935', false, 'exclude', '현재 홈페이지; 역사적 근거로 채택하지 않음'],
  ['gdelt-d8b8fcdf1913', false, 'exclude', 'Yahoo 원문 접근 오류; 제목만으로 승인하지 않음'],
  ['gdelt-485bb48a1150', true, 'exclude', '전일 시장 기사; 해당 관측의 직접 원인 확인 자료 아님'],
  ['gdelt-ddf109d02b89', true, 'exclude', '전일 지역 개장전 보도; 자동 뉴스룸 콘텐츠로 독립적 확인 근거 삼지 않음'],
  ['gdelt-bd19089ad114', true, 'exclude', '이전 정책회의·이주자용 기사; 당일 외환 원인 및 영업 관련성이 낮음'],
].map(([id, originalVerified, decision, reason]) => ({ id, originalVerified, decision, reason }))
