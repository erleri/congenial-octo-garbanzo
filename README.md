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

## 운영 구조

현재 운영 흐름은 GitHub Actions + Netlify + Supabase 기준입니다.

1. GitHub Actions가 매일 09:15 KST에 데이터를 생성합니다.
2. 생성 결과는 `public/data.json`에 저장되고 main 브랜치에 커밋됩니다.
3. Netlify가 main 변경을 감지해 자동 배포합니다.
4. 대시보드 메일링 워크플로는 배포용 화면을 캡처해 수신자에게 발송합니다.
5. 계획 환율은 Supabase에 월별 운영 데이터로 저장합니다.

## 로컬 실행

```bash
npm install
npm run dev
```

로컬 기본 URL:

```text
http://127.0.0.1:5173/
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
SMTP_USERNAME
SMTP_PASSWORD
```

`VITE_SUPABASE_ANON_KEY`에는 Supabase의 `Publishable key` 값을 넣습니다. `service_role`, `secret key`, `sb_secret_...` 값은 브라우저 앱에 넣으면 안 됩니다.

## Supabase 계획 환율

계획 환율은 Supabase Auth 이메일 로그인과 RLS 정책으로 보호합니다.

초기 설정:

1. Supabase SQL Editor에서 `supabase/migrations/20260504120000_business_plan_rates.sql` 실행
2. `business_plan_admins`에 수정 권한자 이메일 등록
3. Netlify/GitHub Actions에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 등록
4. Supabase Auth redirect URL에 운영 URL과 로컬 URL 등록

상세 체크리스트는 `OPERATIONS_TODO.md`를 참고합니다.

## 검증 명령

```bash
npx.cmd tsc -b --noEmit
npm.cmd run lint
```

참고: 이 로컬 Windows 환경에서는 Vite/Rolldown의 `spawn EPERM` 또는 명확한 에러 없는 build 실패가 발생한 이력이 있습니다. 운영 빌드는 Netlify/GitHub Actions 결과를 함께 확인합니다.
