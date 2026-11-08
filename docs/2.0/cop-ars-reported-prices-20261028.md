# COP·ARS 리포트 전용 보도 가격 연결

2026-10-28 · 로컬 저장 자료만 재사용 · 새 유료/네트워크/운영 호출 0

## 바뀐 상태

**COP·ARS 모두 같은 매체가 각각 보도한 두 거래일의 시장 가격을 공통 가격·기간 검사에 연결했다.** 공식 참고환율의 거래일을 추정해 기사 종가로 대체한 것이 아니다. 기존 대시보드 API·데이터·원고·비용은 변경하지 않았다.

| 통화 | 보도 출처·종류 | 확인한 거래일 | 가격: 현지통화/USD | 두 관측 사이 변화 |
| --- | --- | --- | --- | --- |
| COP | La República 시장 종가 보도값 | 10/26 → 10/27 | 3,157.57 → 3,147.92 | -0.305615%: 페소 강세 |
| ARS | Infobae 은행간 도매시장 보도값 | 10/23 → 10/26 | 1,529.50 → 1,541.00 | +0.751880%: 페소 약세 |

확인한 두 보도 거래일 사이의 변화다. 거래일 연속성·휴장일 달력 전체를 인증하지 않았으므로 `dailyChangeClaimAllowed=false`, `dailyHistoryComplete=false`로 보존한다. 단기 전체 시계열·주간/월간 변화·현재 시장 보고서로 확대하지 않는다. ARS는 10/26 사례이며 10/27 최신 자료로 날짜를 바꾸지 않았다.

## 가격을 잘못 연결하지 않는 규칙

- **COP:** [10/26 기사](https://www.larepublica.co/finanzas/precios-del-dolar-y-el-petroleo-hoy-26-de-octubre-de-2026-4511039)와 [10/27 기사](https://www.larepublica.co/finanzas/precios-del-dolar-y-del-petroleo-hoy-27-de-octubre-de-2026-4511869)의 명시적 시장 마감 표현을 읽는다. 27일 보도 종가와 당일 TRM의 차이 **-10.02페소**는 별도 비교다. 이를 이전 거래일 종가 대비 변화와 혼동하지 않는다. TRM 적용일을 현물 거래일로 승격하지 않는다.
- **ARS:** [10/23 기사](https://www.infobae.com/economia/2026/10/23/el-dolar-termino-la-semana-con-nuevo-record-nominal-tras-seis-alzas-consecutivas/)와 [10/26 기사](https://www.infobae.com/economia/2026/10/26/dolar-riesgo-pais-y-acciones-uno-por-uno-cuales-fueron-los-efectos-del-ballotage-de-brasil-en-el-mercado-financiero-argentino/)의 각각 명시된 도매시장 관측을 읽는다. 현재 가격에서 상승폭을 빼거나 반올림된 등락률로 이전 값을 만들지 않는다. BCRA 변수 5의 가중 참고환율·소매·MEP·CCL·비공식 가격과 바꾸지 않는다.
- 두 통화 모두 원문 바이트·단락·출처·URL 날짜·기사 수정판·거래일·가격 종류를 검사한다. 기대한 표현이 바뀌거나 관측이 둘 이상 모호하면 중단한다. 본문 수정 이후에 확보한 자료인지도 확인한다.
- 기사 게시/수정 시각은 실제 거래 관측시각이 아니다. `observationAt`·`aggregationCutoffAt`·`effectiveDate`를 만들지 않는다. 같은 매체의 보도 가격임을 표시하며 공식 종가 인증으로 부르지 않는다.

## 공통 경로와 재현

기존 `readReviewedCountryArticlePrice`의 COP 과거형 `ubicó`와 Infobae 이전 거래일 가격 표현을 추가했다. 이 원문 판독·접근 검사를 재사용하는 `publisher-close-pair`가 두 관측을 묶고, `researchTimeScope`와 `verifiedFxMovement`가 같은 검증을 실행한다. 해당 기준을 통과한 경우에만 COP·ARS 가격을 지원한다. 통화 코드만 허용 목록에 넣은 것이 아니다.

화면용 출처 표시는 COP `La República · 시장 종가 보도값`, ARS `Infobae · 도매시장 종가 보도값`이다. 기존 세 통화 표시와 정확한 관측시각을 요구하는 선후관계 검사는 유지한다.

```powershell
npm run report:price:reported-pair -- --input .local-reports/private/cop-ars-price-link-20261028-3J9Ho9/COP-input.json
npm run report:price:reported-pair -- --input .local-reports/private/cop-ars-price-link-20261028-3J9Ho9/ARS-input.json
```

입력은 Git 제외 비공개 JSON만 받는다. 자격증명·네트워크·모델·DB를 사용하지 않으며 결과는 새 비공개 폴더에 저장한다. 원문을 브라우저나 모델 요청으로 전달하지 않는다.

실제 저장 결과:

- COP: `.local-reports/private/COP-reported-close-lTZWhh/prepared.json`
- ARS: `.local-reports/private/ARS-reported-close-W7gXdB/prepared.json`
- 원본 보존·입력·전체 검사 기록: `.local-reports/private/cop-ars-price-link-20261028-3J9Ho9/`

## 가격 준비와 집필 준비의 경계

가격 검사는 **출처의 사용 허가·설명의 타당성·집필 자격·게시 승인**을 만들지 않는다. 가격만 있고 새 인과 검토/출처 이용 기록이 없는 경우 공통 검사에서 집필 보류가 유지되는 것을 확인했다. 그 경계 시험은 의도적으로 빈 카드 묶음을 사용했으며, 기존 ARS 전문가 견해가 사라졌거나 사실이 아니라는 판정은 아니다.

다음 연결은 서로 다르다.

| 통화 | 해소한 부분 | 아직 남은 부분 |
| --- | --- | --- |
| COP | 같은 매체·같은 가격 종류의 두 원관측, TRM과의 비교 분리 | 기존 9/24 설명을 10/27에 재사용할 수 없음. 새 거래일을 지지하는 원인 카드·출처 이용 범위·자동 내용 대조 필요 |
| ARS | 같은 매체의 두 명시적 도매 관측. BCRA 참고환율의 거래일을 억지로 추정할 필요 없이 별도 가격 경로 확보 | 기존 10/26 견해의 새 가격/기간 바인딩·조건/반대 근거·새 가격 출처 이용 범위 검토 필요 |

두 통화 전체 집필·편집·화면·이력의 운영 호환성을 모두 통과했다는 의미가 아니다. 원고 생성·게시·점수·운영 승인은 만들지 않았다. 가격을 검토한 개발 시점의 에이전트 기록은 무인 운영의 원문 대조 성공으로 계산하지 않는다. 이전 공식 가격 연결 진단도 삭제하지 않는다.

## 검증과 다음 순서

새 가격 계약 테스트 **10사례**와 기존 COP/ARS·BRL 경로를 검증했다. 출처 바이트·날짜·중복·누락/복수 가격·수정시각 충돌·공식값 대체·허위 관측시각을 거부하고, COP TRM 차이를 전 관측 대비 변화와 구분한다. 실제 저장 원문 재생은 합성 경계 시험과 별도다.

전체 **124파일·928사례**, 타입·린트·운영/리포트/기존 앱 로컬 리포트 빌드·번들 경계 통과. 테스트 감사에서 중복 이름/동일 본문 없음. 기존 진입 묶음 610,378바이트 경고는 유지한다. 보호 대상 기존 원고·환율·비용 등 **91파일 변경/누락 0**을 `final-results.json`에 보존했다. 새 유료 비용 $0이며 원격 push·PR·배포·DB·메일 변경은 없다.

원래 순서의 다음 작업은 **PEN 직접 원인 근거와 BRL 소비 배경 보완**이다. 기존 자료·조건을 먼저 확인하고 부족하면 이유를 기록한다. COP·ARS는 가격 준비 통과와 남은 집필 조건을 분리해 후속 근거 입력 연결에 사용한다. 실제 새 유료 시험은 별도 예산 승인 없이 실행하지 않는다.
