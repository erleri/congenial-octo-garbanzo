import { useMemo } from 'react'
import { comparisonPresentationRows } from '../lib/comparisonPresentation'
import { formatCellValue } from '../lib/formatters'
import { buildMovingComparisonRows } from '../lib/moving'
import type { BusinessPlan, ExchangeRateDataset, MovingColumn, MovingComparisonRow } from '../types/exchangeRate'

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
/** Admin keeps the original combined view; readers see results before daily detail. */
export default function MovingComparisonTable({data,businessPlan,presentation='combined'}:{data:ExchangeRateDataset;businessPlan:BusinessPlan;presentation?:'combined'|'summary-first'}) {
  const rows=useMemo(()=>{
    const [year,month]=data.baseDate.split('-').map(Number)
    return buildMovingComparisonRows(data,year,month,businessPlan)
  },[data,businessPlan])
  const groups=comparisonPresentationRows(rows,data.baseDate)
  const table=(items:MovingComparisonRow[],label:string)=><div className="moving-table-wrapper sticky-table-wrapper" tabIndex={0} role="region" aria-label={label}><table className="dense-table">
    <caption className="sr-only">{label}</caption>
    <thead>{presentation==='summary-first'?<tr><th scope="col">항목</th>{COLUMNS.map(col=><th scope="col" key={col.key}>{col.label}</th>)}</tr>:<><tr><th scope="col" rowSpan={2}>항목</th><th scope="colgroup" colSpan={COLUMNS.length}>통화별 환율</th></tr><tr>{COLUMNS.map(col=><th scope="col" key={col.key}>{col.label}</th>)}</tr></>}</thead>
    <tbody>{items.map(row=><tr key={row.label} className={row.isPercent?'row-percent':''}><th scope="row" style={{whiteSpace:'nowrap',fontWeight:row.isPercent?650:450}}>{row.label}</th>{COLUMNS.map(col=><td key={`${row.label}-${col.key}`}>{formatMovingValue(row.values[col.key],col.key,row.isPercent)}</td>)}</tr>)}</tbody>
  </table></div>
  return <div className={presentation==='summary-first'?'comparison-summary-first':'comparison-combined'}>
    <p className="mobile-table-hint">표는 좌우로 이동해 전체 데이터를 확인할 수 있습니다.</p>
    {presentation==='summary-first'?<>
      {table(groups.summary,'평균·계획 대비 요약')}
      <details key={data.baseDate} className="comparison-daily-details"><summary>일자별 상세 <span>{data.baseDate.slice(0,7)}</span></summary>{table(groups.daily,'일자별 환율 상세')}</details>
    </>:table(rows,'평균·계획 대비 전체 비교')}
    <p className="table-help" style={{marginTop:10}}>계획 환율을 입력하지 않은 통화는 최근 3개월 평균값으로 자동 계산합니다.</p>
  </div>
}
