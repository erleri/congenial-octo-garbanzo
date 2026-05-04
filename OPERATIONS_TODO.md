# Operations TODO

## 배포 전 필수 체크리스트

- [ ] Supabase SQL Editor에서 `supabase/migrations/20260504120000_business_plan_rates.sql` 실행
- [ ] `business_plan_admins`에 관리자 이메일 등록
- [ ] Supabase Auth redirect URL 등록
- [ ] Netlify 환경변수 등록
- [ ] GitHub Actions Repository secrets 등록
- [ ] main 푸시 후 Netlify 배포 성공 확인
- [ ] 운영 URL에서 계획 환율 로그인/저장 테스트
- [ ] GitHub Actions 수동 실행으로 메일 캡처/발송 테스트

## Supabase 계획 환율 설정

### 1. SQL 실행

Supabase Dashboard에서 `SQL Editor`를 열고 아래 파일 전체를 실행합니다.

```text
supabase/migrations/20260504120000_business_plan_rates.sql
```

### 2. 관리자 이메일 등록

SQL Editor에서 별도 쿼리로 실행합니다.

```sql
insert into public.business_plan_admins (email)
values
  ('owner@example.com'),
  ('profit-owner@example.com')
on conflict (email) do update set active = true;
```

권한 제거는 삭제보다 비활성화를 권장합니다.

```sql
update public.business_plan_admins
set active = false
where email = 'someone@example.com';
```

### 3. Auth redirect URL

Supabase Dashboard에서 `Authentication` -> `URL Configuration`에 설정합니다.

Site URL:

```text
https://latamforex.netlify.app
```

Redirect URLs:

```text
https://latamforex.netlify.app
http://127.0.0.1:5173
http://localhost:5173
```

### 4. 환경변수

Netlify와 GitHub Actions에 모두 등록합니다.

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

`VITE_SUPABASE_ANON_KEY`에는 Supabase `Publishable key` 값을 넣습니다. `service_role`, `secret key`, `sb_secret_...` 값은 넣지 않습니다.

## 메일링

- [ ] Outlook Distribution Group 생성 요청
- [ ] `data/mailing_list.json`을 개인 이메일 목록 대신 Distribution Group 주소 1개로 변경
- [ ] Gmail SMTP 발신 주소가 그룹으로 보낼 수 있는지 회사 Exchange 정책 확인
- [ ] GitHub Actions `workflow_dispatch`로 실제 수신 테스트

## 향후 개선

### 우선순위 1

- [ ] 계획 환율 변경 이력 UI 추가
- [ ] 저장 성공/실패 상태를 모달 밖에서도 확인 가능하게 개선
- [ ] Supabase 연결 실패 시 사용자 안내 문구 정리

### 우선순위 2

- [ ] Microsoft SSO 검토
- [ ] 계획 환율 승인 워크플로 필요 여부 검토
- [ ] Outlook Distribution Group 운영 전환 완료

### 우선순위 3

- [ ] 로컬 Windows Vite/Rolldown build 실패 원인 추적
- [ ] `xlsx` 취약점 대체 라이브러리 또는 업그레이드 경로 검토
- [ ] 오래된 Excel 업로드/관리 기능 정리
