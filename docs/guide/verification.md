# 검증·변경 이력과 문서 대조

## 기준점

현재 구현 기준은 [PR #26](https://github.com/erleri/congenial-octo-garbanzo/pull/26)의 `681de0c`입니다. 아래 UI 검증 표는 [PR #25](https://github.com/erleri/congenial-octo-garbanzo/pull/25)의 `fa9b58f`, 당시 로컬 시작 `4b4507f`, Netlify `6af1d0e87c67f14a05dcb421` 기준의 기록을 보존합니다. 입력 저장 변경의 로컬·운영 검증은 별도로 구분합니다. 자료 자동 커밋이나 새 AI 원고 성공을 기존 검사에 합산하지 않습니다.

[로컬 검증 사본](evidence/ui-local-verification-20261109.json)과 [배포 검증 사본](evidence/ui-production-verification-20261109.json)은 기존 검증 기록을 재사용했습니다. 이번 문서 작업에서 전체 앱 테스트·DB 권한 검사·메일 발송을 다시 실행한 결과가 아닙니다.

## 검증 범위

| 근거 | 확인한 것 | 확인하지 못한 것 |
| --- | --- | --- |
| PR #25 CI verify/database 성공 | 해당 변경의 CI 결과 | 장기 운영 품질·모든 기기 |
| 1,397개 테스트·200파일 기록 | 코드의 자동 검사 범위 | 원고 품질 표본·업무 성과 |
| 운영/리포트/로컬앱 빌드 | 세 빌드 성공 기록 | 운영 모델 생성 성공 |
| 320/390/768/1440px 로컬 검사 | 선택·배치·내부 표 스크롤 등 | 실제 iPhone Safari |
| 390/1440px 운영 8경로 확인 | 가로 넘침 없음·두 리포트 링크 이동 | 인증 관리자·A4 실물·200% 글자 확대 |
| 운영 DB 읽기 전용 집계 | 공개6건·설정·배치0 | 원문 품질·실제 받은편지함 |
| 최근 Actions 세부 작업 | 리포트 용량 보류·호출0 | 지속 무인 생성 성공 |

위 표의 ‘최근’은 11월9일 당시 관측입니다. 11월10일 저장 검증·배포·자동 생성 설정 복원은 다음 절과 [운영 확인표](operational-status.md)를 기준으로 읽습니다.

## 구현과 설명의 양방향 대응

11월10일 [저장·복원 추가 검증](frozen-input-storage.md#실제-자료와-합성-사례의-검증-결과)은 로컬 전체 회귀 1,411건, 격리 DB 26파일 485항목, 타입·린트·운영/리포트/로컬앱 빌드·공개 번들 검사를 통과했습니다. 무과금 전용 workflow 검사 1건을 추가한 최종 CI는 1,412건을 통과했습니다. [로컬 근거](evidence/frozen-storage-verification-20261110.json), [CI](https://github.com/erleri/congenial-octo-garbanzo/actions/runs/42648272511).

이후 운영 DB·`681de0c` 배포와 [무과금 저장·복원 #1](https://github.com/erleri/congenial-octo-garbanzo/actions/runs/42649524739)을 완료했습니다. 실제 전체 입력 51.54MB → 9.13MB, 원본 해시 일치, 신규 모델 호출·예약 0입니다. [운영 근거](evidence/frozen-storage-production-20261110.json). 중단·변조·동시 실행의 상세 검사는 격리 로컬 결과이고, 운영의 유료 후속 처리·새 AI 원고 생성 성공은 아직 확인되지 않았습니다.

| 기능·규칙 | 실제 구현 | 설명 | 검증 근거 |
| --- | --- | --- | --- |
| 메뉴·통화 공유·URL | [App](../../src/App.tsx) | [앱 이용](app.md#환율-추이의-선택-상태) | UI 배포 기록 |
| 월별 최신/결측 | [MonthlySummary](../../src/components/MonthlySummary.tsx) | [월별·비교](app.md#월별-이력과-상세-비교) | [월별 검사](../../src/components/MonthlySummary.test.tsx) |
| 요약 우선·관리자 유지 | [비교표](../../src/components/MovingComparisonTable.tsx) | 같은 절 | [비교표 검사](../../src/components/MovingComparisonTable.test.tsx) |
| 시간·단위 표시 | [reader-display](../../src/lib/reports/reader-display.ts) | [리포트](app.md#리포트-읽기와-과거-조회) | [표시 검사](../../src/lib/reports/reader-display.test.ts) |
| 리포트 읽기·지난 리포트 | [목록](../../src/components/PublishedCurrencyReports.tsx) | 같은 절 | 배포 확인의 두 링크 이동 |
| 고정 대표 환율·발행 | [가격](../../scripts/currency-report/shared-price-contract.js), [주기](../../scripts/currency-report/publication-cadence.js) | [규칙](rules.md#환율시점발행) | 저장 재생/판정 검사와 실행 결과 분리 |
| 출처·원문·카드 | [선택](../../scripts/currency-report/research-source-selection.js), [원문](../../scripts/currency-report/original-news-pipeline.js) | [자료 규칙](rules.md#조사원문카드내용) | 카탈로그 추출·실행별 후보 상태 |
| 예산·모델 | [운영 정책](../../scripts/currency-report/operating-policy.js), [모델](../../scripts/currency-report/writer-policy.js) | [모델·비용](rules.md#모델전송비용) | DB 정책과 제어값 읽기 |
| 입력 저장·복원 | [저장 계층](../../scripts/currency-report/operating-storage.js), [DB](../../supabase/migrations/20261109150211_currency_operating_frozen_objects.sql) | [저장 안내](frozen-input-storage.md) | 실제 운영 무과금 왕복·원본 해시, 로컬 장애·권한 검사 |
| 저장 장애·알림 | [운영 조율](../../scripts/currency-report/operating-cycle.js), [관리자 검토함](../../src/components/AdminReviewInbox.tsx) | [알림 기준](admin-review-notifications.md#알림-기준) | 같은 원인 중복·정상 검사 해결·기록 실패 구분; 실수신은 미확인 |
| 승인·공개 | [검토 UI](../../src/components/CurrencyReportReview.tsx), [DB 변경](../../supabase/migrations/) | [관리자](app.md#관리자) | 기존 DB CI와 공개 집계 |
| 메일·알림 | [메일](../../scripts/send-dashboard-email.mjs), [알림](../../scripts/email/admin-review.js) | [운영](operations.md#이메일과-알림) | 단계 성공과 실수신 미확인 구분 |
| 보존 | [정책](../../src/lib/report-data-policy.js) | [보존](rules.md#승인공개보존) | dry-run·조회 캐시 코드 대조 |

## 이번 정비에서 바로잡은 불일치

| 이전 설명 | 이번 설명 | 근거 |
| --- | --- | --- |
| README 생성 잠금·새 메일 미활성 | 실제 활성 설정, 게시 review | GitHub 변수 + DB 제어 |
| 앱·설계는 로컬 전용 | 배포된 UI·공통 운영 경로 | PR25·Netlify·코드 |
| 관리자 알림 운영 미적용 | 설정 활성, 실수신·Dot 미확인 | 변수·알림 작업 결과 |
| 운영 안내에 여러 최신 상태 누적 | 한 현재 상태표 + 원본 이력 | 정비 전 바이트 사본 |
| 국가별 등록=연결처럼 읽힘 | 탐색 대상·제외·실제 수집 분리 | 컴파일한 카탈로그·로그 |
| 모델 교체 프로필 존재=운영 교체 가능 | 반복 정책은 sol/sol-us만 허용 | operating-policy 검증 |

## 보존·범위 검사

11월9일 정비 시작 추적 파일 해시는 [기준점](evidence/baseline-files-20261109.json), 문서 역할·갱신 처리는 [색인](catalog.md)을 봅니다. 과거 기록·JSON 실행 입력은 그대로 유지합니다. 당시 수정한 현재 안내의 원본9개도 별도로 보존했습니다. 당시 문서 검사 결과는 [11월9일 결과 파일](evidence/documentation-validation-20261109.json)에 남아 있습니다.

현재 안내의 링크 검사와 [과거 기록의 로컬 참조 문제](evidence/historical-link-issues-20261109.json)를 분리했습니다. 과거 참조 67건은 이 작업 폴더에 없는 산출물 등의 경로이며, 원본 기록은 수정하지 않았습니다. [원본 9개 복원 대조](evidence/archive-verification-20261109.json)와 [11월9일 도식 원본·렌더링 대조](evidence/diagram-verification-20261109.json)도 함께 보존합니다. 현재 도식은 [11월10일 렌더링 확인](evidence/diagram-verification-20261110.json), 문서 묶음의 갱신·보존 결과는 [이번 교차 검증](evidence/documentation-refresh-20261110.json)을 참조합니다.

외부 URL은 출처·기존 기록 링크이며 이번에 전체 사이트의 접근성/약관을 재조사하지 않았습니다. 배포와 로컬 기준점은 PR·배포 검증 기록으로 연결했습니다. 11월9일 문서화 당시 배포 커밋 전체 Git 트리의 새 로컬 다운로드는 네트워크 오류로 완료하지 못했습니다. 그 제한을 새 운영 결과로 덮어쓰지 않으며, 11월10일 운영 배포·무과금 결과는 별도 근거로 확인합니다. 문서 정비 완료는 운영 품질 검증 완료가 아닙니다.

## 11월10일 후속 처리·이용 집계 보강

정기 실행 #212는 저장을 통과했으나 6통화 원문 사전 검사에서 보류됐고 모델 호출은 0회였다. 현재 정보로 같은 입력을 재생한 원문 계획 20건은 통과했다. 당시 세부 제공 정보가 없어 역사적 원인은 확정할 수 없다. 공통 오류 분류·재개·익명 이용 집계 v2는 로컬에서 보강했으며 운영 미적용이다. 상세 구현·권한·확인 범위와 반영 순서는 [후속 처리·이용 집계](report-followup-usage.md)를 따른다.
