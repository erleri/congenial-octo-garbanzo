import { useMemo, useState } from 'react'
import { formatCellValue } from '../lib/formatters'
import type { CurrencyFilter, ExchangeRateDataset } from '../types/exchangeRate'
import { CURRENCIES, MONTHS, YEARS } from '../types/exchangeRate'

interface MonthlySummaryProps {data:ExchangeRateDataset;currencyFilter:CurrencyFilter;yearFrom:number;yearTo:number}
export default function MonthlySummary({data,currencyFilter,yearFrom,yearTo}:MonthlySummaryProps) {
  const [unit,setUnit]=useState<'LOCAL_PER_USD'|'KRW'>('LOCAL_PER_USD')
  const currencies=currencyFilter==='ALL'?CURRENCIES:[currencyFilter]
  const periods=YEARS.filter(y=>y>=Math.min(yearFrom,yearTo)&&y<=Math.max(yearFrom,yearTo)).flatMap(year=>MONTHS.map(month=>({year,month,label:`${year}.${String(month).padStart(2,'0')}`})))
  // Preserve the previous first-match behavior, including duplicate historical rows.
  const values=useMemo(()=>{
    const index=new Map<string,ExchangeRateDataset['monthlyRates'][number]>()
    for(const row of data.monthlyRates){
      const key=`${row.rateType}:${row.currency}:${row.year}:${row.month}`
      if(!index.has(key))index.set(key,row)
    }
    return index
  },[data.monthlyRates])
  const cell=(rateType:'LOCAL_PER_USD'|'KRW',currency:typeof CURRENCIES[number],year:number,month:number)=>{
    const row=values.get(`${rateType}:${currency}:${year}:${month}`)
    return <td key={`${currency}:${year}:${month}`} className={row?.status==='zero'?'cell-zero':''}>{formatCellValue(row?.value??null,row?.status??'empty',rateType==='KRW'?'KRW':currency)}</td>
  }
  const hasValue=(period:typeof periods[number],type:'LOCAL_PER_USD'|'KRW')=>currencies.some(currency=>{
    const value=values.get(`${type}:${currency}:${period.year}:${period.month}`)?.value
    return typeof value==='number'&&Number.isFinite(value)
  })
  const baseMonth=data.baseDate?.slice(0,7).replace('-','.')??''
  const mobilePeriods=[...periods].filter(p=>!baseMonth||p.label<=baseMonth||hasValue(p,'LOCAL_PER_USD')||hasValue(p,'KRW')).reverse()
  const hasMobileData=mobilePeriods.some(p=>hasValue(p,unit))
  return <section className="panel monthly-results" aria-label="월별 평균 환율">
    <h2 className="sr-only">월평균 환율</h2>
    <div className="monthly-mobile-view">
      <div className="monthly-unit-switch" role="group" aria-label="월평균 환율 단위">{(['LOCAL_PER_USD','KRW'] as const).map(type=><button type="button" key={type} aria-pressed={unit===type} onClick={()=>setUnit(type)}>{type==='LOCAL_PER_USD'?'달러 기준':'원화 환산'}</button>)}</div>
      {currencyFilter==='ALL'&&<p className="mobile-table-hint">연월을 기준으로 통화 열을 좌우로 이동하세요.</p>}
      <div key={`${currencyFilter}:${yearFrom}:${yearTo}`} className="table-scroll monthly-row-scroll" tabIndex={0} role="region" aria-label={`월평균 연월표 · ${unit==='KRW'?'원화 환산':'달러 기준'}`}>{hasMobileData?<table className="monthly-row-table"><thead><tr><th scope="col">연월</th>{currencies.map(c=><th scope="col" key={c}>{unit==='KRW'?`${c}/KRW`:`${c}/USD`}</th>)}</tr></thead><tbody>{mobilePeriods.map(p=><tr key={p.label}><th scope="row">{p.label}</th>{currencies.map(c=>{const row=values.get(`${unit}:${c}:${p.year}:${p.month}`);return <td key={c} className={row?.status==='zero'?'cell-zero':''}>{row?.value===null||row?.value===undefined?'—':formatCellValue(row.value,row.status,unit==='KRW'?'KRW':c)}</td>})}</tr>)}</tbody></table>:<p className="monthly-empty" role="status">선택한 기간에 자료가 없습니다</p>}</div>
    </div>
    <div className="monthly-desktop-view">{(['LOCAL_PER_USD','KRW'] as const).map(type=><div className="table-card" key={type}><h3>{type==='LOCAL_PER_USD'?'달러 기준':'원화 환산'}</h3><div className="table-scroll" tabIndex={0} role="region" aria-label={`월평균 비교표 · ${type==='KRW'?'원화 환산':'달러 기준'}`}><table className="dense-table monthly-matrix"><thead><tr><th scope="col">통화</th>{periods.map(p=><th scope="col" key={p.label}>{p.label}</th>)}</tr></thead><tbody>{currencies.map(c=><tr key={c}><th scope="row">{c}</th>{periods.map(p=>cell(type,c,p.year,p.month))}</tr>)}</tbody></table></div></div>)}</div>
  </section>
}
