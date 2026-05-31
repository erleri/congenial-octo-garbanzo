import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCellValue, monthLabel } from '../lib/formatters'
import type {
  BusinessPlan,
  CellStatus,
  CurrencyCode,
  DailyRate,
  DashboardFilters,
  ExchangeRateDataset,
  MonthlyRate,
} from '../types/exchangeRate'

interface DashboardProps {
  data: ExchangeRateDataset
  filters: DashboardFilters
  businessPlan: BusinessPlan
}

interface MiniChartPoint {
  value: number | null
  averageValue: number | null
  isLatest: boolean
  averageDeltaLabel?: string
}

interface DotProps {
  cx?: number
  cy?: number
  payload?: {
    isLatest?: boolean
  }
}

interface KpiSummary {
  currency: (typeof KPI_CURRENCIES)[number]
  cumulativeValue: number | null
  cumulativeStatus: CellStatus
  todayValue: number | null
  todayStatus: CellStatus
  todaySource: 'API' | 'EXCEL' | 'IMPUTED'
  dailyChange: number | null
  mom: number | null
  movingVs: number | null
  low52: number | null
  high52: number | null
  percent52: number
  tag: KpiTag
}

interface KpiTag {
  label: string
  tone: 'up' | 'down' | 'neutral' | 'edge'
  description: string
}

interface FocusItem {
  label: string
  value: string
  detail: string
  tone: 'up' | 'down' | 'neutral' | 'edge'
}

interface DailyChartSeries {
  currency: (typeof KPI_CURRENCIES)[number]
  points: Array<MiniChartPoint & { value: number | null }>
}

interface ChartNotes {
  mostChanged: string
  nearestEdge: string
  broadTone: string
}

const KPI_CURRENCIES = ['BRL', 'MXN', 'CLP', 'COP', 'ARS', 'PEN'] as const

const SERIES_COLORS = {
  BRL: '#2f6f5e',
  MXN: '#4f6f38',
  CLP: '#93691d',
  COP: '#70577a',
  ARS: '#8a4f2a',
  PEN: '#24706d',
} as const

const SOURCE_LABELS = {
  API: 'API',
  EXCEL: 'Excel',
  IMPUTED: '보정',
} as const

const CHART_GRID_STROKE = '#eef1f5'
const CHART_AVERAGE_STROKE = '#a8b0bd'
const CHART_TOOLTIP_STYLE = {
  borderRadius: '6px',
  border: '1px solid #d9dee7',
  boxShadow: 'none',
  color: '#111827',
  fontSize: '12px',
} as const
const CHART_LABEL_STYLE = {
  fill: '#8a94a3',
  fontSize: 9,
  fontWeight: 600,
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

function getMonthlyRate(
  rows: MonthlyRate[],
  currency: CurrencyCode,
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

function getDailyRate(
  rows: DailyRate[],
  currency: CurrencyCode,
  date: string,
  rateType: 'LOCAL_PER_USD' | 'KRW',
): DailyRate | undefined {
  return rows.find(
    (row) => row.currency === currency && row.date === date && row.rateType === rateType,
  )
}

function getPreviousDaily(
  rows: DailyRate[],
  currency: (typeof KPI_CURRENCIES)[number],
  date: string,
): DailyRate | undefined {
  return rows
    .filter(
      (row) =>
        row.currency === currency &&
        row.rateType === 'LOCAL_PER_USD' &&
        row.date < date &&
        typeof row.value === 'number',
    )
    .sort((a, b) => b.date.localeCompare(a.date))[0]
}

function formatChartRate(value: unknown, currency: (typeof KPI_CURRENCIES)[number]): string {
  return typeof value === 'number'
    ? formatCellValue(value, 'ok', currency)
    : String(value ?? '-')
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return '-'
  }

  return `${value >= 0 ? '+' : '-'}${Math.abs(value * 100).toFixed(2)}%`
}

function calculatePlanDelta(planValue: number | null | undefined, actualValue: number | null): number | null {
  if (
    typeof planValue !== 'number' ||
    typeof actualValue !== 'number' ||
    !Number.isFinite(planValue) ||
    !Number.isFinite(actualValue) ||
    actualValue === 0
  ) {
    return null
  }

  return (planValue - actualValue) / actualValue
}

function addMiniChartStats<T extends { value: number | null }>(points: T[]): Array<T & MiniChartPoint> {
  const values = points
    .map((point) => point.value)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const averageValue = average(values)
  let latestIndex = -1

  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (typeof points[index].value === 'number') {
      latestIndex = index
      break
    }
  }

  return points.map((point, index) => ({
    ...point,
    averageValue,
    isLatest: index === latestIndex,
  }))
}

function classifyKpiTag(mom: number | null, percent52: number): KpiTag {
  if (percent52 >= 85) {
    return {
      label: '고점권',
      tone: 'edge',
      description: '기준일 환율이 최근 52주 범위의 상단 구간에 있습니다.',
    }
  }

  if (percent52 <= 15) {
    return {
      label: '저점권',
      tone: 'edge',
      description: '기준일 환율이 최근 52주 범위의 하단 구간에 있습니다.',
    }
  }

  if (mom !== null && Math.abs(mom) >= 0.01) {
    return mom >= 0
      ? {
          label: '약세',
          tone: 'up',
          description: '52주 상·하단 구간은 아니며, MoM이 +1.00% 이상입니다.',
        }
      : {
          label: '강세',
          tone: 'down',
          description: '52주 상·하단 구간은 아니며, MoM이 -1.00% 이하입니다.',
        }
  }

  return {
    label: '범위권',
    tone: 'neutral',
    description: '52주 상·하단 구간은 아니며, MoM이 ±1.00% 미만입니다.',
  }
}

function buildFocusItems(kpis: KpiSummary[]): FocusItem[] {
  const items: FocusItem[] = []
  const biggestDailyMove = kpis
    .filter((kpi) => kpi.dailyChange !== null)
    .sort((a, b) => Math.abs(b.dailyChange ?? 0) - Math.abs(a.dailyChange ?? 0))[0]
  const biggestMomMove = kpis
    .filter((kpi) => kpi.mom !== null)
    .sort((a, b) => Math.abs(b.mom ?? 0) - Math.abs(a.mom ?? 0))[0]
  const rangeEdge = kpis
    .map((kpi) => ({
      ...kpi,
      edgeDistance: Math.min(kpi.percent52, 100 - kpi.percent52),
    }))
    .sort((a, b) => a.edgeDistance - b.edgeDistance)[0]

  if (biggestDailyMove?.dailyChange !== null && biggestDailyMove?.dailyChange !== undefined) {
    items.push({
      label: '가장 큰 일일 변동',
      value: `${biggestDailyMove.currency} ${formatPercent(biggestDailyMove.dailyChange)}`,
      detail: biggestDailyMove.dailyChange >= 0 ? 'USD 대비 약세 방향' : 'USD 대비 강세 방향',
      tone: biggestDailyMove.dailyChange >= 0 ? 'up' : 'down',
    })
  }

  if (biggestMomMove?.mom !== null && biggestMomMove?.mom !== undefined) {
    items.push({
      label: 'MoM 기준 주목 통화',
      value: `${biggestMomMove.currency} ${formatPercent(biggestMomMove.mom)}`,
      detail: '당월 평균과 전월 평균 비교',
      tone: biggestMomMove.mom >= 0 ? 'up' : 'down',
    })
  }

  if (rangeEdge) {
    const isHigh = rangeEdge.percent52 >= 50
    items.push({
      label: '52주 범위상 위치',
      value: `${rangeEdge.currency} ${Math.round(rangeEdge.percent52)}%`,
      detail: isHigh ? '고점권에 가까움' : '저점권에 가까움',
      tone: 'edge',
    })
  }

  return items.slice(0, 3)
}

function describeAveragePosition(
  latestValue: number | null | undefined,
  averageValue: number | null,
  currency: (typeof KPI_CURRENCIES)[number],
): string {
  if (typeof latestValue !== 'number' || typeof averageValue !== 'number' || averageValue === 0) {
    return '30일 평균 대비 확인 대기'
  }

  const diff = (latestValue - averageValue) / averageValue
  if (Math.abs(diff) < 0.001) {
    return `30일 평균 부근 ${formatChartRate(averageValue, currency)}`
  }

  return `30일 평균 대비 ${diff >= 0 ? '위' : '아래'} ${Math.abs(diff * 100).toFixed(2)}%`
}

function describeAverageDelta(
  value: number | null | undefined,
  averageValue: number | null,
): string | undefined {
  if (typeof value !== 'number' || typeof averageValue !== 'number' || averageValue === 0) {
    return undefined
  }

  const diff = (value - averageValue) / averageValue
  if (Math.abs(diff) < 0.001) {
    return '평균 부근'
  }

  return `평균 대비 ${diff >= 0 ? '위' : '아래'} ${Math.abs(diff * 100).toFixed(2)}%`
}

function getChartEdgeLabels(points: Array<{ day?: string; month?: string; value: number | null }>) {
  const first = points.find((point) => typeof point.value === 'number')
  const latest = points.findLast((point) => typeof point.value === 'number')

  return {
    start: first?.day ?? first?.month ?? '-',
    end: latest?.day ?? latest?.month ?? '-',
  }
}

function getTooltipAverageLabel(item: unknown): string {
  if (typeof item !== 'object' || item === null || !('payload' in item)) {
    return '환율'
  }

  const payload = (item as { payload?: { averageDeltaLabel?: unknown } }).payload
  return typeof payload?.averageDeltaLabel === 'string'
    ? `환율 · ${payload.averageDeltaLabel}`
    : '환율'
}

function getNumericPoints(points: Array<{ value: number | null }>) {
  return points
    .map((point) => point.value)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
}

function calculateChartChange(points: Array<{ value: number | null }>): number | null {
  const values = getNumericPoints(points)
  const first = values[0]
  const latest = values.at(-1)

  if (typeof first !== 'number' || typeof latest !== 'number' || first === 0) {
    return null
  }

  return (latest - first) / first
}

function calculateChartRangePosition(points: Array<{ value: number | null }>): number | null {
  const values = getNumericPoints(points)
  const latest = values.at(-1)

  if (typeof latest !== 'number' || values.length < 2) {
    return null
  }

  const min = Math.min(...values)
  const max = Math.max(...values)

  if (max <= min) {
    return null
  }

  return ((latest - min) / (max - min)) * 100
}

function buildDailyChartNotes(seriesList: DailyChartSeries[]): ChartNotes {
  const rows = seriesList.map((series) => ({
    currency: series.currency,
    change: calculateChartChange(series.points),
    rangePosition: calculateChartRangePosition(series.points),
  }))
  const mostChanged = rows
    .filter((row) => row.change !== null)
    .sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0))[0]
  const nearestEdge = rows
    .filter((row) => row.rangePosition !== null)
    .map((row) => ({
      ...row,
      edgeDistance: Math.min(row.rangePosition ?? 50, 100 - (row.rangePosition ?? 50)),
    }))
    .sort((a, b) => a.edgeDistance - b.edgeDistance)[0]
  const upCount = rows.filter((row) => row.change !== null && row.change >= 0).length
  const downCount = rows.filter((row) => row.change !== null && row.change < 0).length

  return {
    mostChanged: mostChanged?.change !== null && mostChanged?.change !== undefined
      ? `${mostChanged.currency} ${formatPercent(mostChanged.change)}`
      : '-',
    nearestEdge: nearestEdge?.rangePosition !== null && nearestEdge?.rangePosition !== undefined
      ? `${nearestEdge.currency} ${nearestEdge.rangePosition >= 50 ? '상단' : '하단'}`
      : '-',
    broadTone: `${upCount} 상승 / ${downCount} 하락`,
  }
}

function renderLatestDot(color: string) {
  return function LatestDot({ cx, cy, payload }: DotProps) {
    if (!payload?.isLatest || typeof cx !== 'number' || typeof cy !== 'number') {
      return null
    }

    return (
      <circle
        cx={cx}
        cy={cy}
        r={3}
        fill={color}
        stroke="#ffffff"
        strokeWidth={1.5}
      />
    )
  }
}

function Dashboard({ data, businessPlan }: DashboardProps) {
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

  const usdKrwMonthlyValues = data.dailyRates
    .filter(
      (row) =>
        row.currency === 'USD' &&
        row.rateType === 'KRW' &&
        row.year === latestYear &&
        row.month === latestMonth &&
        row.date <= baseDateText &&
        typeof row.value === 'number',
    )
    .map((row) => row.value as number)
  const usdKrwMtdAverage = average(usdKrwMonthlyValues)
  const usdKrwToday = getDailyRate(data.dailyRates, 'USD', baseDateText, 'KRW')
  const usdKrwPrevious = getMonthlyRate(
    data.monthlyRates,
    'USD',
    previousDate.getFullYear(),
    previousDate.getMonth() + 1,
    'KRW',
  )
  const usdKrwMom =
    typeof usdKrwMtdAverage === 'number' &&
    typeof usdKrwPrevious?.value === 'number' &&
    usdKrwPrevious.value !== 0
      ? (usdKrwMtdAverage - usdKrwPrevious.value) / usdKrwPrevious.value
      : null
  const usdKrwLastYearDaily = data.dailyRates
    .filter(
      (row) =>
        row.currency === 'USD' &&
        row.rateType === 'KRW' &&
        row.date >= oneYearAgoText &&
        row.date <= baseDateText &&
        typeof row.value === 'number',
    )
    .map((row) => row.value as number)
  const usdKrwLow52 = usdKrwLastYearDaily.length ? Math.min(...usdKrwLastYearDaily) : null
  const usdKrwHigh52 = usdKrwLastYearDaily.length ? Math.max(...usdKrwLastYearDaily) : null
  const usdKrwPercent52 =
    typeof usdKrwToday?.value === 'number' &&
    usdKrwLow52 !== null &&
    usdKrwHigh52 !== null &&
    usdKrwHigh52 > usdKrwLow52
      ? Math.max(0, Math.min(100, ((usdKrwToday.value - usdKrwLow52) / (usdKrwHigh52 - usdKrwLow52)) * 100))
      : 50

  const kpis: KpiSummary[] = KPI_CURRENCIES.map((currency) => {
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
    const previousDaily = getPreviousDaily(data.dailyRates, currency, baseDateText)
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
    const dailyChange =
      today?.value !== undefined &&
      today.value !== null &&
      previousDaily?.value !== undefined &&
      previousDaily.value !== null &&
      previousDaily.value !== 0
        ? (today.value - previousDaily.value) / previousDaily.value
        : null
    const movingVs = calculatePlanDelta(businessPlan.moving[currency], cumulativeValue)

    return {
      currency,
      cumulativeValue,
      cumulativeStatus,
      todayValue: today?.value ?? null,
      todayStatus: today?.status ?? 'empty',
      todaySource: today?.source ?? 'API',
      dailyChange,
      mom,
      movingVs,
      low52,
      high52,
      percent52,
      tag: classifyKpiTag(mom, percent52),
    }
  })

  const focusItems = buildFocusItems(kpis)
  const kpiByCurrency = new Map(kpis.map((kpi) => [kpi.currency, kpi]))

  const localSeriesByCurrency = KPI_CURRENCIES.map((currency) => {
    const monthlyMap = new Map<string, number | null>()

    data.monthlyRates
      .filter((row) => row.rateType === 'LOCAL_PER_USD' && row.currency === currency)
      .forEach((row) => {
        monthlyMap.set(monthKey(row.year, row.month), row.value)
      })

    const points = addMiniChartStats(recentMonths.map(({ year, month }) => ({
      month: monthLabel(year, month),
      value: monthlyMap.get(monthKey(year, month)) ?? null,
    }))).map((point) => ({
      ...point,
      averageDeltaLabel: describeAverageDelta(point.value, point.averageValue),
    }))
    const edgeLabels = getChartEdgeLabels(points)

    return {
      currency,
      points,
      averageValue: points[0]?.averageValue ?? null,
      movingVs: kpiByCurrency.get(currency)?.movingVs ?? null,
      edgeLabels,
      domain: buildDomain(points.map((point) => point.value)),
    }
  })

  const dailySeriesByCurrency = KPI_CURRENCIES.map((currency) => {
    const currencyDaily = data.dailyRates
      .filter((row) => row.rateType === 'LOCAL_PER_USD' && row.currency === currency)
      .sort((a, b) => a.date.localeCompare(b.date))

    const points = addMiniChartStats(currencyDaily.slice(-30).map((row) => ({
      day: `${row.month}/${row.day}`,
      value: row.value,
    }))).map((point) => ({
      ...point,
      averageDeltaLabel: describeAverageDelta(point.value, point.averageValue),
    }))
    const latestPoint = points.findLast((point) => typeof point.value === 'number')
    const edgeLabels = getChartEdgeLabels(points)

    return {
      currency,
      points,
      averageValue: points[0]?.averageValue ?? null,
      latestValue: latestPoint?.value ?? null,
      edgeLabels,
      domain: buildDomain(points.map((point) => point.value)),
    }
  })
  const dailyChartNotes = buildDailyChartNotes(dailySeriesByCurrency)

  return (
    <div className="dashboard-container">
      <div className="dashboard-meta">
        <span className="base-date-chip">기준일 {baseDateText}</span>
        <span className="data-pill">당월 누적 평균</span>
      </div>

      <div className="usd-krw-anchor">
        <div className="usd-krw-anchor-main">
          <span className="source-badge badge-api">기준 환율</span>
          <div>
            <h2>USD/KRW Anchor</h2>
            <p>원달러 기준 환율 · KRW 환산의 기준축</p>
          </div>
        </div>
        <div className="usd-krw-anchor-metrics">
          <div>
            <span>기준일 환율</span>
            <strong>{formatCellValue(usdKrwToday?.value ?? null, usdKrwToday?.status ?? 'empty', 'KRW')}</strong>
          </div>
          <div>
            <span>당월 누적 평균</span>
            <strong>{formatCellValue(usdKrwMtdAverage, usdKrwMtdAverage === null ? 'empty' : 'ok', 'KRW')}</strong>
          </div>
          <div>
            <span>MoM</span>
            <strong className={usdKrwMom === null ? '' : usdKrwMom >= 0 ? 'up' : 'down'}>
              {formatPercent(usdKrwMom)}
            </strong>
          </div>
          <div className="usd-krw-anchor-range">
            <span>52주 범위 내 위치</span>
            <div className="gauge-labels">
              <span>{formatCellValue(usdKrwLow52, usdKrwLow52 === null ? 'empty' : 'ok', 'KRW')}</span>
              <span>{formatCellValue(usdKrwHigh52, usdKrwHigh52 === null ? 'empty' : 'ok', 'KRW')}</span>
            </div>
            <div className="gauge-track">
              <div
                className="gauge-fill"
                style={{
                  width: `${usdKrwPercent52}%`,
                  backgroundColor: '#1f5fbf',
                }}
              />
              <div className="gauge-marker" style={{ left: `${usdKrwPercent52}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="today-focus-bar">
        <div className="today-focus-heading">
          <span className="source-badge badge-api">Today’s Focus</span>
          <strong>오늘의 주목 포인트</strong>
        </div>
        <div className="today-focus-content">
          <div className="today-focus-items">
            {focusItems.map((item) => (
              <div key={item.label} className={`today-focus-item focus-${item.tone}`}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <em>{item.detail}</em>
              </div>
            ))}
          </div>
        </div>
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
            <div className="kpi-main-row">
              <strong>{formatCellValue(kpi.cumulativeValue, kpi.cumulativeStatus, kpi.currency)}</strong>
              <span
                className={`kpi-insight-tag tag-${kpi.tag.tone}`}
                title={kpi.tag.description}
                aria-label={`${kpi.tag.label}: ${kpi.tag.description}`}
              >
                {kpi.tag.label}
              </span>
            </div>
            {kpi.mom !== null ? (
              <em className={kpi.mom >= 0 ? 'up' : 'down'}>
                {formatPercent(kpi.mom)} MoM
              </em>
            ) : (
              <em className="kpi-today">MoM -</em>
            )}
            {kpi.movingVs !== null ? (
              <em className={`kpi-plan-delta ${kpi.movingVs >= 0 ? 'up' : 'down'}`}>
                이동 대비 {formatPercent(kpi.movingVs)}
              </em>
            ) : null}
            <div className="gauge-container">
              <p className="kpi-today">
                기준일 환율 {formatCellValue(kpi.todayValue, kpi.todayStatus, kpi.currency)}
              </p>
              <div className="gauge-title">52주 범위 · 기준일 위치</div>
              <div className="gauge-labels">
                <span>{formatCellValue(kpi.low52, kpi.low52 === null ? 'empty' : 'ok', kpi.currency)}</span>
                <span>{formatCellValue(kpi.high52, kpi.high52 === null ? 'empty' : 'ok', kpi.currency)}</span>
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

      <p className="kpi-tag-note">
        태그 기준: 52주 상·하단 구간을 먼저 표시하고, 그 외에는 MoM ±1.00% 기준으로 강세/약세를 구분합니다.
      </p>

      <div className="chart-card chart-card-full dashboard-chart-card">
        <div className="section-title-row">
          <div>
            <h3>최근 30일 추이</h3>
            <p className="section-kicker">단기 움직임과 30일 평균선을 먼저 확인합니다.</p>
          </div>
        </div>
        <p className="chart-notes-strip">
          <strong>차트 노트</strong>
          <span>30일 최대 변동: {dailyChartNotes.mostChanged}</span>
          <span>범위 근접: {dailyChartNotes.nearestEdge}</span>
          <span>전체 방향: {dailyChartNotes.broadTone}</span>
        </p>
        <div className="small-multiple-row">
          {dailySeriesByCurrency.map((series) => (
            <div key={`daily-${series.currency}`} className="small-chart-card">
              <div className="small-chart-heading">
                <h4>{series.currency}</h4>
                <span>{describeAveragePosition(series.latestValue, series.averageValue, series.currency)}</span>
              </div>
              <ResponsiveContainer width="100%" height={118}>
                <LineChart data={series.points} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                  <CartesianGrid strokeDasharray="2 4" vertical={false} stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="day" hide />
                  <YAxis domain={series.domain} hide />
                  {series.averageValue !== null ? (
                    <ReferenceLine
                      y={series.averageValue}
                      stroke={CHART_AVERAGE_STROKE}
                      strokeDasharray="4 4"
                      strokeWidth={1}
                      label={{
                        value: `30D 평균 ${formatChartRate(series.averageValue, series.currency)}`,
                        position: 'insideTopRight',
                        ...CHART_LABEL_STYLE,
                      }}
                    />
                  ) : null}
                  <Tooltip
                    formatter={(value: unknown, _name: unknown, item: unknown) => [
                      formatChartRate(value, series.currency),
                      getTooltipAverageLabel(item),
                    ]}
                    labelStyle={{ color: '#667085', fontSize: '12px' }}
                    contentStyle={CHART_TOOLTIP_STYLE}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={SERIES_COLORS[series.currency]}
                    strokeWidth={2}
                    dot={renderLatestDot(SERIES_COLORS[series.currency])}
                    activeDot={{ r: 3, strokeWidth: 1, stroke: '#ffffff' }}
                  />
                </LineChart>
              </ResponsiveContainer>
              <div className="chart-edge-labels" aria-hidden="true">
                <span>{series.edgeLabels.start}</span>
                <span>{series.edgeLabels.end}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="chart-card chart-card-full dashboard-chart-card">
        <div className="section-title-row">
          <div>
            <h3>통화별 월간 추이</h3>
            <p className="section-kicker">단기 움직임을 더 긴 월간 흐름 안에서 확인합니다.</p>
          </div>
          <span className="section-range-label">{monthlyRangeLabel}</span>
        </div>
        <div className="small-multiple-row">
          {localSeriesByCurrency.map((series) => (
            <div key={`local-${series.currency}`} className="small-chart-card">
              <div className="small-chart-heading">
                <h4>{series.currency}</h4>
                {series.movingVs !== null ? (
                  <span className={series.movingVs >= 0 ? 'up' : 'down'}>
                    이동 대비 {formatPercent(series.movingVs)}
                  </span>
                ) : null}
              </div>
              <ResponsiveContainer width="100%" height={118}>
                <LineChart data={series.points} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                  <CartesianGrid strokeDasharray="2 4" vertical={false} stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="month" hide />
                  <YAxis domain={series.domain} hide />
                  {series.averageValue !== null ? (
                    <ReferenceLine
                      y={series.averageValue}
                      stroke={CHART_AVERAGE_STROKE}
                      strokeDasharray="4 4"
                      strokeWidth={1}
                      label={{
                        value: `24M 평균 ${formatChartRate(series.averageValue, series.currency)}`,
                        position: 'insideTopRight',
                        ...CHART_LABEL_STYLE,
                      }}
                    />
                  ) : null}
                  <Tooltip
                    formatter={(value: unknown, _name: unknown, item: unknown) => [
                      formatChartRate(value, series.currency),
                      getTooltipAverageLabel(item),
                    ]}
                    labelStyle={{ color: '#667085', fontSize: '12px' }}
                    contentStyle={CHART_TOOLTIP_STYLE}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={SERIES_COLORS[series.currency]}
                    strokeWidth={2}
                    dot={renderLatestDot(SERIES_COLORS[series.currency])}
                    activeDot={{ r: 3, strokeWidth: 1, stroke: '#ffffff' }}
                  />
                </LineChart>
              </ResponsiveContainer>
              <div className="chart-edge-labels" aria-hidden="true">
                <span>{series.edgeLabels.start}</span>
                <span>{series.edgeLabels.end}</span>
              </div>
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
