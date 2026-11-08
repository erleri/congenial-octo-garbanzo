# 설계도와 실행 경로

상태: **로컬 코드 기준**, 운영 적용은 별도. 문서의 화살표는 권한·승인 단계를 생략하는 지름길이 아닙니다.

## 서비스 연결

```mermaid
flowchart LR
  FX[환율 API] --> JOB[GitHub Actions: 데이터 갱신]
  JOB --> JSON[같은 버전의 JSON 자료]
  JOB --> DB[(Supabase: 환율·계획값·리포트·장부)]
  JSON --> GIT[GitHub main]
  GIT --> NET[Netlify: dist 배포]
  NET --> APP[React 앱]
  DB --> APP
  AUTH[Supabase Auth / active admin] --> APP
  JOB --> MAIL[메일 작성·발송 작업]
  DB --> MAIL
  MAIL --> SMTP[SMTP 수신자별 전달]
```

`src/App.tsx`는 화면을 연결하고 `useExchangeData`가 기존 환율·계획값을 관리합니다. 대시보드와 리포트는 같은 기준환율 선택 정책을 사용합니다. `src/lib/reports`는 목록·상세·이력 조회를 담당합니다. `src/local-report`의 재내보내기 파일은 옛 검증 도구 호환용입니다.

## 발행 판단: 왜 새 원고를 준비하는가

```mermaid
flowchart TD
  R[저장된 기준환율 + 새 사건·정정 후보] --> Q[자료 상태·이전 공개 원고·열린 작업 확인]
  Q --> T{조사할 이유가 있는가}
  T -->|누적 2% / 정기 점검 / 새 사건 / 정정| E[근거 수집·신규성 확인]
  T -->|없음| K[원래 날짜의 기존 보고서 유지]
  E --> G{집필 자격이 충분한가}
  G -->|아니오| H[자료 부족·조회 실패·중복 사유 기록]
  G -->|예| W[제작 흐름으로 전달]
```

기준은 `shared-price-contract.js`, 판정은 `publication-cadence.js`, 휴일과 저장값의 관계는 `dashboard-reference-state.js`를 사용합니다. 정기 점검일 도래가 강제 발행 승인은 아닙니다.

## 리포트 제작: 무엇을 누구에게 보내는가

```mermaid
flowchart TD
  P[국가별 질문·출처 계획] --> C[무료 뉴스·공식 자료 수집]
  C --> U[사용 범위·날짜·가격 종류 확인]
  U --> X[허용된 원문: 모델 추출·독립 대조]
  X --> CARD[사실·귀속 견해 카드]
  STAT[정의·기간·발표시점 확인한 공식 지표] --> BG[보조 소비·정책 배경]
  CARD --> IN[환율 중심 집필 입력]
  BG --> IN
  IN --> COST[실행 잠금·중복·예산·경로 검사]
  COST --> WRITE[명시된 집필 모델]
  WRITE --> REVIEW[구조 검사 + 문장별 독립 검토]
  REVIEW --> ADMIN[관리자 승인 또는 보류]
  ADMIN --> PUBLIC[승인 판본만 원자적으로 공개]
```

자동 운영 진입점은 `scripts/currency-report/operating-entry.js`입니다. 계획(plan)과 실행(execute)을 분리하며, 모드 변경만으로 서버 처리 정책·DB 예산·활성화 조건을 우회할 수 없습니다. `runtime-supply`, `original-news-pipeline`, `runtime-worker`와 관련 모듈을 거칩니다. 기사 속 지시문은 실행하지 않습니다.

## 이메일 전달

```mermaid
flowchart LR
  CUT[메일 마감 시점] --> FRAME[고정 환율 데이터·차트]
  CUT --> PUB[승인 공개 원고 확인]
  FRAME --> ED[수신자별 발송 장부]
  PUB --> ED
  ED --> CHECK[전송 직전 공개·철회 상태 재확인]
  CHECK --> SEND[SMTP 접수]
  SEND --> RESULT[접수 / 확정 실패 / 결과 미확인]
```

새 운영 메일 진입점은 `scripts/send-dashboard-email.mjs`, 상태 처리는 `scripts/email`입니다. legacy와 approved 발송기는 동시에 보내지 않습니다. 새 리포트 작업은 일일 환율·메일 작업 뒤에 분리되므로 이후 승인된 원고는 다음 메일 대상입니다. 메일 발송 장부 장애 시 무기록 발송으로 우회하지 않습니다.
