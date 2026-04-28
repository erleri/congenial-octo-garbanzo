import { useMemo, useState } from 'react'
import CurrencyDetail from './components/CurrencyDetail'
import Dashboard from './components/Dashboard'
import FileUploader from './components/FileUploader'
import MonthlySummary from './components/MonthlySummary'
import MovingComparison from './components/MovingComparison'
import RawSheetViewer from './components/RawSheetViewer'
import { useExchangeData } from './hooks/useExchangeData'
import type { DashboardFilters } from './types/exchangeRate'
import { YEARS } from './types/exchangeRate'
import './App.css'

type ScreenKey =
  | 'dashboard'
  | 'monthly'
  | 'currency'
  | 'moving'
  | 'table'
  | 'refresh'

const SCREEN_OPTIONS: Array<{ key: ScreenKey; label: string }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'monthly', label: 'Monthly Summary' },
  { key: 'currency', label: 'Currency Detail' },
  { key: 'moving', label: 'Moving vs Actual' },
  { key: 'table', label: 'Data Table' },
  { key: 'refresh', label: 'Excel Upload' },
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
            onCurrencyChange={(currency) =>
              setFilters((prev) => ({ ...prev, currency }))
            }
          />
        )
      case 'moving':
        return <MovingComparison data={dataset} />
      case 'table':
        return <RawSheetViewer data={dataset} />
      case 'refresh':
        return (
          <FileUploader
            loading={loading}
            error={error}
            dataset={dataset}
            onRefresh={refreshData}
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
          <h1>중남미 환율 대시보드</h1>
          <p>외부 환율 API 수집 기반</p>
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

        <section className="global-filters">
          <label>
            Year
            <select
              value={filters.year}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, year: Number(event.target.value) }))
              }
            >
              {YEARS.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>

          <label>
            Month
            <select
              value={filters.month}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, month: Number(event.target.value) }))
              }
            >
              {Array.from({ length: 12 }, (_, idx) => idx + 1).map((month) => (
                <option key={month} value={month}>
                  {month}월
                </option>
              ))}
            </select>
          </label>

          <label>
            Rate Type
            <select
              value={filters.rateType}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  rateType: event.target.value as DashboardFilters['rateType'],
                }))
              }
            >
              <option value="LOCAL_PER_USD">Local per USD</option>
              <option value="KRW">KRW</option>
            </select>
          </label>

          <button type="button" onClick={() => void refreshData()} disabled={loading}>
            {loading ? '갱신 중...' : 'Refresh'}
          </button>
        </section>
      </header>

      <main>{content}</main>
    </div>
  )
}

export default App
