export interface FreshnessCalendar {timeZone:string;closedDates:string[];releaseHour:number;maxBusinessDays:number}
export const DEFAULT_FRESHNESS_CALENDAR:FreshnessCalendar
export function elapsedBusinessDays(from:string,to:string,closedDates?:string[]):number|null
export function freshnessReferenceDate(now:number,calendar?:FreshnessCalendar):string
