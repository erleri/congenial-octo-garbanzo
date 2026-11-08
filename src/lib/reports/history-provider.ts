import type { SupabaseClient } from '@supabase/supabase-js'
import type { CurrencyReportSummary, ReportCurrency, ReportHistoryQuery, ReportResolution, ReportPeriod } from '../../types/currencyReport'
import { REPORT_CURRENCIES, approvedReport } from '../currencyReportAccess'
import { cursorKey, decodeReportCursor, PUBLIC_REPORT_ID, validReportDate } from '../reportHistory'
import { REPORT_DATA_POLICY } from '../report-data-policy.js'
import { getReportClient } from './client'
import { withConnectionDeadline } from './connection-deadline'
import { latestCurrencySummary, currencyReportPage, currencyReportPeriods, currencyReportNeighbors, resolveCurrencyReport } from './report-queries'

export interface CachedReportResult<T> { data:T; cached:boolean; checkedAt:number }
interface Entry { version:1; checkedAt:number; usedAt:number; category:'body'|'page'|'meta'; data:unknown }
const prefix='latamfx:public-report-history:v1:'
const blocked=new Map<string,ReportResolution>()
const bytes=(value:string)=>new TextEncoder().encode(value).byteLength
function keys() { try { return Array.from({length:sessionStorage.length},(_,i)=>sessionStorage.key(i)!).filter(k=>k?.startsWith(prefix+'cache:')) } catch { return [] } }
function remove(key:string) { try { sessionStorage.removeItem(key) } catch { /* optional cache */ } }
function read(key:string):Entry|null { try { const e=JSON.parse(sessionStorage.getItem(key)??'null'); return e?.version===1?e:null } catch { return null } }
export function trimReportCache(now=Date.now()) {
  const entries=keys().flatMap(key=>{const e=read(key);if(!e||now-e.checkedAt<0||now-e.checkedAt>REPORT_DATA_POLICY.publicCacheMs){remove(key);return []}return [{key,e,size:bytes(JSON.stringify(e))+bytes(key)}]})
    .sort((a,b)=>b.e.usedAt-a.e.usedAt)
  const count={body:0,page:0,meta:0};let total=0
  for(const {key,e,size} of entries){count[e.category]++;if(count[e.category]>(e.category==='body'?10:12)||total+size>5*1024*1024)remove(key);else total+=size}
}
function known(id:string) {
  if(blocked.has(id))return blocked.get(id)
  try { const value=JSON.parse(sessionStorage.getItem(prefix+'state:'+id)??'null') as ReportResolution|null
    if(value?.id===id&&['withdrawn','superseded'].includes(value.state)){blocked.set(id,value);return value}
  }catch { /* no persistent state */ }
}
function safeData<T>(data:T):T {
  if(!data||typeof data!=='object')return data
  if('state' in data){const resolution=data as unknown as ReportResolution
    const previous=resolution.id?known(resolution.id):undefined
    if(previous&&(resolution.state==='active'||(previous.version??0)>(resolution.version??0)))return previous as T
    return data
  }
  if('items' in data){const page=data as {items:CurrencyReportSummary[]};return {...page,items:page.items.filter(i=>!known(i.id))} as T}
  if('id' in data&&known(String(data.id)))return null as T
  return data
}
function purgeCachedIdentity(id:string) {
  for(const key of keys()){const e=read(key);if(!e||!JSON.stringify(e.data).includes(JSON.stringify(id)))continue
    if(e.category==='body'||e.category==='meta')remove(key)
    else try{const page=e.data as {items?:CurrencyReportSummary[]};sessionStorage.setItem(key,JSON.stringify({...e,data:{...page,items:page.items?.filter(i=>i.id!==id)??[]}}))}catch{remove(key)}
  }
}
function remember(state:ReportResolution) {
  if(!state.id||!['withdrawn','superseded'].includes(state.state))return
  const previous=known(state.id)
  if(previous&&(previous.version??0)>(state.version??0))return
  const safe={...state,report:null}
  blocked.set(state.id,safe)
  try{sessionStorage.setItem(prefix+'state:'+state.id,JSON.stringify(safe))}catch{/* memory remains authoritative */}
  // Drop every cached body/summary for this identity, including other filter pages.
  purgeCachedIdentity(state.id)
}

export function reportHistoryProvider(getClient:()=>Promise<SupabaseClient>=getReportClient) {
  const inflight=new Map<string,Promise<CachedReportResult<unknown>>>()
  async function request<T>(resource:string,category:Entry['category'],load:(client:SupabaseClient,signal:AbortSignal)=>Promise<T>):Promise<CachedReportResult<T>> {
    const key=prefix+'cache:'+resource
    try {
      const data=await withConnectionDeadline(async signal=>load(await getClient(),signal),5000)
      if(data&&typeof data==='object'&&'state' in data){const result=data as unknown as ReportResolution
        remember(result)
        if(result.state==='not_found'){remove(key);return {data,cached:false,checkedAt:Date.now()}}
      }
      const safe=safeData(data),now=Date.now()
      try {sessionStorage.setItem(key,JSON.stringify({version:1,category,checkedAt:now,usedAt:now,data:safe}));trimReportCache(now)} catch {/* read succeeds even when cache cannot be stored */}
      return {data:safe,cached:false,checkedAt:now}
    } catch(error) {
      trimReportCache();const entry=read(key)
      if(entry){try{sessionStorage.setItem(key,JSON.stringify({...entry,usedAt:Date.now()}))}catch{/* optional */}
        return {data:safeData(entry.data as T),cached:true,checkedAt:entry.checkedAt}}
      throw error
    }
  }
  function shared<T>(key:string,run:()=>Promise<CachedReportResult<T>>) {
    const pending=inflight.get(key)
    if(pending)return pending as Promise<CachedReportResult<T>>
    const result=run().finally(()=>inflight.delete(key))
    inflight.set(key,result as Promise<CachedReportResult<unknown>>)
    return result
  }
  return {
    latest(currency:ReportCurrency){return shared('latest:'+currency,()=>request('latest:'+currency,'meta',(c,s)=>latestCurrencySummary(c,currency,s)))},
    archive(currency:ReportCurrency){return shared('archive:'+currency,()=>request('archive:'+currency,'meta',(c,s)=>latestCurrencySummary(c,currency,s,true)))},
    async latestAll(){
      const results=await Promise.allSettled(REPORT_CURRENCIES.map(currency=>this.latest(currency)))
      const archives=await Promise.allSettled(REPORT_CURRENCIES.map((currency,i)=>results[i].status==='fulfilled'&&!results[i].value.data?this.archive(currency):Promise.resolve(null)))
      return {items:results.flatMap(r=>r.status==='fulfilled'&&r.value.data?[r.value.data]:[]),
        archives:archives.flatMap(r=>r.status==='fulfilled'&&r.value?.data?[r.value.data]:[]),
        failed:REPORT_CURRENCIES.filter((_,i)=>results[i].status==='rejected'||archives[i].status==='rejected'),
        cached:[...results,...archives].some(r=>r.status==='fulfilled'&&r.value?.cached),
        checkedAt:Math.min(...[...results,...archives].flatMap(r=>r.status==='fulfilled'&&r.value?[r.value.checkedAt]:[]))}
    },
    page(q:ReportHistoryQuery){decodeReportCursor(q);return request('page:'+cursorKey(q)+':'+(q.cursor??''),'page',(c,s)=>currencyReportPage(c,q,s))},
    periods(currency:ReportCurrency,includeTest=false){return request('periods:'+currency+':'+includeTest,'meta',(c,s)=>currencyReportPeriods(c,currency,includeTest,s))},
    async resolve(currency:ReportCurrency,date?:string,id?:string,includeTest=false){
      if(!REPORT_CURRENCIES.includes(currency)||date!==undefined&&!validReportDate(date)||id!==undefined&&!PUBLIC_REPORT_ID.test(id))throw Error('invalid_route')
      const r=await request('body:'+currency+':'+(date??'')+':'+(id??'')+':'+includeTest,'body',async(c,s)=>{
        const value=await resolveCurrencyReport(c,currency,date,id,includeTest,s)
        if(value.state==='active'&&(!value.report||!approvedReport(value.report)))throw Error('invalid_public_report')
        return value
      })
      if(r.data.state==='not_found'&&id)purgeCachedIdentity(id)
      return r
    },
    neighbors(currency:ReportCurrency,date:string,p:ReportPeriod={},includeTest=false){
      return request('neighbors:'+cursorKey({currency,...p,includeTest})+':'+date,'meta',(c,s)=>currencyReportNeighbors(c,currency,date,p,includeTest,s))
    }
  }
}

// Shared by the dashboard and report page to coalesce concurrent reads.
export const publicReportHistory = reportHistoryProvider()
