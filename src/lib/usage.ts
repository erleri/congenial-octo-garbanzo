import type { FxNavigation } from './fxNavigation'
import { parseFxNavigation } from './fxNavigation'
import type { ReportCurrency } from '../types/currencyReport'
import { getReportClient, localReportMode } from './reports/client'
import { REPORT_CURRENCIES } from './currencyReportAccess'

export type UsageEvent = 'page_view'|'email_entry'|'report_open'|'report_30s'|'evidence_open'|'dashboard_report'
export interface UsageInput {event:UsageEvent;screen:'dashboard'|'trends'|'reports';currency?:ReportCurrency;reportId?:string;view?:'daily'|'monthly'|'comparison'|''}
const events=new Set(['page_view','email_entry','report_open','report_30s','evidence_open','dashboard_report'])
export function usagePayload(input:UsageInput,entrySource='direct_or_unknown') {
 if(!events.has(input.event)||!['dashboard','trends','reports'].includes(input.screen))return null
 if(input.currency&&!REPORT_CURRENCIES.includes(input.currency))return null
 if(input.reportId&&!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(input.reportId))return null
 if(['report_open','report_30s','evidence_open'].includes(input.event)&&(!input.reportId||!input.currency||input.screen!=='reports'))return null
 if(input.event==='dashboard_report'&&(input.screen!=='reports'||!input.currency))return null
 if(input.view&&!['daily','monthly','comparison'].includes(input.view)||input.view&&input.screen!=='trends')return null
 return {p_event:input.event,p_screen:input.screen,p_currency:input.currency??'',p_report_id:input.reportId??'',p_view:input.view??'',
  p_entry_source:entrySource==='email'?'email':'direct_or_unknown'}
}
// The visit token never leaves memory. It coalesces effects/refreshes; a genuine
// route return starts a new view. No cookie, user ID, URL or device ID is stored.
export function createUsageRecorder(send:(payload:NonNullable<ReturnType<typeof usagePayload>>)=>Promise<boolean>) {
 const accepted=new Set<string>(),pending=new Set<string>();let visit='',generation=0
 return async(input:UsageInput|null,route:string,source:string)=>{
  if(route!==visit){visit=route;generation++;accepted.clear()}
  if(!input)return
  const payload=usagePayload(input,source);if(!payload)return
  const key=JSON.stringify([generation,payload])
  if(accepted.has(key)||pending.has(key))return
  pending.add(key)
  try{if(await send(payload)){accepted.add(key);if(accepted.size>256)accepted.delete(accepted.values().next().value!)}}catch{/* Viewing never depends on analytics. */}
  finally{pending.delete(key)}
 }
}
let entrySource:string|undefined,emailEntryAccepted=false,emailEntryPending=false
function source(){return entrySource??=(new URLSearchParams(location.search).get('entry')==='email'?'email':'direct_or_unknown')}
function routeKey(){const n=parseFxNavigation(location.hash),p=pageUsage(n);return JSON.stringify([p,n.screen==='reports'?location.hash.split('?')[0]:''])}
function allowed(){return typeof window!=='undefined'&&window.top===window&&navigator.doNotTrack!=='1'
 &&!(navigator as Navigator & {globalPrivacyControl?:boolean}).globalPrivacyControl&&!localReportMode()
 &&import.meta.env.VITE_USAGE_ENABLED==='true'&&location.hostname==='latamforex.netlify.app'}
async function send(payload:NonNullable<ReturnType<typeof usagePayload>>){
 const client=await getReportClient(),session=await client.auth.getSession()
 if(session.error||session.data.session)return false
 const response=await client.rpc('record_app_usage_v2',{...payload,p_scope:'production'})
 return !response.error&&response.data===true
}
const record=createUsageRecorder(send)
export async function recordUsage(input:UsageInput){if(allowed())await record(input,routeKey(),source())}
export async function recordPageUsage(navigation:FxNavigation){
 if(!allowed())return
 const input=pageUsage(navigation);if(!input){await record(null,JSON.stringify(navigation.screen),source());return}
 await recordUsage(input)
 if(source()==='email'&&!emailEntryAccepted&&!emailEntryPending){
  emailEntryPending=true
  try{emailEntryAccepted=await send(usagePayload({...input,event:'email_entry'},'email')!)}catch{/* retry at the next real view */}
  finally{emailEntryPending=false}
 }
}
export function pageUsage(navigation:FxNavigation):UsageInput|null {
 if(navigation.screen==='admin'||navigation.screen==='plan')return null
 const currency=navigation.screen==='trends'&&navigation.view==='monthly'?navigation.monthlyCurrency:navigation.currency
 return {event:'page_view',screen:navigation.screen,
  ...(navigation.screen==='trends'?{view:navigation.view,...(REPORT_CURRENCIES.includes(currency as ReportCurrency)?{currency:currency as ReportCurrency}:{})}:{})}
}
// Each continuous foreground interval must reach 30 seconds. A hidden tab
// resets the interval; automatic report status polling does not restart it.
export function observeReportDwell(doc:Pick<Document,'visibilityState'|'addEventListener'|'removeEventListener'>,onDwell:()=>void){
 let timer:ReturnType<typeof setTimeout>|undefined
 const arm=()=>{clearTimeout(timer);if(doc.visibilityState==='visible')timer=setTimeout(onDwell,30000)}
 arm();doc.addEventListener('visibilitychange',arm)
 return()=>{clearTimeout(timer);doc.removeEventListener('visibilitychange',arm)}
}
