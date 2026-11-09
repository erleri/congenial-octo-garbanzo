# 검증·변경 이력과 문서 대조

## 기준점

이번 문서는 [PR #25](https://github.com/erleri/congenial-octo-garbanzo/pull/25)의 배포 `fa9b58f`를 기준으로 합니다. 로컬 시작 HEAD는 `4b4507f`입니다. 확인한 Netlify 배포는 `6af1d0e87c67f14a05dcb421`입니다. 자료 자동 커밋처럼 이후 다른 변경을 이 기준에 조용히 합치지 않습니다.

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

## 구현과 설명의 양방향 대응

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

전체 시작 추적 파일 해시는 [기준점](evidence/baseline-files-20261109.json), 문서 역할·갱신 처리는 [색인](catalog.md)을 봅니다. 과거 기록·JSON 실행 입력은 그대로 유지합니다. 수정한 현재 안내의 원본9개도 별도로 보존했습니다. 문서 검사 결과는 작업 마감 시 [결과 파일](evidence/documentation-validation-20261109.json)에 기록합니다.

현재 안내의 링크 검사와 [과거 기록의 로컬 참조 문제](evidence/historical-link-issues-20261109.json)를 분리했습니다. 과거 참조 67건은 이 작업 폴더에 없는 산출물 등의 경로이며, 원본 기록은 수정하지 않았습니다. [원본 9개 복원 대조](evidence/archive-verification-20261109.json)와 [도식 원본·렌더링 대조](evidence/diagram-verification-20261109.json)도 함께 보존합니다.

외부 URL은 출처·기존 기록 링크이며 이번에 전체 사이트의 접근성/약관을 재조사하지 않았습니다. 배포와 로컬 기준점은 PR·기존 배포 검증 기록으로 연결했습니다. 배포 커밋 전체 Git 트리의 새 로컬 다운로드는 네트워크 오류로 완료하지 못했으므로 전체 트리의 새 대조까지 수행했다고 보지 않습니다. 문서 정비 완료는 운영 품질 검증 완료가 아닙니다.
