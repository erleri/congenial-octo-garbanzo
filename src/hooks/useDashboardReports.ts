import { useEffect, useState } from 'react'
import type { CurrencyReportSummary } from '../types/currencyReport'
import { approvedSummary } from '../lib/currencyReportAccess'
import { REPORT_DATA_POLICY } from '../lib/report-data-policy.js'

export function useDashboardReports(enabled: boolean, revision: string) {
  const [items,setItems]=useState<CurrencyReportSummary[]>([])
  const [archives,setArchives]=useState<CurrencyReportSummary[]>([])
  const [verified,setVerified]=useState(false)
  const [now,setNow]=useState(Date.now)
  const [state,setState]=useState<'loading'|'ready'|'cache'|'failed'>('loading')
  useEffect(()=>{
    if(!enabled)return
    let active=true,inflight=false
    const check=async()=>{
      if(inflight)return
      inflight=true
      try{
        const {publicReportHistory}=await import('../lib/reports/history-provider')
        const result=await publicReportHistory.latestAll()
        if(active){setItems(result.items.filter(approvedSummary));setArchives(result.archives.filter(approvedSummary));setVerified(!result.cached&&!result.failed.length);setState(result.failed.length?'failed':result.cached?'cache':'ready');setNow(Date.now())}
      }catch{if(active){setItems([]);setArchives([]);setVerified(false);setState('failed')}}
      finally{inflight=false}
    }
    const foreground=()=>{setNow(Date.now());if(document.visibilityState==='visible')void check()}
    void check()
    const poll=window.setInterval(()=>{if(document.visibilityState==='visible')void check()},REPORT_DATA_POLICY.statusCheckMs)
    // Date-only rendering changes locally; it does not query providers or invoke AI.
    let clock:number
    const armClock=()=>{clock=window.setTimeout(()=>{setNow(Date.now());armClock()},86400000-((Date.now()+9*3600000)%86400000)+20)}
    armClock()
    window.addEventListener('focus',foreground)
    document.addEventListener('visibilitychange',foreground)
    return()=>{active=false;clearInterval(poll);clearTimeout(clock);window.removeEventListener('focus',foreground);document.removeEventListener('visibilitychange',foreground)}
  },[enabled,revision])
  return {items,archives,verified,now,state}
}
