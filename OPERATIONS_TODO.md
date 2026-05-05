# Operations TODO

## 배포 전 필수 체크리스트
- [ ] Supabase SQL Editor에서 `supabase/migrations/20260504120000_business_plan_rates.sql` 실행
- [ ] `business_plan_admins`에 관리자 이메일 등록
- [ ] Supabase Auth redirect URL 등록
- [ ] Netlify 환경변수 등록
- [ ] GitHub Actions Repository secrets 등록
- [ ] `main` 반영 후 Netlify 배포 성공 확인
- [ ] 운영 URL에서 계획 환율 로그인 및 저장 테스트
- [ ] GitHub Actions `workflow_dispatch`로 메일 캡처/발송 테스트

## Supabase 계획 환율 설정

### 1. SQL 실행
Supabase Dashboard의 `SQL Editor`에서 아래 파일 전체를 실행합니다.

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

권한 회수는 삭제보다 비활성화를 권장합니다.

```sql
update public.business_plan_admins
set active = false
where email = 'someone@example.com';
```

### 3. Auth redirect URL
Supabase Dashboard의 `Authentication` -> `URL Configuration`에서 등록합니다.

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

`VITE_SUPABASE_ANON_KEY`에는 Supabase `Publishable key` 값을 넣습니다. `service_role`, `secret key`, `sb_secret_...` 값은 사용하지 않습니다.

## 메일링 운영
- [ ] Outlook Distribution Group 생성 완료 확인
- [ ] `data/mailing_list.json`은 당분간 `imjun.koo@lge.com` + `latam-fx-dashboard@lge.com` 병행 유지
- [ ] Gmail SMTP 발신 주소가 배포 그룹으로 메일 발송 가능한지 회사 Exchange 정책 확인
- [ ] GitHub Actions `workflow_dispatch`로 주인님 개인 주소와 배포 그룹 주소 모두 수신 테스트
- [ ] 배포 그룹 수신이 안정화되면 개인 주소 제거 여부 재검토

## 후속 개선

### 우선순위 1
- [ ] 계획 환율 변경 이력 UI 추가
- [ ] 저장 성공/실패 상태를 모달 밖에서도 확인 가능하게 개선
- [ ] Supabase 연결 실패 시 사용자 안내 문구 정리

### 우선순위 2
- [ ] Microsoft SSO 검토
- [ ] 계획 환율 승인 워크플로 필요 여부 검토
- [ ] Outlook Distribution Group 중심 운영으로 완전 전환 여부 결정

### 우선순위 3
- [ ] 로컬 Windows Vite/Rolldown build 실패 원인 추적
- [ ] `xlsx` 취약점 대체 라이브러리 또는 업그레이드 경로 검토
- [ ] 장기적인 Excel 업로드 관리 기능 정리
