import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCellValue, monthLabel } from '../lib/formatters'
import type {
  CellStatus,
  DailyRate,
  DashboardFilters,
  ExchangeRateDataset,
  MonthlyRate,
} from '../types/exchangeRate'

interface DashboardProps {
  data: ExchangeRateDataset
  filters: DashboardFilters
}

const KPI_CURRENCIES = ['BRL', 'MXN', 'CLP', 'COP', 'PEN'] as const

const SERIES_COLORS = {
  BRL: '#26734d',
  MXN: '#5b7f2b',
  CLP: '#a86d00',
  COP: '#8a4f7d',
  PEN: '#26736f',
} as const

function getMonthly(
  rows: MonthlyRate[],
  currency: (typeof KPI_CURRENCIES)[number],
  year: number,
  month: number,
  rateType: 'LOCAL_PER_USD',
): MonthlyRate | undefined {
  return rows.find(
    (row) =>
      row.currency === currency &&
      row.year === year &&
      row.month === month &&
      row.rateType === rateType,
  )
}

function average(values: number[]): number | null {
  if (!values.length) {
    return null
  }

  const sum = values.reduce((acc, cur) => acc + cur, 0)
  return sum / values.length
}

function getDaily(
  rows: DailyRate[],
  currency: (typeof KPI_CURRENCIES)[number],
  date: string,
): DailyRate | undefined {
  return rows.find(
    (row) =>
      row.currency === currency && row.date === date && row.rateType === 'LOCAL_PER_USD',
  )
}

function Dashboard({ data, filters: _filters }: DashboardProps) {
  const baseDate = new Date(data.baseDate)
  const latestYear = baseDate.getFullYear()
  const latestMonth = baseDate.getMonth() + 1
  const baseDateText = data.baseDate
  const recentMonths = buildRecentMonths(latestYear, latestMonth, 24)

  const previousDate = new Date(latestYear, latestMonth - 2, 1)

  const oneYearAgoText = `${latestYear - 1}-${String(latestMonth).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`

  const kpis = KPI_CURRENCIES.map((currency) => {
    const monthlyValues = data.dailyRates
      .filter(
        (row) =>
          row.currency === currency &&
          row.rateType === 'LOCAL_PER_USD' &&
          row.year === latestYear &&
          row.month === latestMonth &&
          row.date <= baseDateText &&
          typeof row.value === 'number',
      )
      .map((row) => row.value as number)

    const cumulativeValue = average(monthlyValues)
    const cumulativeStatus: CellStatus = cumulativeValue === null ? 'empty' : 'ok'

    const current = getMonthly(data.monthlyRates, currency, latestYear, latestMonth, 'LOCAL_PER_USD')
    const previous = getMonthly(
      data.monthlyRates,
      currency,
      previousDate.getFullYear(),
      previousDate.getMonth() + 1,
      'LOCAL_PER_USD',
    )

    const today = getDaily(data.dailyRates, currency, baseDateText)

    const lastYearDaily = data.dailyRates
      .filter(row => row.currency === currency && row.rateType === 'LOCAL_PER_USD' && row.date >= oneYearAgoText && row.date <= baseDateText && typeof row.value === 'number')
      .map(row => row.value as number)
    const min52 = lastYearDaily.length ? Math.min(...lastYearDaily) : null
    const max52 = lastYearDaily.length ? Math.max(...lastYearDaily) : null
    const gaugePercent = (today?.value !== undefined && today.value !== null && min52 !== null && max52 !== null && max52 > min52)
      ? Math.max(0, Math.min(100, ((today.value - min52) / (max52 - min52)) * 100))
      : 50

    const diff =
      current?.value !== undefined && current.value !== null && previous?.value !== undefined && previous.value !== null && previous.value !== 0
        ? (current.value - previous.value) / previous.value
        : null

    return {
      currency,
      label: `${currency} 당월 누적 평균`,
      valueText: formatCellValue(cumulativeValue, cumulativeStatus, currency),
      todayText: formatCellValue(today?.value ?? null, today?.status ?? 'empty', currency),
      todaySource: today?.source,
      todayMethod: today?.imputationMethod,
      diff,
      min52: formatCellValue(min52, min52 !== null ? 'ok' : 'empty', currency),
      max52: formatCellValue(max52, max52 !== null ? 'ok' : 'empty', currency),
      gaugePercent
    }
  })

  const localSeriesByCurrency = KPI_CURRENCIES.map((currency) => {
    const monthlyMap = new Map<string, number | null>()

    data.monthlyRates
      .filter(
        (row) =>
          row.rateType === 'LOCAL_PER_USD' &&
          row.currency === currency,
      )
      .forEach((row) => {
        monthlyMap.set(monthKey(row.year, row.month), row.value)
      })

    const points = recentMonths.map(({ year, month }) => ({
      month: monthLabel(year, month),
      value: monthlyMap.get(monthKey(year, month)) ?? null,
    }))

    return {
      currency,
      points,
      domain: buildDomain(points.map((point) => point.value)),
    }
  })

  const dailySeriesByCurrency = KPI_CURRENCIES.map((currency) => {
    const currencyDaily = data.dailyRates
      .filter((row) => row.rateType === 'LOCAL_PER_USD' && row.currency === currency)
      .sort((a, b) => a.date.localeCompare(b.date))

    const currentMonthRows = currencyDaily.filter(
      (row) => row.year === latestYear && row.month === latestMonth && row.date <= baseDateText
    )

    const points = currentMonthRows.map((row) => {
      const currentDate = new Date(row.year, row.month - 1, row.day)
      const past30Date = new Date(currentDate)
      past30Date.setDate(past30Date.getDate() - 29)
      const past30Str = `${past30Date.getFullYear()}-${String(past30Date.getMonth() + 1).padStart(2, '0')}-${String(past30Date.getDate()).padStart(2, '0')}`

      const windowValues = currencyDaily
        .filter(r => r.date >= past30Str && r.date <= row.date && typeof r.value === 'number')
        .map(r => r.value as number)

      return {
        day: `${row.day}일`,
        value: row.value,
        ma30: windowValues.length ? average(windowValues) : null,
      }
    })

    const allValues = points.flatMap(p => [p.value, p.ma30]).filter((v): v is number => v !== null)
    return {
      currency,
      points,
      domain: buildDomain(allValues),
    }
  })

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Dashboard</h2>
      </div>

      <div className="dashboard-meta">
        <span>기준일: {baseDateText}</span>
        <span>카드 기준: 당월 1일~기준일까지 일별 평균(당월 누적)</span>
      </div>

      <div className="kpi-grid">
        {kpis.map((kpi) => (
          <div key={kpi.currency} className="kpi-card">
            <span>{kpi.label}</span>
            <strong>{kpi.valueText}</strong>
            <p className="kpi-today">
              오늘 환율 {kpi.todayText}
              {kpi.todaySource === 'API' && <span className="source-badge badge-api">API</span>}
              {kpi.todaySource === 'EXCEL' && <span className="source-badge badge-excel">EXCEL</span>}
              {kpi.todaySource === 'IMPUTED' && <span className="source-badge badge-imputed">보정</span>}
            </p>
            <em className={kpi.diff !== null && kpi.diff < 0 ? 'down' : 'up'}>
              {kpi.diff === null ? '-' : `${(kpi.diff * 100).toFixed(2)}% MoM`}
            </em>
            <div className="gauge-container">
              <div className="gauge-labels">
                <small className="gauge-min" title="52주 최저">L {kpi.min52}</small>
                <small className="gauge-max" title="52주 최고">H {kpi.max52}</small>
              </div>
              <div className="gauge-track">
                <div className="gauge-fill" style={{ width: `${kpi.gaugePercent}%`, backgroundColor: SERIES_COLORS[kpi.currency] }}></div>
                <div className="gauge-marker" style={{ left: `${kpi.gaugePercent}%` }}></div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <article className="chart-card chart-card-full dashboard-chart-card">
        <h3>통화별 Local per USD 월간 추이 (2년)</h3>
        <div className="small-multiple-row">
          {localSeriesByCurrency.map((series) => (
            <div key={`local-${series.currency}`} className="small-chart-card">
              <h4>{series.currency}</h4>
              <ResponsiveContainer width="100%" height={118}>
                <LineChart data={series.points}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" hide />
                  <YAxis
                    domain={series.domain}
                    width={64}
                    tickFormatter={formatAxisTick}
                  />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={SERIES_COLORS[series.currency]}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="ma30"
                    stroke="#9ca8b8"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    dot={false}
                    name="30일 이평"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      </article>

      <article className="chart-card chart-card-full dashboard-chart-card">
        <h3>통화별 Local per USD 최신 일간 추이 ({latestMonth}월)</h3>
        <div className="small-multiple-row">
          {dailySeriesByCurrency.map((series) => (
            <div key={`daily-${series.currency}`} className="small-chart-card">
              <h4>{series.currency}</h4>
              <ResponsiveContainer width="100%" height={118}>
                <LineChart data={series.points}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" hide />
                  <YAxis
                    domain={series.domain}
                    width={64}
                    tickFormatter={formatAxisTick}
                  />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={SERIES_COLORS[series.currency]}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      </article>
    </section>
  )
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

function buildRecentMonths(
  latestYear: number,
  latestMonth: number,
  span: number,
): Array<{ year: number; month: number }> {
  return Array.from({ length: span }, (_, idx) => {
    const offset = span - 1 - idx
    const date = new Date(latestYear, latestMonth - 1 - offset, 1)
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
    }
  })
}

function buildDomain(values: Array<number | null>): [number, number] {
  const numeric = values.filter((value): value is number => typeof value === 'number')
  if (!numeric.length) {
    return [0, 1]
  }

  const min = Math.min(...numeric)
  const max = Math.max(...numeric)

  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.05, 1)
    return [min - padding, max + padding]
  }

  const padding = (max - min) * 0.08
  return [min - padding, max + padding]
}

function formatAxisTick(value: number | string): string {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return String(value)
  }

  return numeric.toFixed(2)
}

export default Dashboard
