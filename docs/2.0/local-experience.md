# 2.0 로컬 개발 — 실행과 검토

## CLP 실제 AI 비교 결과 열기 (2026-10-05)

`npm run dev:report` 실행 후 다음 주소를 연다. 생성은 새로고침/화면 이동과 분리되어 있다.

- 기본 GPT-5.4 초안: `http://127.0.0.1:4175/local-experience.html?mode=live-local&design=a#report/CLP/2026-09-11`
- 같은 날짜의 두 결과는 화면 상단 **로컬 품질·비용 비교**에서 전환한다. 선택 결과는 `run` 쿼리로 고정되며, 통화/날짜 불일치면 다른 보고서로 대체하지 않고 미존재 상태를 표시한다.
- Mini 결과는 내용 평가 미채택 경고를 표시한다. 기본 목록에는 미채택 결과를 노출하지 않는다.
- `.local-reports/reviewable/clp-comparison-review.md`에 문장별 근거와 비용표가 있다. 이것은 잠정 평가이며 인간의 게시 승인이 아니다.

### 재현 및 비용 안전 경계

```text
npm run report:compare -- plan       # 비용 없는 입력/예산 계산
npm run report:compare -- blind      # 저장된 익명 평가용 후보
npm run report:compare -- status     # 저장된 비교 결과
node scripts/currency-report/verify-clp-local.js  # 미리보기 서버 기동 후 경계/스냅샷 검사
```

`run`은 유료 호출 명령이며, 이번 고정 캠페인 폴더가 존재하면 중복 실행을 막는다. `retry-routing-approved`는 이번 사용자 승인에만 해당하는 Azure 경로 수정 1회용이고 이미 소진됐다. **폴더·예약 파일을 지워 재실행하지 않는다.** 새 시험은 새 승인과 누적 비용 기록을 갖춘 별도 캠페인으로 준비한다.

현재 코드의 비교 경로는 Azure ZDR 목록·가격·구조화 출력·추론 지원을 먼저 확인한다. 기존 무료 모델과 백업 경로는 그대로다. `.env.report.local` 키를 Node에서만 읽으며 브라우저에는 정제 결과만 제공한다. `revalidate`는 저장된 응답의 검사만 수행하고, 최초 검사와 원문을 덮어쓰지 않는다. `evaluate-clp-local.js`는 이번 두 콘텐츠의 해시에 고정된 수동 잠정 평가 기록이며 일반 자동 채점기가 아니다.

실제 생성비용 $0.04097975 + 최초 ZDR 404 요청 두 건의 미확인 예약 $0.20167550을 구분한다. 오류 응답에 ID/usage가 없으므로 그 요청을 0달러로 확정하지 않는다. 운영/DB/메일 변경은 없다. 상세 이력은 release-backlog.md 최상단을 참고한다.

## 경계와 기준점

- 작업 브랜치: `codex/2.0-local-experience`.
- 읽기 전용 fetch로 확인한 `origin/main`: `ebb2970` (2026-09-13 확인).
- 보존한 기반: `codex/2.0-nemotron-ultra-adapter`의 `b7449fd`. 기존 어댑터·샘플 렌더러를 덮어쓰지 않았다.
- main과 작업 브랜치는 다르다. 운영 배포 SHA를 다시 검증한 기록으로 간주하지 않는다.
- 이번 단계는 디자인/생성 기반이다. **2.0 출시 완료가 아니며 원격 push·PR·운영 배포·DB 변경·메일·워크플로 변경을 하지 않는다.**

## 처음 실행

프로젝트 루트에서 Node 20.19.0을 사용한다. Windows PowerShell 예:

```powershell
$nodeRuntimeDir = "C:\Users\접근금지\Documents\Codex\.runtime\node-v20.19.0-win-x64"
$env:Path = "$nodeRuntimeDir;$env:Path"
npm.cmd ci
npm.cmd run dev:report
```

<http://127.0.0.1:4175/local-experience.html>에서 대시보드 숫자 카드의 **BRL/MXN 해석 읽기** 또는 상단 **환율 리포트**로 들어간다. 숫자·기존 카드 동작은 그대로이며 별도 링크만 추가한다. 이 화면은 로컬 전용 엔트리이며 운영 App에 연결하지 않았다.

- `?design=a#report/BRL`: A 편집형
- `?design=b#report/BRL`: B 분석 브리프
- `#report`: 목록
- `#report/MXN/2025-05-16`: 고정 과거 사례
- `?mode=live-local#report`: 로컬 AI 검토 결과(키 설정 후 생성 필요)

URL에 모드와 디자인이 보존된다. 링크 복사, 통화·이력 전환, 근거 펼침, 대시보드 복귀, 인쇄 버튼을 제공한다. 이력은 통화별 **서로 다른 30개 날짜**이며 같은 날짜의 후속 시도는 중복 메뉴로 세지 않는다.

`npm run build:report`는 별도 번들의 컴파일 검증이다. 결과 디렉터리 `dist-report-ui`를 운영 배포하지 않는다. 데이터 API는 로컬 개발 서버 전용이므로 일반 정적 호스팅에 올려도 완성된 서비스가 되지 않는다.

## 키 설정: 채팅에 붙이지 말 것

빈 `.env.report.local`을 준비했다. 없으면 `.env.report.example`을 복사한다. 편집기에서 `OPENROUTER_API_KEY=` 뒤에 키를 직접 입력하고 저장한다. 기존 키 재사용 가능, 별도 개발 키 선택 가능. 기존 Alpha Vantage 뉴스 키를 로컬 근거 수집에도 쓰려면 `ALPHA_VANTAGE_API_KEY=`에 같은 값을 직접 넣는다. 뉴스 키도 `VITE_` 접두사를 쓰지 않는다.

- GitHub Secret은 로컬로 꺼내오지 않는다.
- `.env.report.local`은 Git 제외, Node 생성 명령만 명시적으로 읽는다.
- `VITE_` 접두사 금지. Vite 리포트 서버는 `.env` 로딩을 끈다.
- 상태 명령은 키값 대신 `설정됨/누락`만 출력한다.
- 모델 기본값: `nvidia/nemotron-3-ultra-550b-a55b:free`. 무료 모델 ID만 허용하며 유료 자동 전환은 없다.
- 근거 검색 기본값: `perplexity/sonar`. 같은 키를 사용하지만 보고서 모델과 분리하며, 급변·근거 부족 사례의 수동 로컬 검증에서만 호출한다. `.env.report.local`의 `OPENROUTER_SEARCH_MODEL`로 명시적으로 바꿀 수 있다.

```powershell
npm.cmd run report:local -- --mode live-local --action status
# 하루·공통 피드 1회만 수집하여 BRL/MXN 검토 후보로 분리. AI 호출 없음.
npm.cmd run report:local -- --mode live-local --action collect-news --date 2026-09-11
# 첫 실제 요청: 이미 공개 근거를 확인한 BRL 한 건만
npm.cmd run report:local -- --mode live-local --action generate --currency BRL --date 2025-06-20
# 첫 결과의 인증·구조·개인정보 조건·내용 확인 후 MXN
npm.cmd run report:local -- --mode live-local --action generate --currency MXN --date 2025-05-16
```

2026-09-13 키 설정 및 실제 BRL 요청 확인. 기본 strict 모드는 HTTP 404, 사용자 승인 후 public-data 정책 변경 재시험은 HTTP 성공 뒤 `invalid_candidate`로 종료했다. 새 AI 리포트는 저장하지 않았으며 기존 시안을 유지한다. 당시 파싱 실패 원문은 보존되지 않아 토큰 부족/함수 호출 누락/잘못된 JSON 중 무엇인지 확정할 수 없다. 후속 실패부터 원문과 제한된 진단 필드를 private 폴더에 보존하도록 보완했다.

페이지 열기·새로고침으로 AI를 호출하지 않는다. 통화·기준일별 최초 요청 슬롯을 `wx`로 원자적으로 예약하며 실패/프로세스 중단 후에도 자동 재호출하지 않는다. 각 요청 내부에서 전송 오류·타임아웃·429·5xx만 최대 한 번 재시도한다. BRL/MXN 합계 기준일당 두 논리 요청, 최대 네 HTTP 시도다. 슬롯 파일을 임의로 지워 한도를 우회하지 않는다. 별도 모델 A/B 실호출은 평가 예산/대상 모델 결정 후 구현·실행한다.

OpenRouter 요청에 `require_parameters=true`, `data_collection=deny`, `zdr=true`, `allow_fallbacks=false`를 지정한다. 호환 무료 엔드포인트가 없으면 실패하고 기존 자료를 유지한다. Ultra는 기존 어댑터 방식을 따라 스키마가 붙은 지정 함수 응답을 사용하며 다른 모델은 JSON Schema response_format을 사용한다. 도구 응답은 실행하지 않고 JSON 데이터로만 검증한다. API 지원은 변할 수 있으므로 실제 성공을 아직 보장하지 않는다.

### 승인된 공개자료 전용 시험

2026-09-13 사용자 승인: 로컬 공개자료에 한해서만 `--privacy public-data`를 명시하면 `data_collection=allow`, `zdr=false`를 사용한다. 설정 생략 시 strict 유지. 운영 워크플로와 기존 어댑터는 변경하지 않는다. 제공자는 요청/응답을 보관·활용할 수 있다. 공개 환율/공식 근거만 전송하고, 모든 전송 필드의 이메일·키·명백한 주입문 탐지 및 인증키 본문 유출 검사를 유지한다. 패턴 검사는 모든 종류의 개인정보/기밀을 탐지하는 보장이 아니며 임의 사내자료를 투입해서는 안 된다. 계정 수준 ZDR 설정은 요청에서 해제할 수 없다.

기존 strict 404와 동일 패킷/모델에 대한 정책 변경 재시험은 아래 명령으로 **딱 한 개의 별도 슬롯**을 사용한다. 기존 기록을 삭제하지 않는다. 이번 BRL 슬롯은 이미 소진됐으며 반복 실행은 차단된다.

```powershell
npm.cmd run report:local -- --mode live-local --action generate --currency BRL --date 2025-06-20 --privacy public-data --retry-policy-change
```

### 제공자 오류 진단 결과 (2026-09-13)

사용자 진행 승인 후, 원문이 보존되지 않은 기존 public-data `invalid_candidate` 한 건에 한해서 `--action diagnose`를 추가했다. 동일 통화·날짜·모델·패킷에 대해 별도 `diagnostic-call.json` 슬롯을 딱 한 번 예약하며 자동 재시도는 없다. 진단 결과는 private 폴더에만 남기고, 유효 후보가 오더라도 화면 자료를 바꾸지 않는다.

```powershell
npm.cmd run report:local -- --mode live-local --action diagnose --currency BRL --date 2025-06-20 --privacy public-data
```

실제 결과: HTTP 성공 응답 **본문에는 502**, `error_type=provider_unavailable`, 메시지는 `Upstream error from Nvidia: Service temporarily overloaded`. 모델 콘텐츠·함수 호출·토큰 사용량은 없었으며 실제 처리 모델 ID도 반환되지 않았다. 설정은 Ultra지만 완료된 Ultra 생성으로 기록하지 않는다. 원문 없는 이전 호출까지 같은 원인이었다고 소급 확정하지 않는다.

오류 본문은 `provider_generation_error`, 길이 종료는 `output_truncated`, 필터 종료는 `provider_content_filter`로 구분한다. 본문 오류를 JSON 형식 불량이나 성공 리포트로 취급하지 않는다. 진단 슬롯은 소진됐으며 추가 호출을 수행하지 않았다. 제공자 회복 후 별도 검증 계획이 필요하다.

### 사용자 요청 장애 재시험과 백업 후보 (2026-09-13)

후속 사용자 재시험 요청에 따라 `--retry-run BRL-2025-06-20-1789268077039`로 한 번 재호출했다. 결과는 다시 `provider_generation_error`, 본문502/provider_unavailable, 콘텐츠 없음이다. 실패 기록은 삭제하지 않았다.

`--retry-run`은 live-local/generate에서만 허용한다. 같은 통화·날짜·패킷·모델·개인정보 정책의 일시 장애 실행을 명시해야 한다. 해당 실행마다 `manual-retry-call.json`을 `wx`로 한 번 예약하고 HTTP 요청도1회만 실행한다. 동일 명령 반복은 차단된다. 후속 실패를 재시험하려면 또 다른 명시적 사용자 요청이 필요하며 스케줄러/자동 재시도 루프에서 사용하지 않는다. 형식 오류/콘텐츠 검증 실패/인증·권한 오류를 이 경로로 우회하지 않는다.

무료 백업 제안은 **조사 단계이며 구현·실호출·운영 적용하지 않았다**.

- 주 모델: `nvidia/nemotron-3-ultra-550b-a55b:free` (현재 제공자 Nvidia).
- 우선 비교 후보: `nex-agi/nex-n2.5-pro:free` (현재 제공자 Nex AGI, 입력/출력0, JSON Schema/도구 지원 확인). 한국어·근거 설명 품질은 미검증.
- `nvidia/nemotron-3-super-120b-a12b:free`도 현재 제공자가 Nvidia라 장애 분리 효과를 보장할 수 없다.
- `dots-studio/dots-3-note-preview:free`는 AtlasCloud 제공이지만 2026-09-30 종료 고지 때문에 지속 백업의 우선 후보에서 제외.
- OpenRouter 내 다른 모델은 동일 키를 사용하되 OpenRouter 전체 장애/계정 한도는 공유하므로 완전 독립 백업이 아니다. 별도 공급자 API는 키·정책·어댑터를 추가 검토해야 한다.
- 현재 설계: 주 모델1회 → 일시 제공자 장애에 한해 고정 Nex1회 → Nex도 일시 장애일 때만 `openrouter/free`1회 → 모두 실패하면 이전 보고서 유지. 각 단계는 중첩 재시도하지 않는다. 인증/권한/콘텐츠 필터/형식·근거 검증 실패를 다른 모델로 우회하지 않는다.
- 모델별 요청/응답 형식 변환, 시도별 결과/실제 모델 기록, 동일 콘텐츠 검증을 사용한다. 무작위 `openrouter/free`는 검토된 고정 모델 뒤의 비상 경로다. 가격·지원 기능·제공자 변경 시 재검토하며 유료 자동 전환은 없다.

근거: [Nex 무료 모델](https://openrouter.ai/nex-agi/nex-n2.5-pro:free), [Dots 종료 고지](https://openrouter.ai/dots-studio/dots-3-note-preview:free), [OpenRouter 모델 폴백](https://openrouter.ai/docs/guides/routing/model-fallbacks). 제공자·기능은 당일 공개 `/api/v1/models/{model}/endpoints` 응답과 대조했다.

### 무료 백업 로컬 구현·첫 시험 (2026-09-13 후속)

사용자 동의 후 `fallback.js`와 CLI 선택 옵션을 구현했다. 기본 실행에는 여전히 백업이 꺼져 있다. 운영 모델 변수, 키 파일, 워크플로는 변경하지 않았다.

- `--with-backup`: 새 기준일의 주 모델1회, 일시 장애면 고정 Nex1회, Nex도 일시 장애면 `openrouter/free`1회. 각45초, 중첩 재시도 없음. 기본 strict 유지, 공개자료 보관 허용은 `--privacy public-data`를 별도로 명시한다.
- `--backup-from <runId>`: 동일 데이터/모델/개인정보 정책의 기존 주 모델 장애를 확인하고 주 모델은 재호출하지 않는다. Nex와 비상 라우터는 각각 통화·기준일별 원자적 슬롯을 사용해 중복 호출을 막는다.
- Ultra는 지정 함수 JSON, Nex는 JSON Schema 응답. 동일 공개 입력과 동일 `validateContent` 검사 사용. 401/403, 콘텐츠 필터, 스키마/근거 검사 실패는 백업 우회 사유가 아니다.
- 시도별 요청 모델·재사용 여부·실패 사유·반환 모델을 private 실행 기록에 보존한다. 모델이 응답하지 않으면 실제 모델을 `not_reported`로 표시한다. API 키는 기존 것을 인증 헤더에만 사용한다.

```powershell
# 이번에 실행한 명령: 백업 슬롯 소진. 반복해도 추가 호출하지 않음.
npm.cmd run report:local -- --mode live-local --action generate --currency BRL --date 2025-06-20 --privacy public-data --backup-from BRL-2025-06-20-1789268077039
```

실제 결과: Nex 무료 모델에1회 요청 후 **45초 timeout**. 본문/실제 반환 모델/완성된 리포트 없음. 주 모델은 기존502기록 재사용(새 요청0회). 초기 콘솔은 timeout 시 주 모델 설정을 대신 표시하는 문제가 있어 요청 모델과 반환 모델을 별도로 출력하도록 보완했다. private 기록의 `requestedModel`은 Nex로 올바르게 보존돼 있다.

**연결 코드 테스트 통과와 실제 백업 품질 통과는 다르다.** 이번 시험으로 Nex를 품질 검증된 운영 백업으로 승인하지 않는다. 생성 시간이45초를 넘은 이유나 모델 출력 품질은 미확인이다. 응답 시간 예산 재검토/추가 비교 시험은 후속 체크포인트이며 제한을 몰래 늘리거나 다른 모델을 연쇄 호출하지 않았다.

### 120초 로컬 평가

후속 사용자 재시험 요청에 따라 별도 `evaluate` 명령을 추가했다. **로컬 평가에서만** 모델별120초이며 현재 chain은 주 모델·Nex·비상 라우터를 일시 장애에 한해 각1회까지 허용한다. 일반 generate/운영의45초 기본값은 변경하지 않는다. 평가ID별 `evaluation-<id>-call.json`을 원자적으로 예약해 동일 평가 재실행을 차단한다. 기존 실패/백업 슬롯은 삭제하지 않는다. 새로운 평가ID는 새로운 호출 예산이므로 명시적 사용자 시험 요청 없이 자동으로 만들지 않는다.

```powershell
npm.cmd run report:local -- --mode live-local --action evaluate --currency BRL --date 2025-06-20 --privacy public-data --evaluation-id brl-120s-20260913
```

과거 BRL 사례로 출력 품질을 비교하는 시험이며 오늘자 시장 분석이 아니다. 모델별 시작/종료 상태를 키·원문 없이 출력한다. 검증에 통과한 후보만 로컬 검토 화면에 추가하며 운영 게시/승인은 하지 않는다.

첫120초 평가 결과: Ultra는 본문502/provider_unavailable, Nex는 실제 모델ID를 반환했지만 `finish_reason=length`, `hasContent=false`, `hasReasoning=true`, completion_tokens3800으로 종료했다. 제공자의 reasoning_tokens4241은 completion_tokens와 일치하지 않으므로 정확한 내부 예산으로 해석하지 않는다. 확실한 사실은 **본문 없이 길이 제한으로 잘렸다는 것**이다. 원문은 private 실행 `BRL-2025-06-20-1789272856288`에 보존되며 리포트로 게시하지 않았다.

추가 공식 `/api/v1/models` 조회에서 Nex의 reasoning은 `mandatory=false`, supported_efforts=`high/medium/none`, default_effort=`high`임을 확인했다. 기존 코드의 `low`는 지원 목록에 없었다. Nex 요청을 지원되는 `none`으로 수정하고 계약 테스트를 추가했다. 실제 요청에 어떤 effort가 적용됐는지는 응답으로 확정할 수 없으며, 변경 후 품질/속도는 추가 실호출 전까지 미검증이다. `exclude=true`는 추론을 숨길 뿐 끄지 않으므로 해결책으로 쓰지 않는다.

위 평가의 승인된2회 예산은 사용 완료. 이후 사용자 승인으로 아래 Nex 단독1회 시험을 진행했다. 새 평가ID를 자동 생성해 재호출하지 않는다.

### Nex 추론 해제 후 단독 평가 — 2026-09-13

```powershell
npm.cmd run report:local -- --mode live-local --action evaluate --currency BRL --date 2025-06-20 --privacy public-data --evaluation-target backup --evaluation-id brl-nex-none-20260913
```

- `backup` 대상은 Ultra를 호출하지 않고 Nex만 최대120초·HTTP1회 실행한다. 동일 평가ID의 슬롯은 재사용할 수 없다. 기본 `chain` 평가와 일반 생성 설정은 유지한다.
- 실제 반환 모델은 `nex-agi/nex-n2.5-pro:free`. `finishReason=stop`, 본문 있음, reasoning 없음, completionTokens600. 이번에는 전송/본문 생성에 성공했다.
- **내용 검증은 실패**: `unknown_reference`, `placeholder_outside_claim`. 수치 fact ID를 뉴스 evidence ID로 사용하고, 뉴스 ID를 fact ID로 사용했으며 요약에 허용되지 않은 placeholder를 넣었다.
- 별도 문장 검토에서도 BRL 강세를 수입 가전의 **원화 환산 원가** 감소로 연결했다. 제공된 BRL/USD 자료만으로 원화 환산 효과를 단정할 수 없으므로 내용상 승인할 수 없다. 이 의미 오류는 현재 기계 검사가 직접 검출한 항목이 아니다.
- private 실행 `BRL-2025-06-20-1789278389193`에 보존. 검증을 우회하거나 문장을 수동 교정하여 AI 성공으로 처리하지 않았다. reviewable 파일/화면은 추가하지 않았고 기존 시안을 유지했다. 운영 변경 없음.
- 다음 개선은 입력별 ID 허용 목록을 구조화 출력 스키마에 반영하고, fact/evidence의 차이와 현지통화 기준 영향 경로를 명확히 하는 것이다. 저장된 실패 후보로 오프라인 회귀 검증을 먼저 진행할 수 있다. 추가 실호출은 별도 승인 후 실시한다.

### 출력 계약 강화와 무료 라우터 비상 경로

- 입력 패킷의 실제 fact ID와 evidence ID를 각각 JSON Schema enum으로 주입한다. 제목·요약·한계에는 placeholder를 허용하지 않으며, claim 본문에서만 해당 패킷의 fact placeholder를 사용할 수 있다.
- LOCAL_PER_USD 표기에서 수치 상승은 현지통화 약세, 하락은 현지통화 강세임을 프롬프트에 명시했다. USD/KRW fact가 없는 보고서가 원화 환산 효과를 말하면 사후 검증에서 거부한다.
- `openrouter/free`는 두 고정 모델이 일시 장애·rate limit인 경우에만 마지막1회 사용한다. 어떤 무료 모델이 선택됐는지 응답 모델을 기록하며, 형식·내용 검증 실패에는 다음 모델을 호출하지 않는다.
- 이 단계에서는 실제 API를 호출하지 않았다. 전체 `npm run check` 통과: 타입·린트·131개 테스트·production build·번들 경계 검사. 기존804KB 번들 경고는 유지되며 운영 코드·변수·배포는 변경하지 않았다.

### MXN 3단계 실제 평가 — 2026-09-13

```powershell
npm.cmd run report:local -- --mode live-local --action evaluate --currency MXN --date 2025-05-16 --privacy public-data --evaluation-id mxn-policy-chain-20260913
```

- 사전 패킷 검사는 `eligible=true`, `review_required`. 공개 환율과 검토된 Banxico 근거만 전송했다.
- Ultra: HTTP 응답 본문의 `provider_generation_error`. 실제 반환 모델 없음.
- Nex: 120초 timeout. 본문·실제 반환 모델 없음.
- `openrouter/free`: 120초 timeout. 본문·선택 모델 정보 없음.
- 총 HTTP 시도3회로 종료. private 실행 `MXN-2025-05-16-1789300159655`에 상태를 보존했다. 정제 후보가 없으므로 reviewable 보고서와 화면은 추가하지 않았다.
- 이 결과는 새 출력 계약의 품질을 평가하지 못한 **가용성 실패**다. 동일 평가ID 재실행은 원자적 슬롯으로 차단된다. 추가 모델·재호출·시간 연장은 별도 결정 전까지 하지 않는다.

### 경량 AI 초안과 결정론적 조립 — 2026-09-14

- 무료 모델의 지연과 형식 오류 부담을 줄이기 위해 AI 출력 계약을 전체 보고서에서 `title`, `summary`, 근거가 연결된 `drivers`·`implications`·`watch` 블록으로 축소했다. 최대 출력은3800에서1800토큰으로 줄였다.
- AI는 fact ID, 수치 placeholder, 변화 문단, 한계 문구를 생성하지 않는다. 코드는 패킷의 실제 fact ID로 `change`를 만들고 검증된 패킷 한계를 그대로 삽입한 뒤 기존 `validateContent`를 다시 통과시킨다.
- 모든 AI 블록은 패킷별 evidence ID enum에서 하나 이상을 선택해야 한다. 제목·요약의 방향 단정, 숫자·URL·placeholder, 업무 지시와 근거 없는 KRW 연결 검사는 유지한다.
- 기존 Ultra → Nex → `openrouter/free` 가용성 경로와 원자적 호출 슬롯은 그대로다. 품질/형식 실패는 다음 모델 호출 사유가 아니다.
- 전체 `npm run check` 통과: 타입·린트·132개 테스트·production build·번들 경계. 실제 API 재호출, 운영 변수·워크플로·DB·배포·메일 변경은 없었다.

### 경량 계약 MXN 실평가 — 2026-09-14

```powershell
npm.cmd run report:local -- --mode live-local --action evaluate --currency MXN --date 2025-05-16 --privacy public-data --evaluation-id mxn-compact-chain-20260914
```

- Ultra는 다시 `provider_generation_error`로 종료했다.
- Nex는 reasoning 없이 본문을 반환했지만 completionTokens1800을 모두 사용해 `finishReason=length`로 종료했다. 본문은 JSON 객체로 시작했으나 약4707자에서 닫히지 않았다.
- `output_truncated`는 일시적 제공자 장애가 아닌 불완전 출력이므로 `openrouter/free`를 호출하지 않았다. 총 HTTP 시도2회다.
- private 실행 `MXN-2025-05-16-1789346244668`에 보존했다. 후보 파싱·내용 검증·사람 검토 단계에 도달하지 못했고 reviewable 보고서와 화면 변경은 없다.
- 경량화로 Nex 응답 시간은 이전 timeout보다 짧아졌지만 길이 지시 준수 문제는 남았다. 동일 평가ID는 재실행하지 않는다.

## 실행 모드와 파일 격리

| 모드 | 현재 동작 | 결과 |
|---|---|---|
| fixture | 검토한 과거 공개 자료 두 건, AI/네트워크 없음 | 서버가 정제된 시안만 반환 |
| live-local | 공식 자료 수집, 패킷 검사, 선택적 실제 OpenRouter 생성 | 아래 로컬 폴더 |
| local-db | 아직 연결하지 않음. 명령은 명시적으로 실패 | 운영 DB로 우회하지 않음 |

- `.local-reports/private`: 원문·오류·요청 슬롯·근거 패킷·공식 API 스냅샷. 브라우저 파일 제공 금지.
- `.local-reports/reviewable`: 스키마·정책 검증을 통과한 정제 초안만. 아직 **사람이 검토하지 않은 초안**이다.
- `.local-reports/evidence`: 직접 검토한 근거 JSON 입력 위치.
- `.local-reports/design`: 로컬 화면 검토 이미지.
- 모두 Git에서 제외한다. 서버는 loopback 전용 GET API이며 생성·승인·메일 API가 없다. 인터넷에 터널링하거나 공개 호스팅하지 않는다.

```powershell
npm.cmd run report:local -- --mode fixture --action verify
npm.cmd run report:local -- --mode live-local --action packet --currency BRL --date 2025-06-20
npm.cmd run report:local -- --mode live-local --action collect --currency BRL --date 2026-09-13
npm.cmd run report:local -- --mode live-local --action collect --currency MXN --date 2026-09-13
npm.cmd run report:local -- --mode live-local --action discover-local-sources --currency CLP --date 2026-09-11
npm.cmd run report:local -- --mode live-local --action prepare-evidence-review --currency CLP --date 2026-09-11
```

현재 공식 수집은 **검토용 스냅샷**까지다. BCB Selic, IBGE 전체 소매 판매량/메타데이터의 실제 응답을 확인했다. 발표일을 확인하지 못한 시계열은 `publishedAt:null, evidenceReady:false`로 보존한다. 대상 월을 발표일로 만들거나 당일 환율 원인으로 전환하지 않는다. 멕시코는 토큰/시리즈 선택 필요 상태를 반환하며 자료를 확보한 것처럼 표시하지 않는다.

CLP 현지 공개 소스 수집기는 Emol 경제·Reporte Minero의 sitemap과 허용된 기사 메타데이터를 사용한다. OpenRouter 검색과 별도이며 API 키·비용이 필요 없다. 결과는 `.local-reports/discovery`에서 GDELT·OpenRouter 후보와 URL 기준으로 합쳐지지만 검토 화면에서 출처 경로와 직접 보도/시장 배경을 구분한다. 원문 확인 전에는 자동 근거 채택과 새 보고서 발행이 계속 차단된다. 다른 통화는 동일 어댑터 구조에 국가별 소스 설정과 계약 테스트를 추가한 뒤 하나씩 활성화한다.

추가 근거 입력: `--evidence .local-reports/evidence/BRL-YYYY-MM-DD.json`. 스키마는 `ReportEvidence[]`. 날짜·국가·공식 HTTPS 도메인·필수 필드·중복을 검사하고 명시적 공개 필드만 투영한다. 발표 당시 버전, 발표시각, 실제 인과관계는 사람의 검토가 필요하다. 수집 실패를 새 보고서로 채우지 않는다.

## 품질 경계

- 실제 유효 관측값만 사용: 주말·보간·비정상값 제외. 전 관측일/다섯 관측일/전월 마지막 관측일 기준을 명시한다.
- 데이터 공급자가 휴일에 같은 값을 다시 발표했는지는 완전히 식별할 수 없다. 현재 저장소의 역사 데이터는 당시 버전의 증거가 아니다.
- AI는 설명만 작성하고 수치는 fact placeholder에서 코드가 삽입한다. JSON 전체 스키마, 참조 ID, 다른 통화, 직접 수치/URL/업무 권고 등을 검사한다.
- 기계 검사는 인과관계와 문장별 근거 충실도를 증명하지 않는다. 실제 후보를 사람이 읽고 승인하는 저장 흐름은 후속 로컬 DB 단계다.
- 과거 사례 두 건은 콘텐츠·레이아웃 검토용이다. 최소 열 개 과거 사례 백테스트나 열 영업일 파일럿을 대신하지 않는다.

## 참고한 공식 문서

- [OpenRouter 구조화 출력](https://openrouter.ai/docs/guides/features/structured-outputs)
- [OpenRouter ZDR](https://openrouter.ai/docs/guides/features/zdr)
- [IBGE 집계 API](https://servicodados.ibge.gov.br/api/docs/agregados?versao=3)
- [Banxico SIE API](https://www.banxico.org.mx/SieAPIRest/service/v1/)
- [INEGI 지표 API](https://www.inegi.org.mx/servicios/api_indicadores.html)

다음 상태는 `release-backlog.md`, 디자인 전달 자료는 `design-handoff.md`를 참조한다.
