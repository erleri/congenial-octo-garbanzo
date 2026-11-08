import type { FxNavigation } from './fxNavigation'
import type { ReportCurrency } from '../types/currencyReport'
import { getReportClient, localReportMode } from './reports/client'
import { REPORT_CURRENCIES } from './currencyReportAccess'

export type UsageEvent = 'page_view'|'report_open'|'report_30s'|'evidence_open'|'dashboard_report'
export interface UsageInput {event:UsageEvent;screen:'dashboard'|'trends'|'reports';currency?:ReportCurrency;reportId?:string}
const events=new Set(['page_view','report_open','report_30s','evidence_open','dashboard_report'])
const seen=new Set<string>()
export function usagePayload(input:UsageInput) {
  if(!events.has(input.event)||!['dashboard','trends','reports'].includes(input.screen))return null
  if(input.currency&&!REPORT_CURRENCIES.includes(input.currency))return null
  if(input.reportId&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(input.reportId))return null
  if(['report_open','report_30s','evidence_open'].includes(input.event)&&(!input.reportId||!input.currency))return null
  return {p_event:input.event,p_screen:input.screen,p_currency:input.currency??'',p_report_id:input.reportId??''}
}
export async function recordUsage(input:UsageInput) {
  if(typeof window==='undefined'||window.top!==window||navigator.doNotTrack==='1')return
  const local=localReportMode()
  if(!local&&import.meta.env.VITE_USAGE_ENABLED!=='true')return
  if(!local&&['localhost','127.0.0.1','[::1]'].includes(location.hostname))return
  const payload=usagePayload(input)
  if(!payload)return
  const scope=local?'local':'production',key=JSON.stringify([scope,payload])
  if(seen.has(key))return
  if(seen.size>=256)seen.delete(seen.values().next().value!)
  seen.add(key)
  try {
    const client=await getReportClient(),session=await client.auth.getSession()
    // Signed-in readers/admins excluded; no identity is sent to the aggregate.
    if(session.error||session.data.session)return
    const response=await client.rpc('record_app_usage',{...payload,p_scope:scope})
    if(response.error)seen.delete(key)
  }catch{seen.delete(key)}
}
export function pageUsage(navigation:FxNavigation):UsageInput|null {
  if(navigation.screen==='admin'||navigation.screen==='plan')return null
  return {event:'page_view',screen:navigation.screen==='reports'?'reports':navigation.screen,
    ...(navigation.screen==='trends'&&REPORT_CURRENCIES.includes(navigation.currency as ReportCurrency)?{currency:navigation.currency as ReportCurrency}:{})}
}
