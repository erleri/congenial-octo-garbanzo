import type { CurrencyReport, CurrencyReportProvider, CurrencyReportSummary } from '../types/currencyReport'
import { getLocalDbClient } from './dbClient'
import { withConnectionDeadline } from './connection-deadline'
import { listPublishedCurrencySummaries } from './report-queries'
import { REPORT_DATA_POLICY } from '../lib/report-data-policy.js'

const removedInMemory=new Set<string>()
function wasRemoved(key:string){try{return removedInMemory.has(key)||!!sessionStorage.getItem(key)}catch{return removedInMemory.has(key)}}

export function localProvider(mode: 'fixture' | 'live-local' | 'local-db'): CurrencyReportProvider {
  const prefix = `latamfx:local-currency-report:v2:${mode}:`
  // Old live-local caches could contain private review metadata. Never migrate them.
  try { for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key?.startsWith('latamfx:local-currency-report:v1:live-local:'))sessionStorage.removeItem(key)} }catch{/* optional storage */}
  async function get<T>(resource: string): Promise<{ data: T; cached: boolean; checkedAt: number }> {
    const tombstone = prefix + resource + ':removed'
    try {
      const response = await withConnectionDeadline(signal => mode === 'local-db' ? dbResource(resource, signal) : fetch(`/__report/${encodeURIComponent(resource)}?mode=${mode}`, { signal }), 5000)
      if (response.status === 404 || response.status === 410) {
        if(resource!=='index'&&response.status===410)removedInMemory.add(tombstone)
        try {
          if(response.status===410)sessionStorage.setItem(tombstone,'true')
          sessionStorage.removeItem(prefix + resource)
          if (resource !== 'index') {
            const envelope=JSON.parse(sessionStorage.getItem(prefix+'index')??'null')
            if(Array.isArray(envelope?.data)){envelope.data=envelope.data.filter((r:CurrencyReportSummary)=>r.id!==resource);sessionStorage.setItem(prefix+'index',JSON.stringify(envelope))}
          }
        } catch { /* Offline invalidation may be unavailable. */ }
        throw new Error(response.status === 410 ? 'withdrawn' : 'not_found')
      }
      if (!response.ok) throw new Error('unavailable')
      const data = await response.json() as T
      // IDs identify immutable runs. A known removed run cannot be resurrected by a stale replica.
      if(resource!=='index'&&wasRemoved(tombstone))throw new Error('withdrawn')
      const checkedAt=Date.now()
      // live-local is a private design/review response, never persistent browser cache.
      if(mode!=='live-local')try { sessionStorage.setItem(prefix + resource, JSON.stringify({version:2,checkedAt,data})) } catch { /* Optional public cache. */ }
      return { data, cached: false, checkedAt }
    } catch (error) {
      if (error instanceof Error && ['not_found', 'withdrawn'].includes(error.message)) throw error
      try {
        const stored = removedInMemory.has(tombstone)||sessionStorage.getItem(tombstone)||mode==='live-local' ? null : sessionStorage.getItem(prefix + resource)
        if(stored){const entry=JSON.parse(stored),age=Date.now()-entry.checkedAt
          if(entry.version===2&&Number.isFinite(entry.checkedAt)&&age>=0&&age<=REPORT_DATA_POLICY.publicCacheMs)return {data:entry.data as T,cached:true,checkedAt:entry.checkedAt}
          sessionStorage.removeItem(prefix+resource)
        }
      } catch { /* Preserve the original failure. */ }
      throw new Error('자료를 불러오지 못했습니다. 로컬 서버 연결을 확인해 주세요.', { cause: error })
    }
  }
  return {
    async list() { const r = await get<CurrencyReportSummary[]>('index'); return { items: r.data.filter(i=>!wasRemoved(prefix+i.id+':removed')), cached: r.cached, checkedAt:r.checkedAt } },
    async get(id) { const r = await get<CurrencyReport>(id); return { report: r.data, cached: r.cached, checkedAt:r.checkedAt } },
  }
}

async function dbResource(resource: string, signal: AbortSignal): Promise<Response> {
  const client = await getLocalDbClient()
  if (resource === 'index') {
    return Response.json(await listPublishedCurrencySummaries(client,signal))
  }
  const result = await client.from('currency_reports').select('report').eq('report->>id',resource).abortSignal(signal).maybeSingle()
  if (result.error) throw new Error('unavailable')
  return result.data ? Response.json(result.data.report) : new Response('{}',{status:404})
}
