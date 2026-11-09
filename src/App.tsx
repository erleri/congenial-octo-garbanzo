import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DataStatus from './components/DataStatus'
import Disclosure from './components/Disclosure'
import AdminAccessPanel from './components/AdminAccessPanel'
import {parseReviewRequest} from './lib/review-request.js'
import { fxReportConfig } from './generated/fxReportConfig'
import { REPORT_CURRENCIES, approvedHistory, reportLink } from './lib/currencyReportAccess'
import type { ReportCurrency } from './types/currencyReport'
import ReportBoundary from './components/ReportBoundary'
import { useExchangeData } from './hooks/useExchangeData'
import { useDashboardReports } from './hooks/useDashboardReports'
import { buildPeriodOptions, buildYearOptions, resolvePeriodRange, resolveYearRange } from './lib/periodSelection'
import { parseFxNavigation, selectTrendCurrency, trendHash, type FxNavigation, type FxScreen, type TrendView } from './lib/fxNavigation'
import { reportBadge } from './lib/reportFreshness'
import { reportHistoryHash } from './lib/reportHistory'
import { recentMonthRange } from './lib/pageContext'
import { usePageContext } from './hooks/usePageContext'
import { pageUsage, recordUsage } from './lib/usage'
import { CURRENCIES, type CurrencyCode, type CurrencyFilter } from './types/exchangeRate'
import './App.css'
import './ui2.css'

const Admin = lazy(() => import('./components/Admin'))
const loadDashboard=()=>import('./components/Dashboard')
const Dashboard=lazy(loadDashboard)
const CurrencyDetail = lazy(() => import('./components/CurrencyDetail'))
const MonthlySummary = lazy(() => import('./components/MonthlySummary'))
const MovingComparison = lazy(() => import('./components/MovingComparison'))
const MovingComparisonTable = lazy(() => import('./components/MovingComparisonTable'))
const PublishedCurrencyReports = lazy(() => import('./components/PublishedCurrencyReports'))
const CurrencyReportReview = lazy(() => import('./components/CurrencyReportReview'))
const LOCAL_CURRENCY_REPORTS = __LOCAL_CURRENCY_REPORTS__
const REPORT_FEATURE_ENABLED = fxReportConfig.enabled
const HAS_REPORTS = LOCAL_CURRENCY_REPORTS || REPORT_FEATURE_ENABLED

function App() {
  const [navigation,setNavigation]=useState(()=>parseFxNavigation(parseReviewRequest(window.location.search)?'#admin':window.location.hash))
  const [locationHash,setLocationHash]=useState(window.location.hash)
  const [selectionNotice,setSelectionNotice]=useState('')
  const [customRange,setCustomRange]=useState(false)
  const rangeButton=useRef<HTMLButtonElement>(null)
  const reports=useDashboardReports(HAS_REPORTS,navigation.screen)
  usePageContext(navigation,locationHash)
  useEffect(()=>{const event=pageUsage(navigation);if(event)void recordUsage(event)},[navigation])
  const {dataset,datasetSource,loading,error,excelPriority,fillMissing,dailyRangeLoading,dailyRangeNotice,
    filters,refreshData,ensureDailyRange,uploadAndMergeExcel,businessPlan,updateBusinessPlan,businessPlanStatus,adminAccess,
    businessPlanHistory,businessPlanHistoryStatus,loadMoreBusinessPlanHistory,requestBusinessPlanAccess,signOutBusinessPlanAccess}=useExchangeData()
  const screen=navigation.screen
  // Fetch charts alongside FX data on the dashboard; report readers skip them.
  useEffect(()=>{if(screen==='dashboard')void loadDashboard()},[screen])
  const periodOptions=useMemo(()=>dataset?buildPeriodOptions(dataset.monthlyRates,dataset.baseDate):[],[dataset])
  const yearOptions=useMemo(()=>buildYearOptions(periodOptions),[periodOptions])
  const [from,to]=useMemo(()=>resolvePeriodRange(periodOptions,navigation.from,navigation.to),[periodOptions,navigation.from,navigation.to])
  const [yearFrom,yearTo]=useMemo(()=>resolveYearRange(yearOptions,navigation.yearFrom,navigation.yearTo),[yearOptions,navigation.yearFrom,navigation.yearTo])
  const trendState: FxNavigation={...navigation,screen:'trends',from,to,yearFrom:yearFrom||null,yearTo:yearTo||null}

  const applyNavigation=useCallback((next:FxNavigation,hash:string,replace=false)=>{
    const previousScreen=parseFxNavigation(window.location.hash).screen
    const url=new URL(window.location.href)
    url.hash=hash
    if(next.screen!=='reports')url.searchParams.delete('run')
    if(next.screen!=='admin'){url.searchParams.delete('review');url.searchParams.delete('reviewVersion')}
    const entry=null
    if(url.href!==window.location.href)window.history[replace?'replaceState':'pushState'](entry,'',url)
    else if(replace)window.history.replaceState(entry,'',url)
    if(previousScreen!==next.screen&&!replace)window.scrollTo(0,0)
    setNavigation(next);setLocationHash(hash);setSelectionNotice('')
  },[])
  useEffect(()=>{
    const sync=()=>{setLocationHash(window.location.hash);setNavigation(previous=>parseFxNavigation(window.location.hash,previous))}
    window.addEventListener('hashchange',sync)
    window.addEventListener('popstate',sync)
    return()=>{window.removeEventListener('hashchange',sync);window.removeEventListener('popstate',sync)}
  },[])
  useEffect(()=>{
    if(screen!=='trends'||!from||!to||!yearFrom||!yearTo)return
    const canonical={...navigation,from,to,yearFrom,yearTo}
    if(trendHash(canonical)===window.location.hash)return
    const parameters=new URLSearchParams(window.location.hash.split('?')[1]??'')
    const adjusted=[['from',from],['to',to],['yearFrom',String(yearFrom)],['yearTo',String(yearTo)]].some(([key,value])=>parameters.has(key)&&parameters.get(key)!==value)
    const timer=window.setTimeout(()=>{applyNavigation(canonical,trendHash(canonical),true);if(adjusted)setSelectionNotice('요청한 기간을 조회 가능한 자료 범위에 맞춰 조정했습니다. 선택된 시작·종료 기간을 확인해 주세요.')},0)
    return()=>clearTimeout(timer)
  },[screen,navigation,from,to,yearFrom,yearTo,applyNavigation])
  useEffect(()=>{
    if(screen==='trends'&&navigation.view==='daily'&&from&&to)void ensureDailyRange(navigation.currency,from,to)
  },[screen,navigation.view,navigation.currency,from,to,ensureDailyRange])

  const changeTrend=(patch:Partial<FxNavigation>)=>{
    const next={...trendState,...patch,screen:'trends' as const}
    applyNavigation(next,trendHash(next))
  }
  const changeCurrency=(currency:CurrencyFilter)=>{
    const next=selectTrendCurrency(trendState,currency)
    applyNavigation(next,trendHash(next))
  }
  const openTrend=(currency?:CurrencyCode)=>{
    const next=currency?{...selectTrendCurrency(trendState,currency),view:'daily' as const}:trendState
    applyNavigation(next,trendHash(next))
  }
  const openScreen=(nextScreen:FxScreen)=>{
    if(nextScreen==='trends'){openTrend();return}
    if(nextScreen==='reports'&&!HAS_REPORTS)return
    const hash=nextScreen==='dashboard'?'#dashboard':nextScreen==='reports'?'#report':nextScreen==='plan'?'#admin/plan':'#admin'
    applyNavigation({...navigation,screen:nextScreen},hash)
  }
  const reportEntry=(currency:CurrencyCode)=>{
    if(!HAS_REPORTS||!REPORT_CURRENCIES.includes(currency as ReportCurrency))return null
    const item=approvedHistory(reports.items,currency as ReportCurrency)[0]
    const archive=reports.archives.find(i=>i.currency===currency)
    const badge=reportBadge(item,reports.now,reports.verified)
    const hash=item?reportLink(currency):reportHistoryHash(currency as ReportCurrency)
    const status=item?`보고서 ${item.baseDate}`:archive?`최근 보관 ${archive.baseDate}`:reports.state==='failed'?'연결 확인 필요':reports.state==='loading'?'확인 중':'발행된 리포트가 없습니다'
    const label=item?'리포트 읽기':archive?'지난 리포트':reports.state==='failed'?'리포트 확인':'리포트 목록'
    return <a className="kpi-report-link" href={hash} onClick={e=>{e.preventDefault();if(navigation.screen==='dashboard')void recordUsage({event:'dashboard_report',screen:'reports',currency:currency as ReportCurrency});applyNavigation({...navigation,screen:'reports'},hash)}}>
      <strong>{currency} {label} →</strong>{badge&&<span className={`report-fresh-badge ${badge==='정정'?'correction':''}`}>{badge}</span>}
      <small>{status}{reports.state==='cache'?' · 캐시':''}</small>
    </a>
  }
  const renderPlan=()=>dataset&&<MovingComparison key={adminAccess.revision} sharedAdminAccess data={dataset} businessPlan={businessPlan} onUpdatePlan={updateBusinessPlan}
    businessPlanStatus={businessPlanStatus} businessPlanHistory={businessPlanHistory} businessPlanHistoryStatus={businessPlanHistoryStatus}
    onLoadMorePlanHistory={loadMoreBusinessPlanHistory} onRequestPlanAccess={requestBusinessPlanAccess} onSignOutPlanAccess={signOutBusinessPlanAccess}/>
  const legacyAdmin=<Admin key={locationHash==='#mailing'?'admin-mailing':'admin'} error={error} dataset={dataset} datasetSource={datasetSource} onUploadExcel={uploadAndMergeExcel} excelPriority={excelPriority} fillMissing={fillMissing} initialMailingOpen={locationHash==='#mailing'} canReviewReports={businessPlanStatus.canEdit} reportAdminStatus={businessPlanStatus} onRequestReportAccess={requestBusinessPlanAccess} onSignOutReportAccess={signOutBusinessPlanAccess} reportEnabled={false}/>

  const relatedReport=<div className="trend-related-report"><span>관련 리포트</span>{navigation.view==='monthly'&&navigation.monthlyCurrency==='ALL'?<button className="inline-link" onClick={()=>openScreen('reports')} disabled={!HAS_REPORTS}>전체 환율 리포트 보기</button>:reportEntry(navigation.view==='monthly'&&navigation.monthlyCurrency!=='ALL'?navigation.monthlyCurrency:navigation.currency)??<span className="table-help">이 통화는 현재 리포트 대상이 아닙니다.</span>}<small>보고서 기준일은 환율 조회 기간과 다를 수 있습니다.</small></div>

  let content
  if(screen==='reports')content=HAS_REPORTS?<ReportBoundary onBack={()=>openScreen('dashboard')}><PublishedCurrencyReports hash={locationHash}/></ReportBoundary>:<div className="panel empty"><h2>리포트 제공이 현재 중지되어 있습니다.</h2><button className="quiet-button" onClick={()=>openScreen('dashboard')}>대시보드로</button></div>
  else if(screen==='admin')content=<><nav className="admin-section-nav" aria-label="관리 영역"><button className="quiet-button selected" onClick={()=>openScreen('admin')}>데이터·리포트 관리</button><button className="quiet-button" onClick={()=>openScreen('plan')}>계획환율·변경 이력</button></nav>{HAS_REPORTS&&adminAccess.canManage?<section className="report-experience design-a"><CurrencyReportReview dataset={dataset} datasetSource={datasetSource} access={adminAccess}/></section>:!HAS_REPORTS&&adminAccess.canManage?legacyAdmin:null}{HAS_REPORTS&&!LOCAL_CURRENCY_REPORTS&&dataset&&businessPlanStatus.canEdit&&<details className="panel admin-legacy"><summary>데이터·메일 도구</summary>{legacyAdmin}</details>}</>
  else if(!dataset)content=<div className={`panel empty ${error?'':'loading-panel'}`}><h2>{error?'환율을 불러오지 못했습니다.':'데이터를 불러오는 중입니다.'}</h2>{error?<><p className="table-help">리포트는 상단 메뉴에서 계속 이용할 수 있습니다.</p><button className="quiet-button" disabled={loading} onClick={()=>void refreshData()}>다시 시도</button></>:<p className="table-help">환율 자료를 확인하고 있습니다.</p>}</div>
  else if(screen==='dashboard')content=<>
    <Dashboard data={dataset} filters={filters} businessPlan={businessPlan} renderReportLink={currency=><div className="kpi-navigation">
      <a href={trendHash({...selectTrendCurrency(trendState,currency),view:'daily'})} className="kpi-trend-link" onClick={e=>{e.preventDefault();openTrend(currency)}}>{currency} 추이 보기 →</a>
      {reportEntry(currency)}
    </div>}/>
  </>
  else if(screen==='trends')content=<section className="trends-workspace" aria-label="환율 추이">
    {selectionNotice&&<p className="inline-notice warning-notice" role="status">{selectionNotice}</p>}
    <div className="panel trends-controls">
      <h2 className="sr-only">환율 추이</h2>
      <div className="trend-view-switch" role="group" aria-label="조회 종류">{([['daily','일별 추이'],['monthly','월별 이력'],['comparison','상세 비교']] as [TrendView,string][]).map(([view,label])=><button key={view} className={`quiet-button ${navigation.view===view?'selected':''}`} aria-pressed={navigation.view===view} onClick={()=>changeTrend({view})}>{label}</button>)}</div>
      {navigation.view==='daily'?<div className="daily-controls" onKeyDown={e=>{if(e.key==='Escape'&&customRange){setCustomRange(false);rangeButton.current?.focus()}}}>
        <div className="trend-primary-row"><label><span className="filter-label">통화</span><select aria-label="통화" value={navigation.currency} onChange={e=>changeCurrency(e.target.value as CurrencyCode)}>{CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}</select></label><span className="selected-period" aria-label="선택 기간">{from} — {to}</span></div>
        <div id="custom-trend-range" className={`custom-range ${customRange?'is-open':''}`}>
          <label><span className="filter-label">시작 월</span><select aria-label="시작 월" value={from} onChange={e=>changeTrend({from:e.target.value,to:e.target.value>to?e.target.value:to})}>{periodOptions.map(p=><option key={p} value={p}>{p}</option>)}</select></label>
          <label><span className="filter-label">종료 월</span><select aria-label="종료 월" value={to} onChange={e=>changeTrend({to:e.target.value})}>{periodOptions.filter(p=>p>=from).map(p=><option key={p} value={p}>{p}</option>)}</select></label>
        </div>
        <div className="period-presets" aria-label="최근 기간">{[1,3,12].map(months=>{const range=periodOptions.length?recentMonthRange(periodOptions.at(-1)!,months,periodOptions[0]):null;return <button key={months} className="quiet-button" disabled={!range} aria-pressed={!!range&&from===range.from&&to===range.to} onClick={()=>{if(range)changeTrend(range);setCustomRange(false)}}>{months===12?'1년':`${months}개월`}</button>})}<button ref={rangeButton} className="quiet-button custom-range-toggle" aria-expanded={customRange} aria-controls="custom-trend-range" onClick={()=>setCustomRange(v=>!v)}>직접 설정</button></div>
      </div>:navigation.view==='monthly'?<div className="monthly-controls">
        <label><span className="filter-label">통화</span><select aria-label="통화 필터" value={navigation.monthlyCurrency} onChange={e=>changeCurrency(e.target.value as CurrencyFilter)}><option value="ALL">전체 통화</option>{CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
        <label><span className="filter-label">시작 연도</span><select aria-label="시작 연도" value={yearFrom} onChange={e=>changeTrend({yearFrom:Number(e.target.value),yearTo:Math.max(yearTo,Number(e.target.value))})}>{yearOptions.map(y=><option key={y} value={y}>{y}</option>)}</select></label>
        <label><span className="filter-label">종료 연도</span><select aria-label="종료 연도" value={yearTo} onChange={e=>changeTrend({yearTo:Number(e.target.value)})}>{yearOptions.filter(y=>y>=yearFrom).map(y=><option key={y} value={y}>{y}</option>)}</select></label>
      </div>:<p className="table-help">이동·선행 평균과 실제·계획 편차를 조회합니다. 계획환율 수정·변경 이력은 <button className="inline-link" onClick={()=>openScreen('plan')}>관리자 → 계획환율</button>에서 확인합니다.</p>}
    </div>
    {navigation.view==='daily'?<CurrencyDetail data={dataset} currencyFilter={navigation.currency} periodFrom={from} periodTo={to} rangeNotice={dailyRangeNotice} relatedReport={relatedReport}/>:navigation.view==='monthly'?<MonthlySummary data={dataset} currencyFilter={navigation.monthlyCurrency} yearFrom={yearFrom} yearTo={yearTo}/>:<div className="panel"><h2>평균·계획 대비 상세 비교</h2><p className="table-help">자료 기준일 {dataset.baseDate} · {businessPlanStatus.remoteLoadStatus==='loaded'?'저장된 계획환율':'계획환율 저장소 미확인 · 자동 평균/로컬 참고값'}</p><MovingComparisonTable data={dataset} businessPlan={businessPlan} presentation="summary-first"/></div>}
    {navigation.view==='monthly'&&relatedReport}
  </section>
  else content=<>
    <nav className="admin-section-nav" aria-label="관리 영역"><button className="quiet-button" aria-pressed={false} onClick={()=>openScreen('admin')}>데이터·리포트 관리</button><button className="quiet-button" aria-pressed={true} onClick={()=>openScreen('plan')}>계획환율·변경 이력</button></nav>
    {renderPlan()}
  </>

  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={e=>{e.preventDefault();document.getElementById('main-content')?.focus()}}>본문으로 건너뛰기</a>
    <header className="top-header"><div className="title-wrap"><h1><a className="title-primary brand-home" href="#dashboard" aria-label="LATAM FX 대시보드로" onClick={e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();openScreen('dashboard')}}>LATAM FX</a><span className="title-secondary">환율 대시보드</span></h1></div>
      <button className={`quiet-button admin-entry ${screen==='admin'||screen==='plan'?'selected':''}`} onClick={()=>openScreen('admin')}>관리자</button>
      <nav className="screen-nav" aria-label="화면 선택">{([['dashboard','대시보드'],['trends','환율 추이'],...(HAS_REPORTS?[['reports','환율 리포트']]:[])] as [FxScreen,string][]).map(([key,label])=><button type="button" key={key} className={screen===key?'tab active':'tab'} aria-current={screen===key?'page':undefined} onClick={()=>openScreen(key)}>{label}</button>)}</nav>
    </header>
      {screen==='reports'?<Disclosure className="report-data-context" summary="대시보드 자료 기준"><div className="data-toolbar"><DataStatus data={dataset} source={datasetSource} busy={loading} error={error}/></div></Disclosure>:<div className="data-toolbar" aria-label="자료 기준 및 관리"><DataStatus data={dataset} source={datasetSource} busy={loading||dailyRangeLoading} error={error} showAverage={screen==='dashboard'}/>
        <button className="header-refresh-button" aria-label={loading?'데이터 갱신 중':'데이터 갱신'} title="환율 데이터 갱신" onClick={()=>void refreshData()} disabled={loading}><span aria-hidden="true">↻</span><span className="refresh-label">{loading?'갱신 중':'데이터 갱신'}</span></button>
      </div>}
    <main id="main-content" tabIndex={-1}>{(screen==='admin'||screen==='plan')&&<AdminAccessPanel access={adminAccess}/>}<Suspense fallback={<div className="panel empty loading-panel"><h2>화면을 불러오는 중입니다.</h2></div>}>{content}</Suspense></main>
  </div>
}
export default App
