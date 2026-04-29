import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCellValue } from '../lib/formatters'
import type {
  CurrencyCode,
  DashboardFilters,
  DailyRate,
  ExchangeRateDataset,
} from '../types/exchangeRate'
import { MONTHS } from '../types/exchangeRate'

interface CurrencyDetailProps {
  data: ExchangeRateDataset
  filters: DashboardFilters
}

function buildMatrix(
  rows: DailyRate[],
  currency: CurrencyCode,
  year: number,
  rateType: 'LOCAL_PER_USD' | 'KRW',
) {
  const filtered = rows.filter(
    (row) => row.currency === currency && row.year === year && row.rateType === rateType,
  )

  const dayRows = Array.from({ length: 31 }, (_, idx) => {
    const day = idx + 1

    const values = MONTHS.map((month) => {
      const value = filtered.find((row) => row.month === month && row.day === day)
      return value
    })

    return {
      day,
      values,
    }
  })

  return dayRows
}

function CurrencyDetail({ data, filters }: CurrencyDetailProps) {
  const defaultCurrency =
    filters.currency === 'ALL' ? 'BRL' : (filters.currency as CurrencyCode)
  const currency = defaultCurrency

  const [selectedMonth, setSelectedMonth] = useState(filters.month)

  useEffect(() => {
    setSelectedMonth(filters.month)
  }, [filters.month])

  const localMatrix = useMemo(
    () => buildMatrix(data.dailyRates, currency, filters.year, 'LOCAL_PER_USD'),
    [currency, data.dailyRates, filters.year],
  )

  const dailySeries = data.dailyRates
    .filter(
      (row) =>
        row.currency === currency &&
        row.year === filters.year &&
        row.month === selectedMonth &&
        row.rateType === 'LOCAL_PER_USD',
    )
    .map((row) => ({
      day: row.day,
      value: row.value ?? 0,
    }))

  const monthlyAvg = (rateType: 'LOCAL_PER_USD' | 'KRW', month: number) => {
    const row = data.monthlyRates.find(
      (item) =>
        item.currency === currency &&
        item.year === filters.year &&
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
              {MONTHS.map((month) => (
                <th key={`${rateType}-${month}`}>
                  <button
                    type="button"
                    className={selectedMonth === month ? 'month-chip active' : 'month-chip'}
                    onClick={() => setSelectedMonth(month)}
                  >
                    {month}월
                  </button>
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
              {MONTHS.map((month) => {
                const avg = monthlyAvg(rateType, month)
                return (
                  <td key={`${rateType}-avg-${month}`} className={avg?.status === 'zero' ? 'cell-zero' : ''}>
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
          {filters.year}년 {selectedMonth}월 일별 환율
        </h3>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={dailySeries}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" />
            <YAxis domain={(['auto', 'auto'] as const)} tickFormatter={(v: number) => v.toLocaleString()} width={80} />
            <Tooltip formatter={(v: any) => v.toLocaleString(undefined, { maximumFractionDigits: 4 })} />
            <Line type="monotone" dataKey="value" stroke="#1f3c88" strokeWidth={2} />
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
