import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
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

    const currentValue = current?.value ?? null
    const previousValue = previous?.value ?? null

    const diff =
      currentValue !== null && previousValue !== null && previousValue !== 0
        ? (currentValue - previousValue) / previousValue
        : null

    return {
      currency,
      label: `${currency} 당월 누적 평균`,
      valueText: formatCellValue(cumulativeValue, cumulativeStatus, currency),
      todayText: formatCellValue(today?.value ?? null, today?.status ?? 'empty', currency),
      todayImputed: today?.source === 'IMPUTED' && today?.imputationMethod === 'FFILL',
      diff,
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

  const focusedCurrencies = KPI_CURRENCIES

  const normalizedTrend = focusedCurrencies
    .flatMap((currency) => {
      const rows = data.monthlyRates
        .filter(
          (row) =>
            row.currency === currency &&
            row.rateType === 'LOCAL_PER_USD' &&
            row.year === latestYear &&
            row.month <= latestMonth,
        )
        .sort((a, b) => a.month - b.month)

      const baseline = rows.find((row) => typeof row.value === 'number')?.value
      if (!baseline || baseline === 0) {
        return []
      }

      return rows.map((row) => ({
        month: `${row.month}월`,
        currency,
        index: row.value ? (row.value / baseline) * 100 : null,
      }))
    })

  const latestMomComparison = focusedCurrencies.map((currency) => {
    const current = getMonthly(data.monthlyRates, currency, latestYear, latestMonth, 'LOCAL_PER_USD')
    const previous = getMonthly(
      data.monthlyRates,
      currency,
      previousDate.getFullYear(),
      previousDate.getMonth() + 1,
      'LOCAL_PER_USD',
    )

    const delta =
      typeof current?.value === 'number' &&
      typeof previous?.value === 'number' &&
      previous.value !== 0
        ? ((current.value - previous.value) / previous.value) * 100
        : 0

    return {
      currency,
      delta,
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
              {kpi.todayImputed ? <span className="imputed-badge">휴</span> : null}
            </p>
            <em className={kpi.diff !== null && kpi.diff < 0 ? 'down' : 'up'}>
              {kpi.diff === null ? '-' : `${(kpi.diff * 100).toFixed(2)}% MoM`}
            </em>
          </div>
        ))}
      </div>

      <article className="chart-card chart-card-full">
        <h3>통화별 Local per USD 월간 추이</h3>
        <div className="small-multiple-row">
          {localSeriesByCurrency.map((series) => (
            <div key={`local-${series.currency}`} className="small-chart-card">
              <h4>{series.currency}</h4>
              <ResponsiveContainer width="100%" height={170}>
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
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      </article>

      <div className="chart-grid chart-grid-2 dashboard-lower-grid">
        <article className="chart-card">
          <h3>{latestYear}년 기준지수 추이 (1월=100)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={normalizedTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis domain={['auto', 'auto']} tickFormatter={formatAxisTick} />
              <Tooltip />
              <Legend />
              {focusedCurrencies.map((currency) => (
                <Line
                  key={`index-${currency}`}
                  type="monotone"
                  dataKey="index"
                  data={normalizedTrend.filter((row) => row.currency === currency)}
                  name={currency}
                  stroke={SERIES_COLORS[currency]}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </article>

        <article className="chart-card">
          <h3>최신월 전월 대비 변화율(MoM)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={latestMomComparison}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="currency" />
              <YAxis unit="%" tickFormatter={formatAxisTick} />
              <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
              <Bar dataKey="delta">
                {latestMomComparison.map((row) => (
                  <Cell
                    key={`mom-cell-${row.currency}`}
                    fill={row.delta >= 0 ? '#c43232' : '#1f5ac4'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </article>
      </div>
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
