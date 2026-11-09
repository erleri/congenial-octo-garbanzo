import { CURRENCIES } from '../../types/exchangeRate'

/** Known machine tokens only; never rewrite saved prose or unknown definitions. */
export function readerText(text:string) {
  return text.replace(/\b([A-Z]{3})_per_USD\b/g,(token,currency:string)=>CURRENCIES.includes(currency as typeof CURRENCIES[number])?`${currency} / 1 USD`:token)
}
/** Explicit offsets only. Dates and unzoned values stay dates/unconverted text. */
export function readerTime(value:string|null|undefined,missing='시각 미기록') {
  if(!value)return missing
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return readerText(value)
  const timestamp=Date.parse(value)
  const [year,month,day]=value.slice(0,10).split('-').map(Number)
  if(!Number.isFinite(timestamp)||month<1||month>12||day<1||day>new Date(year,month,0).getDate())return readerText(value)
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(timestamp))
  const part=(type:string)=>parts.find(p=>p.type===type)?.value
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')} KST`
}
