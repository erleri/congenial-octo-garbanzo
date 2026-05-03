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
  yearFrom: number
  yearTo: number
  onCurrencyChange: (currency: CurrencyFilter) => void
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
  yearFrom: number,
  yearTo: number,
) {
  const activeCurrencies =
    currencyFilter === 'ALL' ? CURRENCIES : [currencyFilter]
  const fromYear = Math.min(yearFrom, yearTo)
  const toYear = Math.max(yearFrom, yearTo)

  const yearGroups = YEARS
    .map((year) => ({
      year,
      months: year >= fromYear && year <= toYear ? MONTHS : [],
    }))
    .filter((group) => group.months.length > 0)

  return (
    <>
      <p className="mobile-table-hint">표를 좌우로 이동해 전체 데이터를 확인할 수 있습니다.</p>
      <div className="table-scroll">
        <table className="dense-table">
          <thead>
            <tr>
              <th rowSpan={2}>통화</th>
              {yearGroups.map((group) => (
                <th key={`year-${group.year}`} colSpan={group.months.length}>
                  {group.year}
                </th>
              ))}
            </tr>
            <tr>
              {yearGroups.flatMap((group) =>
                group.months.map((month) => (
                  <th key={`${group.year}-${month}`}>{month}월</th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {activeCurrencies.map((currency) => (
              <tr key={`${rateType}-${currency}`}>
                <td>{currency}</td>
                {yearGroups.flatMap((group) =>
                  group.months.map((month) => {
                    const row = rows.find(
                      (item) =>
                        item.currency === currency &&
                        item.year === group.year &&
                        item.month === month,
                    )

                    const className = row?.status === 'zero' ? 'cell-zero' : ''

                    return (
                      <td key={`${currency}-${group.year}-${month}`} className={className}>
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
    </>
  )
}

function MonthlySummary({ data, currencyFilter, yearFrom, yearTo, onCurrencyChange }: MonthlySummaryProps) {
  const localRows = pickRows(data.monthlyRates, 'LOCAL_PER_USD', currencyFilter)
  const krwRows = pickRows(data.monthlyRates, 'KRW', currencyFilter)

  const rawSummary = data.rawSheets.find((sheet) => sheet.name === 'Summary')

  return (
    <div className="panel">
      <div className="panel-header-inline">
        <div>
          <h2>월별 내역</h2>
          <p className="table-help">선택한 기간과 통화의 월평균 환율입니다.</p>
        </div>
        <select
          value={currencyFilter}
          onChange={(event) => onCurrencyChange(event.target.value as CurrencyFilter)}
          aria-label="통화 필터"
        >
          <option value="ALL">전체 통화</option>
          {CURRENCIES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      <div className="table-card">
        <h3>Local per USD</h3>
        {renderMatrix(localRows, 'LOCAL_PER_USD', currencyFilter, yearFrom, yearTo)}
      </div>

      <div className="table-card" style={{ marginTop: 12 }}>
        <h3>KRW 환산</h3>
        {renderMatrix(krwRows, 'KRW', currencyFilter, yearFrom, yearTo)}
      </div>

      <div className="table-card" style={{ marginTop: 12 }}>
        <h3>원본 Summary</h3>
        <p className="mobile-table-hint">표를 좌우로 이동해 전체 데이터를 확인할 수 있습니다.</p>
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
      </div>
    </div>
  )
}

export default MonthlySummary
