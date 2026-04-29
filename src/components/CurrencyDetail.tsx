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

  const dayRows = Array.from({ length: 31 }, (_, idx) => {
    const day = idx + 1

    const values = monthColumns.map(({ year, month }) => {
      const value = filtered.find((row) => row.year === year && row.month === month && row.day === day)
      return value
    })

    return {
      day,
      values,
    }
  })

  return dayRows
}

function CurrencyDetail({ data, currencyFilter, periodFrom, periodTo }: CurrencyDetailProps) {
  const defaultCurrency =
    currencyFilter === 'ALL' ? 'BRL' : (currencyFilter as CurrencyCode)
  const currency = defaultCurrency

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
    () => {
      const filtered = data.dailyRates
        .filter((row) => {
          const ym = row.year * 100 + row.month
          return row.currency === currency && row.rateType === 'LOCAL_PER_USD' && ym >= fromValue && ym <= toValue
        })
        .sort((a, b) => a.date.localeCompare(b.date))

      return filtered.map((row) => {
        return {
          ts: new Date(`${row.date}T00:00:00Z`).getTime(),
          fullDate: row.date,
          value: typeof row.value === 'number' ? row.value : null,
          source: row.source,
        }
      })
    },
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
    const row = data.monthlyRates.find(
      (item) =>
        item.currency === currency &&
        item.year === year &&
        item.month === month &&
        item.rateType === rateType,
    )

    return row
  }

  const renderMatrix = (rateType: 'LOCAL_PER_USD' | 'KRW') => {
    const matrix = rateType === 'LOCAL_PER_USD' ? localMatrix : []

    return (
      <div className="table-scroll">
        <table className="dense-table">
          <thead>
            <tr>
              <th>Day</th>
              {monthColumns.map(({ year, month }) => (
                <th key={`${rateType}-${year}-${month}`}>
                  {String(year).slice(2)}.{String(month).padStart(2, '0')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row: any) => (
              <tr key={`${rateType}-day-${row.day}`}>
                <td>{row.day}</td>
                {row.values.map((item: any, idx: number) => {
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
                        <span className="imputed-badge" title="휴일/결측으로 전일값 보정">휴</span>
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
    <section className="panel">
      <div className="panel-header">
        <h2>Daily Trend</h2>
      </div>

      <article className="chart-card">
        <h3>
          {periodFrom} ~ {periodTo} 일별 환율
        </h3>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={dailySeries}>
            <CartesianGrid strokeDasharray="3 3" />
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
              formatter={(value: any, _name: any, item: any) => {
                const formatted = typeof value === 'number'
                  ? value.toLocaleString(undefined, { maximumFractionDigits: 4 })
                  : value

                const source = item?.payload?.source === 'IMPUTED' ? '보정' : 'API'
                return [formatted, `일별 환율 (${source})`]
              }}
            />
            {periodAverage !== null ? (
              <ReferenceLine
                y={periodAverage}
                stroke="#b34a4a"
                strokeDasharray="5 5"
                label={{ value: `평균 ${periodAverage.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, position: 'insideTopRight', fill: '#8f3d3d', fontSize: 11 }}
              />
            ) : null}
            <Line type="monotone" dataKey="value" stroke="#1f3c88" strokeWidth={2} dot={false} activeDot={false} />
          </LineChart>
        </ResponsiveContainer>
      </article>

      <article className="table-card">
        <h3>Exchange Rate (1 Dollar Exchange Rate)</h3>
        <p className="table-help">표시: <span className="imputed-badge">휴</span> = 휴일/결측으로 전일값 보정</p>
        <p className="mobile-table-hint">모바일에서는 표를 좌우로 밀어 전체 데이터를 볼 수 있습니다.</p>
        {renderMatrix('LOCAL_PER_USD')}
      </article>
    </section>
  )
}

export default CurrencyDetail
