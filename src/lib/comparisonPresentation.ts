import type { MovingComparisonRow } from '../types/exchangeRate'

/** Presentation groups retain the shared calculation and stored row shape. */
export function comparisonPresentationRows(rows:MovingComparisonRow[],baseDate:string) {
  const year=Number(baseDate.slice(0,4)),month=Number(baseDate.slice(5,7)),day=Number(baseDate.slice(8,10))
  const daysInMonth=new Date(year,month,0).getDate()
  const summary:MovingComparisonRow[]=[],daily:MovingComparisonRow[]=[]
  for(const row of rows){
    const match=/^(\d{1,2})일$/.exec(row.label)
    if(!match){summary.push(row);continue}
    const number=Number(match[1])
    if(number<1||number>daysInMonth)continue
    if(number>day&&!Object.values(row.values).some(v=>typeof v==='number'&&Number.isFinite(v)))continue
    daily.push(row)
  }
  return {summary,daily}
}
