import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import Dashboard from './components/Dashboard'
const Admin = lazy(() => import('./components/Admin'))
const CurrencyDetail = lazy(() => import('./components/CurrencyDetail'))
const MonthlySummary = lazy(() => import('./components/MonthlySummary'))
const MovingComparison = lazy(() => import('./components/MovingComparison'))
import { useExchangeData } from './hooks/useExchangeData'
import type { DashboardFilters } from './types/exchangeRate'
import { CURRENCIES } from './types/exchangeRate'
import './App.css'

type ScreenKey =
  | 'dashboard'
  | 'monthly'
  | 'currency'
  | 'moving'
  | 'admin'

const SCREEN_OPTIONS: Array<{ key: ScreenKey; label: string }> = [
  { key: 'dashboard', label: '대시보드' },
  { key: 'monthly', label: '월별 이력' },
  { key: 'currency', label: '일별 추이' },
  { key: 'moving', label: '계획 대비' },
  { key: 'admin', label: '관리' },
]

function periodToNumber(period: string): number {
  const [yearText, monthText] = period.split('-')
  return Number(yearText) * 100 + Number(monthText)
}

function formatDateTime(value?: string): string {
  if (!value) {
    return '-'
  }

  return new Date(value).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function App() {
  const [screen, setScreen] = useState<ScreenKey>('dashboard')
  const showHeaderFilters = ['monthly', 'currency'].includes(screen)
  const [monthlyCurrency, setMonthlyCurrency] = useState<DashboardFilters['currency']>('ALL')
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  const [yearFrom, setYearFrom] = useState<number | null>(null)
  const [yearTo, setYearTo] = useState<number | null>(null)

  const {
    dataset,
    loading,
    error,
    excelPriority,
    fillMissing,
    filters,
    setFilters,
    refreshData,
    uploadAndMergeExcel,
    businessPlan,
    updateBusinessPlan,
  } = useExchangeData()

  const periodOptions = useMemo(() => {
    if (!dataset) {
      return []
    }

    const unique = new Set(
      dataset.dailyRates
        .filter((row) => row.rateType === 'LOCAL_PER_USD')
        .map((row) => `${row.year}-${String(row.month).padStart(2, '0')}`),
    )

    return [...unique].sort((a, b) => periodToNumber(a) - periodToNumber(b))
  }, [dataset])

  const yearOptions = useMemo(() => {
    if (!dataset) {
      return []
    }

    const unique = new Set(
      dataset.monthlyRates
        .filter((row) => row.rateType === 'LOCAL_PER_USD')
        .map((row) => row.year),
    )

    return [...unique].sort((a, b) => a - b)
  }, [dataset])

  useEffect(() => {
    if (!periodOptions.length) {
      return
    }

    const latest = periodOptions[periodOptions.length - 1]
    const defaultFrom = periodOptions[Math.max(0, periodOptions.length - 2)]
    const isPeriodToStale =
      periodTo &&
      periodOptions.includes(periodTo) &&
      periodTo !== latest &&
      periodToNumber(periodTo) < periodToNumber(latest)

    if (!periodFrom || !periodOptions.includes(periodFrom)) {
      window.setTimeout(() => setPeriodFrom(defaultFrom), 0)
    }

    if (!periodTo || !periodOptions.includes(periodTo) || isPeriodToStale) {
      window.setTimeout(() => setPeriodTo(latest), 0)
    }
  }, [periodFrom, periodOptions, periodTo])

  useEffect(() => {
    if (!yearOptions.length) {
      return
    }

    const latest = yearOptions[yearOptions.length - 1]
    const defaultFrom = yearOptions[Math.max(0, yearOptions.length - 2)]
    const isYearToStale = yearTo !== null && yearOptions.includes(yearTo) && yearTo < latest

    if (yearFrom === null || !yearOptions.includes(yearFrom)) {
      window.setTimeout(() => setYearFrom(defaultFrom), 0)
    }

    if (yearTo === null || !yearOptions.includes(yearTo) || isYearToStale) {
      window.setTimeout(() => setYearTo(latest), 0)
    }
  }, [yearFrom, yearOptions, yearTo])

  const [effectivePeriodFrom, effectivePeriodTo] = useMemo(() => {
    if (!periodOptions.length) {
      return ['', '']
    }

    const fallbackFrom = periodOptions[Math.max(0, periodOptions.length - 2)]
    const fallbackTo = periodOptions[periodOptions.length - 1]
    const from = periodOptions.includes(periodFrom) ? periodFrom : fallbackFrom
    const to = periodOptions.includes(periodTo) ? periodTo : fallbackTo

    return periodToNumber(from) <= periodToNumber(to) ? [from, to] : [to, from]
  }, [periodFrom, periodOptions, periodTo])

  const [effectiveYearFrom, effectiveYearTo] = useMemo(() => {
    if (!yearOptions.length) {
      return [0, 0]
    }

    const fallbackFrom = yearOptions[Math.max(0, yearOptions.length - 2)]
    const fallbackTo = yearOptions[yearOptions.length - 1]
    const from = yearFrom !== null && yearOptions.includes(yearFrom) ? yearFrom : fallbackFrom
    const to = yearTo !== null && yearOptions.includes(yearTo) ? yearTo : fallbackTo

    return from <= to ? [from, to] : [to, from]
  }, [yearFrom, yearOptions, yearTo])

  const monthlyToOptions = useMemo(() => {
    if (yearFrom === null) {
      return yearOptions
    }

    return yearOptions.filter((year) => year >= yearFrom)
  }, [yearFrom, yearOptions])

  const dailyToOptions = useMemo(() => {
    if (!periodFrom) {
      return periodOptions
    }

    const fromValue = periodToNumber(periodFrom)
    return periodOptions.filter((period) => periodToNumber(period) >= fromValue)
  }, [periodFrom, periodOptions])

  useEffect(() => {
    if (!monthlyToOptions.length) {
      return
    }

    if (yearTo === null || !monthlyToOptions.includes(yearTo)) {
      window.setTimeout(() => setYearTo(monthlyToOptions[monthlyToOptions.length - 1]), 0)
    }
  }, [monthlyToOptions, yearTo])

  useEffect(() => {
    if (!dailyToOptions.length) {
      return
    }

    if (!periodTo || !dailyToOptions.includes(periodTo)) {
      window.setTimeout(() => setPeriodTo(dailyToOptions[dailyToOptions.length - 1]), 0)
    }
  }, [dailyToOptions, periodTo])

  const content = useMemo(() => {
    if (!dataset) {
      return (
        <div className="panel empty">
          <h2>데이터를 불러오는 중입니다.</h2>
          <p className="table-help">네트워크와 정적 데이터 파일 상태를 확인하고 있습니다.</p>
        </div>
      )
    }

    switch (screen) {
      case 'dashboard':
        return <Dashboard data={dataset} filters={filters} />
      case 'monthly':
        return (
          <MonthlySummary
            data={dataset}
            currencyFilter={monthlyCurrency}
            yearFrom={effectiveYearFrom}
            yearTo={effectiveYearTo}
            onCurrencyChange={setMonthlyCurrency}
          />
        )
      case 'currency':
        return (
          <CurrencyDetail
            data={dataset}
            currencyFilter={filters.currency}
            periodFrom={effectivePeriodFrom}
            periodTo={effectivePeriodTo}
          />
        )
      case 'moving':
        return (
          <MovingComparison
            data={dataset}
            businessPlan={businessPlan}
            onUpdatePlan={updateBusinessPlan}
          />
        )
      case 'admin':
        return (
          <Admin
            error={error}
            dataset={dataset}
            onUploadExcel={uploadAndMergeExcel}
            excelPriority={excelPriority}
            fillMissing={fillMissing}
          />
        )
      default:
        return null
    }
  }, [
    dataset,
    error,
    excelPriority,
    effectivePeriodFrom,
    effectivePeriodTo,
    effectiveYearFrom,
    effectiveYearTo,
    fillMissing,
    filters,
    monthlyCurrency,
    screen,
    uploadAndMergeExcel,
    businessPlan,
    updateBusinessPlan,
  ])

  return (
    <div className="app-shell">
      <header className="top-header">
        <div className="title-wrap">
          <h1>
            <span className="title-primary">LATAM FX</span>
            <span className="title-secondary">환율 대시보드</span>
          </h1>
        </div>

        <nav className="screen-nav" aria-label="화면 선택">
          {SCREEN_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={screen === option.key ? 'tab active' : 'tab'}
              onClick={() => setScreen(option.key)}
            >
              {option.label}
            </button>
          ))}
        </nav>

        <div className="header-actions">
          <div className="status-group">
            <span className="status-item">
              <span className={`status-dot ${loading ? 'loading' : error ? 'error' : ''}`} />
              {loading ? '갱신 중' : error ? '확인 필요' : '정상'}
            </span>
            <span className="status-item">기준일 {dataset?.baseDate ?? '-'}</span>
            <span className="status-item">최종 갱신 {formatDateTime(dataset?.fetchedAt)}</span>
          </div>
          <button type="button" className="header-refresh-button" onClick={() => void refreshData()} disabled={loading}>
            {loading ? '갱신 중' : 'Refresh'}
          </button>
        </div>

        {showHeaderFilters && (
          <div className="header-controls">
            <div className="global-filters">
              {screen === 'monthly' && (
                <>
                  <label>
                    <span className="filter-label">시작 연도</span>
                    <select
                      title="시작 연도"
                      value={yearFrom ?? ''}
                      onChange={(event) => setYearFrom(Number(event.target.value))}
                      aria-label="시작 연도"
                    >
                      {yearOptions.map((year) => (
                        <option key={`from-year-${year}`} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span className="filter-label">종료 연도</span>
                    <select
                      title="종료 연도"
                      value={yearTo ?? ''}
                      onChange={(event) => setYearTo(Number(event.target.value))}
                      aria-label="종료 연도"
                    >
                      {monthlyToOptions.map((year) => (
                        <option key={`to-year-${year}`} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}

              {screen === 'currency' && (
                <>
                  <label>
                    <span className="filter-label">시작 월</span>
                    <select
                      title="시작 월"
                      value={periodFrom}
                      onChange={(event) => setPeriodFrom(event.target.value)}
                      aria-label="시작 월"
                    >
                      {periodOptions.map((period) => (
                        <option key={`from-${period}`} value={period}>
                          {period}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span className="filter-label">종료 월</span>
                    <select
                      title="종료 월"
                      value={periodTo}
                      onChange={(event) => setPeriodTo(event.target.value)}
                      aria-label="종료 월"
                    >
                      {dailyToOptions.map((period) => (
                        <option key={`to-${period}`} value={period}>
                          {period}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span className="filter-label">통화</span>
                    <select
                      title="통화"
                      value={filters.currency}
                      onChange={(event) =>
                        setFilters((prev) => ({
                          ...prev,
                          currency: event.target.value as DashboardFilters['currency'],
                        }))
                      }
                      aria-label="통화"
                    >
                      {CURRENCIES.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main>
        <Suspense
          fallback={
            <div className="panel empty" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <h2 style={{ color: '#667085' }}>화면을 불러오는 중입니다.</h2>
            </div>
          }
        >
          {content}
        </Suspense>
      </main>
    </div>
  )
}

export default App
