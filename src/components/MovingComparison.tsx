import { useMemo, useState } from 'react'
import { formatCellValue } from '../lib/formatters'
import { buildMovingComparisonRows } from '../lib/moving'
import type { ExchangeRateDataset, MovingColumn, BusinessPlan, CurrencyCode } from '../types/exchangeRate'
import { CURRENCIES } from '../types/exchangeRate'

interface MovingComparisonProps {
  data: ExchangeRateDataset
  businessPlan: BusinessPlan
  onUpdatePlan: (plan: BusinessPlan) => Promise<void>
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
  { key: 'OIL', label: '유가' },
]

const TARGET_CURRENCIES: CurrencyCode[] = ['USD', 'BRL', 'MXN', 'COP', 'CLP', 'PEN']
const REST_CURRENCIES: CurrencyCode[] = CURRENCIES.filter((currency) => !TARGET_CURRENCIES.includes(currency))

function formatMovingValue(value: number | null, column: MovingColumn, isPercent: boolean): string {
  if (column === 'OIL') {
    if (value === null) {
      return '-'
    }

    if (isPercent) {
      return `${(value * 100).toFixed(2)}%`
    }

    return new Intl.NumberFormat('ko-KR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  }

  return formatCellValue(value, value !== null ? 'ok' : 'empty', column === 'KRW' ? 'KRW' : column, isPercent)
}

function MovingComparison({ data, businessPlan, onUpdatePlan }: MovingComparisonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [tempPlan, setTempPlan] = useState<BusinessPlan>(businessPlan)

  const rows = useMemo(() => {
    const baseDate = new Date(data.baseDate)
    const year = baseDate.getFullYear()
    const month = baseDate.getMonth() + 1
    return buildMovingComparisonRows(data, year, month, businessPlan)
  }, [data, businessPlan])

  const openModal = () => {
    setTempPlan(businessPlan)
    setIsModalOpen(true)
  }

  const handlePlanChange = (type: 'leading' | 'moving', currency: CurrencyCode, valueStr: string) => {
    const value = valueStr === '' ? undefined : Number(valueStr)
    setTempPlan((prev) => ({
      ...prev,
      [type]: {
        ...prev[type],
        [currency]: value,
      },
    }))
  }

  const handleSave = async () => {
    await onUpdatePlan(tempPlan)
    setIsModalOpen(false)
  }

  const renderCurrencyRow = (currency: CurrencyCode, isTarget: boolean) => (
    <tr key={currency} style={{ opacity: isTarget ? 1 : 0.62 }}>
      <td>{currency === 'USD' ? 'USD (KRW)' : currency}</td>
      <td>
        <input
          type="number"
          step="0.0001"
          value={tempPlan.leading[currency] ?? ''}
          onChange={(event) => handlePlanChange('leading', currency, event.target.value)}
          placeholder="자동 평균"
        />
      </td>
      <td>
        <input
          type="number"
          step="0.0001"
          value={tempPlan.moving[currency] ?? ''}
          onChange={(event) => handlePlanChange('moving', currency, event.target.value)}
          placeholder="자동 평균"
        />
      </td>
    </tr>
  )

  return (
    <div className="panel">
      <div className="panel-header-inline">
        <div>
          <h2>계획 대비</h2>
          <p className="table-help">이동/선행 평균값과 실제 환율을 비교합니다.</p>
        </div>
        <button type="button" onClick={openModal} className="quiet-button">계획 환율 입력</button>
      </div>

      <p className="mobile-table-hint">표를 좌우로 이동해 전체 데이터를 확인할 수 있습니다.</p>
      <div className="moving-table-wrapper">
        <table className="dense-table">
          <thead>
            <tr>
              <th rowSpan={2}>항목</th>
              <th colSpan={COLUMNS.length}>통화별 환율</th>
            </tr>
            <tr>
              {COLUMNS.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className={row.isPercent ? 'row-percent' : ''}>
                <td style={{ whiteSpace: 'nowrap', fontWeight: row.isPercent ? 650 : 450 }}>
                  {row.label}
                </td>
                {COLUMNS.map((col) => {
                  const val = row.values[col.key]
                  return (
                    <td key={`${row.label}-${col.key}`}>
                      {formatMovingValue(val, col.key, row.isPercent)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="table-help" style={{ marginTop: 10 }}>
        계획 환율을 입력하지 않은 통화는 최근 3개월 평균값으로 자동 계산합니다.
      </p>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 650 }}>
            <h3>계획 환율 설정</h3>
            <p>
              각 통화의 USD 기준 계획 환율을 입력합니다. USD 항목에는 1 USD 기준 KRW 값을 입력합니다.
            </p>

            <div className="table-scroll" style={{ margin: '16px 0' }}>
              <table className="dense-table" style={{ minWidth: '100%' }}>
                <thead>
                  <tr>
                    <th>통화</th>
                    <th>선행 환율</th>
                    <th>이동 환율</th>
                  </tr>
                </thead>
                <tbody>
                  {TARGET_CURRENCIES.map((currency) => renderCurrencyRow(currency, true))}
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', color: '#667085' }}>
                      기타 통화
                    </td>
                  </tr>
                  {REST_CURRENCIES.map((currency) => renderCurrencyRow(currency, false))}
                </tbody>
              </table>
            </div>
            <div className="inline-controls" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" onClick={() => setIsModalOpen(false)} className="quiet-button">취소</button>
              <button type="button" onClick={handleSave} className="header-refresh-button">저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default MovingComparison
