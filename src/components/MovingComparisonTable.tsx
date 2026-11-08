import { useMemo } from 'react'
import { formatCellValue } from '../lib/formatters'
import { buildMovingComparisonRows } from '../lib/moving'
import type { BusinessPlan, ExchangeRateDataset, MovingColumn } from '../types/exchangeRate'

const COLUMNS: Array<{ key: MovingColumn; label: string }> = [
  {key:'KRW',label:'KRW'},{key:'BRL',label:'BRL'},{key:'COP',label:'COP'},
  {key:'CLP',label:'CLP'},{key:'PEN',label:'PEN'},{key:'ARS',label:'ARS'},
  {key:'MXN',label:'MXN'},{key:'PYG',label:'PYG'},{key:'GTQ',label:'GTQ'},
  {key:'UYU',label:'UYU'},{key:'CNY',label:'CNY'},{key:'OIL',label:'Oil'},
]
function formatMovingValue(value: number | null, column: MovingColumn, isPercent: boolean): string {
  if (column === 'OIL') {
    if(value===null)return '-'
    return isPercent?`${(value*100).toFixed(2)}%`:new Intl.NumberFormat('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value)
  }
  return formatCellValue(value,value!==null?'ok':'empty',column==='KRW'?'KRW':column,isPercent)
}
/** The public comparison and admin editor share the exact same calculations/table. */
export default function MovingComparisonTable({data,businessPlan}:{data:ExchangeRateDataset;businessPlan:BusinessPlan}) {
  const rows=useMemo(()=>{
    const baseDate=new Date(data.baseDate)
    return buildMovingComparisonRows(data,baseDate.getFullYear(),baseDate.getMonth()+1,businessPlan)
  },[data,businessPlan])
  return <>
    <p className="mobile-table-hint">표는 좌우로 이동해 전체 데이터를 확인할 수 있습니다.</p>
    <div className="moving-table-wrapper sticky-table-wrapper"><table className="dense-table">
      <thead><tr><th rowSpan={2}>항목</th><th colSpan={COLUMNS.length}>통화별 환율</th></tr><tr>{COLUMNS.map(col=><th key={col.key}>{col.label}</th>)}</tr></thead>
      <tbody>{rows.map(row=><tr key={row.label} className={row.isPercent?'row-percent':''}><td style={{whiteSpace:'nowrap',fontWeight:row.isPercent?650:450}}>{row.label}</td>{COLUMNS.map(col=><td key={`${row.label}-${col.key}`}>{formatMovingValue(row.values[col.key],col.key,row.isPercent)}</td>)}</tr>)}</tbody>
    </table></div>
    <p className="table-help" style={{marginTop:10}}>계획 환율을 입력하지 않은 통화는 최근 3개월 평균값으로 자동 계산합니다.</p>
  </>
}
