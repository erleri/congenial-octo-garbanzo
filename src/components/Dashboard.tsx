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
  BRL: '#2f6f5e',
  MXN: '#4f6f38',
  CLP: '#93691d',
  COP: '#70577a',
  PEN: '#24706d',
} as const

const SOURCE_LABELS = {
  API: 'API',
  EXCEL: 'Excel',
  IMPUTED: '보정',
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

function Dashboard({ data }: DashboardProps) {
  const baseDate = new Date(data.baseDate)
  const latestYear = baseDate.getFullYear()
  const latestMonth = baseDate.getMonth() + 1
  const baseDateText = data.baseDate
  const recentMonths = buildRecentMonths(latestYear, latestMonth, 24)
  const firstRecentMonth = recentMonths[0]
  const lastRecentMonth = recentMonths[recentMonths.length - 1]
  const monthlyRangeLabel =
    firstRecentMonth && lastRecentMonth
      ? `최근 ${recentMonths.length}개월 · ${monthKey(firstRecentMonth.year, firstRecentMonth.month)}~${monthKey(lastRecentMonth.year, lastRecentMonth.month)}`
      : '최근 24개월'

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
      .filter(
        (row) =>
          row.currency === currency &&
          row.rateType === 'LOCAL_PER_USD' &&
          row.date >= oneYearAgoText &&
          row.date <= baseDateText &&
          typeof row.value === 'number',
      )
      .map((row) => row.value as number)

    const low52 = lastYearDaily.length ? Math.min(...lastYearDaily) : null
    const high52 = lastYearDaily.length ? Math.max(...lastYearDaily) : null
    const percent52 =
      today?.value !== undefined &&
      today.value !== null &&
      low52 !== null &&
      high52 !== null &&
      high52 > low52
        ? Math.max(0, Math.min(100, ((today.value - low52) / (high52 - low52)) * 100))
        : 50

    const mom =
      current?.value !== undefined &&
      current.value !== null &&
      previous?.value !== undefined &&
      previous.value !== null &&
      previous.value !== 0
        ? (current.value - previous.value) / previous.value
        : null

    return {
      currency,
      cumulativeValue,
      cumulativeStatus,
      todayValue: today?.value ?? null,
      todayStatus: today?.status ?? 'empty',
      todaySource: today?.source ?? 'API',
      mom,
      low52,
      high52,
      percent52,
    }
  })

  const localSeriesByCurrency = KPI_CURRENCIES.map((currency) => {
    const monthlyMap = new Map<string, number | null>()

    data.monthlyRates
      .filter((row) => row.rateType === 'LOCAL_PER_USD' && row.currency === currency)
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

    const points = currencyDaily.slice(-30).map((row) => ({
      day: `${row.month}/${row.day}`,
      value: row.value,
    }))

    return {
      currency,
      points,
      domain: buildDomain(points.map((point) => point.value)),
    }
  })

  return (
    <div className="dashboard-container">
      <div className="dashboard-meta">
        <span className="base-date-chip">기준일 {baseDateText}</span>
        <span className="data-pill">당월 누적 평균</span>
      </div>

      <div className="kpi-grid">
        {kpis.map((kpi) => (
          <div key={kpi.currency} className="kpi-card">
            <div className="kpi-header">
              <span>{kpi.currency} / USD</span>
              <div className={`source-badge badge-${kpi.todaySource.toLowerCase()}`}>
                {SOURCE_LABELS[kpi.todaySource]}
              </div>
            </div>
            <strong>{formatCellValue(kpi.cumulativeValue, kpi.cumulativeStatus, kpi.currency)}</strong>
            <p className="kpi-today">
              기준일 환율 {formatCellValue(kpi.todayValue, kpi.todayStatus, kpi.currency)}
            </p>
            {kpi.mom !== null ? (
              <em className={kpi.mom >= 0 ? 'up' : 'down'}>
                {kpi.mom >= 0 ? '+' : '-'}{Math.abs(kpi.mom * 100).toFixed(2)}% MoM
              </em>
            ) : (
              <em className="kpi-today">MoM -</em>
            )}
            <div className="gauge-container">
              <div className="gauge-labels">
                <span>{kpi.low52?.toFixed(2) ?? '-'}</span>
                <span>{kpi.high52?.toFixed(2) ?? '-'}</span>
              </div>
              <div className="gauge-track">
                <div
                  className="gauge-fill"
                  style={{
                    width: `${kpi.percent52}%`,
                    backgroundColor: SERIES_COLORS[kpi.currency],
                  }}
                />
                <div className="gauge-marker" style={{ left: `${kpi.percent52}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="chart-card chart-card-full dashboard-chart-card">
        <div className="section-title-row">
          <h3>통화별 월간 추이</h3>
          <span className="section-range-label">{monthlyRangeLabel}</span>
        </div>
        <div className="small-multiple-row">
          {localSeriesByCurrency.map((series) => (
            <div key={`local-${series.currency}`} className="small-chart-card">
              <h4>{series.currency}</h4>
              <ResponsiveContainer width="100%" height={118}>
                <LineChart data={series.points}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eceff3" />
                  <XAxis dataKey="month" hide />
                  <YAxis domain={series.domain} hide />
                  <Tooltip
                    labelStyle={{ color: '#667085', fontSize: '12px' }}
                    contentStyle={{
                      borderRadius: '6px',
                      border: '1px solid #d9dee7',
                      boxShadow: 'none',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={SERIES_COLORS[series.currency]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      </div>

      <div className="chart-card chart-card-full dashboard-chart-card">
        <h3>최근 30일 추이</h3>
        <div className="small-multiple-row">
          {dailySeriesByCurrency.map((series) => (
            <div key={`daily-${series.currency}`} className="small-chart-card">
              <h4>{series.currency}</h4>
              <ResponsiveContainer width="100%" height={118}>
                <LineChart data={series.points}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eceff3" />
                  <XAxis dataKey="day" hide />
                  <YAxis domain={series.domain} hide />
                  <Tooltip
                    labelStyle={{ color: '#667085', fontSize: '12px' }}
                    contentStyle={{
                      borderRadius: '6px',
                      border: '1px solid #d9dee7',
                      boxShadow: 'none',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={SERIES_COLORS[series.currency]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      </div>
    </div>
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

export default Dashboard
