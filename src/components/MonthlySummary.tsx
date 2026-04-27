import { formatCellValue } from '../lib/formatters'
import type {
  CurrencyFilter,
  ExchangeRateDataset,
  MonthlyRate,
} from '../types/exchangeRate'
import { CURRENCIES, MONTHS, YEARS } from '../types/exchangeRate'

interface MonthlySummaryProps {
  data: ExchangeRateDataset
  currencyFilter: CurrencyFilter
}

function pickRows(
  monthlyRates: MonthlyRate[],
  rateType: 'LOCAL_PER_USD' | 'KRW',
  currencyFilter: CurrencyFilter,
): MonthlyRate[] {
  return monthlyRates.filter((row) => {
    if (row.rateType !== rateType) {
      return false
    }

    if (currencyFilter === 'ALL') {
      return true
    }

    return row.currency === currencyFilter
  })
}

function renderMatrix(
  rows: MonthlyRate[],
  rateType: 'LOCAL_PER_USD' | 'KRW',
  currencyFilter: CurrencyFilter,
) {
  const activeCurrencies =
    currencyFilter === 'ALL' ? CURRENCIES : [currencyFilter]

  return (
    <div className="table-scroll">
      <table className="dense-table">
        <thead>
          <tr>
            <th rowSpan={2}>Currency</th>
            {YEARS.map((year) => (
              <th key={`year-${year}`} colSpan={12}>
                {year}
              </th>
            ))}
          </tr>
          <tr>
            {YEARS.flatMap((year) =>
              MONTHS.map((month) => (
                <th key={`${year}-${month}`}>{month}월</th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {activeCurrencies.map((currency) => (
            <tr key={`${rateType}-${currency}`}>
              <td>{currency}</td>
              {YEARS.flatMap((year) =>
                MONTHS.map((month) => {
                  const row = rows.find(
                    (item) =>
                      item.currency === currency &&
                      item.year === year &&
                      item.month === month,
                  )

                  const className = row?.status === 'zero' ? 'cell-zero' : ''

                  return (
                    <td key={`${currency}-${year}-${month}`} className={className}>
                      {formatCellValue(
                        row?.value ?? null,
                        row?.status ?? 'empty',
                        rateType === 'KRW' ? 'KRW' : currency,
                      )}
                    </td>
                  )
                }),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MonthlySummary({ data, currencyFilter }: MonthlySummaryProps) {
  const localRows = pickRows(data.monthlyRates, 'LOCAL_PER_USD', currencyFilter)
  const krwRows = pickRows(data.monthlyRates, 'KRW', currencyFilter)

  const rawSummary = data.rawSheets.find((sheet) => sheet.name === 'Summary')

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Monthly Summary</h2>
      </div>

      <article className="table-card">
        <h3>Local per USD 월별 환율</h3>
        {renderMatrix(localRows, 'LOCAL_PER_USD', currencyFilter)}
      </article>

      <article className="table-card">
        <h3>KRW 월별 환율</h3>
        {renderMatrix(krwRows, 'KRW', currencyFilter)}
      </article>

      <article className="table-card">
        <h3>원본 형태 (Summary)</h3>
        <div className="table-scroll">
          <table className="dense-table">
            <thead>
              <tr>
                {(rawSummary?.headers ?? []).map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rawSummary?.rows ?? []).slice(0, 500).map((row, rowIndex) => (
                <tr key={`raw-${rowIndex}`}>
                  {(rawSummary?.headers ?? []).map((header) => (
                    <td key={`${rowIndex}-${header}`}>{String(row[header] ?? '-')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  )
}

export default MonthlySummary
