# 6통화 승인 시험 결과 — 상류 429로 중단 / 2026-11-02

## 결론

승인된 새 입력으로 실제 실행했다. **새 리포트0건, 게시0건이다.** BRL 원문 추출은 성공했지만 이어지는 독립 대조에서 제공 경로가 호출 제한 오류를 반환했다. 사용료가 확인되지 않아 회계 차단으로 나머지 다섯 통화도 실행하지 않았다. 뉴스 부족·원고 품질 미달·6통화 정상 완료로 보고하지 않는다.

## 실제 단계와 비용

| 통화 | 실제 수행 | 결과 | 새 원고 |
|---|---|---|---:|
| BRL | 원문 추출1회, 독립 대조1회 | 추출 성공. 대조는 본문 없이 상류429 오류, 비용 미확정 | 0 |
| MXN | 호출 없음 | 회계 차단으로 미실행 | 0 |
| COP | 호출 없음 | 회계 차단으로 미실행 | 0 |
| PEN | 호출 없음 | 회계 차단으로 미실행 | 0 |
| CLP | 호출 없음 | 회계 차단으로 미실행 | 0 |
| ARS | 호출 없음 | 회계 차단으로 미실행 | 0 |

- 승인: 이번 일회 신규 최대$8·62회, 등록 원문25건을 공통 경로8로 처리. 기존 대시보드 기준환율 유지.
- 실제 생성 API 전송2회. 이는 기사 추출·대조이며 리포트 집필2회가 아니다.
- 확정 비용 **$0.0177835**. 성공한 추출의 usage.cost와 별도 generation 조회 비용이 일치했다.
- 미확정 요청 예약액 **$0.098275** 유지. 확정 비용과 예약액의 합은$0.1160585이며, 예약액을 실제 지출이라고 세지 않는다.
- 자동 재시도0, 모델/제공 경로 백업0, 수동 교정0.

## 원인 확인

대조 요청의 외부 HTTP 응답은200이었지만 스트림 안에 `code:429`, `error_type:rate_limit_exceeded`가 반환됐다. 메시지는 `openai/gpt-6.1-sol is temporarily rate-limited upstream`이다. 본문0자, usage 없음, finish reason 없음으로 저장됐다. 출처 의미 검토나 원고 품질 평가에 도달하지 않았다.

비용 회수는 생성 요청을 다시 보내는 방식이 아니라 기존 응답 ID의 [generation metadata GET](https://openrouter.ai/docs/api/api-reference/generations/get-request-&-usage-metadata-for-a-generation)만 사용했다. 실패 ID는404로 조회되어 비용을 확정할 수 없었다. 같은 키·같은 비용 조회 API에서 성공 ID는200/정확한 ID/$0.0177835로 확인돼 인증·조회 경로 전체의 장애와 구분했다. **실패 응답 ID의404는 무과금 증거가 아니므로0으로 기록하지 않았다.**

미확정 비용을 보존하고 로컬 실행을 비활성화하는 기존 Plan B를 적용했다. 호출 가능하다는 제공 메타데이터는 실제 호출 성공을 보장하지 않는다. 이번 결과를 공통 편집 기준이나 집필 모델의 품질 평가에 합산하지 않는다.

## 로컬 변경과 검증

일반 운영/제안의 기본 상한은$7·60회로 유지했다. 명시적 일회 시험 정책에만$8·62회까지 허용하고, 기존 dataset binding·승인 reference·만료·동일 승인 재사용 방지·요청당$0.25·미확정 비용 차단을 유지했다.

- 코드: `scripts/currency-report/operating-batch-plan.js`, `operating-policy.js`.
- migration: `supabase/migrations/20261102123233_currency_operating_explicit_trial_limits.sql`.
- 격리 DB에 정의만 적용하고64개 경계/운영/복구 SQL 검사를 롤백으로 확인했다. 기존 행 해시 동일, 익명/일반 로그인 실행 권한 확대0, SECURITY INVOKER 유지.
- 기존 SQL 시험 두 개는 과거 확정 비용이 있는 DB에서도 시험용 잔여 예산만 추가하도록 계산을 보정했다. 실제 장부를 지우거나 바꾸지 않았다.
- 전체172파일·1,266검사, 타입·전체 린트·운영/앱/리포트 빌드·번들 경계·diff 공백 검사 통과. 이 수치는 실제 원고 품질 표본 수가 아니다.
- 실행 종료 후 `enabled=false`, `review_enabled=false`, 예산0. 이전 서버 정책 복원, 실제 공개 원고 해시 동일. 기존 원고·대시보드·운영·메일 변경0.

## 보존 위치와 남은 조건

기준 디렉터리: `.local-reports/private/common-closeout-20261102/six-current-nYHKaN/approved-run-0py0pn/`

- `execution-started.json`: 승인/입력/목적지/제한.
- `execution-result.json`, `closeout.json`: 당시 중단 결과·예약·비활성 확인.
- `analysis-BSjeYX/jobs.json`: 실제 두 응답과 청구/검사 기록. 원문·키를 웹에 노출하지 않음.
- `analysis-BSjeYX/summary.json`: 6통화 단계와 미실행 사유.
- `cost-recovery-*.json`, `cost-query-*.json`, `paired-cost-record-check-*.json`: 추가 생성 없는 비용 조회 증거.
- 한도/롤백 검사: `.local-reports/private/common-closeout-20261102/trial-limits-x74rEx/result.json`.

현재 남은 조건은 **실패 요청의 비용 확인과 제공 경로429 이후의 재개 범위 결정**이다. 미확정 비용이나 재시도 금지 조건을 우회해 나머지 통화를 호출하지 않는다. 기존 승인 금액을 새 시험에 자동으로 재사용하지 않는다. 새 리포트가 없는데 이전 원고를 이번 성공 결과처럼 표시하지 않는다.
