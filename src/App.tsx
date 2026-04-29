import { useEffect, useMemo, useState, Suspense, lazy } from 'react'
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
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'monthly', label: 'Monthly History' },
  { key: 'currency', label: 'Daily Trend' },
  { key: 'moving', label: 'Moving vs Actual' },
  { key: 'admin', label: 'Admin' },
]

function periodToNumber(period: string): number {
  const [yearText, monthText] = period.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  return year * 100 + month
}

function App() {
  const [screen, setScreen] = useState<ScreenKey>('dashboard')
  const showHeaderFilters = ['monthly', 'currency'].includes(screen)
  const [monthlyCurrency, setMonthlyCurrency] = useState<DashboardFilters['currency']>('ALL')
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  const [yearFrom, setYearFrom] = useState<number | null>(null)
  const [yearTo, setYearTo] = useState<number | null>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const handleResize = () => {
      // PC 해상도(1200px 이상)일 때, 1600x920 크기의 가상 캔버스를 화면에 딱 맞춤
      if (window.innerWidth >= 1200) {
        const scaleX = window.innerWidth / 1600
        const scaleY = window.innerHeight / 920
        // 스크롤바가 생기지 않도록 너비와 높이 중 더 작은 배율을 선택
        setScale(Math.min(scaleX, scaleY))
      } else {
        setScale(1)
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  
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

    const baseYm = periodToNumber(dataset.baseDate.slice(0, 7))

    const unique = new Set(
      dataset.dailyRates
        .filter((row) => {
          if (row.rateType !== 'LOCAL_PER_USD') {
            return false
          }

          const ym = row.year * 100 + row.month
          return ym <= baseYm
        })
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

    if (!periodFrom || !periodOptions.includes(periodFrom)) {
      setPeriodFrom(defaultFrom)
    }

    if (!periodTo || !periodOptions.includes(periodTo)) {
      setPeriodTo(latest)
    }
  }, [periodFrom, periodOptions, periodTo])

  useEffect(() => {
    if (!yearOptions.length) {
      return
    }

    const latest = yearOptions[yearOptions.length - 1]
    const defaultFrom = yearOptions[Math.max(0, yearOptions.length - 2)]

    if (yearFrom === null || !yearOptions.includes(yearFrom)) {
      setYearFrom(defaultFrom)
    }

    if (yearTo === null || !yearOptions.includes(yearTo)) {
      setYearTo(latest)
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
      setYearTo(monthlyToOptions[monthlyToOptions.length - 1])
    }
  }, [monthlyToOptions, yearTo])

  useEffect(() => {
    if (!dailyToOptions.length) {
      return
    }

    if (!periodTo || !dailyToOptions.includes(periodTo)) {
      setPeriodTo(dailyToOptions[dailyToOptions.length - 1])
    }
  }, [dailyToOptions, periodTo])

  const content = useMemo(() => {
    if (!dataset) {
      return (
        <section className="panel empty">
          <h2>데이터를 불러오는 중입니다.</h2>
          {error ? <p className="error-message">{error}</p> : null}
        </section>
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
    fillMissing,
    filters,
    loading,
    monthlyCurrency,
    screen,
    setFilters,
    refreshData,
    uploadAndMergeExcel,
    businessPlan,
    updateBusinessPlan
  ])

  return (
    <div className="app-shell" style={{ zoom: scale } as React.CSSProperties}>
      <header className="top-header">
        <div className="title-wrap">
          <h1>
            <span className="title-primary">중남미 환율 대시보드</span>
            <span className="title-secondary">LATAM FX Dashboard</span>
          </h1>
          <p>외부 환율 API 수집 기반 · Built by Imjun Koo</p>
        </div>

        <nav className="screen-nav">
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
          <button type="button" className="header-refresh-button" onClick={() => void refreshData()} disabled={loading}>
            {loading ? '갱신 중...' : 'Refresh'}
          </button>
        </nav>

        {showHeaderFilters && (
          <div className="header-controls">
            <section className="global-filters">
              {screen === 'monthly' && (
                <>
                  <label>
                    <span className="filter-label">From</span>
                    <select
                      title="From"
                      value={yearFrom ?? ''}
                      onChange={(event) => setYearFrom(Number(event.target.value))}
                      aria-label="From"
                    >
                      {yearOptions.map((year) => (
                        <option key={`from-year-${year}`} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span className="filter-label">To</span>
                    <select
                      title="To"
                      value={yearTo ?? ''}
                      onChange={(event) => setYearTo(Number(event.target.value))}
                      aria-label="To"
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
                    <span className="filter-label">From</span>
                    <select
                      title="From"
                      value={periodFrom}
                      onChange={(event) => setPeriodFrom(event.target.value)}
                      aria-label="From"
                    >
                      {periodOptions.map((period) => (
                        <option key={`from-${period}`} value={period}>
                          {period}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span className="filter-label">To</span>
                    <select
                      title="To"
                      value={periodTo}
                      onChange={(event) => setPeriodTo(event.target.value)}
                      aria-label="To"
                    >
                          {dailyToOptions.map((period) => (
                        <option key={`to-${period}`} value={period}>
                          {period}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span className="filter-label">Currency</span>
                    <select
                      title="Currency"
                      value={filters.currency}
                      onChange={(event) =>
                        setFilters((prev) => ({
                          ...prev,
                          currency: event.target.value as DashboardFilters['currency'],
                        }))
                      }
                      aria-label="Currency"
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
            </section>
          </div>
        )}
      </header>

      <main>
        <Suspense fallback={
          <section className="panel empty" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <h2 style={{ color: '#5b6778' }}>화면을 불러오는 중입니다...</h2>
          </section>
        }>
          {content}
        </Suspense>
      </main>
    </div>
  )
}

export default App
