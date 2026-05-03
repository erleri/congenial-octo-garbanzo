import { useMemo } from 'react'
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
import { formatCellValue } from '../lib/formatters'
import type {
  CurrencyCode,
  CurrencyFilter,
  DailyRate,
  ExchangeRateDataset,
} from '../types/exchangeRate'
import { MONTHS, YEARS } from '../types/exchangeRate'

interface CurrencyDetailProps {
  data: ExchangeRateDataset
  currencyFilter: CurrencyFilter
  periodFrom: string
  periodTo: string
}

function periodToNumber(period: string): number {
  const [yearText, monthText] = period.split('-')
  return Number(yearText) * 100 + Number(monthText)
}

function buildMatrix(
  rows: DailyRate[],
  currency: CurrencyCode,
  rateType: 'LOCAL_PER_USD' | 'KRW',
  monthColumns: Array<{ year: number; month: number }>,
) {
  const filtered = rows.filter((row) => row.currency === currency && row.rateType === rateType)

  return Array.from({ length: 31 }, (_, idx) => {
    const day = idx + 1
    const values = monthColumns.map(({ year, month }) =>
      filtered.find((row) => row.year === year && row.month === month && row.day === day),
    )

    return {
      day,
      values,
    }
  })
}

type MatrixRow = ReturnType<typeof buildMatrix>[number]

function getTooltipSource(item: unknown): string {
  if (typeof item !== 'object' || item === null || !('payload' in item)) {
    return 'API'
  }

  const payload = (item as { payload?: { source?: unknown } }).payload
  return payload?.source === 'IMPUTED' ? '보정' : 'API'
}

function CurrencyDetail({ data, currencyFilter, periodFrom, periodTo }: CurrencyDetailProps) {
  const currency = currencyFilter === 'ALL' ? 'BRL' : (currencyFilter as CurrencyCode)

  const fromValue = periodFrom ? periodToNumber(periodFrom) : 0
  const toValue = periodTo ? periodToNumber(periodTo) : Number.MAX_SAFE_INTEGER

  const monthColumns = useMemo(() => {
    const rangeSet = new Set<string>()

    for (const row of data.dailyRates) {
      if (row.currency !== currency || row.rateType !== 'LOCAL_PER_USD') {
        continue
      }

      const ym = row.year * 100 + row.month
      if (ym >= fromValue && ym <= toValue) {
        rangeSet.add(`${row.year}-${String(row.month).padStart(2, '0')}`)
      }
    }

    const listed = [...rangeSet]
      .map((period) => {
        const [yearText, monthText] = period.split('-')
        return { year: Number(yearText), month: Number(monthText), value: periodToNumber(period) }
      })
      .sort((a, b) => a.value - b.value)
      .map(({ year, month }) => ({ year, month }))

    if (listed.length > 0) {
      return listed
    }

    return [...YEARS]
      .flatMap((year) => MONTHS.map((month) => ({ year, month, value: year * 100 + month })))
      .filter((item) => item.value >= fromValue && item.value <= toValue)
      .map(({ year, month }) => ({ year, month }))
  }, [currency, data.dailyRates, fromValue, toValue])

  const localMatrix = useMemo(
    () => buildMatrix(data.dailyRates, currency, 'LOCAL_PER_USD', monthColumns),
    [currency, data.dailyRates, monthColumns],
  )

  const dailySeries = useMemo(
    () =>
      data.dailyRates
        .filter((row) => {
          const ym = row.year * 100 + row.month
          return row.currency === currency && row.rateType === 'LOCAL_PER_USD' && ym >= fromValue && ym <= toValue
        })
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((row) => ({
          ts: new Date(`${row.date}T00:00:00Z`).getTime(),
          fullDate: row.date,
          value: typeof row.value === 'number' ? row.value : null,
          source: row.source,
        })),
    [currency, data.dailyRates, fromValue, toValue],
  )

  const periodAverage = useMemo(() => {
    const values = dailySeries
      .map((item) => item.value)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

    if (!values.length) {
      return null
    }

    const sum = values.reduce((acc, value) => acc + value, 0)
    return sum / values.length
  }, [dailySeries])

  const monthlyAvg = (rateType: 'LOCAL_PER_USD' | 'KRW', year: number, month: number) => {
    return data.monthlyRates.find(
      (item) =>
        item.currency === currency &&
        item.year === year &&
        item.month === month &&
        item.rateType === rateType,
    )
  }

  const renderMatrix = (rateType: 'LOCAL_PER_USD' | 'KRW') => {
    const matrix: MatrixRow[] = rateType === 'LOCAL_PER_USD' ? localMatrix : []

    return (
      <div className="table-scroll">
        <table className="dense-table">
          <thead>
            <tr>
              <th>일자</th>
              {monthColumns.map(({ year, month }) => (
                <th key={`${rateType}-${year}-${month}`}>
                  {String(year).slice(2)}.{String(month).padStart(2, '0')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={`${rateType}-day-${row.day}`}>
                <td>{row.day}</td>
                {row.values.map((item, idx) => {
                  const classes = [item?.status === 'zero' ? 'cell-zero' : '']

                  if (item?.source === 'IMPUTED' && item?.imputationMethod === 'FFILL') {
                    classes.push('cell-imputed')
                  }

                  return (
                    <td key={`${rateType}-day-${row.day}-month-${idx + 1}`} className={classes.filter(Boolean).join(' ')}>
                      {formatCellValue(
                        item?.value ?? null,
                        item?.status ?? 'empty',
                        rateType === 'KRW' ? 'KRW' : currency,
                      )}
                      {item?.source === 'IMPUTED' && item?.imputationMethod === 'FFILL' ? (
                        <span className="imputed-badge" title="휴일 또는 결측으로 전일값 보정">보</span>
                      ) : null}
                    </td>
                  )
                })}
              </tr>
            ))}
            <tr>
              <td>Avg.</td>
              {monthColumns.map(({ year, month }) => {
                const avg = monthlyAvg(rateType, year, month)
                return (
                  <td key={`${rateType}-avg-${year}-${month}`} className={avg?.status === 'zero' ? 'cell-zero' : ''}>
                    {formatCellValue(
                      avg?.value ?? null,
                      avg?.status ?? 'empty',
                      rateType === 'KRW' ? 'KRW' : currency,
                    )}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2>일별 추이</h2>
          <p className="table-help">{currency} 기준 일별 환율과 기간 평균입니다.</p>
        </div>
      </div>

      <div className="chart-card">
        <h3>{periodFrom} ~ {periodTo} 일별 환율</h3>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={dailySeries}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eceff3" />
            <XAxis
              type="number"
              dataKey="ts"
              scale="time"
              domain={['dataMin', 'dataMax']}
              minTickGap={22}
              tickFormatter={(value: number) => {
                const date = new Date(value)
                return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
              }}
            />
            <YAxis domain={(['auto', 'auto'] as const)} tickFormatter={(v: number) => v.toLocaleString()} width={80} />
            <Tooltip
              labelFormatter={(_label, payload) => payload?.[0]?.payload?.fullDate ?? ''}
              formatter={(value: unknown, _name: unknown, item: unknown) => {
                const formatted = typeof value === 'number'
                  ? value.toLocaleString(undefined, { maximumFractionDigits: 4 })
                  : String(value ?? '')

                const source = getTooltipSource(item)
                return [formatted, `일별 환율 (${source})`]
              }}
              contentStyle={{
                borderRadius: '6px',
                border: '1px solid #d9dee7',
                boxShadow: 'none',
              }}
            />
            {periodAverage !== null ? (
              <ReferenceLine
                y={periodAverage}
                stroke="#93691d"
                strokeDasharray="5 5"
                label={{
                  value: `평균 ${periodAverage.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
                  position: 'insideTopRight',
                  fill: '#93691d',
                  fontSize: 11,
                }}
              />
            ) : null}
            <Line type="monotone" dataKey="value" stroke="#1f2a44" strokeWidth={2} dot={false} activeDot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="table-card" style={{ marginTop: 12 }}>
        <h3>일별 환율표</h3>
        <p className="table-help">표시: <span className="imputed-badge">보</span> = 휴일 또는 결측 보정값</p>
        <p className="mobile-table-hint">표를 좌우로 이동해 전체 데이터를 확인할 수 있습니다.</p>
        {renderMatrix('LOCAL_PER_USD')}
      </div>
    </div>
  )
}

export default CurrencyDetail
