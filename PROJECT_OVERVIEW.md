# 중남미 환율 대시보드 프로젝트 설명

## 1. 프로젝트 개요

이 프로젝트는 중남미 주요 통화 환율을 웹에서 조회하고 비교하기 위한 React + TypeScript 기반 대시보드다.

초기 목표는 Excel workbook 기반 조회 시스템이었지만, 현재 구현은 다음 2개 소스를 병행하는 구조로 바뀌었다.

- 외부 환율 API 기반 기본 데이터 로딩
- 사용자가 업로드한 Excel 파일을 API 데이터 위에 병합하는 보강 데이터 로딩

즉, 현재 시스템은 기본적으로 API 데이터를 가져오고, 필요하면 Excel 값을 우선 적용해 덮어쓰는 하이브리드 구조다.


## 2. 기술 스택

- React
- TypeScript
- Vite
- Recharts
- SheetJS/xlsx
- 브라우저 localStorage 캐시


## 3. 현재 구현된 핵심 기능

### 3.1 기본 데이터 수집

기본 환율 시계열은 Frankfurter API의 history 데이터를 사용한다.

- 과거/시계열 데이터: Frankfurter history API
- 최신 기준일 보정: ExchangeRate-API latest API

이렇게 분리한 이유는 ExchangeRate-API 키가 history 엔드포인트를 지원하지 않는 요금제 제약이 있었기 때문이다.


### 3.2 Excel 업로드 후 우선 병합

사용자는 Upload / Refresh 화면에서 Excel 파일을 업로드할 수 있다.

업로드 시 다음 옵션이 적용된다.

- 엑셀 우선(EXCEL > API)
- 빈칸 자동 보정

병합 우선순위는 현재 다음과 같다.

- EXCEL 값이 있으면 EXCEL 사용
- EXCEL 값이 없으면 API 사용
- 두 값 모두 없으면 보정 규칙 적용 가능


### 3.3 빈칸 자동 보정

현재 구현된 자동 보정은 다음 2단계다.

- 일별 데이터: 같은 통화와 같은 환율 타입 기준으로 forward-fill
- 월별 데이터: 월값이 비어 있으면 같은 월의 일별 평균으로 보정

보정 여부는 데이터 메타에 남는다.

- source: API | EXCEL | IMPUTED
- imputationMethod: NONE | FFILL | LINEAR | MONTHLY_FALLBACK

참고로 현재는 LINEAR 타입이 타입에는 준비되어 있지만 실제 구현은 FFILL, MONTHLY_FALLBACK 중심이다.


### 3.4 캐시 저장

브라우저 localStorage를 사용한다.

다만 환율 원본 데이터 양이 커서 저장 용량 초과가 발생할 수 있기 때문에, 현재는 경량 캐시 전략을 사용한다.

- rawSheets는 캐시에서 제외
- dailyRates는 단계적으로 축소 저장 시도
  - 12000개
  - 6000개
  - 2000개
  - 0개

그래도 저장이 안 되면 캐시를 생략하고, 화면 조회만 가능하게 처리한다.


## 4. 현재 화면 구성

### 4.1 Dashboard

현재 메인 대시보드는 다음 요소로 구성된다.

- KPI 카드
  - USD/KRW 최신 월평균
  - BRL 최신 월평균
  - MXN 최신 월평균
  - CLP 최신 월평균
  - COP 최신 월평균
  - PEN 최신 월평균
  - 각 KPI는 전월 대비 변화율(MoM) 표시

- 통화별 Local per USD 월간 추이
  - 통화별 독립 Y축 스케일 사용
  - 소형 멀티 차트 형태

- KRW 기준 환산 환율 추이
  - 통화별 독립 Y축 스케일 사용
  - 소형 멀티 차트 형태

- 기준지수 추이 (1월=100)
  - 상대 추세 비교용

- 최신월 전월 대비 변화율(MoM)
  - 막대 차트

중간에 제거된 차트는 다음과 같다.

- 2026년 1월~4월 주요 통화 비교
- 기존 전년동월누적 비교 막대 차트

이유는 현재 데이터 상태와 스케일에서 정보 전달력이 낮았기 때문이다.


### 4.2 Monthly Summary

Summary 성격의 월별 테이블을 보여준다.

- Local per USD 월별 테이블
- KRW 월별 테이블
- Summary 원본 형태 테이블

특징:

- 연도별 12개월 그룹 헤더
- 가로 스크롤 지원


### 4.3 Currency Detail

선택한 통화의 일별/월별 상세를 보여준다.

- Exchange Rate (1 Dollar Exchange Rate)
- Exchange Rate (KRW)
- 선택 연/월의 일별 라인 차트
- Avg. 행 표시


### 4.4 Moving vs Actual

현재는 실제 Excel의 이동 比 시트를 그대로 재현한 수준은 아니고, API/병합 데이터 기준으로 계산한 비교 행을 보여준다.

구성:

- 1일~31일
- 평균(실적)
- 누적(1월~현재)
- 선행
- 선행 比
- 이동
- 이동 比
- 전년동월누적
- 전년동월누적比

주의:

- 이 영역은 실제 업무 정의와 100% 동일하다고 보장하지 않는다.
- 현 단계에서는 대시보드형 근사 계산이다.


### 4.5 Data Table

원본/정규화 데이터를 시트별로 확인할 수 있다.

기능:

- sheet selector
- 검색
- CSV 다운로드

현재 source와 imputation_method 컬럼도 확인할 수 있다.


### 4.6 Upload / Refresh

이 화면에서는 다음 작업을 수행한다.

- 외부 API 기준 새로고침
- Excel 파일 업로드 및 병합
- 엑셀 우선 여부 선택
- 빈칸 자동 보정 여부 선택
- 기준일 / 최종 갱신 / 레코드 수 확인


## 5. 데이터 모델

핵심 타입은 src/types/exchangeRate.ts에 정의되어 있다.

주요 타입:

- MonthlyRate
- DailyRate
- MovingComparisonRow
- ExchangeRateDataset

일별/월별 레코드에는 현재 다음 메타가 들어간다.

- source
- imputationMethod
- status


## 6. 주요 파일 구조

### 루트

- package.json
- vite.config.ts
- PROJECT_OVERVIEW.md

### src

- src/App.tsx
  - 전체 앱 엔트리
  - 탭, 필터, 새로고침, 엑셀 병합 연결

- src/lib/exchangeRateParser.ts
  - 외부 API 로딩
  - Excel 파싱
  - API + Excel 병합
  - 빈칸 보정
  - 캐시 저장/복원

- src/lib/formatters.ts
  - 숫자/축/문자 포맷 처리

- src/types/exchangeRate.ts
  - 전체 데이터 타입 정의

- src/components/Dashboard.tsx
  - KPI 및 메인 차트

- src/components/MonthlySummary.tsx
  - 월별 요약 테이블

- src/components/CurrencyDetail.tsx
  - 통화 상세 일별/월별 보기

- src/components/MovingComparison.tsx
  - 이동 비교 영역

- src/components/RawSheetViewer.tsx
  - 데이터 테이블 / 검색 / CSV 다운로드

- src/components/FileUploader.tsx
  - 새로고침 / 엑셀 업로드 화면


## 7. Excel 파싱 동작 방식

현재 Excel 파서는 완전 고정 스키마 파서가 아니라, 시트 구조를 기준으로 해석하는 휴리스틱 파서다.

동작 방식:

- 파일명에서 기준일 추출 시도
- Summary 시트에서 LOCAL/KRW 섹션 탐색
- 통화 시트(ARS, BRL, CLP...)를 순회하면서
  - 1 Dollar Exchange Rate 섹션 파싱
  - KRW 섹션 파싱
- Avg. 행은 월평균으로 해석
- 1일~31일 행은 일별 데이터로 해석

제약:

- 실제 Excel 구조가 예상과 다르면 일부 값이 누락될 수 있다.
- 특히 병합 셀, 제목 줄, 중간 공백 행 패턴이 다르면 결과가 달라질 수 있다.


## 8. 현재 한계와 알려진 이슈

### 8.1 ExchangeRate-API history 제한

주어진 키는 latest는 되지만 history는 막혀 있다.

그래서 다음 하이브리드 구조를 사용 중이다.

- history: Frankfurter
- latest: ExchangeRate-API


### 8.2 localStorage 용량 한계

현재는 localStorage를 쓰고 있어서 대용량 workbook까지 장기 보관하기엔 한계가 있다.

향후 권장 방향:

- IndexedDB 전환


### 8.3 Moving vs Actual 계산 정확도

현재 비교 계산은 화면 구성을 위해 만든 근사치다.

실제 업무 Excel 계산식과 완전히 같지 않을 수 있다.


### 8.4 차트 번들 크기

현재 빌드 경고상 JS 번들이 큰 편이다.

향후 개선 가능 항목:

- 차트 컴포넌트 lazy loading
- 화면 단위 code splitting


## 9. 현재까지의 사용 방법

### 기본 사용

1. 앱 실행
2. Refresh 클릭
3. Dashboard / Monthly Summary / Currency Detail 등 조회

### Excel 우선 병합 사용

1. Upload / Refresh 탭 이동
2. xlsx 파일 선택
3. 엑셀 우선 옵션 선택
4. 빈칸 자동 보정 옵션 선택
5. 엑셀 업로드/병합 클릭


## 10. 다음 우선 개선 후보

### 1순위

- Excel 파서 정확도 보정
- Moving vs Actual 계산식 실제 업무 기준 반영

### 2순위

- 보정값(IMPUTED) 시각적 배지/색상 표시
- source별 필터링

### 3순위

- IndexedDB 저장소 전환
- 번들 최적화 및 화면 lazy loading


## 11. 한 줄 요약

현재 이 프로젝트는 외부 환율 API를 기본 데이터 소스로 사용하고, 필요할 경우 업로드한 Excel 데이터를 우선 병합하며, 빈칸 보정과 대시보드 시각화를 제공하는 중남미 환율 관리용 내부 웹 대시보드다.