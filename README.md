# LATAM FX Dashboard

중남미 주요 통화의 USD 기준 환율과 계획 대비 실적을 확인하는 React + TypeScript + Vite 기반 업무 대시보드입니다.

운영 URL:
- https://latamforex.netlify.app/

## 주요 기능

- Dashboard: 기준일 환율, 당월 누적 평균, MoM, 52주 범위, 월간/일간 미니차트
- 월별 이력: 통화별 월평균 환율 테이블
- 일별 추이: 선택 통화의 일별 환율 차트와 일별 표
- 계획 대비: 월별 선행 환율/이동 환율과 실제 환율 비교
- 관리: 데이터 상태 확인, Excel 업로드, CSV 내보내기, 메일링 리스트 관리
- 리포트: 주요 6개 통화와 USD/KRW의 결정론적 변동 분석, 선택적 무료 AI 보강, 최근 30개 공개 이력
- 리포트 검토: active admin 전용 승인·반려와 비공개 실행·검증 기록

## 운영 구조

현재 운영 흐름은 GitHub Actions + Netlify + Supabase 기준입니다. 환율 데이터는
Supabase 병행 이전을 지원하며 안정화 전까지 기존 JSON 경로도 유지합니다.

1. GitHub Actions가 매일 09:15 KST에 데이터를 생성합니다.
2. 생성 결과는 `public/data.json`에 저장되고 main 브랜치에 커밋됩니다.
3. 서버 전용 키가 설정되어 있으면 같은 데이터를 Supabase에도 upsert하고 검증합니다.
4. Netlify가 main 변경을 감지해 자동 배포합니다.
5. 대시보드 메일링 워크플로는 배포용 화면을 캡처해 수신자에게 발송합니다.
6. 계획 환율은 Supabase에 월별 운영 데이터로 저장합니다.
7. 2.0 리포트는 GitHub Actions에서 자동 분석을 먼저 만들고, OpenRouter 무료 모델이 성공하면 검증된 문장만 선택적으로 사용합니다.
8. 리포트 생성이나 AI 호출 실패는 기존 데이터 갱신·메일·배포를 중단하지 않습니다.

### 환율 데이터 소스 전환

`VITE_FX_DATA_SOURCE`로 프론트엔드 조회 경로를 선택합니다.

```text
json       기존 public/data.json만 사용
supabase   Supabase만 사용하며 연결 실패를 오류로 처리
auto       Supabase 우선, 실패하면 IndexedDB 캐시와 JSON으로 복구
```

Supabase 모드는 대시보드와 월별 집계를 먼저 받고, 일별 상세는 `통화 + 연도`
단위로 조회해 IndexedDB에 저장합니다. 과거 연도 캐시는 재사용하고 최신 연도만
데이터 버전에 맞춰 갱신합니다.

## 로컬 실행

```bash
npm install
npm run dev
```

로컬 기본 URL:

```text
http://127.0.0.1:5173/
```

Windows에서 Codex 세션 안의 장시간 실행 명령이 끊기면, 별도 CMD 또는 PowerShell 창에서 아래처럼 직접 실행합니다.

```cmd
cd /d "C:\Users\Koo Imjun\중남미 환율사이트"
npm.cmd run dev:local
```

운영 배포와 비슷한 정적 결과를 확인할 때는 빌드 후 preview를 사용합니다.

```cmd
npm.cmd run build:local
npm.cmd run preview:local
```

## 데이터 생성

```bash
npm run generate:data
```

생성 결과:

```text
public/data.json
data/alpha-vantage-history.json
```

## 환경변수

로컬 개발은 `.env.local`에, Netlify/GitHub Actions 운영은 각 서비스의 환경변수/Secrets에 등록합니다.

```text
VITE_EXCHANGERATE_API_KEY
VITE_ALPHA_VANTAGE_API_KEY
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_FX_DATA_SOURCE
SUPABASE_SERVICE_ROLE_KEY
OPENROUTER_API_KEY
SMTP_USERNAME
SMTP_PASSWORD
```

`VITE_SUPABASE_ANON_KEY`에는 Supabase의 `Publishable key` 값을 넣습니다. `service_role`, `secret key`, `sb_secret_...` 값은 브라우저 앱에 넣으면 안 됩니다.

`SUPABASE_SERVICE_ROLE_KEY`는 GitHub Actions 동기화에서만 사용하며 Netlify 또는
`VITE_` 환경변수로 노출하면 안 됩니다.

`OPENROUTER_API_KEY`도 GitHub Actions Secret에만 저장합니다. 무료 AI가 실패하거나
사용 불가능해지면 추가 과금 없이 결정론적 자동 분석을 사용합니다.

GitHub repository variables의 초기값은 다음과 같습니다.

```text
FX_REPORT_ENABLED=true
FX_REPORT_PUBLISH_MODE=review
FX_REPORT_AI_MODE=optional
FX_REPORT_AI_MODEL=openrouter/free
```

병합 시 저장소 기본값은 안전하게 `false`입니다. 파일럿 시작 체크포인트에서 repository variable을 `true`로 설정합니다.
`FX_REPORT_ENABLED`는 일일 워크플로가 `src/generated/fxReportConfig.ts`에도 동기화합니다.
긴급 중단 시 값을 `false`로 바꾸고 워크플로를 수동 실행하면 생성 중단과 UI 비활성화가 같은 커밋으로 배포됩니다.

## Supabase 환율 데이터

초기 설정:

1. `supabase/migrations/20260623112518_fx_rate_storage.sql` 적용
2. GitHub Secrets에 `SUPABASE_SERVICE_ROLE_KEY` 추가
3. GitHub Actions의 `Supabase Initial Load` 선택
4. `Run workflow`에서 확인 문구 `LOAD_SUPABASE` 입력
5. 전체 적재와 검증이 모두 성공했는지 확인

초기 적재 워크플로는 환율 API 호출, 이메일 발송, Git 커밋과 Netlify 배포를
수행하지 않습니다. 저장소에 이미 있는 `public/data.json`만 Supabase로 복사합니다.

## Supabase 계획 환율

계획 환율은 Supabase Auth 이메일 로그인과 RLS 정책으로 보호합니다.

초기 설정:

1. Supabase SQL Editor에서 `supabase/migrations/20260504120000_business_plan_rates.sql` 실행
2. `business_plan_admins`에 수정 권한자 이메일 등록
3. Netlify/GitHub Actions에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 등록
4. Supabase Auth redirect URL에 운영 URL과 로컬 URL 등록

상세 체크리스트는 `OPERATIONS_TODO.md`를 참고합니다.

## LATAM FX 2.0 리포트

1. `supabase/migrations/20260912021010_fx_report_storage.sql`과 `20260912021458_lock_fx_report_reviews_append_only.sql`을 테스트 DB에서 먼저 적용합니다.
2. `npm run generate:report`로 AI 없이도 완성되는 `fx-report-run.json`을 확인합니다.
3. GitHub Secret에 `OPENROUTER_API_KEY`를 추가합니다. 키가 없어도 자동 분석은 정상 동작합니다.
4. 파일럿은 `FX_REPORT_PUBLISH_MODE=review`로 유지합니다.
5. active admin이 관리 화면에서 초안을 승인하면 공개 리포트와 최근 30개 이력에 나타납니다.
6. 10영업일 합격 후 별도 승인으로만 `automatic`으로 전환합니다.

상세 적용·복구 절차는 `docs/2x-rollout.md`에 기록합니다.

## 검증 명령

```bash
npx.cmd tsc -b --noEmit
npm.cmd run lint
npm.cmd run test
npm.cmd run build
```

참고: 이 로컬 Windows 환경에서는 Vite/Rolldown의 `spawn EPERM` 또는 명확한 에러 없는 build 실패가 발생한 이력이 있습니다. 운영 빌드는 Netlify/GitHub Actions 결과를 함께 확인합니다.
