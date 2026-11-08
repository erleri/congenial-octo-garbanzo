import {validDate} from './core.js'
export const MARKET_ZONES=Object.freeze({BRL:'America/Sao_Paulo',MXN:'America/Mexico_City',CLP:'America/Santiago',
 COP:'America/Bogota',PEN:'America/Lima',ARS:'America/Argentina/Buenos_Aires'})
export function marketCalendarDate(value,currency) {
 if(!MARKET_ZONES[currency])return null
 if(validDate(value))return value
 if(typeof value!=='string'||!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))return null
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:MARKET_ZONES[currency],year:'numeric',month:'2-digit',day:'2-digit'})
  .formatToParts(new Date(value)).map(p=>[p.type,p.value]))
 return `${p.year}-${p.month}-${p.day}`
}
