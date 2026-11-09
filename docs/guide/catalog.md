# 문서 전수 색인

2026-11-09 정비. 시작 시 `docs` **264개 전체**, 루트 안내와 schema 안내를 포함해 분류했습니다. 날짜·참조 수로 삭제하지 않았습니다. [문서별 역할·대응 구현·처리·해시](evidence/document-inventory-20261109.json), [로컬 산출물 목록](evidence/local-artifact-inventory-20261109.json), [시작 추적 파일 기준점](evidence/baseline-files-20261109.json)을 제공합니다.

## 현재 읽을 문서

[앱](app.md) → [설계도](architecture.md) → [공통 규칙](rules.md) → [운영](operations.md). [실제 상태](operational-status.md), [국가별 차이](countries.md), [검증](verification.md), [발표 근거](presentation-evidence.md), [관리자 알림](admin-review-notifications.md)을 연결합니다.

## 11월10일 기존 문서 묶음의 갱신 범위

현재 구현 기준은 운영 배포 `681de0c`입니다. 원본 압축·분리 보관, 작은 실행 명세서, 무과금 저장·복원 검사와 장애 표시를 아래 담당 문서에 반영했습니다. 운영 상태는 11월10일 01:06 KST 확인값이며 실시간 현황으로 간주하지 않습니다.

| 문서 묶음 | 이번 반영 내용 |
| --- | --- |
| [README](../../README.md)·[운영 할 일](../../OPERATIONS_TODO.md) | 저장 문제 해결과 남은 실제 생성 확인을 구분 |
| [앱 안내](app.md)·[관리자 알림](admin-review-notifications.md) | 저장 장애의 운영 확인·중복 알림·해결 조건과 원문 접근 제한 |
| [설계도](architecture.md)·[도식 6종](diagrams/index.html) | 비공개 원본 저장 경계, 저장·복원과 생성의 분기, 장애 알림 연결 |
| [공통 규칙](rules.md)·[저장 상세](frozen-input-storage.md) | 기존 발행·모델·예산 기준 유지, 새 형식과 이전 형식 호환·무결성·상한 |
| [운영 안내](operations.md)·[상태 확인표](operational-status.md) | 무과금 확인과 실제 실행 구분, 배포·설정 복원·회계·복구 범위 |
| [6통화 표](countries.md) | 국가별 정의는 유지하고 11월9일·10일 수집 관측을 분리 |
| [검증 이력](verification.md)·[PPT 근거](presentation-evidence.md) | 실제 용량·해시 복원 증거와 새 AI 생성 미확인을 구분 |

[갱신·보존 확인 기록](evidence/documentation-refresh-20261110.json), [도식 원본·렌더링 확인](evidence/diagram-verification-20261110.json), [국가별 수집 관측](evidence/source-observation-20261110.json)을 함께 연결합니다. 아래 전수 목록과 과거 시험·실패·비용 기록은 당시 사실을 보존합니다. 실행 코드가 읽는 정책 파일은 이번 문서 갱신으로 변경하지 않았습니다.

## 분류와 처리

11월10일 추가 현재 안내: [입력 저장·복원](frozen-input-storage.md), [로컬 검증 근거](evidence/frozen-storage-verification-20261110.json), [운영 반영·무과금 확인 근거](evidence/frozen-storage-production-20261110.json). 기존 11월9일 전수 목록은 당시 기준점으로 보존합니다. 로컬 검증·운영 저장 성공·실제 유료 생성 미확인을 구분합니다.

코드 참조 목록은 파일 경로나 이름의 정적 연결 근거입니다. 운영 입력으로 확인한 4개 JSON과 테스트/과거 재생에서만 참조하는 자료는 `runtimeInputConfirmed`로 구분했습니다. 코드 참조가 없다고 필요 없는 파일로 판단하지 않습니다. 과거 설계·검증 파일은 당시 문구를 그대로 남기고 아래 표의 현재 담당 문서로 연결합니다. 과거 파일의 ‘최신’·‘미완료’ 문장은 당시 시점입니다.

현재 안내9개는 갱신 전 바이트 사본을 [보관](../history/documentation-before-20261109/INDEX.md)했습니다. 그 사본 안의 상대 링크는 원래 위치 기준이므로 원래 경로로 복원해 읽습니다. 개별 과거 기록을 모두 새 현재 설명으로 바꾸지 않습니다.

| 기존 문서 | 분류 | 현재 설명 | 처리 |
| --- | --- | --- | --- |
| [LatamFX_AX_5min_script.md](../../LatamFX_AX_5min_script.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [OPERATIONS_TODO.md](../../OPERATIONS_TODO.md) | 현재 내용으로 연결하는 호환 안내 | [안내](verification.md) | 현재 안내 갱신·정비 전 원본 보존 |
| [PROJECT_OVERVIEW.md](../../PROJECT_OVERVIEW.md) | 현재 내용으로 연결하는 호환 안내 | [안내](verification.md) | 현재 안내 갱신·정비 전 원본 보존 |
| [README.md](../../README.md) | 현재 사용자·운영 안내 | [안내](verification.md) | 현재 안내 갱신·정비 전 원본 보존 |
| [docs/1x-prs.md](../1x-prs.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/1x-rollout.md](../1x-rollout.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/actual-response-common-repair-20261102.md](../2.0/actual-response-common-repair-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/admin-auth-unification-20261031.md](../2.0/admin-auth-unification-20261031.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/app-flow-verification-20261030.json](../2.0/app-flow-verification-20261030.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/app-flow-verification-20261030.md](../2.0/app-flow-verification-20261030.md) | 설계·결정·검증의 과거 기록 | [안내](app.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/app-map-handoff-20261030.md](../2.0/app-map-handoff-20261030.md) | 설계·결정·검증의 과거 기록 | [안내](app.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/app-report-integration-20261013.md](../2.0/app-report-integration-20261013.md) | 설계·결정·검증의 과거 기록 | [안내](app.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/automation-completion-fixes-20261102.md](../2.0/automation-completion-fixes-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/automation-continuation-20261102.md](../2.0/automation-continuation-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/automation-independent-audit-20261102.md](../2.0/automation-independent-audit-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/automation-independent-reaudit-20261102.md](../2.0/automation-independent-reaudit-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/bcch-api-token-verification-20261026.json](../2.0/bcch-api-token-verification-20261026.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/bcch-public-reuse-review-20261017.json](../2.0/bcch-public-reuse-review-20261017.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/bcch-report-input-verification-20261026.json](../2.0/bcch-report-input-verification-20261026.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/brazil-harness-comparison-results.md](../2.0/brazil-harness-comparison-results.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/brl-saved-source-handoff-20261028.md](../2.0/brl-saved-source-handoff-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/business-writing-connection-20261028.md](../2.0/business-writing-connection-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/chile-monthly-collector-review-20261015.json](../2.0/chile-monthly-collector-review-20261015.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/chile-monthly-evidence-review-20261015.json](../2.0/chile-monthly-evidence-review-20261015.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/chile-monthly-refresh-verification-20261016.json](../2.0/chile-monthly-refresh-verification-20261016.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/chile-monthly-reuse-review-20261015.json](../2.0/chile-monthly-reuse-review-20261015.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/chile-statistic-registry-review-20261014.json](../2.0/chile-statistic-registry-review-20261014.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-20261005-evidence-review.md](../2.0/clp-20261005-evidence-review.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-current-market-review-20261016.md](../2.0/clp-current-market-review-20261016.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-editorial-trial-results.md](../2.0/clp-editorial-trial-results.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-final-input-review.md](../2.0/clp-final-input-review.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-final-trial-result.md](../2.0/clp-final-trial-result.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-free-news-case-20260910-review-20261027.json](../2.0/clp-free-news-case-20260910-review-20261027.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-gemini-stream-report-result.md](../2.0/clp-gemini-stream-report-result.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-gemini38-trial-result.md](../2.0/clp-gemini38-trial-result.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-latest-report-preparation-20261028.md](../2.0/clp-latest-report-preparation-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-news-notes-20260910.json](../2.0/clp-news-notes-20260910.json) | 코드가 실제 읽거나 참조하는 정책·설정·검증 자료 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-news-notes-correction-20261027.md](../2.0/clp-news-notes-correction-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-news-notes-trial-20261027.md](../2.0/clp-news-notes-trial-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-official-price-verification-20261017.json](../2.0/clp-official-price-verification-20261017.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-price-basis-input-20261017.json](../2.0/clp-price-basis-input-20261017.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-price-basis-verification-20261017.json](../2.0/clp-price-basis-verification-20261017.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-publisher-admission-verification-20261026.json](../2.0/clp-publisher-admission-verification-20261026.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-publisher-input-final-review-20261026.json](../2.0/clp-publisher-input-final-review-20261026.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-publisher-input-final-review-20261026.md](../2.0/clp-publisher-input-final-review-20261026.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-publisher-research-verification-20261026.json](../2.0/clp-publisher-research-verification-20261026.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/clp-source-pool-20261029.json](../2.0/clp-source-pool-20261029.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/common-process-rerun-20261101.md](../2.0/common-process-rerun-20261101.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/common-report-rules-history-20261104.md](../2.0/common-report-rules-history-20261104.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/common-report-rules.md](../2.0/common-report-rules.md) | 현재 내용으로 연결하는 호환 안내 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/common-runtime-closeout-20261102.md](../2.0/common-runtime-closeout-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/common-source-selection-20261029.json](../2.0/common-source-selection-20261029.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/common-writer-closeout-20261028.md](../2.0/common-writer-closeout-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/consumer-generation-trial-20261015.json](../2.0/consumer-generation-trial-20261015.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/consumer-input-comparison-20261016.json](../2.0/consumer-input-comparison-20261016.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/consumer-input-review-20261015.json](../2.0/consumer-input-review-20261015.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/consumer-reader-input-review-20261016.json](../2.0/consumer-reader-input-review-20261016.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/cop-ars-reported-prices-20261028.md](../2.0/cop-ars-reported-prices-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/cop-pen-ars-gap-judgment-20261029.json](../2.0/cop-pen-ars-gap-judgment-20261029.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/country-queue-recovery-fixes-20261102.md](../2.0/country-queue-recovery-fixes-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/current-validity-preparation-recovery-fixes-20261102.md](../2.0/current-validity-preparation-recovery-fixes-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/dashboard-layout-comparison-20261030.md](../2.0/dashboard-layout-comparison-20261030.md) | 설계·결정·검증의 과거 기록 | [안내](app.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/dashboard-trends-implementation-20261031.md](../2.0/dashboard-trends-implementation-20261031.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/dashboard-trends-work-plan-20261030.md](../2.0/dashboard-trends-work-plan-20261030.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/data-boundary-implementation-20261029.json](../2.0/data-boundary-implementation-20261029.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/data-lifecycle-policy-20261029.json](../2.0/data-lifecycle-policy-20261029.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/design-handoff.md](../2.0/design-handoff.md) | 설계·결정·검증의 과거 기록 | [안내](app.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/economic-comparison-preparation-20261011.md](../2.0/economic-comparison-preparation-20261011.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/economic-editorial-comparison-20261012.md](../2.0/economic-editorial-comparison-20261012.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/economic-editorial-input-20261011.md](../2.0/economic-editorial-input-20261011.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/economic-evidence-card-proposal.json](../2.0/economic-evidence-card-proposal.json) | 코드가 실제 읽거나 참조하는 정책·설정·검증 자료 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/economic-retest-20261011.md](../2.0/economic-retest-20261011.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/economic-scope-implementation-20261011.md](../2.0/economic-scope-implementation-20261011.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/economic-scope-review-20261011.md](../2.0/economic-scope-review-20261011.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/economic-scoped-trial-20261011.md](../2.0/economic-scoped-trial-20261011.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/economic-trial-20261011.md](../2.0/economic-trial-20261011.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/editorial-standard-history-20261104.md](../2.0/editorial-standard-history-20261104.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/editorial-standard.md](../2.0/editorial-standard.md) | 현재 내용으로 연결하는 호환 안내 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/email-integration-20261103.md](../2.0/email-integration-20261103.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/email-integration-status-20261103.json](../2.0/email-integration-status-20261103.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/evidence-quality.md](../2.0/evidence-quality.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/execution-status.md](../2.0/execution-status.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/figjam-app-map-review-20261030.md](../2.0/figjam-app-map-review-20261030.md) | 설계·결정·검증의 과거 기록 | [안내](app.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/final-independent-audit-20261102.md](../2.0/final-independent-audit-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/final-validity-independent-audit-20261102.md](../2.0/final-validity-independent-audit-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/five-country-news-pool-20261029.json](../2.0/five-country-news-pool-20261029.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/four-country-evidence-gap-audit-20261102.md](../2.0/four-country-evidence-gap-audit-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/four-country-price-case-followup-20261028.md](../2.0/four-country-price-case-followup-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/four-currency-price-link-20261028.md](../2.0/four-currency-price-link-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/free-news-expansion-20261028.md](../2.0/free-news-expansion-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/fx-cause-workflow-20261027.json](../2.0/fx-cause-workflow-20261027.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/fx-cause-workflow-20261027.md](../2.0/fx-cause-workflow-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/fx-first-generation-20261102.md](../2.0/fx-first-generation-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/gemini-connection-diagnostics.md](../2.0/gemini-connection-diagnostics.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/gemini-connection-probe-result.md](../2.0/gemini-connection-probe-result.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/generation-decision-plan.md](../2.0/generation-decision-plan.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/generation-review-structure.md](../2.0/generation-review-structure.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/generation-wire-and-card-policy-20261027.json](../2.0/generation-wire-and-card-policy-20261027.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/github-bp-report-harness.md](../2.0/github-bp-report-harness.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/harness-comparison-results.md](../2.0/harness-comparison-results.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/indicator-price-plan.md](../2.0/indicator-price-plan.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/initial-scope-independent-review-20261102.md](../2.0/initial-scope-independent-review-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/input-edition-independent-audit-20261102.md](../2.0/input-edition-independent-audit-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/input-edition-recovery-fixes-20261102.md](../2.0/input-edition-recovery-fixes-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/local-editorial-approval-20261013.md](../2.0/local-editorial-approval-20261013.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/local-experience.md](../2.0/local-experience.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/local-integration-checkpoint-20261011.md](../2.0/local-integration-checkpoint-20261011.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/local-release-verification-20261016.json](../2.0/local-release-verification-20261016.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/material-processing-20261101.md](../2.0/material-processing-20261101.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/material-processing-complete-reading-20261101.md](../2.0/material-processing-complete-reading-20261101.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/material-processing-rules-v1.json](../2.0/material-processing-rules-v1.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/material-processing-rules-v2.json](../2.0/material-processing-rules-v2.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/material-processing-rules.json](../2.0/material-processing-rules.json) | 코드가 실제 읽거나 참조하는 정책·설정·검증 자료 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/material-selection-implementation-20261028.md](../2.0/material-selection-implementation-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/mexico-api-verification-20261027.md](../2.0/mexico-api-verification-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/mxn-business-dollar-retest-20261028.md](../2.0/mxn-business-dollar-retest-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/mxn-input-final-review-20261028.md](../2.0/mxn-input-final-review-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/mxn-market-policy-review-20261028.md](../2.0/mxn-market-policy-review-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/mxn-writing-integration-20261028.md](../2.0/mxn-writing-integration-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/narrative-placement-and-link-review-20261027.json](../2.0/narrative-placement-and-link-review-20261027.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/news-model-review-20261028.md](../2.0/news-model-review-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/news-notes-input-20261027.md](../2.0/news-notes-input-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/news-notes-verification-20261027.json](../2.0/news-notes-verification-20261027.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/news-review-connection-20261028.md](../2.0/news-review-connection-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/news-routing-integration-20261028.md](../2.0/news-routing-integration-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/news-selection-period-repair-20261102.md](../2.0/news-selection-period-repair-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/next-trial-preparation-20261102.md](../2.0/next-trial-preparation-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/official-background-connection-20261101.md](../2.0/official-background-connection-20261101.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/official-five-country-connection-20261101.md](../2.0/official-five-country-connection-20261101.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/operating-automation-20261101.md](../2.0/operating-automation-20261101.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/operating-completion-20261101.md](../2.0/operating-completion-20261101.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/operating-final-check-20261103.json](../2.0/operating-final-check-20261103.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/operating-final-check-20261103.md](../2.0/operating-final-check-20261103.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/operating-readiness-20261103.json](../2.0/operating-readiness-20261103.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/operating-readiness-20261103.md](../2.0/operating-readiness-20261103.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/operations-todo-history-20261104.md](../2.0/operations-todo-history-20261104.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/original-news-pipeline-20261028.md](../2.0/original-news-pipeline-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/original-news-source-policy-20261028.json](../2.0/original-news-source-policy-20261028.json) | 코드가 실제 읽거나 참조하는 정책·설정·검증 자료 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/original-scope-and-df-decision-20261029.json](../2.0/original-scope-and-df-decision-20261029.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/original-source-trial-preparation-20261028.md](../2.0/original-source-trial-preparation-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/owned-content-trial-results.md](../2.0/owned-content-trial-results.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/pen-ars-cop-basis-verification-20261027.json](../2.0/pen-ars-cop-basis-verification-20261027.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/pen-ars-cop-basis-verification-20261027.md](../2.0/pen-ars-cop-basis-verification-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/pen-brl-evidence-followup-20261028.md](../2.0/pen-brl-evidence-followup-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/periodic-check-generation-20261027.md](../2.0/periodic-check-generation-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/periodic-report-content-20261027.md](../2.0/periodic-report-content-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/periodic-report-samples-20261027.json](../2.0/periodic-report-samples-20261027.json) | 코드가 실제 읽거나 참조하는 정책·설정·검증 자료 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/periodic-report-samples-20261027.md](../2.0/periodic-report-samples-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/periodic-sol-preparation-20261027.md](../2.0/periodic-sol-preparation-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/periodic-sol-result-20261027.md](../2.0/periodic-sol-result-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/periodic-sol-v2-preparation-20261027.md](../2.0/periodic-sol-v2-preparation-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/periodic-sol-v2-result-20261027.md](../2.0/periodic-sol-v2-result-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/periodic-writing-rules-20261027.md](../2.0/periodic-writing-rules-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/pre-generation-stages-1-2-20261027.json](../2.0/pre-generation-stages-1-2-20261027.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/pre-generation-stages-1-2-20261027.md](../2.0/pre-generation-stages-1-2-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/pre-ui-policy-review-20261030.json](../2.0/pre-ui-policy-review-20261030.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/pre-ui-policy-review-20261030.md](../2.0/pre-ui-policy-review-20261030.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/price-provenance-hardening-20261028.md](../2.0/price-provenance-hardening-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/production-baseline-20261029.json](../2.0/production-baseline-20261029.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/production-data-operations-plan-20261029.html](../2.0/production-data-operations-plan-20261029.html) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/project-overview-history-20261104.md](../2.0/project-overview-history-20261104.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/provider-close-definition-review-20261028.md](../2.0/provider-close-definition-review-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/publication-cadence-design-20261027.md](../2.0/publication-cadence-design-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](app.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/publication-cadence-four-currencies-2pct-20261027.md](../2.0/publication-cadence-four-currencies-2pct-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/publication-cadence-replay-20261027.md](../2.0/publication-cadence-replay-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/publication-policy-history-20261104.md](../2.0/publication-policy-history-20261104.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/publication-policy.md](../2.0/publication-policy.md) | 현재 내용으로 연결하는 호환 안내 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/publisher-admission-standard.md](../2.0/publisher-admission-standard.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/publisher-input-revision-20261027.json](../2.0/publisher-input-revision-20261027.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/publisher-input-revision-20261027.md](../2.0/publisher-input-revision-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/question-led-evidence-discovery-design.md](../2.0/question-led-evidence-discovery-design.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/reader-presentation-20261016.json](../2.0/reader-presentation-20261016.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/readme-history-20261104.md](../2.0/readme-history-20261104.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/recovery-runbook.md](../2.0/recovery-runbook.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/recovery-verification-20261030.json](../2.0/recovery-verification-20261030.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/reference-material-reconnection-20261028.md](../2.0/reference-material-reconnection-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/reference-rate-policy-20261028.md](../2.0/reference-rate-policy-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/reference-review-application-20261029.md](../2.0/reference-review-application-20261029.md) | 설계·결정·검증의 과거 기록 | [안내](app.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/registered-discovery-followup-20261102.md](../2.0/registered-discovery-followup-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/release-backlog.md](../2.0/release-backlog.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/release-gates-20261103.md](../2.0/release-gates-20261103.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/report-correction-connection-20261101.md](../2.0/report-correction-connection-20261101.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/report-creation-flow-20261016.md](../2.0/report-creation-flow-20261016.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/report-history-implementation-20261031.md](../2.0/report-history-implementation-20261031.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/report-history-review-20261031.md](../2.0/report-history-review-20261031.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/report-history-work-plan-20261031.md](../2.0/report-history-work-plan-20261031.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/report-independent-audit-20261101.md](../2.0/report-independent-audit-20261101.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/report-navigation-20261031.md](../2.0/report-navigation-20261031.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/report-operations-stage123-20261101.md](../2.0/report-operations-stage123-20261101.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/report-production-design-20261016.md](../2.0/report-production-design-20261016.md) | 설계·결정·검증의 과거 기록 | [안내](app.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/report-service-baseline-20261027.md](../2.0/report-service-baseline-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/report-service-flows-20261027.html](../2.0/report-service-flows-20261027.html) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/report-source-routes-20261027.json](../2.0/report-source-routes-20261027.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/report-state-actions-20261030.md](../2.0/report-state-actions-20261030.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/research-api-access-20261027.md](../2.0/research-api-access-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/research-collection-verification-20261016.json](../2.0/research-collection-verification-20261016.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/research-material-handoff-20261027.json](../2.0/research-material-handoff-20261027.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/research-material-handoff-20261027.md](../2.0/research-material-handoff-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/resource-optimization-20261030.json](../2.0/resource-optimization-20261030.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/review-error-and-style-policy.md](../2.0/review-error-and-style-policy.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/rollout-preparation-20261030.md](../2.0/rollout-preparation-20261030.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/runtime-connection-20261031.md](../2.0/runtime-connection-20261031.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/runtime-supply-20261101.md](../2.0/runtime-supply-20261101.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/saved-manuscript-evaluation.md](../2.0/saved-manuscript-evaluation.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/scope-body-common-repair-20261102.md](../2.0/scope-body-common-repair-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/scope-body-release-audit-20261102.md](../2.0/scope-body-release-audit-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/selected-source-collection-20261027.md](../2.0/selected-source-collection-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/shared-dashboard-report-standard-20261028.md](../2.0/shared-dashboard-report-standard-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/shared-input-final-audit-20261029.json](../2.0/shared-input-final-audit-20261029.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/shared-input-hardening-20261029.json](../2.0/shared-input-hardening-20261029.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/shared-reference-content-review-20261028.md](../2.0/shared-reference-content-review-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/shared-writer-connection-20261029.json](../2.0/shared-writer-connection-20261029.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-common-trial-results-20261102.md](../2.0/six-common-trial-results-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-country-closeout-20261028.md](../2.0/six-country-closeout-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-country-news-outlets-yahoo-review-20261028.md](../2.0/six-country-news-outlets-yahoo-review-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-country-source-selection-20261027.md](../2.0/six-country-source-selection-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-currency-cause-use-review-20261028.md](../2.0/six-currency-cause-use-review-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-currency-eligibility-decision-20261028.md](../2.0/six-currency-eligibility-decision-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-currency-explanation-sources-20261027.json](../2.0/six-currency-explanation-sources-20261027.json) | 코드가 실제 읽거나 참조하는 정책·설정·검증 자료 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-currency-input-closeout-20261028.md](../2.0/six-currency-input-closeout-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-currency-preparation-20261028.md](../2.0/six-currency-preparation-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-currency-readiness-20261027.md](../2.0/six-currency-readiness-20261027.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-currency-review-readiness-20261029.json](../2.0/six-currency-review-readiness-20261029.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-currency-source-register-20261027.json](../2.0/six-currency-source-register-20261027.json) | 코드가 실제 읽거나 참조하는 정책·설정·검증 자료 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-currency-trial-stage6-20261101.md](../2.0/six-currency-trial-stage6-20261101.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-currency-trial-stage6-20261102.md](../2.0/six-currency-trial-stage6-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-currency-work-sequence-20261028.md](../2.0/six-currency-work-sequence-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-current-execution-preparation-20261102.md](../2.0/six-current-execution-preparation-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-current-execution-results-20261102.md](../2.0/six-current-execution-results-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-latest-trial-preparation-20261102.md](../2.0/six-latest-trial-preparation-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-latest-trial-results-20261102.md](../2.0/six-latest-trial-results-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-operational-batch-20261101.md](../2.0/six-operational-batch-20261101.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-refreshed-preparation-20261102.md](../2.0/six-refreshed-preparation-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-report-completion-goal.md](../2.0/six-report-completion-goal.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/six-trial-final-preparation-20261102.md](../2.0/six-trial-final-preparation-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/source-applicability-review-20261011.json](../2.0/source-applicability-review-20261011.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/source-applicability-review-20261011.md](../2.0/source-applicability-review-20261011.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/source-feasibility.md](../2.0/source-feasibility.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/source-readiness-closeout-20261102.md](../2.0/source-readiness-closeout-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/source-scope-recovery-20261101.md](../2.0/source-scope-recovery-20261101.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/source-use-conditions-followup-20261028.md](../2.0/source-use-conditions-followup-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/test-design.md](../2.0/test-design.md) | 설계·결정·검증의 과거 기록 | [안내](app.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/three-country-latest-report-preparation-20261028.md](../2.0/three-country-latest-report-preparation-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/three-country-latest-report-result-20261028.md](../2.0/three-country-latest-report-result-20261028.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/transition-preparation-20261030.json](../2.0/transition-preparation-20261030.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/ui2-diagnostic-20261031.md](../2.0/ui2-diagnostic-20261031.md) | 설계·결정·검증의 과거 기록 | [안내](app.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/ui2-implementation-20261031.md](../2.0/ui2-implementation-20261031.md) | 설계·결정·검증의 과거 기록 | [안내](app.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/ui2-refinement-20261031.md](../2.0/ui2-refinement-20261031.md) | 설계·결정·검증의 과거 기록 | [안내](app.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/ui2-style-comparison-20261031.md](../2.0/ui2-style-comparison-20261031.md) | 설계·결정·검증의 과거 기록 | [안내](app.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/unattended-integration-20261101.md](../2.0/unattended-integration-20261101.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/validity-error-and-news-scope-fixes-20261102.md](../2.0/validity-error-and-news-scope-fixes-20261102.md) | 설계·결정·검증의 과거 기록 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/webapp-final-check-20261031.md](../2.0/webapp-final-check-20261031.md) | 설계·결정·검증의 과거 기록 | [안내](app.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/webapp-navigation-spec-20261030.md](../2.0/webapp-navigation-spec-20261030.md) | 설계·결정·검증의 과거 기록 | [안내](app.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2.0/writer-model-suitability.md](../2.0/writer-model-suitability.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/2x-rollout.md](../2x-rollout.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/guide/admin-review-notifications.md](admin-review-notifications.md) | 현재 사용자·운영 안내 | [안내](app.md) | 현재 안내 갱신·정비 전 원본 보존 |
| [docs/guide/app.md](app.md) | 현재 사용자·운영 안내 | [안내](app.md) | 현재 안내 갱신·정비 전 원본 보존 |
| [docs/guide/architecture.md](architecture.md) | 현재 사용자·운영 안내 | [안내](app.md) | 현재 안내 갱신·정비 전 원본 보존 |
| [docs/guide/catalog.md](catalog.md) | 현재 사용자·운영 안내 | [안내](app.md) | 현재 안내 갱신·정비 전 원본 보존 |
| [docs/guide/maintenance-20261104.json](maintenance-20261104.json) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/guide/maintenance-20261104.md](maintenance-20261104.md) | 설계·결정·검증의 과거 기록 | [안내](app.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/guide/operations.md](operations.md) | 현재 사용자·운영 안내 | [안내](operations.md) | 현재 안내 갱신·정비 전 원본 보존 |
| [docs/guide/reference-rollout-review-20261108.md](reference-rollout-review-20261108.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/guide/release-readiness-20261104.md](release-readiness-20261104.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/guide/rules.md](rules.md) | 현재 사용자·운영 안내 | [안내](rules.md) | 현재 안내 갱신·정비 전 원본 보존 |
| [docs/guide/source-gap-review-20261108.md](source-gap-review-20261108.md) | 설계·결정·검증의 과거 기록 | [안내](rules.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/guide/unattended-operation-completion-20261108.md](unattended-operation-completion-20261108.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [docs/guide/unattended-operation-review-20261108.md](unattended-operation-review-20261108.md) | 설계·결정·검증의 과거 기록 | [안내](operations.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |
| [supabase/schema-proposals/README.md](../../supabase/schema-proposals/README.md) | 현재 사용자·운영 안내 | [안내](verification.md) | 원문·해시 보존; 색인에서 현재 안내 연결 |

## 새 결과물

새 안내·도식·공개 화면·확인값은 위 현재 문서들에서 연결합니다. 최종 생성 파일 목록과 검증 결과는 [정비 결과](evidence/documentation-validation-20261109.json)에 기록합니다. 과거 원고·근거·비용·발송 기록과 실행 JSON은 변경하지 않습니다. 외부 원문이나 비밀값을 색인에 복사하지 않습니다.

<!-- Compatibility anchors for pre-20261109 inbound links. -->
<a id="문서-목록과-상태"></a>

기존 절의 당시 설명은 [정비 전 원본](../history/documentation-before-20261109/docs/guide/catalog.md)에서 확인합니다. 현재 안내는 위 본문을 기준으로 합니다.
