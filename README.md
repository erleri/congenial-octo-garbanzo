# LATAM FX 2.0

중남미 환율을 빠르게 확인하고, 환율이 왜 움직였는지 근거와 함께 읽는 업무용 웹앱입니다. BRL·MXN·COP·PEN·CLP·ARS를 다룹니다.

[운영 앱](https://latamforex.netlify.app/) · 문서 기준: **2026-11-10 / 배포 `fe86f65`**

자동 생성·자동 내용 검토와 관리자 승인·독자 메일·관리자 알림 경로가 운영에 반영돼 있습니다. **저장 구조 전환의 일시 보류를 해제해 기존 자동 생성 설정으로 복원했으며, 공개는 관리자 승인 방식**입니다. 기존 환율·공개 원고·메일 설정과 월 $30·실행 $7 한도는 유지했습니다. 확인 시각·실행 결과·남은 제한은 [운영 상태 확인표](docs/guide/operational-status.md)를 기준으로 봅니다.

## 문서 시작점

2026-11-10 [입력 저장·복원 정상화](docs/guide/frozen-input-storage.md)를 운영에 반영하고 무과금 왕복을 확인했습니다. 실제 입력 51.54MB를 9.13MB로 저장해 원본 해시가 일치했습니다. 후속 처리·익명 이용 집계 보강도 운영에 반영했습니다. 집계는 활성화됐지만 유료 후속 실행은 재개 상태·집필 입력 용량 문제로 새 원고 없이 종료됐습니다. [실행 결과와 남은 결함](docs/guide/report-followup-usage.md#후속-실행-종료와-남은-결함)을 구분해 확인합니다.

| 알고 싶은 것 | 담당 문서 |
| --- | --- |
| 독자·관리자의 화면과 사용 방법 | [앱 개요·이용 안내](docs/guide/app.md) |
| 서비스 연결과 6개 흐름도 | [설계도·실행 경로](docs/guide/architecture.md) |
| 환율·발행·근거·모델·비용 기준 | [공통 규칙](docs/guide/rules.md) |
| 일정·설정·장애·복구·정기 점검 | [운영 안내](docs/guide/operations.md) |
| 국가별 출처·가격·달력·지표 차이 | [6통화 비교표](docs/guide/countries.md) |
| 실제로 무엇을 확인했는가 | [운영 상태](docs/guide/operational-status.md) / [검증·변경 이력](docs/guide/verification.md) |
| 과거 문서와 실행 코드가 읽는 자료 | [전수 문서 색인](docs/guide/catalog.md) |
| 사내 개발·AI 역량 인증 발표의 근거 | [발표 근거 패키지](docs/guide/presentation-evidence.md) |

## 로컬 개발

Node.js 20.19.0과 잠금 파일 기준입니다. 새 체크아웃에서 `npm ci`, 일반 앱은 `npm run dev:local`로 실행합니다. Windows 실행 정책 문제가 있으면 `npm.cmd`를 사용합니다.

| 명령 | 목적 |
| --- | --- |
| `npm run dev:local` | 기본 앱 개발 서버 |
| `npm run dev:app-report` | 격리 로컬 리포트 DB를 사용하는 앱 검증 |
| `npm run dev:report` | 로컬 원고·실행을 보는 별도 A안 도구 |
| `npm run check` | 타입·린트·테스트·운영 빌드·공개 번들 경계 |
| `npm run build:app-report` / `npm run build:report` | 로컬 검토용 빌드 |
| `node scripts/maintenance/verify-docs.mjs` | 현재 문서 링크 확인 |

운영 배포 대상은 [Netlify 설정](netlify.toml)의 `dist`입니다. 비공개 `.local-reports`, `artifacts`, 로컬 검토 빌드를 운영 배포하지 않습니다. Netlify 빌드는 모델 집필을 실행하지 않습니다. 키는 Git·채팅·공개 번들에 넣지 않습니다. 생성·메일 명령은 운영 영향을 갖기 때문에 [실행 구분](docs/guide/operations.md#실행-구분)을 먼저 확인합니다.

<a id="먼저-구분하세요"></a>
이전 상태 설명은 [정비 전 README](docs/history/documentation-before-20261109/README.md)에 보존했습니다. 현재 상태는 위 운영 확인표를 기준으로 합니다.
