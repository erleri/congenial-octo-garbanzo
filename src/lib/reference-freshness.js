// Shared dashboard/report freshness reminder. This is not an exchange calendar.
export const DEFAULT_FRESHNESS_CALENDAR = Object.freeze({timeZone:'UTC',closedDates:[],releaseHour:18,maxBusinessDays:2})
export function elapsedBusinessDays(from,to,closedDates=[]) {
 const start=Date.parse(from+'T00:00:00Z'),end=Date.parse(to+'T00:00:00Z')
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>end)return null
 let count=0
 for(let t=start+86400000;t<=end;t+=86400000){const d=new Date(t)
  if(![0,6].includes(d.getUTCDay())&&!closedDates.includes(d.toISOString().slice(0,10)))count++
 }
 return count
}
export function freshnessReferenceDate(now,calendar=DEFAULT_FRESHNESS_CALENDAR) {
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:calendar.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]))
 const date=`${p.year}-${p.month}-${p.day}`
 return Number(p.hour)<calendar.releaseHour?new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10):date
}
