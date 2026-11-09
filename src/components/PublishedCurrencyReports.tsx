import { useEffect, useRef, useState, type ReactNode } from 'react'
import { publicReportHistory } from '../lib/reports/history-provider'
import { localReportMode } from '../lib/reports/client'
import type { CachedReportResult } from '../lib/reports/history-provider'
import { REPORT_CURRENCIES, reportLink, reportRoute } from '../lib/currencyReportAccess'
import { historyRoute, reportHistoryHash, PUBLIC_REPORT_ID } from '../lib/reportHistory'
import type { CurrencyReportSummary, ReportCurrency, ReportHistoryQuery, ReportResolution } from '../types/currencyReport'
import CurrencyReportDetail from './CurrencyReportDetail'
import '../local-report/report.css'
import './published-currency-report.css'
import { REPORT_DATA_POLICY } from '../lib/report-data-policy.js'
import { recordUsage } from '../lib/usage'

const names = { BRL:'브라질', MXN:'멕시코', CLP:'칠레', COP:'콜롬비아', PEN:'페루', ARS:'아르헨티나' }
const provider = publicReportHistory
const positions = new Map<string,{pages:number;scroll:number;at:number;truncated?:boolean}>()
function saveHistoryPosition(hash:string,pages:number){const position={pages:Math.min(pages,12),scroll:window.scrollY,at:Date.now(),truncated:pages>12};positions.delete(hash);positions.set(hash,position);history.replaceState({...history.state,reportHistoryPosition:{hash,...position}},'');while(positions.size>12)positions.delete(positions.keys().next().value!)}
function savedHistoryPosition(hash:string){const p=history.state?.reportHistoryPosition
  return p?.hash===hash&&Number.isInteger(p.pages)&&p.pages>=1&&p.pages<=12&&Number.isFinite(p.scroll)&&p.scroll>=0&&Number.isFinite(p.at)?p:positions.get(hash)}
type Go = (hash:string, fromHistory?:string) => void
function typeLabel(item:CurrencyReportSummary) {
  return [item.testOnly?'합성 연결 시험':item.historicalReview?'과거 사례':null,item.reportKind==='periodic'?'정기 점검':item.reportKind==='movement'?'변동 분석':'리포트',item.revisionKind==='correction'?'정정':null].filter(Boolean).join(' · ')
}
function CacheNotice({cached,checkedAt}:{cached:boolean;checkedAt?:number}) {
  return cached?<p className="local-notice" role="status">캐시 자료 · 원래 기준일 유지 · 마지막 게시 상태 확인 {checkedAt?new Date(checkedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'미확인'} · 현재 정정 여부 미확인</p>:null
}
function ErrorNotice({onRetry,children}:{onRetry:()=>void;children:React.ReactNode}) {
  return <div className="local-notice" role="alert">{children} <button onClick={onRetry}>다시 시도</button></div>
}
function LatestList({go,revision}:{go:Go;revision:number}) {
  const [result,setResult]=useState<Awaited<ReturnType<typeof provider.latestAll>>>()
  useEffect(()=>{let active=true;void provider.latestAll().then(r=>{if(active)setResult(r)});return()=>{active=false}},[revision])
  return <><div className="report-list-heading"><h1>국가별 리포트</h1><p>국가를 선택해 리포트 목록을 보거나 최신 리포트를 바로 읽으세요.</p></div>
    {!result?<p role="status">최신 리포트를 확인하는 중입니다.</p>:<><CacheNotice cached={result.cached} checkedAt={result.checkedAt}/><div className="brief-list">{REPORT_CURRENCIES.map(c=>{
      const current=result.items.find(i=>i.currency===c),item=current??result.archives.find(i=>i.currency===c),failed=result.failed.includes(c)
      return <article className={`brief-list-card currency-${c.toLowerCase()}`} key={c}><span>{names[c]} · {c}</span>
        <h2>{item?.title??(failed?'조회 확인 필요':'현재 리포트 미발행')}</h2><p>{item?.summary??(failed?'연결을 확인하지 못했습니다.':'이 국가의 리포트 목록에서 발행된 자료를 확인할 수 있습니다.')}</p>
        {item&&<p className="brief-list-meta"><time>{item.baseDate}</time><span aria-hidden="true"> · </span>{typeLabel(item)}</p>}
        <nav className="brief-list-actions" aria-label={`${names[c]} 리포트 이동`}>
          {item&&<a className="brief-list-read" href={reportLink(c,item.baseDate)} onClick={e=>{e.preventDefault();go(reportLink(c,item.baseDate))}}>{current?'리포트 읽기':'보관 리포트 읽기'} →</a>}
          <a className="brief-list-history" href={reportHistoryHash(c)} onClick={e=>{e.preventDefault();go(reportHistoryHash(c))}}>지난 리포트</a>
        </nav>
      </article>
    })}</div></>}
  </>
}
function HistoryList({hash,q,go,revision}:{hash:string;q:ReportHistoryQuery;go:Go;revision:number}) {
  const [items,setItems]=useState<CurrencyReportSummary[]>([]),[periods,setPeriods]=useState<string[]>([])
  const [next,setNext]=useState<string|null>(null),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false)
  const [error,setError]=useState(''),[periodError,setPeriodError]=useState(false),[cached,setCached]=useState(false),[checkedAt,setCheckedAt]=useState<number>()
  const [restoreNotice,setRestoreNotice]=useState('')
  const epoch=useRef(0),pending=useRef(false),pages=useRef(1)
  const requestPage=async(more:boolean)=>{
    if(pending.current)return
    pending.current=true;setBusy(true);const generation=epoch.current
    try {
      const result=await provider.page({...q,cursor:more?next??undefined:undefined})
      if(epoch.current!==generation)return
      setItems(old=>{const rows=more?[...old,...result.data.items]:result.data.items;return [...new Map(rows.map(i=>[i.id,i])).values()]})
      setNext(result.data.nextCursor);setCached(result.cached);setCheckedAt(result.checkedAt);setLoaded(true);setError('')
      pages.current=more?pages.current+1:1
    }catch{if(epoch.current===generation){setLoaded(true);setError('리포트 목록을 불러오지 못했습니다.')}}
    finally{if(epoch.current===generation){pending.current=false;setBusy(false)}}
  }
  useEffect(()=>{
    const generation=++epoch.current;pending.current=true
    const saved=savedHistoryPosition(hash),restore=saved&&Date.now()-saved.at>=0&&Date.now()-saved.at<REPORT_DATA_POLICY.publicCacheMs?saved:null
    void Promise.resolve().then(async()=>{
      if(epoch.current!==generation)return
      setBusy(true)
      try{
        let cursor:string|undefined,count=0,last:Awaited<ReturnType<typeof provider.page>>|undefined
        const rows:CurrencyReportSummary[]=[]
        let anyCached=false,oldestCheck=Infinity
        do {last=await provider.page({...q,cursor});if(epoch.current!==generation)return
          rows.push(...last.data.items);cursor=last.data.nextCursor??undefined;count++;anyCached ||= last.cached;oldestCheck=Math.min(oldestCheck,last.checkedAt)
        }while(cursor&&count<Math.min(restore?.pages??1,12))
        setItems([...new Map(rows.map(i=>[i.id,i])).values()]);setNext(last!.data.nextCursor);setCached(anyCached);setCheckedAt(oldestCheck);setLoaded(true);setError('');pages.current=count
        setRestoreNotice(restore?.truncated?'최근 불러온 목록은 최대 360개까지 복원합니다. 더 보기를 눌러 계속 확인할 수 있습니다.':'')
        if(restore)requestAnimationFrame(()=>{if(epoch.current===generation)window.scrollTo(0,restore.scroll)})
      }catch{if(epoch.current===generation){setLoaded(true);setError('리포트 목록을 불러오지 못했습니다.')}}
      finally{if(epoch.current===generation){pending.current=false;setBusy(false)}}
    })
    return()=>{epoch.current=generation+1;pending.current=false}
    // The keyed view fixes the currency/filter; revision refreshes all restored pages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[revision])
  useEffect(()=>{let active=true;void provider.periods(q.currency,!!q.includeTest).then(r=>{if(active){setPeriods(r.data);setPeriodError(false)}}).catch(()=>{if(active)setPeriodError(true)});return()=>{active=false}},[q.currency,q.includeTest,revision])
  const years=[...new Set(periods.map(p=>Number(p.slice(0,4))))],months=periods.filter(p=>Number(p.slice(0,4))===q.year).map(p=>Number(p.slice(5)))
  return <><div className="report-list-heading"><h1>{names[q.currency]} 리포트</h1><p>발행된 리포트를 최신 기준일순으로 확인하세요.</p></div>
    <div className="report-history-filters"><label>연도 <select aria-label="리포트 연도" value={q.year??''} onChange={e=>go(reportHistoryHash(q.currency,{year:e.target.value?Number(e.target.value):undefined},q.includeTest))}><option value="">전체 연도</option>{[...new Set([...years,...q.year?[q.year]:[]])].sort((a,b)=>b-a).map(y=><option key={y}>{y}</option>)}</select></label>
      <label>월 <select aria-label="리포트 월" disabled={!q.year} value={q.month??''} onChange={e=>go(reportHistoryHash(q.currency,{year:q.year,month:e.target.value?Number(e.target.value):undefined},q.includeTest))}><option value="">전체 월</option>{[...new Set([...months,...q.month?[q.month]:[]])].sort((a,b)=>a-b).map(m=><option key={m} value={m}>{m}월</option>)}</select></label>
      {localReportMode()&&<label className="report-test-filter"><input type="checkbox" checked={!!q.includeTest} onChange={e=>go(reportHistoryHash(q.currency,q,e.target.checked))}/>로컬 합성 시험 포함</label>}</div>
    {q.includeTest&&<p className="local-notice">합성 연결 시험을 포함한 로컬 검증 화면입니다. 실제 AI 원고 품질 표본과 구분합니다.</p>}
    {periodError&&<p role="status">발행 기간 선택지를 확인하지 못했습니다. 현재 기간 조회는 계속 사용할 수 있습니다.</p>}
    {restoreNotice&&<p role="status">{restoreNotice}</p>}
    <CacheNotice cached={cached} checkedAt={checkedAt}/>
    {error&&<ErrorNotice onRetry={()=>void requestPage(false)}>{error}</ErrorNotice>}
    {!loaded?<p role="status">리포트 목록을 불러오는 중입니다.</p>:!items.length&&!error?<p className="report-empty">이 기간에 발행된 리포트가 없습니다. <button onClick={()=>go(reportHistoryHash(q.currency,{},q.includeTest))}>전체 기간 보기</button></p>:null}
    <ol className="report-history-list">{items.map(item=><li key={item.id}><time>{item.baseDate}</time><div><p className="report-kind">{typeLabel(item)}</p><h2><a href={reportLink(item.currency,item.baseDate)} onClick={e=>{e.preventDefault();saveHistoryPosition(hash,pages.current);go(reportLink(item.currency,item.baseDate),hash)}}>{item.title}</a></h2><p>{item.summary}</p></div></li>)}</ol>
    {next&&<button className="report-more" disabled={busy} onClick={()=>void requestPage(true)}>{busy?'불러오는 중…':'더 보기 · 30개'}</button>}
    {loaded&&items.length>0&&!next&&!error&&<p className="report-list-end">선택한 기간의 마지막 리포트입니다.</p>}
  </>
}
function Detail({currency,date,id,go,revision,onRetry,mobileNavigation}:{currency:ReportCurrency;date?:string;id?:string;go:Go;revision:number;onRetry:()=>void;mobileNavigation:ReactNode}) {
  const context=historyRoute(String(history.state?.reportHistory??'')),q=context?.currency===currency?context:undefined
  const historyHash=q?reportHistoryHash(currency,q,!!q.includeTest):reportHistoryHash(currency)
  const [result,setResult]=useState<CachedReportResult<ReportResolution>>(),[error,setError]=useState(''),[empty,setEmpty]=useState(false)
  const [neighbors,setNeighbors]=useState<Awaited<ReturnType<typeof provider.neighbors>>>(),[neighborError,setNeighborError]=useState(false)
  useEffect(()=>{let active=true
    void (async()=>{try{
      let targetDate=date
      if(!date&&!id){const latest=await provider.latest(currency);if(!active)return;if(!latest.data){setEmpty(true);setResult(undefined);return}targetDate=latest.data.baseDate}
      const value=await provider.resolve(currency,targetDate,id,!!q?.includeTest)
      if(active){setResult(value);setError('');setEmpty(false)}
    }catch{if(active){setResult(undefined);setError('보고서를 불러오지 못했습니다. 환율 화면은 계속 사용할 수 있습니다.')}}})()
    return()=>{active=false}
  },[currency,date,id,q?.includeTest,revision])
  const baseDate=result?.data.baseDate
  useEffect(()=>{let active=true;if(!baseDate||result?.data.state!=='active')return
    void provider.neighbors(currency,baseDate,q,!!q?.includeTest).then(r=>{if(active){setNeighbors(r);setNeighborError(false)}}).catch(()=>{if(active)setNeighborError(true)})
    return()=>{active=false}
    // Restrict navigation to the validated history context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[currency,baseDate,result?.data.state,revision])
  const state=result?.data
  useEffect(()=>{
    const report=state?.state==='active'?state.report:undefined
    if(!report||report.testOnly)return
    const input={screen:'reports' as const,currency:report.currency,reportId:report.id}
    void recordUsage({...input,event:'report_open'})
    let timer:ReturnType<typeof setTimeout>|undefined
    const arm=()=>{if(timer)clearTimeout(timer);if(document.visibilityState==='visible')timer=setTimeout(()=>{void recordUsage({...input,event:'report_30s'})},30_000)}
    arm();document.addEventListener('visibilitychange',arm)
    return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',arm)}
  },[state])
  return <><nav className="report-detail-links" aria-label="보고서 이동">{state?.state!=='active'&&<a href={historyHash} onClick={e=>{e.preventDefault();go(historyHash)}}>← {names[currency]} 리포트 목록</a>}{(state?.state!=='active'||neighbors?.data.newer)&&<a href={reportLink(currency)} onClick={e=>{e.preventDefault();go(reportLink(currency))}}>최신 리포트 읽기</a>}</nav>
    {error?<ErrorNotice onRetry={onRetry}>{error}</ErrorNotice>:null}
    {empty?<div className="report-empty"><h1>현재 리포트 미발행</h1><p>발행된 자료와 과거 사례는 이 국가의 리포트 목록에서 확인할 수 있습니다.</p><button onClick={()=>go(historyHash)}>{names[currency]} 리포트 목록 보기</button></div>:null}
    {!state&&!empty&&!error?<p role="status">보고서를 불러오는 중입니다.</p>:null}
    {result&&<CacheNotice cached={result.cached} checkedAt={result.checkedAt}/>}
    {state&&state.state!=='active'?<div className="report-empty"><h1>{state.state==='withdrawn'?'이 보고서는 철회되었습니다.':state.state==='superseded'?'이 보고서는 새 판본으로 교체되었습니다.':'해당 공개 리포트를 찾을 수 없습니다.'}</h1>
      {state.replacement?<button onClick={()=>go(reportLink(state.replacement!.currency,state.replacement!.baseDate),historyHash)}>유효 수정본 보기</button>:<p>{state.state==='not_found'?'주소의 통화·날짜·보고서 ID를 확인해 주세요.':'현재 유효한 수정본은 없습니다.'}</p>}</div>:null}
    {state?.state==='active'&&state.report?<>
      {state.revisionKind&&<p className="local-notice">{state.revisionKind==='correction'?'정정된 리포트입니다.':'새 판본으로 교체된 리포트입니다.'} 당시 기준일과 자료를 유지합니다.</p>}
      <CurrencyReportDetail key={state.id} report={state.report} onBack={()=>go(historyHash)} backLabel={`← ${names[currency]} 리포트 목록`} mobileNavigation={mobileNavigation} onRefresh={onRetry}/>
      <nav className="report-neighbors" aria-label="같은 통화의 이전 다음 리포트">{(['older','newer'] as const).map(direction=>{const item=neighbors?.data[direction];return <button key={direction} disabled={!item} onClick={()=>item&&go(reportLink(currency,item.baseDate),historyHash)}>{direction==='older'?'← 이전 · 더 오래된':'다음 · 더 최근인 →'} {item?.baseDate??'없음'}</button>})}</nav>
      {neighborError?<p role="status">이전·다음 탐색을 확인하지 못했습니다. 본문 조회는 정상입니다.</p>:q&&(q.year||q.month)&&<p className="report-list-end">현재 기간 안에서 이동합니다. 기간 밖의 글은 전체 이력에서 확인할 수 있습니다.</p>}
    </>:null}
  </>
}
export default function PublishedCurrencyReports({hash}:{hash:string}) {
  const [revision,setRevision]=useState(0)
  useEffect(()=>{const refresh=()=>setRevision(n=>n+1),visible=()=>{if(document.visibilityState==='visible')refresh()};const timer=setInterval(refresh,REPORT_DATA_POLICY.statusCheckMs)
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',visible)
    return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',visible)}
  },[])
  const go:Go=(target,fromHistory)=>{const url=new URL(location.href);url.searchParams.delete('run');url.hash=target
    const context=fromHistory??(target.includes('/history')?target:undefined)
    const position=context?savedHistoryPosition(context):undefined
    history.pushState({...context?{reportHistory:context}:{},...position?{reportHistoryPosition:{hash:context,...position}}:{}},'',url)
    window.dispatchEvent(new HashChangeEvent('hashchange'));window.scrollTo(0,0);setRevision(n=>n+1)
  }
  const route=reportRoute(hash),hist=historyRoute(hash),runs=new URLSearchParams(location.search).getAll('run')
  const invalidRun=runs.length>1||runs.length===1&&!PUBLIC_REPORT_ID.test(runs[0])||runs.length>0&&(!route?.currency||!!hist)
  const invalidScope=!localReportMode()&&hist?.includeTest
  const currency=hist?.currency??route?.currency
  const countrySelector=<label className="report-country-select"><span className="sr-only">국가별 리포트 목록</span><select aria-label="국가별 리포트 목록" value={currency??'ALL'} onChange={e=>go(e.target.value==='ALL'?'#report':reportHistoryHash(e.target.value as ReportCurrency))}><option value="ALL">전체 국가</option>{REPORT_CURRENCIES.map(c=><option key={c} value={c}>{names[c]} · {c}</option>)}</select></label>
  return <section className="report-experience design-a published-currency-reports">{localReportMode()&&<p className="local-notice">로컬 승인·조회 검증 · 운영 게시 없음</p>}
    <div className="report-navigation">
      {countrySelector}
      <nav className="currency-tabs" aria-label="국가별 리포트 목록"><a href="#report" aria-current={!currency&&route?'page':undefined} onClick={e=>{e.preventDefault();go('#report')}}>전체 국가</a>{REPORT_CURRENCIES.map(c=><a key={c} href={reportHistoryHash(c)} aria-current={currency===c?'page':undefined} onClick={e=>{e.preventDefault();go(reportHistoryHash(c))}}>{names[c]} <b>{c}</b></a>)}</nav>
      <button type="button" className="report-status-refresh" aria-label="리포트 새로고침" title="리포트 목록과 공개 상태를 다시 불러옵니다." onClick={()=>setRevision(n=>n+1)}>
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16.2 7A6.5 6.5 0 1 0 16 13.5"/><path d="M16.2 2.8V7H12"/></svg>
        <span>새로고침</span>
      </button>
    </div>
    {invalidRun||invalidScope||!route&&!hist?<div className="report-empty"><h1>리포트 주소를 확인해 주세요.</h1><button onClick={()=>go('#report')}>전체 국가로</button></div>:hist?<HistoryList key={hash} hash={hash} q={hist} go={go} revision={revision}/>:route?.currency?<Detail key={hash+':'+runs.join()} currency={route.currency} date={route.date} id={runs[0]} go={go} revision={revision} onRetry={()=>setRevision(n=>n+1)} mobileNavigation={countrySelector}/>:<LatestList go={go} revision={revision}/>}
  </section>
}
