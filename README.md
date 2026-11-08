# LATAM FX

중남미 환율을 빠르게 확인하고, 환율이 왜 움직였는지 근거와 함께 읽는 업무용 웹앱입니다.

**운영 사이트:** https://latamforex.netlify.app/ · **문서 정리 기준일:** 2026-11-04

## 먼저 구분하세요

- **현재 운영:** 기존 환율·계획환율·메일 경로. 최근 확인 기록은 [운영 전환 점검](docs/2.0/operating-final-check-20261103.md)입니다. 기록의 관측일을 확인하세요.
- **로컬 2.0:** 대시보드·환율 추이·환율 리포트, 공통 관리자 인증, 6통화 리포트 제작·검토·메일 연결을 구현한 출시 후보입니다. 로컬 시험 통과는 운영 활성화가 아닙니다.
- **미확정:** 반복 생성 예산, 실제 운영 백업·설정·최초 연동 확인 등은 [운영 안내](docs/guide/operations.md)에서 관리합니다.

## 문서 시작점

| 알고 싶은 것 | 읽을 문서 |
| --- | --- |
| 사용자와 관리자가 무엇을 하는가 | [앱 개요](docs/guide/app.md) |
| 어디서 자료를 가져와 어떻게 발행하는가 | [설계도와 실행 경로](docs/guide/architecture.md) |
| 현재 적용할 규칙은 무엇인가 | [공통 규칙과 코드 기준점](docs/guide/rules.md) |
| 실행·장애·복구·운영 전환은 어떻게 하는가 | [운영 안내](docs/guide/operations.md) |
| 옛 문서와 시험 기록은 어디 있는가 | [문서 목록과 상태](docs/guide/catalog.md) |
| 이번 평가·정리·청소 결과 | [정비 결과](docs/guide/maintenance-20261104.md) |
| 최신 운영 설정·백업 상태와 출시 코드 | [운영 대조·출시 기준점](docs/guide/release-readiness-20261104.md) |

## 로컬 개발

Node.js 20.19.0과 잠금 파일을 사용합니다. 새 체크아웃에서는 `npm ci`, 앱은 `npm run dev:local`로 실행합니다. Windows PowerShell에서 실행 정책 문제가 있으면 `npm.cmd`를 사용하세요.

| 명령 | 용도 |
| --- | --- |
| `npm run dev:local` | 기본 앱 개발 서버, 127.0.0.1:5173 |
| `npm run dev:app-report` | 격리 로컬 리포트 DB를 연결하는 앱 검증 |
| `npm run dev:report` | 비공개 실행을 검토하는 별도 A안 도구 |
| `npm run check` | 타입·린트·단위검사·운영 빌드·번들 경계 |
| `npm run build:app-report` / `npm run build:report` | 로컬 검토용 빌드. 운영 배포 대상 아님 |

운영 배포 대상은 `netlify.toml`의 `dist`입니다. `artifacts`, `.local-reports`, 로컬 검토용 빌드를 운영 사이트로 올리지 않습니다. Netlify 빌드는 환율 수집이나 모델 집필을 실행하지 않습니다.

키는 `.env.*.local` 등에 직접 보관하고 채팅·Git·브라우저 번들에 넣지 않습니다. 모델·공식 자료 키는 Node 서버 경로에서만 읽습니다. 기존 수신자 설정은 유지하며 메일 시험은 발송 승인과 수신 범위를 따로 확인합니다.

개별 시험 명령과 기록의 실행 옵션은 당시 실험용일 수 있습니다. 현재 자동 운영은 [운영 안내](docs/guide/operations.md)의 진입점에서 시작하세요.
