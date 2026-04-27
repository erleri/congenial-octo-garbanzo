# 중남미 환율 대시보드 구현 지시문 (AntiGravity 입력용)

아래 블록을 AntiGravity에 그대로 입력해 1차 구현을 시작한다.

```markdown
중남미 환율 대시보드 웹사이트를 만든다.

목표:
업로드된 Excel 파일 `Daily Exchange Rate (26.04.20).xlsx`의 모든 환율 데이터를 웹에서 조회, 필터링, 비교, 차트화할 수 있게 한다.

데이터 원천:
- Excel workbook
- 포함 시트:
  - Summary
  - ARS
  - BRL
  - CLP
  - COP
  - GTQ
  - MXN
  - PYG
  - PEN
  - CNY
  - UYU
  - USD
  - 이동 比

전체 화면 구조:
1. Dashboard
2. Monthly Summary
3. Currency Detail
4. Moving vs Actual
5. Data Table
6. Upload / Refresh

공통 UI:
- 상단 필터:
  - Currency: All, ARS, BRL, CLP, COP, GTQ, MXN, PYG, PEN, CNY, UYU, USD
  - Year: 2010 ~ 2026
  - Month: 1월 ~ 12월
  - Rate Type: Local per USD / KRW / Moving Comparison
- 숫자는 통화별 소수점 자릿수를 다르게 표시:
  - KRW, CLP, COP, PYG: 정수 또는 1자리
  - BRL, PEN, MXN, GTQ, UYU, CNY: 2~4자리
  - ARS: 2~4자리
- 빈 값, 0, #DIV/0!는 정상 데이터와 구분해서 표시한다.
  - 빈 값: "-"
  - 0: "0"으로 표시하되, future month placeholder 가능성이 있으므로 회색 처리
  - 오류값: "N/A"

Dashboard 요구사항:
- 최신 기준월은 파일명 기준 2026년 4월 20일로 해석한다.
- 카드 KPI:
  - USD/KRW 최신 월평균
  - BRL 최신 월평균
  - MXN 최신 월평균
  - CLP 최신 월평균
  - COP 최신 월평균
  - PEN 최신 월평균
- 각 KPI에는 전월 대비 증감률을 함께 표시한다.
- 주요 차트:
  1. 통화별 Local per USD 월간 추이
  2. KRW 기준 환산 환율 추이
  3. 2026년 1월~4월 주요 통화 비교
  4. 전년동월누적 대비 차이

Monthly Summary 화면:
- Summary 시트의 월별 데이터를 normalized table로 변환해서 표시한다.
- 데이터 구조:
  {
    currency: string,
    year: number,
    month: number,
    rate_type: "LOCAL_PER_USD" | "KRW",
    value: number | null
  }
- 상단 영역:
  - Local per USD 월별 환율 테이블
- 하단 영역:
  - KRW 월별 환율 테이블
- 테이블은 Excel의 원본 형태도 볼 수 있어야 한다.
- 열이 많으므로 horizontal scroll을 지원한다.
- 연도별 column group header를 둔다.

Currency Detail 화면:
- 통화 선택 시 해당 통화 시트를 표시한다.
- 각 통화 시트는 두 구역으로 나뉜다.
  1. Exchange Rate (1 Dollar Exchange Rate)
  2. Exchange Rate (KRW)
- 각 구역은 일자 x 월별 매트릭스 구조다.
- 데이터 구조:
  {
    currency: string,
    year: number,
    month: number,
    day: number,
    rate_type: "LOCAL_PER_USD" | "KRW",
    value: number | null
  }
- 일별 차트:
  - 선택한 연도/월의 일별 환율 line chart
- 월평균:
  - 각 월의 Avg. 값을 별도 행으로 보여준다.
- 특정 월을 클릭하면 해당 월의 일별 상세가 우측 drawer 또는 하단 패널에 표시된다.

Moving vs Actual 화면:
- `이동 比` 시트를 기반으로 한다.
- 주요 컬럼:
  - KRW
  - BRL
  - COP
  - CLP
  - PEN
  - ARS
  - MXN
  - PYG
  - GTQ
  - UYU
  - CNY
  - 원유가(U$/bbl)
- 행:
  - 1일~31일
  - 평균(실적)
  - 누적(1월~현재)
  - 선행
  - 선행 比
  - 이동
  - 이동 比
  - 전년동월누적
  - 전년동월누적比
- 비교율 행은 percentage format으로 표시한다.
- 양수/음수에 따라 색상을 다르게 표시한다.
  - 유리한 방향/불리한 방향 판단은 하지 말고, 우선 상승은 빨강, 하락은 파랑으로 표시한다.
- `#DIV/0!` 오류값은 `N/A`로 표시한다.

Data Table 화면:
- 원본 workbook의 모든 시트를 선택해서 볼 수 있게 한다.
- sheet selector 제공:
  - Summary
  - ARS
  - BRL
  - CLP
  - COP
  - GTQ
  - MXN
  - PYG
  - PEN
  - CNY
  - UYU
  - USD
  - 이동 比
- 원본 셀 병합 형태를 완벽히 복원할 필요는 없지만, 연도/월 header 구조는 유지한다.
- 검색, 필터, 다운로드 CSV 기능을 제공한다.

Upload / Refresh:
- 사용자가 새로운 Excel 파일을 업로드하면 동일한 파서로 재처리한다.
- 파일명에서 기준일을 추출한다.
  - 예: `26.04.20` → 2026-04-20
- 파싱 후 normalized JSON을 생성한다.
- 생성 데이터:
  - monthlyRates
  - dailyRates
  - movingComparison
  - rawSheets

기술 요구사항:
- React + TypeScript 기반으로 구현한다.
- Excel parsing은 SheetJS/xlsx 라이브러리를 사용한다.
- 상태 관리는 간단히 React state 또는 Zustand를 사용한다.
- 차트는 Recharts를 사용한다.
- 테이블은 TanStack Table 또는 기본 HTML table로 구현한다.
- 모든 파싱 로직은 `/src/lib/exchangeRateParser.ts`에 둔다.
- UI 컴포넌트는 `/src/components`에 둔다.

파일 구조:
- `/src/App.tsx`
- `/src/lib/exchangeRateParser.ts`
- `/src/types/exchangeRate.ts`
- `/src/components/Dashboard.tsx`
- `/src/components/MonthlySummary.tsx`
- `/src/components/CurrencyDetail.tsx`
- `/src/components/MovingComparison.tsx`
- `/src/components/RawSheetViewer.tsx`
- `/src/components/FileUploader.tsx`

중요한 파싱 규칙:
1. Summary 시트
   - 상단 구역: `▶ 월별 LOCAL 환율 현황 (1 Dollar Exchange)`
   - 하단 구역: `▶ 월별 LOCAL 환율 현황 (KRW)`
   - 첫 번째 데이터 열은 2010년 1월부터 시작한다.
   - 이후 12개월 단위로 연도가 증가한다.
   - 2026년은 4월까지 실데이터가 있고 이후 값은 0 또는 빈 값일 수 있다.

2. 통화별 시트
   - 상단 구역: `▶ Exchange Rate (1 Dollar Exchange Rate)`
   - 하단 구역: `▶ Exchange Rate (KRW)`
   - 행은 1일~31일, 마지막은 Avg.이다.
   - 열은 2010년 1월부터 월 단위로 이어진다.

3. 이동 比 시트
   - 첫 번째 열은 항목명이다.
   - KRW, BRL, COP, CLP, PEN, ARS, MXN, PYG, GTQ, UYU, CNY, 원유가를 컬럼으로 사용한다.
   - 1일~31일은 일별 데이터이다.
   - 평균, 누적, 선행, 이동, 전년동월누적 관련 행은 summary metric으로 분리한다.

디자인 톤:
- 기업 내부 전략/관리 대시보드 느낌
- 밝은 배경
- 통화별 컬러는 과하지 않게 사용
- 숫자 중심의 밀도 있는 화면
- 모바일보다는 데스크톱 우선
- 단, 태블릿에서 깨지지 않게 responsive 처리
```

## 1차 버전 권장 범위

1. 엑셀 업로드
2. Summary 파싱
3. Dashboard KPI
4. 통화별 월간 추이 차트
5. `이동 比` 테이블 표시

> 이후 2차에서 Currency Detail(일별)과 원본 전체 시트 뷰어를 확장한다.
