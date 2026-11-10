# 설계도·데이터 흐름

기준: 운영 배포 `681de0c` / 2026-11-10. 아래 여섯 도식은 현재 구현의 책임과 경계를 설명합니다. **운영 저장·복원 통과와 실제 AI 생성 성공은 다릅니다.** 확인 범위는 [운영 상태](operational-status.md)를 봅니다. 노드의 자동·AI·관리자 표기를 구분하며, 화살표는 권한·사용 범위·예산 검사를 생략하는 지름길이 아닙니다.

[여섯 도식 보기](diagrams/index.html)에서 확대해 볼 수 있습니다. 원본은 `.mmd`, 렌더링은 같은 이름의 `.svg`로 관리합니다. 원본 변경 시 두 결과를 함께 갱신합니다.
## 독자·관리자의 화면 이동

[Mermaid 원본](diagrams/01-navigation.mmd) · [확대 그림](diagrams/01-navigation.svg)

```mermaid
flowchart TD
  HOME[독자: LATAM FX 로고] --> DASH[대시보드: 통화별 숫자]
  DASH --> TREND[환율 추이: 일별 / 월별 / 상세 비교]
  DASH --> REPORT[국가별 리포트 카드]
  TREND --> REPORT
  REPORT -->|리포트 읽기| READ[선택한 판본 읽기]
  REPORT --> HIST[지난 리포트: 국가별 목록]
  HIST -->|과거 판본 선택| READ
  READ --> STATUS{자동: 공개 상태 재확인}
  STATUS -->|정상| BODY[본문·출처·자료 정보·인쇄]
  STATUS -->|실패·철회| NOTICE[상태 표시·재확인]
  HOME --> LOGIN[관리자 로그인]
  LOGIN --> AUTH{서버: 활성 관리자 확인}
  AUTH -->|허용| ADMIN[리포트·출처·정정 / 계획환율·이력]
  AUTH -->|거절| DENY[비공개 자료 차단]
  ADMIN --> DECIDE[관리자 결정·이력 보존]
  classDef normal fill:#edf4f8,stroke:#25465d,color:#162f43;
  classDef decision fill:#fff4d6,stroke:#8a6416,color:#42330e;
  classDef human fill:#e5f3ee,stroke:#19745f,color:#104b3e;
  classDef hold fill:#fceceb,stroke:#a64e45,color:#71302a;

```

## 외부 서비스·저장소와 공개 경계

[Mermaid 원본](diagrams/02-services.mmd) · [확대 그림](diagrams/02-services.svg)

```mermaid
flowchart TD
  GIT[GitHub: 코드·공개 자료] --> NET[Netlify: 공개 웹앱 배포]
  GIT --> JOB[Actions: 자동 운영]
  API[환율 API·뉴스·공식 통계] --> JOB
  JOB --> PRIVATE[Supabase 비공개: 실행 명세·검토·비용·발송 이력]
  JOB -->|서버만 저장·복원| OBJECTS[Supabase 비공개: 무손실 압축 원본·조각]
  OBJECTS -->|해시·완전성 확인| JOB
  PRIVATE -.->|변경 불가 참조| OBJECTS
  JOB -->|허용한 자료만| MODEL[OpenRouter → 검증된 Azure: AI 처리]
  MODEL --> PRIVATE
  AUTH[Supabase Auth: 활성 관리자] --> DECIDE[관리자 결정]
  PRIVATE -->|허용된 검토 정보만| DECIDE
  DECIDE -->|승인·공개 복사| PUB[공개 리포트·허용 조회 필드]
  PUB --> NET
  JOB --> SMTP[SMTP: 독자 메일·관리자 알림]
  PRIVATE -->|권한 있는 서버만| JOB
  JOB -->|실패·보류| HOLD[사유 기록·기존 공개 유지]
  NET --> READER[독자]
  NOTE[비공개 원문·키·초안은 공개 번들 제외] -.-> NET
  classDef normal fill:#edf4f8,stroke:#25465d,color:#162f43;
  classDef decision fill:#fff4d6,stroke:#8a6416,color:#42330e;
  classDef human fill:#e5f3ee,stroke:#19745f,color:#104b3e;
  classDef hold fill:#fceceb,stroke:#a64e45,color:#71302a;

```

## 환율 수집·채택·동기화·조회

[Mermaid 원본](diagrams/03-rates.mmd) · [확대 그림](diagrams/03-rates.svg)

```mermaid
flowchart TD
  API[자동: 기존 환율 API 조회] --> CHECK{날짜·통화·값·출처 확인}
  CHECK -->|유효| ADOPT[날짜별 채택값·가격 정의 보존]
  CHECK -->|휴일·결측| HOLIDAY[기존 전일값 보정 정책과 상태 표시]
  HOLIDAY --> ADOPT
  ADOPT --> DIFF{같은 기준의 기존 값과 충돌?}
  DIFF -->|예| PROPOSE[수정 제안·진단 기록: 자동 덮어쓰기 안 함]
  DIFF -->|아니오| FREEZE[같은 판본의 데이터 고정]
  PROPOSE --> KEEP[기존 채택값 유지]
  KEEP --> FREEZE
  FREEZE --> SYNC[자동: Supabase 동기화·공개 자료 커밋]
  SYNC --> APP[대시보드·추이 조회]
  FREEZE --> REPORT[리포트 대표 숫자·발행 비교]
  CHECK -->|자료 실패| ERR[실패 기록: 변화 없음으로 처리하지 않음]
  ERR --> OLD[마지막 정상 자료·상태 안내]
  classDef normal fill:#edf4f8,stroke:#25465d,color:#162f43;
  classDef decision fill:#fff4d6,stroke:#8a6416,color:#42330e;
  classDef human fill:#e5f3ee,stroke:#19745f,color:#104b3e;
  classDef hold fill:#fceceb,stroke:#a64e45,color:#71302a;

```

## 리포트 발행 필요성 판단

[Mermaid 원본](diagrams/04-cadence.mmd) · [확대 그림](diagrams/04-cadence.svg)

```mermaid
flowchart TD
  INPUT[자동: 채택 환율·기준일·새 자료] --> BASE[최근 유효 공개본의 기준점 확인]
  BASE --> REASON{조사 계기?}
  REASON -->|첫 보고서| FIRST[첫 정기 점검 후보]
  REASON -->|누적 절대 2퍼센트| MOVE[변화 설명 후보]
  REASON -->|기준일 14일 후 첫 월요일| PERIOD[정기 점검 후보]
  REASON -->|새 사건·정정| EVENT[신규성·충돌 확인 후보]
  REASON -->|없음| KEEP[기존 날짜의 원고 유지]
  FIRST --> DUP[자동: 중복·열린 실행·자료 상태 검사]
  MOVE --> DUP
  PERIOD --> DUP
  EVENT --> DUP
  DUP -->|적합| RESEARCH[근거 수집·AI 내용 검토 단계]
  DUP -->|중복·부족·실패| HOLD[사유별 보류]
  RESEARCH --> HUMAN[최종 공개는 관리자 결정]
  classDef normal fill:#edf4f8,stroke:#25465d,color:#162f43;
  classDef decision fill:#fff4d6,stroke:#8a6416,color:#42330e;
  classDef human fill:#e5f3ee,stroke:#19745f,color:#104b3e;
  classDef hold fill:#fceceb,stroke:#a64e45,color:#71302a;

```

## 조사·카드·집필·검토·공개

[Mermaid 원본](diagrams/05-production.mmd) · [확대 그림](diagrams/05-production.svg)

```mermaid
flowchart TD
  PLAN[자동: 국가별 질문·출처 선택] --> COLLECT[뉴스·공식 자료 수집]
  COLLECT -->|뉴스| SCOPE{자동: 이용 범위·기간·가격 적합?}
  SCOPE -->|예| INPUT[자동: 환율·조사 준비 입력 고정]
  SCOPE -->|예외| SOURCE[관리자: 출처 범위 결정]
  SOURCE -->|조건 충족 후| INPUT
  SOURCE -->|보류| HOLD[사유 기록·다른 적합 경로 유지]
  INPUT --> STORE[서버: 무손실 압축·조각 저장·복원 해시 대조]
  STORE -->|무과금 확인| VERIFIED[저장 검증 종료: 호출·예약·게시 없음]
  STORE -->|실행| GATE[서버: 작은 명세서 연결·경로·중복·예산 검사와 예약]
  STORE -->|실패| FAULT[기술 장애 기록·관리자 운영 확인·Actions 실패]
  FAULT -->|기록도 실패| LOG[Actions에 기록 실패 표시]
  GATE -->|허용| EXTRACT[AI: 원문 추출 → 별도 대조]
  GATE -->|차단| HOLD
  EXTRACT --> CARDS[검토된 사실·귀속 견해 카드]
  COLLECT -->|공식 통계| OFFICIAL[자동: 지표 정의·기간·수정 확인]
  OFFICIAL --> BG[보조 배경: 당일 환율 원인과 분리]
  BG --> INPUT
  CARDS --> WRITE[AI: 환율 중심 집필]
  BG --> WRITE
  WRITE --> REVIEW[자동 구조 검사 + AI 문장별 검토]
  REVIEW -->|미달| HOLD
  REVIEW -->|검토 결과 저장| ADMIN[관리자: 근거·원고·버전 확인]
  ADMIN -->|승인| PUBLIC[서버: 승인·공개 복사 함께 저장]
  ADMIN -->|반려·정정| HISTORY[이력 보존·공개 문장 자동 수정 안 함]
  classDef normal fill:#edf4f8,stroke:#25465d,color:#162f43;
  classDef decision fill:#fff4d6,stroke:#8a6416,color:#42330e;
  classDef human fill:#e5f3ee,stroke:#19745f,color:#104b3e;
  classDef hold fill:#fceceb,stroke:#a64e45,color:#71302a;

```

## 독자 메일·관리자 알림과 앱 복귀

[Mermaid 원본](diagrams/06-email.mmd) · [확대 그림](diagrams/06-email.svg)

```mermaid
flowchart TD
  DATA[자동: 환율·차트 준비] --> CUTOFF[메일 마감 시점의 승인 리포트 선택]
  CUTOFF --> LEDGER[수신자별 발송 원장·중복 검사]
  LEDGER --> LIVE{전송 직전 공개·철회 재확인}
  LIVE -->|유효| SMTP[SMTP 접수 → 결과 기록]
  LIVE -->|변경·실패| HOLD[보류·실패·미확정 기록]
  SMTP --> MAIL[독자: 제목·발행 사유·리포트 읽기]
  MAIL --> APP[앱의 통화·날짜 판본]
  INCIDENT[저장·복원 장애: 같은 원인 통합·정상 검사로 해결] --> NEW[새 관리자 검토 항목]
  NEW --> DIGEST[자동: 하루 한 묶음·같은 버전 중복 제외]
  DIGEST --> NOTICE[관리자 메일: 대상 링크]
  NOTICE --> DOT[사용자 또는 Dot: 링크 확인]
  DOT --> AUTH{현재 로그인·권한·버전 일치?}
  AUTH -->|예| HUMAN[관리자 최종 결정·기록 재확인]
  AUTH -->|아니오| STOP[로그인 또는 변경 상태 안내]
  SMTP -->|응답 유실| UNKNOWN[자동 재발송 금지·원장 확인]
  classDef normal fill:#edf4f8,stroke:#25465d,color:#162f43;
  classDef decision fill:#fff4d6,stroke:#8a6416,color:#42330e;
  classDef human fill:#e5f3ee,stroke:#19745f,color:#104b3e;
  classDef hold fill:#fceceb,stroke:#a64e45,color:#71302a;

```

## 실제 진입점과 책임

위 도식에 분리 저장과 장애 알림 연결을 반영했습니다. 조각·해시·구형 `/1` 및 신형 `/2` 재개는 [저장·복원 상세 흐름](frozen-input-storage.md#저장과-재개-흐름)을 함께 봅니다. 원본 객체는 로그인 관리자도 직접 조회할 수 없으며 기존 검토 화면은 허용된 정보만 받습니다. AI·공개·비용 승인 경계는 바뀌지 않습니다.

| 흐름 | 구현 진입점 | 권한·실패 경계 |
| --- | --- | --- |
| 화면·선택·URL | [App](../../src/App.tsx), [리포트 목록](../../src/components/PublishedCurrencyReports.tsx) | 공개와 관리자 조회 구분 |
| 환율 생성·고정 | [generate-data](../../scripts/generate-data.ts), [채택 보관](../../scripts/dashboard-reference-archive.ts) | 관측·수집·보정 상태 보존 |
| DB 동기화 | [sync-fx-to-supabase](../../scripts/sync-fx-to-supabase.js) | 서비스 서버 경로, 공개 키와 분리 |
| 발행 판단 | [publication-cadence](../../scripts/currency-report/publication-cadence.js) | 후보와 발행 승인 분리 |
| 운영 조율 | [operating-entry](../../scripts/currency-report/operating-entry.js), [operating-cycle](../../scripts/currency-report/operating-cycle.js) | 설정·용량·예약·중복·국가별 상태 |
| 입력 보관·재개 | [operating-storage](../../scripts/currency-report/operating-storage.js), [추가 DB 변경](../../supabase/migrations/20261109150211_currency_operating_frozen_objects.sql) | 원본 무손실·서버 전용·조각 완전성·`/1`/`/2` 호환 |
| 무과금 저장 확인 | [전용 workflow](../../.github/workflows/report-storage-check.yml) | 모델 키·메일 인증정보 없음, 원본 저장은 수행 |
| 자료·원문 | [runtime-supply](../../scripts/currency-report/runtime-supply.js), [original-news-pipeline](../../scripts/currency-report/original-news-pipeline.js) | 이용 범위·판본·원문 대조 |
| 집필·검토 | [shared-writer](../../scripts/currency-report/shared-writer.js), [runtime-worker](../../scripts/currency-report/runtime-worker.js) | 모델 결과와 최종 게시 분리 |
| 관리자 승인 | [CurrencyReportReview](../../src/components/CurrencyReportReview.tsx), [migration](../../supabase/migrations/) | 서버가 활성 권한·버전·공개 복사 검사 |
| 독자 메일 | [send-dashboard-email](../../scripts/send-dashboard-email.mjs), [메일 모듈](../../scripts/email/) | 마감·발송 원장·철회 재확인 |
| 관리자 알림 | [관리자 알림 모듈](../../scripts/email/admin-review.js) | 대상 버전·현재 권한·중복과 미확정 발송 |
| 예약·분리 | [Actions](../../.github/workflows/generate-data.yml) | 환율·메일 뒤 리포트·알림 별도 작업 |

GitHub는 버전·실행, Netlify는 공개 앱, Supabase는 인증·공개/비공개 데이터, SMTP는 메일 접수를 담당합니다. OpenRouter는 모델 제공 경로 연결이며 기사 사이트나 원문 저장소가 아닙니다. 공식 통계·뉴스는 내용의 근거이고, 사용자/관리자 결정과 서버 처리 설정은 실행 권한의 근거입니다.

원문→카드 경로는 중간 결과를 다시 근거와 대조합니다. 검토된 저장 카드 재사용은 허용된 별도 경로지만 새 원문 검증으로 보고하지 않습니다. 자동 내용 검토를 통과해도 관리자가 게시하지 않으면 독자에게 공개되지 않습니다.

<!-- Compatibility anchors for pre-20261109 inbound links. -->
<a id="리포트-제작-무엇을-누구에게-보내는가"></a>
<a id="발행-판단-왜-새-원고를-준비하는가"></a>
<a id="서비스-연결"></a>
<a id="설계도와-실행-경로"></a>
<a id="이메일-전달"></a>

기존 절의 당시 설명은 [정비 전 원본](../history/documentation-before-20261109/docs/guide/architecture.md)에서 확인합니다. 현재 안내는 위 본문을 기준으로 합니다.

## 후속 처리·이용 집계의 추가 경계

리포트 전용 수동 실행은 기존 공통 생성 경로와 일일 작업 잠금을 공유하지만 환율 갱신·독자 메일은 호출하지 않는다. 익명 이용 집계 v2는 브라우저 → 제한된 기록 함수 → KST 합산 테이블로 흐르며, 조회는 활성 관리자 전용 함수로 분리한다. 개인별 로그·전체 URL은 저장하지 않는다. 구현·검증·운영 미적용 상태는 [별도 안내](report-followup-usage.md)를 따른다.
