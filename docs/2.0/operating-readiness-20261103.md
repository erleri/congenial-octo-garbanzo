# 운영 설정·저장·복구 연결 — 운영 반영 전 마감

2026-11-03. 이 문서는 현재 확인한 운영 상태와 로컬 검증 결과다. 운영 전환·2.0 출시 완료를 뜻하지 않는다. [출시 기준](release-gates-20261103.md)의 운영 연결 구간을 다룬다.

**최종 점검 갱신:** [11월3일 최신 운영 기준·메일 포함 전환표](operating-final-check-20261103.md)를 우선한다. 새 main `dc24f69`와 같은 Netlify 배포, 기준일11월3일, 추가24개 migration/전체33개·368 SQL 검사로 재검증했다. 아래 9→32/23개와 이전 main은 앞선 점검 당시 기록이다. 수신자는 사용자 결정으로 기존 주소를 유지하며 당일 반송 기록과 별도로 실제 도착을 확인한다.

## 현재 운영에서 확인한 것

| 대상 | 확인 결과 |
|---|---|
| GitHub | `erleri/congenial-octo-garbanzo`, main `1d05b093c08894a55bfd3e9c78f6e3c85b63e532`. 실제 fetch로 확인 |
| Netlify | `latamforex.netlify.app`, 배포 `6ae829692b949c9b3f1fa761`가 같은 main commit. Functions/Edge Functions 없음 |
| 브라우저 설정 | `VITE_SUPABASE_URL`과 공개 키 설정됨. URL은 현재 Supabase 프로젝트와 일치하고 키는 publishable 유형. 값은 문서·로그에 보관하지 않음 |
| Supabase | `amzvxggdomxerdffbfdt`, 기존 migration 9개. 새 통화별 저장·실행 테이블은 아직 운영에 없음 |
| 기존 데이터 | 최신 환율 11월 2일, 계획환율 현재 110행·이력 176행, 구 리포트 실행 51행·공개 0행. 작업 후 같은 값 재확인 |
| GitHub 설정 | 현재 Actions 변수·Secret의 등록 여부는 미확인. 연결 도구가 이 조회를 지원하지 않고 브라우저 설정 화면도 접근되지 않음. 코드에 적힌 이름을 ‘등록 완료’로 취급하지 않음 |

운영 main에서 이 개발 브랜치와 갈라진 이후 변경된 파일은 환율 자료 3개와 생성된 기능 표시 파일 1개뿐이었다. 이 네 파일은 준비 사본에서도 운영 main의 바이트를 그대로 보존했다. 특히 운영의 `fxReportConfig.enabled`는 **true**이고 오래된 로컬 값은 false다. 표시 설정과 새 생성기의 활성화는 따로 확인해야 한다.

## 이번에 마감한 연결과 수정

1. **업그레이드 실제 재생:** 운영과 같은 9개 migration을 가진 별도 로컬 DB를 암호화 백업·복원하고, 공식 CLI로 추가 23개 migration을 적용했다. 원본 DB와 운영은 쓰지 않았다.
2. **기존 데이터 보존:** 복제본에만 합성 환율·계획환율·구 원고 등 7행을 넣고 업그레이드 전후 해시를 대조했다. 기존 9개 테이블의 RLS·권한, 정책 10개, 기존 함수 8개, Auth 사용자·세션 해시도 보존됐다. 실제 운영 데이터 전체를 백업·복구한 시험은 아니다.
3. **미완료 작업 보호:** 운영 정책의 revision을 바꾸면 이전 revision의 재개 대상을 조회하지 못하는 문제가 있었다. 이제 미완료 batch, 전송 중/미전송 예약, 미확인 비용, 예약을 넘은 비용이 있으면 설정 교체를 거부한다. 기존 정책으로 재개·정리한 후 교체한다. 긴급 중지는 설정 교체 없이 가능하다.
4. **반복 운영 설정 준비:** `draft-recurring`을 추가했다. 명시적인 월 예산·승인 기록·집필 경로로 설정 사본을 만들며, DB 설치·제어 활성화·모델 호출은 하지 않는다. 과거 일회 $28 승인을 월 예산으로 옮기지 않는다.
5. **새 실행 환경:** 운영 경로는 저장된 로컬 원고/manifest/토큰 파일을 요구하지 않는다. 코드와 출처 등록부는 checkout에서 읽고, 환율은 기존 데이터 commit을 사용하며, 검토 결과·고정 입력·비용·재개 상태는 DB에 둔다. 공식 PDF의 임시 파일만 생성 후 제거한다. 로컬 fixture와 연결 파일은 배포 자료에서 제외한다.
6. **테스트의 초기 상태 오류:** 첫 정책이 없는 DB에서 revision을 null로 넘기던 시험과, 구 원고가 존재하면 전체 행 수 때문에 실패하던 시험을 수정했다. 검증할 fixture를 정확히 조회한다. 제품 권한은 완화하지 않았다.
7. **배포 준비 사본:** 현재 운영 main을 기반으로 로컬 코드를 합친 비공개 소스 사본과 파일별 해시 manifest를 만들고 운영 빌드를 확인했다. 원격 commit·push·배포는 없다. 준비 사본은 release commit이 아니며, 실제 반영 때 최신 main을 다시 확인해야 한다.

## 설정은 어디에 두는가

| 위치 | 항목 | 준비/전환 때의 의미 |
|---|---|---|
| Netlify build | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | 현재 두 항목 확인. 브라우저용 공개 연결만 둔다. 모델·서비스 키를 넣지 않는다 |
| GitHub Secret | `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | 서버 DB 연결. 해당 프로젝트 일치와 실행 job의 접근 범위를 확인해야 함 |
| GitHub Secret | `OPENROUTER_API_KEY` | execute 단계에만 전달. plan 단계에는 키를 주지 않음 |
| GitHub Secret | `INEGI_INDICATORS_TOKEN` | 현 자동 공식자료 경로가 사용하는 멕시코 지표 인증. Banxico·BCCh의 별도 도구용 토큰을 이 job의 필수 값으로 새로 요구하지 않음 |
| 기존 GitHub Secret | 환율 API 키·SMTP 설정 | 기존 환율·메일 job이 계속 사용. 이번 변경에서 값·동작을 바꾸지 않음 |
| GitHub variable | `FX_REPORT_GENERATOR=currency` | 기존 생성기와 새 생성기를 동시에 실행하지 않는 선택 |
| GitHub variable | `FX_REPORT_ENABLED` | 기존 UI 표시 파일 생성과 새 job 진입에 사용. 현재 운영 실제 변수 값은 별도 확인 필요 |
| GitHub variable | `FX_REPORT_PUBLISH_MODE=review` | 새 경로의 관리자 승인 전 공개 금지. automatic으로 두면 새 job이 실행되지 않음 |
| GitHub variable | `FX_REPORT_EXECUTION_MODE=plan` | 초기 무과금 단계. 나중에 별도 승인 후 execute로 변경 |
| GitHub variable | `FX_REPORT_OPERATIONAL_HOLD=true` | 전환 준비 중 새 리포트 job 중지. false 전환도 승인 순서에 포함 |
| DB 서버 정책 | 출처·처리 규칙 해시, 목적지, 모델/경로, 월·배치·요청 예산 | 변경 시 검증. source/processing binding이 다르면 집필을 보류 |
| DB 실행 제어 | enabled, review_enabled, writer, monthly_limit_nano, per_call_limit_nano | migration 직후 false/false/0. 정책만 저장해도 켜지지 않음. 월 예산·집필 경로가 정책과 일치해야 함 |

기본 모델은 GPT Sol·medium이다. 11월 3일 공개 GET 정보에서 `azure`와 `azure/us` 모두 정상·ZDR·구조화 출력·현재 설정 가격 상한 이내임을 확인했다. 경로를 자동 교체하지 않는다. 실제 전송 직전에는 기존 preflight가 다시 검사한다. 공개 정보 확인은 유료 응답 시험이나 실제 key 인증 확인이 아니다.

## 저장·재개·공개의 구분

| 자료 | 저장 위치와 동작 |
|---|---|
| 기준환율 | 기존 JSON/DB 갱신 경로 유지. 기존 forward-fill 값과 가격 기준을 함께 사용. 뉴스의 가격으로 대체하지 않음 |
| 무료 수집·공식자료 | 서버 비공개 cache·조회 상태. 새 자료와 수집 실패를 구분하고 사용 전에 기간·정의·이용 범위를 다시 검사 |
| 원문 추출·대조 | 실행별 요청 해시·원 응답·비용을 비공개 DB에 보존. 원문이 공개 원고나 Actions artifact에 복사되지 않음 |
| 집필·원고 검토 | 고정 입력·실행 ID·검토 결과·비용 연결. 자동 검증은 관리자 게시 승인이 아님 |
| 공개 | active admin의 원자적 승인으로 정제된 원고만 공개. 이전 공개본은 임의 최신 날짜로 바꾸지 않음 |
| 복구 | 같은 정책·입력·실행 ID로 이어감. source/가격/규칙이 바뀐 frozen 작업을 현재 작업인 것처럼 재전송하지 않음 |

서로 다른 psql 프로세스 3개로 실제 commit 후 재접속했다. 고정 입력과 미확인 비용이 보존되고, 미확인 중 새 batch는 차단되며, 합성 비용 확인 후 같은 작업이 1건으로 유지됨을 확인했다. 모든 모델 단계는 합성이고 실제 HTTP 전송은 0이다. 실제 Actions runner 중단이나 운영 DB 장애를 유발한 시험으로 부르지 않는다.

## 운영 적용 순서 — 아직 실행하지 않음

1. **최종 범위 승인:** UI·이메일 범위와 현재 준비 코드를 출시 후보로 확정한다. 월 반복 예산·외부 처리 승인 기록·모델 경로·검토 담당자도 확정한다. 장기 관찰은 [출시 후 기준](release-gates-20261103.md)으로 둔다.
2. **새 생성 잠금:** GitHub의 실제 변수/Secret 이름과 등록 여부만 확인한다. 새 생성은 hold=true, execution=plan, DB disabled/예산0으로 준비한다. UI 숨김이 필요하면 기존 enabled 표시도 별도로 false로 고정·빌드한다. 현재 main의 true를 ‘꺼진 상태’라고 가정하지 않는다.
3. **최신 복구점 확보:** 적용 직전 운영 migration 이력, 기존 데이터, 승인·철회·관리자 상태를 다시 읽고 운영 DB/인증의 복구 가능한 백업을 확보한다. 암호화 파일과 키를 따로 보관하고 열림을 확인한다. 이번 로컬 백업을 운영 백업으로 대신하지 않는다. 자동 전체 덮어쓰기 복구는 금지한다.
4. **DB 선행 적용:** 새 메일 구조를 포함한 추가 24개 migration의 파일/순서/해시를 다시 대조해 별도 승인 후 적용한다. 기존 9개는 수정하지 않는다. enabled=false·review_enabled=false·monthly_limit_nano=0과 기존 환율/계획환율/원고·권한을 확인한다.
5. **코드 반영:** 최신 운영 main 위에서 준비 소스를 반영하고 CI·빌드·배포 승인 후 올린다. 현재 원격과 겹친 생성 자료 4개는 운영 것을 유지한다. secret, 수집 원문, `.local-reports`, 로컬 연결/계정, 암호화 백업/키, 로컬 mock은 commit/Netlify 산출물에서 제외한다.
6. **실제 환경 무과금 확인:** review+plan에서 새 수집·PDF 의존성·DB cache·관리자/익명 최소 조회·기존 환율·메일 결과를 확인한다. 현 Daily workflow를 수동 실행하면 기존 이메일도 발송될 수 있으므로, 메일 승인 없이 그 workflow를 시험 실행하지 않는다. GitHub/Netlify 실제 환경에서의 시험은 이번 목표에 포함된 로컬 검증과 별도다.
7. **정책 설치·제한 활성화:** 승인받은 월 예산으로 준비한 서버 정책을 설치하고 동일한 writer/상한을 DB 제어에 맞춘다. 그 뒤에만 execution=execute·hold 해제한다. 신규 비용을 승인받지 않은 지금은 하지 않는다. 첫 실제 원고는 관리자 승인 후 공개하며 마지막 정상 공개본을 유지한다.

위 순서를 통과해도 UI 최종 검토·이메일 2.0·전체 출시 승인은 별개다.

## 중지·장애·복구 절차

| 상황 | 처리와 재개 조건 |
|---|---|
| 새 작성만 중지 | GitHub hold를 켜고 DB enabled/review_enabled를 false. 실행 중 요청은 취소됐다고 가정하지 말고 응답·비용 기록부터 확인. 기존 환율·메일·공개본 유지 |
| 프로세스가 전송 전 중단 | lease와 미전송 여부를 DB에서 검증한 기존 recovery가 예약을 해제. 같은 요청 해시/ID로 재개. 단순 오래됐다는 이유로 calling을 0원 처리하지 않음 |
| 전송 후 응답/비용 불명 | response ID가 있으면 기존 generation 조회로 대조. 없거나 비용이 확인되지 않으면 자동 신규 과금 중지. 전액 예약 보존. 재시도·전액 비용 유보 승인 범위는 별도로 결정 |
| 429/시간 초과 | 현재 반복 운영은 자동 재시도·백업 없음. 이전 일회 시험의 429 추가 시도 승인을 물려받지 않음. 보류·비용 상태를 기록 |
| 규칙/출처/예산/경로 교체 | 미완료 작업을 기존 revision에서 재개 또는 사유 있는 supersede로 정리하고 비용부터 확인. 새 binding을 만들어 기존 비용/중복 제한을 우회하지 않음 |
| DB 조회 장애 | 새 작성·승인을 보류. 마지막 정상 공개본은 기존 기준일·cache 상태로 제공하되 알려진 철회/정정 상태를 우선. 초안을 대신 공개하지 않음 |
| 원고 오류 | 해당 판본을 정정·철회 절차로 처리. 자동 원고 수정이나 전체 환율 서비스 중단으로 확대하지 않음 |
| 코드 배포 오류 | 공개되지 않은 실패는 현재 정상 사이트 유지. 공개된 코드의 오류는 새 생성·메일을 잠그고 변경을 되돌리는 커밋을 CI로 재배포. 이전 배포 직접 재게시와 혼용하지 않음. DB를 과거 시점으로 되돌리지 않고 새 데이터·발송/비용 기록 보존 |
| DB 복구 필요 | 새 DB에 복원·검증 후 현재 계획환율 변경/관리자 권한 해제/철회와 대조. 최신 권한·철회를 백업 시점으로 되살리지 않음. 삭제 migration·공개 권한 복원으로 되돌리지 않음 |

자동 복구가 가능한 전송 전 예약과, 비용/원고 확인이 필요한 전송 후 중단을 구분한다. 후자를 무조건 무인 재시도로 돌리는 것이 완료 기준은 아니다. 관리자 화면의 실행 상태와 Actions summary의 action_required/failure를 확인해야 한다.

## 검증 범위와 남은 승인

- 로컬 DB: 9→32 migration, 합성 기존 데이터 7행 보존, SQL 20파일 347개 통과, 보안 advisor 오류 0. 기존 보안·인증 보존 별도 대조 완료.
- 프로세스 재개: commit 후 3개 독립 프로세스·비용 차단·입력 보존·동일 ID 검증 완료.
- 코드: 전체 회귀, 타입·린트·리포트/앱 빌드와 운영 main 기반 준비 사본의 운영 빌드·번들 경계 검사를 수행한다. 최종 수치는 [검증 기록](operating-readiness-20261103.json)에 고정한다. 테스트 수는 실제 리포트 품질 표본이 아니다.
- 기존 메일의 5개 단계는 운영 main과 객체 단위로 동일함을 확인했다. 실제 메일은 보내지 않았다.
- 운영 DB 쓰기·변수 변경·워크플로 실행·push·배포·추가 유료 호출은 0이다.
- 운영 Secret/변수 등록 상태, 운영 Auth callback 최소 연결, 운영 백업·실제 runner 재개·최초 운영 저장/승인은 **운영 적용 단계에서 확인할 항목**이다. 완료로 세지 않는다.
- 기존 운영 보안 advisor의 leaked-password 경고는 사전 존재한 설정이며 이번에 바꾸지 않았다. 현재 이메일 링크 인증 검증과 비밀번호 보안 설정 변경을 혼동하지 않는다.

## 재현 명령 — 로컬만

```powershell
# 공식 CLI 2.116.0 이상 중 검증한 버전을 명시. 현재 CI의 2.116.0으로 성공.
node scripts/currency-report/rehearse-operating-upgrade-local.mjs --execute-local --seed-synthetic --cli <공식_CLI_경로>
node scripts/currency-report/probe-operating-restart-local.mjs --rehearsal <완료한_비공개_upgrade_폴더>
node scripts/currency-report/prepare-operating-release-local.mjs

# 월 예산 승인 후에만 값을 채우며, 아래도 설정 사본 작성뿐이다.
node scripts/currency-report/operating-entry.js --action draft-recurring --input <비공개_설정_JSON>
```

위 도구는 운영 DB URL을 받지 않는다. 복제 DB 이름·container·loopback port와 private 결과 폴더를 검사한다. 재개할 때 입력 migration 파일이 바뀌면 같은 검증으로 처리하지 않는다. 준비 사본의 빌드에는 잠금 파일에 맞는 의존성이 필요하며 이번에는 현재 프로젝트의 설치본을 재사용했다. 격리된 Linux에서 새 `npm ci`/Actions 실행까지 검증한 것은 아니다.
