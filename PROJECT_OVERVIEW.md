# LATAM FX 프로젝트 개요

## 1. 목적

LATAM FX는 중남미 주요 통화의 환율을 매일 확인하고, 월별 계획 환율과 실제 환율을 비교하기 위한 내부 업무 대시보드입니다.

핵심 사용자는 환율을 매일 확인하는 실무자와 월 2회 계획 환율을 업데이트하는 손익 담당자입니다.

## 2. 기술 스택

- React 19
- TypeScript
- Vite
- Recharts
- SheetJS/xlsx
- IndexedDB
- Supabase Auth + Database
- GitHub Actions
- Netlify

## 3. 데이터 흐름

### 정적 환율 데이터

GitHub Actions 워크플로 `.github/workflows/generate-data.yml`이 매일 데이터를 생성합니다.

1. 환율 API와 보정 로직으로 데이터셋을 생성합니다.
2. 결과를 `public/data.json`에 저장합니다.
3. `data/alpha-vantage-history.json` 보조 캐시를 갱신합니다.
4. 변경이 있으면 main 브랜치에 커밋합니다.
5. Netlify가 main 변경을 감지해 자동 배포합니다.

앱은 시작 시 IndexedDB 캐시와 `public/data.json`을 비교해 더 최신 데이터를 사용합니다.

### 계획 환율 데이터

계획 환율은 Supabase에 저장합니다.

- 월별 기준: `period_month`
- 환율 유형: `leading` 선행 환율, `moving` 이동 환율
- 통화별 값: USD, BRL, MXN, COP, CLP, PEN 등
- 저장 방식: 같은 월/통화/유형을 다시 저장해도 이전 값은 이력으로 남기고 최신 값을 화면에 사용
- 권한: `business_plan_admins`에 등록된 이메일만 저장 가능

Supabase가 설정되지 않았거나 로드에 실패하면 기존 IndexedDB 계획 환율을 로컬 임시값으로 표시합니다.

### 메일링

대시보드 메일링은 GitHub Actions에서 처리합니다.

1. 데이터 생성
2. 프론트엔드 빌드
3. preview 서버 실행
4. 첫 대시보드 화면 캡처
5. Gmail SMTP로 HTML 메일 발송

현재 수신자는 `data/mailing_list.json`을 읽습니다. 향후 Outlook Distribution Group 주소 1개로 축소하는 것이 운영 목표입니다.

## 4. 주요 화면

### Dashboard

- 당월 누적 평균 KPI
- MoM
- 기준일 환율
- 52주 범위와 기준일 위치
- 통화별 월간 추이
- 최근 30일 추이
- 미니차트 평균선과 최신값 marker

### 월별 이력

통화별 월평균 환율을 연도/월 기준 테이블로 확인합니다.

### 일별 추이

선택 통화의 일별 환율 차트, 월평균선, 일별 표를 제공합니다.

### 계획 대비

현재 월의 실제 환율과 계획 환율을 비교합니다.

- 평균(실적)
- 누적(1월~현재)
- 선행
- 선행 대비
- 이동
- 이동 대비
- 전년 동월 누적
- 전년 동월 대비

계획 환율 입력은 Supabase 이메일 로그인 후 권한자만 저장할 수 있습니다.

### 관리

- 데이터 상태 확인
- Excel 업로드 및 병합
- CSV 내보내기
- 메일링 리스트 관리

메일링 리스트 관리 화면은 현재 로컬/운영 저장 구조가 제한적이므로, 운영상으로는 Outlook Distribution Group 전환을 우선합니다.

## 5. 보안과 권한

### Supabase

Supabase에는 다음 테이블을 둡니다.

- `business_plan_admins`: 계획 환율 수정 권한자
- `business_plan_rates`: 계획 환율 입력 이력

두 테이블 모두 RLS를 활성화합니다.

- 모든 사용자는 계획 환율 조회 가능
- 로그인 사용자는 자신의 관리자 row만 조회 가능
- active admin만 계획 환율 insert 가능

브라우저에는 Supabase `Publishable key`만 노출합니다. `service_role` 또는 secret key는 사용하지 않습니다.

### 메일링

SMTP 계정 정보는 GitHub Secrets에만 저장합니다.

- `SMTP_USERNAME`
- `SMTP_PASSWORD`

## 6. 환경변수

### Netlify

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

### GitHub Actions

```text
VITE_EXCHANGERATE_API_KEY
VITE_ALPHA_VANTAGE_API_KEY
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SMTP_USERNAME
SMTP_PASSWORD
```

## 7. 알려진 이슈

- 로컬 Windows 환경에서 `npm run build`가 Vite/Rolldown `spawn EPERM` 또는 명확한 에러 없는 exit 1로 실패한 이력이 있습니다.
- `npm audit --omit=dev`에서 `xlsx` 취약점이 보고되며 현재 fix available 없음입니다.
- Supabase 운영 전 SQL 실행, 관리자 이메일 등록, Auth redirect URL 설정이 필요합니다.
- 메일링 리스트는 아직 Outlook Distribution Group으로 전환되지 않았습니다.

## 8. 앞으로의 방향

1. Supabase 운영 설정 완료 및 계획 환율 저장 테스트
2. 계획 환율 변경 이력 UI 추가
3. 메일링 리스트를 Outlook Distribution Group 주소 1개로 전환
4. Microsoft SSO 검토
5. 로컬 Windows build 이슈 추적
