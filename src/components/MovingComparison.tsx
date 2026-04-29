import { formatCellValue } from '../lib/formatters'
import type { ExchangeRateDataset, MovingColumn } from '../types/exchangeRate'

interface MovingComparisonProps {
  data: ExchangeRateDataset
}

const COLUMNS: Array<{ key: MovingColumn; label: string }> = [
  { key: 'KRW', label: 'KRW' },
  { key: 'BRL', label: 'BRL' },
  { key: 'COP', label: 'COP' },
  { key: 'CLP', label: 'CLP' },
  { key: 'PEN', label: 'PEN' },
  { key: 'ARS', label: 'ARS' },
  { key: 'MXN', label: 'MXN' },
  { key: 'PYG', label: 'PYG' },
  { key: 'GTQ', label: 'GTQ' },
  { key: 'UYU', label: 'UYU' },
  { key: 'CNY', label: 'CNY' },
  { key: 'OIL', label: '원유가(U$/bbl)' },
]

function MovingComparison({ data }: MovingComparisonProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Moving vs Actual</h2>
      </div>

      <p className="mobile-table-hint">모바일에서는 표를 좌우로 밀어 전체 데이터를 볼 수 있습니다.</p>
      <div className="table-scroll">
        <table className="dense-table">
          <thead>
            <tr>
              <th>항목</th>
              {COLUMNS.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.movingComparison.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                {COLUMNS.map((column) => {
                  const value = row.values[column.key]
                  const className =
                    row.isPercent && typeof value === 'number'
                      ? value >= 0
                        ? 'cell-up'
                        : 'cell-down'
                      : ''

                  return (
                    <td key={`${row.label}-${column.key}`} className={className}>
                      {formatCellValue(
                        value,
                        value === null ? 'empty' : 'ok',
                        column.key === 'KRW' ? 'KRW' : 'USD',
                        row.isPercent,
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default MovingComparison
