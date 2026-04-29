import { useMemo, useState } from 'react'
import Admin from './components/Admin'
import CurrencyDetail from './components/CurrencyDetail'
import Dashboard from './components/Dashboard'
import MonthlySummary from './components/MonthlySummary'
import MovingComparison from './components/MovingComparison'
import { useExchangeData } from './hooks/useExchangeData'
import type { DashboardFilters } from './types/exchangeRate'
import { YEARS, CURRENCIES } from './types/exchangeRate'
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

function App() {
  const [screen, setScreen] = useState<ScreenKey>('dashboard')
  
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
  } = useExchangeData()

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
            currencyFilter={filters.currency}
            onCurrencyChange={(currency) => setFilters((prev) => ({ ...prev, currency }))}
          />
        )
      case 'currency':
        return (
          <CurrencyDetail
            data={dataset}
            filters={filters}
          />
        )
      case 'moving':
        return <MovingComparison data={dataset} />
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
    screen,
    setFilters,
    refreshData,
    uploadAndMergeExcel
  ])

  return (
    <div className="app-shell">
      <header className="top-header">
        <div className="title-wrap">
          <h1>중남미 환율 대시보드 · LATAM FX Dashboard</h1>
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
        </nav>

        <div className="header-controls">
          <section className="global-filters">
            {['monthly', 'currency'].includes(screen) && (
            <>
              <label>
                <select
                  title="Year"
                  value={filters.year}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, year: Number(event.target.value) }))
                  }
                  aria-label="Year"
                >
                  {YEARS.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>

              {screen === 'currency' && (
                <>
                  <label>
                    <select
                      title="Month"
                      value={filters.month}
                      onChange={(event) =>
                        setFilters((prev) => ({ ...prev, month: Number(event.target.value) }))
                      }
                      aria-label="Month"
                    >
                      {Array.from({ length: 12 }, (_, idx) => idx + 1).map((month) => (
                        <option key={month} value={month}>
                          {month}월
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
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
            </>
          )}

          <button type="button" onClick={() => void refreshData()} disabled={loading}>
            {loading ? '갱신 중...' : 'Refresh'}
          </button>
          </section>
        </div>
      </header>

      <main>{content}</main>
    </div>
  )
}

export default App
