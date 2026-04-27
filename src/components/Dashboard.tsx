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
  DashboardFilters,
  ExchangeRateDataset,
  MonthlyRate,
} from '../types/exchangeRate'

interface DashboardProps {
  data: ExchangeRateDataset
  filters: DashboardFilters
}

const KPI_CURRENCIES = ['USD', 'BRL', 'MXN', 'CLP', 'COP', 'PEN'] as const

const SERIES_COLORS = {
  USD: '#1f3c88',
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
  rateType: 'LOCAL_PER_USD' | 'KRW',
): MonthlyRate | undefined {
  return rows.find(
    (row) =>
      row.currency === currency &&
      row.year === year &&
      row.month === month &&
      row.rateType === rateType,
  )
}

function Dashboard({ data, filters }: DashboardProps) {
  const baseDate = new Date(data.baseDate)
  const latestYear = baseDate.getFullYear()
  const latestMonth = baseDate.getMonth() + 1

  const previousDate = new Date(latestYear, latestMonth - 2, 1)

  const kpis = KPI_CURRENCIES.map((currency) => {
    const isUsd = currency === 'USD'
    const rateType = isUsd ? 'KRW' : 'LOCAL_PER_USD'

    const current = getMonthly(
      data.monthlyRates,
      currency,
      latestYear,
      latestMonth,
      rateType,
    )

    const previous = getMonthly(
      data.monthlyRates,
      currency,
      previousDate.getFullYear(),
      previousDate.getMonth() + 1,
      rateType,
    )

    const currentValue = current?.value ?? null
    const previousValue = previous?.value ?? null

    const diff =
      currentValue !== null && previousValue !== null && previousValue !== 0
        ? (currentValue - previousValue) / previousValue
        : null

    return {
      currency,
      label: currency === 'USD' ? 'USD/KRW 최신 월평균' : `${currency} 최신 월평균`,
      valueText: formatCellValue(
        current?.value ?? null,
        current?.status ?? 'empty',
        currency === 'USD' ? 'KRW' : currency,
      ),
      diff,
    }
  })

  const localSeriesByCurrency = KPI_CURRENCIES.map((currency) => {
    const points = data.monthlyRates
      .filter(
        (row) =>
          row.rateType === 'LOCAL_PER_USD' &&
          row.currency === currency &&
          row.year >= filters.year - 2,
      )
      .sort((a, b) => (monthKey(a.year, a.month) > monthKey(b.year, b.month) ? 1 : -1))
      .map((row) => ({
        month: monthLabel(row.year, row.month),
        value: row.value,
      }))

    return {
      currency,
      points,
      domain: buildDomain(points.map((point) => point.value)),
    }
  })

  const krwSeriesByCurrency = KPI_CURRENCIES.map((currency) => {
    const points = data.monthlyRates
      .filter(
        (row) =>
          row.rateType === 'KRW' &&
          row.currency === currency &&
          row.year >= filters.year - 2,
      )
      .sort((a, b) => (monthKey(a.year, a.month) > monthKey(b.year, b.month) ? 1 : -1))
      .map((row) => ({
        month: monthLabel(row.year, row.month),
        value: row.value,
      }))

    return {
      currency,
      points,
      domain: buildDomain(points.map((point) => point.value)),
    }
  })

  const focusedCurrencies = ['BRL', 'MXN', 'CLP', 'COP', 'PEN'] as const

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

      <div className="kpi-grid">
        {kpis.map((kpi) => (
          <div key={kpi.currency} className="kpi-card">
            <span>{kpi.label}</span>
            <strong>{kpi.valueText}</strong>
            <em className={kpi.diff !== null && kpi.diff < 0 ? 'down' : 'up'}>
              {kpi.diff === null ? '-' : `${(kpi.diff * 100).toFixed(2)}% MoM`}
            </em>
          </div>
        ))}
      </div>

      <div className="chart-grid chart-grid-2">
        <article className="chart-card">
          <h3>통화별 Local per USD 월간 추이 (통화별 독립 스케일)</h3>
          <div className="small-multiple-grid">
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

        <article className="chart-card">
          <h3>KRW 기준 환산 환율 추이 (통화별 독립 스케일)</h3>
          <div className="small-multiple-grid">
            {krwSeriesByCurrency.map((series) => (
              <div key={`krw-${series.currency}`} className="small-chart-card">
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
