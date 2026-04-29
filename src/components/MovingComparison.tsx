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
  { key: 'OIL', label: '원유가(U$/bbl)' },
]

const TARGET_CURRENCIES: CurrencyCode[] = ['USD', 'BRL', 'MXN', 'COP', 'CLP', 'PEN']
const REST_CURRENCIES: CurrencyCode[] = CURRENCIES.filter(c => !TARGET_CURRENCIES.includes(c))

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
    setTempPlan(prev => ({
      ...prev,
      [type]: {
        ...prev[type],
        [currency]: value
      }
    }))
  }

  const handleSave = async () => {
    await onUpdatePlan(tempPlan)
    setIsModalOpen(false)
  }

  const renderCurrencyRow = (currency: CurrencyCode, isTarget: boolean) => (
    <tr key={currency} style={{ opacity: isTarget ? 1 : 0.6 }}>
      <td>{currency === 'USD' ? 'USD (원/달러)' : currency}</td>
      <td>
        <input 
          type="number" 
          step="0.0001"
          value={tempPlan.leading[currency] ?? ''}
          onChange={(e) => handlePlanChange('leading', currency, e.target.value)}
          style={{ width: '120px', padding: '4px', border: '1px solid #ccc', borderRadius: '4px' }}
          placeholder="미입력 시 평균값"
        />
      </td>
      <td>
        <input 
          type="number" 
          step="0.0001"
          value={tempPlan.moving[currency] ?? ''}
          onChange={(e) => handlePlanChange('moving', currency, e.target.value)}
          style={{ width: '120px', padding: '4px', border: '1px solid #ccc', borderRadius: '4px' }}
          placeholder="미입력 시 평균값"
        />
      </td>
    </tr>
  )

  return (
    <section className="panel">
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Moving vs Actual</h2>
        <button type="button" onClick={openModal} className="primary">계획 환율 입력</button>
      </div>

      <p className="mobile-table-hint">모바일에서는 표를 좌우로 밀어 전체 데이터를 볼 수 있습니다.</p>
      <div className="moving-table-wrapper">
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
            {rows.map((row) => (
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
      <p style={{ marginTop: '12px', fontSize: '12px', color: '#6a7790', fontWeight: 500 }}>
        * 계획 환율 미입력 시, 해당 통화의 선행 및 이동 환율은 주변 3개월 평균값으로 자동 계산됩니다.
      </p>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '650px', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3>선행 및 이동 계획 환율 설정 (당월 기준)</h3>
            <p style={{ margin: '8px 0', fontSize: '13px', color: '#5b6778' }}>
              각 국가별 환율을 달러(USD) 기준으로 입력해주세요. (예: 1 USD = 5.2 BRL)<br/>
              단, USD 항목에는 달러/원(KRW) 환율을 입력합니다. (예: 1 USD = 1400 KRW)
            </p>
            
            <div className="table-scroll" style={{ margin: '16px 0' }}>
              <table className="dense-table" style={{ minWidth: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                  <tr>
                    <th>통화</th>
                    <th>선행 환율 (Leading)</th>
                    <th>이동 환율 (Moving)</th>
                  </tr>
                </thead>
                <tbody>
                  {TARGET_CURRENCIES.map(currency => renderCurrencyRow(currency, true))}
                  <tr>
                    <td colSpan={3} style={{ background: '#f1f5f9', textAlign: 'center', fontSize: '11px', color: '#64748b', padding: '6px' }}>
                      기타 통화 (입력 불필요)
                    </td>
                  </tr>
                  {REST_CURRENCIES.map(currency => renderCurrencyRow(currency, false))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button type="button" onClick={() => setIsModalOpen(false)} style={{ padding: '6px 16px' }}>취소</button>
              <button type="button" onClick={handleSave} className="primary" style={{ padding: '6px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>저장</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default MovingComparison
