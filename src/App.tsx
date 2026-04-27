import { useEffect, useMemo, useState } from 'react'
import CurrencyDetail from './components/CurrencyDetail'
import Dashboard from './components/Dashboard'
import FileUploader from './components/FileUploader'
import MonthlySummary from './components/MonthlySummary'
import MovingComparison from './components/MovingComparison'
import RawSheetViewer from './components/RawSheetViewer'
import {
  fetchRemoteExchangeData,
  fetchRemoteExchangeDataWithExcel,
  loadDatasetFromCache,
  saveDatasetToCache,
} from './lib/exchangeRateParser'
import type {
  CurrencyCode,
  DashboardFilters,
  ExchangeRateDataset,
} from './types/exchangeRate'
import { CURRENCIES, YEARS } from './types/exchangeRate'
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
  { key: 'refresh', label: 'Upload / Refresh' },
]

function App() {
  const [screen, setScreen] = useState<ScreenKey>('dashboard')
  const [dataset, setDataset] = useState<ExchangeRateDataset | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [excelPriority, setExcelPriority] = useState(true)
  const [fillMissing, setFillMissing] = useState(true)

  const [filters, setFilters] = useState<DashboardFilters>({
    currency: 'ALL',
    year: 2026,
    month: 4,
    rateType: 'LOCAL_PER_USD',
  })

  const refreshData = async () => {
    try {
      setLoading(true)
      setError(null)
      const fetched = excelFile
        ? await fetchRemoteExchangeDataWithExcel(
            excelFile,
            { excelPriority, fillMissing },
            new Date(),
          )
        : await fetchRemoteExchangeData(new Date())
      setDataset(fetched)
      const cacheSaved = saveDatasetToCache(fetched)

      if (!cacheSaved) {
        setError(
          '브라우저 저장공간이 부족해 캐시 저장을 생략했습니다. 화면 조회는 계속 가능합니다.',
        )
      }

      const latest = new Date(fetched.baseDate)
      setFilters((prev) => ({
        ...prev,
        year: latest.getFullYear(),
        month: latest.getMonth() + 1,
      }))
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : '환율 데이터 조회 중 오류가 발생했습니다.',
      )
    } finally {
      setLoading(false)
    }
  }

  const uploadAndMergeExcel = async (
    file: File,
    options: { excelPriority: boolean; fillMissing: boolean },
  ) => {
    try {
      setLoading(true)
      setError(null)
      setExcelFile(file)
      setExcelPriority(options.excelPriority)
      setFillMissing(options.fillMissing)

      const merged = await fetchRemoteExchangeDataWithExcel(file, options, new Date())
      setDataset(merged)

      const cacheSaved = saveDatasetToCache(merged)
      if (!cacheSaved) {
        setError(
          '브라우저 저장공간이 부족해 캐시 저장을 생략했습니다. 화면 조회는 계속 가능합니다.',
        )
      }

      const latest = new Date(merged.baseDate)
      setFilters((prev) => ({
        ...prev,
        year: latest.getFullYear(),
        month: latest.getMonth() + 1,
      }))
    } catch (mergeError) {
      setError(
        mergeError instanceof Error
          ? mergeError.message
          : '엑셀 병합 중 오류가 발생했습니다.',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const cached = loadDatasetFromCache()

    if (cached) {
      setDataset(cached)
      const latest = new Date(cached.baseDate)
      setFilters((prev) => ({
        ...prev,
        year: latest.getFullYear(),
        month: latest.getMonth() + 1,
      }))
      return
    }

    void refreshData()
  }, [])

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
        return <MonthlySummary data={dataset} currencyFilter={filters.currency} />
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
            Currency
            <select
              value={filters.currency}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  currency: event.target.value as CurrencyCode | 'ALL',
                }))
              }
            >
              <option value="ALL">All</option>
              {CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </label>

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
              <option value="MOVING_COMPARISON">Moving Comparison</option>
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
