import { lazy, Suspense, useState } from 'react'
import type { DatasetSource, ExchangeRateDataset } from '../types/exchangeRate'
import { datasetStatus } from '../lib/dataStatus'
import UsagePanel from './UsagePanel'
import ReportRuntimeStatus from './ReportRuntimeStatus'
import type {InboxItem} from './AdminReviewInbox'
const LocalApiStatus=__LOCAL_CURRENCY_REPORTS__?lazy(()=>import('./ApiStatusPanel')):null
export default function AdminOverview({runs,pendingTotal,dataset,datasetSource,focus=null}:{runs:{id:string;status:string;created_at:string;cost?:{costUsd?:number|null}}[];pendingTotal:number;dataset:ExchangeRateDataset|null;datasetSource:DatasetSource;focus?:InboxItem|null}) {
  const focusHealth=!!focus&&['source','policy','incident'].includes(focus.kind)
  const [healthOpen,setHealthOpen]=useState(false),[usageOpen,setUsageOpen]=useState(false)
  const costs=runs.flatMap(r=>typeof r.cost?.costUsd==='number'&&Number.isFinite(r.cost.costUsd)?[r.cost.costUsd]:[])
  return <><div className="admin-ops-grid">
    <div><strong>{pendingTotal}</strong><span>검토 대기 · 전체</span></div><div><strong>{runs.filter(r=>r.status==='failed').length}</strong><span>조회 범위 생성 실패</span></div>
    <div><strong>{dataset?.baseDate??'미확인'}</strong><span>환율 기준 · {datasetStatus(dataset).label}</span></div><div><strong>{costs.length?`$${costs.reduce((a,b)=>a+b,0).toFixed(3)}`:'미확인'}</strong><span>조회 {runs.length}건 확인 비용 · 미확인 {runs.length-costs.length}건</span></div>
  </div><details className="admin-data-details" open={focusHealth||undefined} onToggle={event=>setHealthOpen(event.currentTarget.open)}><summary>연결·수집 상태</summary><p>환율 {dataset?.baseDate??'미확인'} · 조회 {datasetSource} · 최근 실행 {runs.map(r=>r.created_at).sort().at(-1)??'없음'}</p>
    {(healthOpen||focusHealth)&&<><ReportRuntimeStatus focus={focus}/>{LocalApiStatus?<Suspense fallback={<p>저장된 점검 기록을 읽는 중입니다.</p>}><LocalApiStatus/></Suspense>:null}</>}
  </details><details className="admin-data-details" onToggle={event=>setUsageOpen(event.currentTarget.open)}><summary>이용 현황</summary>{usageOpen&&<UsagePanel/>}</details></>
}
