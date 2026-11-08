import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { ExchangeRateDataset } from '../types/exchangeRate'
import type { CurrencyReport, CurrencyReportSummary } from '../types/currencyReport'
import { localProvider } from './provider'
import { historyFor, latestReports, selectReport, setLocalQuery } from './navigation'
import { comparisonIncludesRun } from './provenance'
import Detail from '../components/CurrencyReportDetail'
import '../index.css'
import '../App.css'
import './report.css'

import { REPORT_COUNTRIES as COUNTRY } from './countries'
const Dashboard = lazy(() => import('../components/Dashboard'))
const EvidenceReviewStudio = lazy(() => import('./EvidenceReviewStudio'))
const GenerationStatus = lazy(() => import('./GenerationStatus'))
const ReviewSimulation = lazy(() => import('./ReviewSimulation'))
const OfficialCalendar = lazy(() => import('./OfficialCalendar'))
const DbReview = lazy(() => import('./DbReview'))
export default function Experience() {
  const reportsEnabled = new URLSearchParams(location.search).get('reports') !== 'off'
  return <Suspense fallback={<p role="status">로컬 화면을 불러오는 중입니다.</p>}><ExperienceBody reportsEnabled={reportsEnabled}/></Suspense>
}
interface ComparisonManifest {
  title?: string
  statusLabel?: string
  note?: string
  winner: string | null
  confirmedCostUsd: number
  reservedUnknownUsd: number
  rows: { label: string; variant?: string; notes?: string[]; reviewLabel?: string; model: string; generationCostUsd?: number | null; costUsd: number | null; average: number | null; validationPassed?: boolean; validationErrors?: string[]; reportId?: string; passed: boolean }[]
}
function ComparisonPanel({ run, onRun }: { run?: string; onRun: (id: string) => void }) {
  const [data, setData] = useState<ComparisonManifest | null>(null)
  useEffect(() => { let active = true; void fetch('/__report/rules-comparison').then(r => r.status === 404 ? fetch('/__report/explanation-comparison') : r).then(r => r.status === 404 ? fetch('/__report/editorial-comparison') : r).then(r => r.status === 404 ? fetch('/__report/comparison') : r).then(r => r.ok ? r.json() : null).then(d => { if (active) setData(d) }).catch(() => {}); return () => { active = false } }, [])
  if (!data || !comparisonIncludesRun(data.rows, run)) return null
  const dollars = (n: number | null | undefined) => n == null ? '미확인' : `$${n.toFixed(6)}`
  return <details className="comparison-panel"><summary>{data.title ?? '로컬 품질·비용 비교'} · {data.statusLabel ?? (data.winner ? '에이전트 잠정 평가' : '새 기준 통과 결과 없음')}</summary><p>{data.note ?? '운영 게시 승인이 아닙니다.'} 새로고침·화면 전환은 API를 호출하지 않습니다.</p><div className="comparison-table-wrap"><table><thead><tr><th>비교 대상</th><th>품질 / 5</th><th>생성 비용</th><th>결과</th></tr></thead><tbody>{data.rows.map(row => <tr key={row.label}><td>{row.variant ? <strong>{row.variant}<br/></strong> : null}{row.model}</td><td>{row.average ?? '평가 안 함'}</td><td>{dollars(row.generationCostUsd)}</td><td>{row.reportId ? <button aria-pressed={run === row.reportId} onClick={() => { if (row.reportId) onRun(row.reportId) }}>{row.variant ?? (data.winner === row.label ? '기본 결과' : row.passed ? '비교 결과' : '미채택 결과')} 열기</button> : (row.validationErrors?.length ? row.validationErrors : ['내용 평가 미통과']).join(', ')}</td></tr>)}</tbody></table></div>{data.rows.filter(row => row.notes?.length).map(row => <div key={row.label}><strong>{row.variant ?? row.label} · {row.reviewLabel ?? (row.passed ? '잠정 통과' : '내용 평가 미통과')}</strong><ul>{row.notes!.map(note => <li key={note}>{note}</li>)}</ul></div>)}<p>이번 칠레 비교의 누적 확인 지출 {dollars(data.confirmedCostUsd)} · 비용 미확인 요청 예약 {dollars(data.reservedUnknownUsd)} · 과거 검색 비용 제외</p></details>
}

function ExperienceBody({ reportsEnabled }: { reportsEnabled: boolean }) {
  const [hash, setHash] = useState(location.hash)
  const [run, setRun] = useState(new URLSearchParams(location.search).get('run'))
  const [design, setDesign] = useState<'a' | 'b'>(new URLSearchParams(location.search).get('design') === 'b' ? 'b' : 'a')
  const [mode, setMode] = useState<'fixture' | 'live-local' | 'local-db'>(new URLSearchParams(location.search).get('mode') === 'local-db' ? 'local-db' : new URLSearchParams(location.search).get('mode') === 'live-local' ? 'live-local' : 'fixture')
  const [indexReady, setIndexReady] = useState(false)
  const [items, setItems] = useState<CurrencyReportSummary[]>([])
  const [report, setReport] = useState<CurrencyReport | null>(null)
  const [dataset, setDataset] = useState<ExchangeRateDataset | null>(null)
  const [error, setError] = useState('')
  const [cached, setCached] = useState(false)
  const [loading, setLoading] = useState(true)
  const provider = useMemo(() => localProvider(mode), [mode])
  useEffect(() => {
    const change = () => { setHash(location.hash); setRun(new URLSearchParams(location.search).get('run')) }
    window.addEventListener('hashchange', change)
    window.addEventListener('popstate', change)
    return () => { window.removeEventListener('hashchange', change); window.removeEventListener('popstate', change) }
  }, [])
  useEffect(() => { void fetch('/__report/data').then(r => { if (!r.ok) throw new Error(); return r.json() }).then(setDataset).catch(() => setError('환율 데이터 조회 실패')) }, [])
  useEffect(() => {
    let active = true
    if (!reportsEnabled) return
    void provider.list().then(r => { if (active) { setItems(r.items); setIndexReady(true); setCached(r.cached) } }).catch(e => { if (active) { setIndexReady(true); setError(String(e.message)) } })
    return () => { active = false }
  }, [provider, reportsEnabled, hash])
  const parts = hash.replace(/^#/, '').split('/')
  const currency = reportsEnabled && parts[0] === 'report' && ['BRL', 'MXN', 'CLP', 'COP', 'PEN', 'ARS'].includes(parts[1]) ? parts[1] : null
  const selected = currency ? selectReport(items, currency, parts[2], run) : undefined
  useEffect(() => {
    let active = true
    if (!selected) return
    void provider.get(selected.id).then(r => { if (active) { setReport(r.report); setCached(r.cached); setLoading(false); setError('') } }).catch(e => { if (active) { setReport(null); setCached(false); setError(String(e.message)); setLoading(false); if(['not_found','withdrawn'].includes(e.message)) setItems(previous=>previous.filter(i=>i.id!==selected.id)) } })
    return () => { active = false }
  }, [selected, provider, hash])
  const isDashboard = !reportsEnabled || !hash || hash === '#dashboard'
  const isEvidenceReview = reportsEnabled && hash.startsWith('#evidence-review')
  const isSimulation = reportsEnabled && hash === '#review-simulation'
  const isDbReview = reportsEnabled && mode === 'local-db' && hash === '#review-db'
  const go = (target: string) => { if (location.hash === `#${target}` && !run) return; if (isDashboard) sessionStorage.setItem('local-report-scroll', String(window.scrollY)); setReport(null); setLoading(true); const url = new URL(location.href); url.searchParams.delete('run'); url.hash = target; history.pushState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')); window.scrollTo(0, 0) }
  const chooseRun = (id: string) => { const item = items.find(i => i.id === id && i.currency === currency && (!parts[2] || i.baseDate === parts[2])); if (!item) return; const url = new URL(location.href); url.searchParams.set('run', id); url.hash = `report/${item.currency}/${item.baseDate}`; history.pushState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')) }
  const back = () => { go('dashboard'); requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, Number(sessionStorage.getItem('local-report-scroll') ?? 0)))) }
  return <div className={`report-experience design-${design}`} onClick={event => { if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; const link = (event.target as Element).closest('a[href^="#"]'); const target = link?.getAttribute('href')?.slice(1); if (target && !target.startsWith('source-')) { event.preventDefault(); go(target) } }}><div className="studio-bar"><span><b>2.0 DESIGN STUDIO</b> 로컬</span><span className="studio-description">같은 내용으로 디자인 비교</span><div className="studio-options"><button aria-pressed={design === 'a'} onClick={() => { setDesign('a'); setLocalQuery('design', 'a') }}>A · 에디토리얼</button><button aria-pressed={design === 'b'} onClick={() => { setDesign('b'); setLocalQuery('design', 'b') }}>B · 브리프</button><select aria-label="데이터 모드" value={mode} onChange={e => { setReport(null); setItems([]); setIndexReady(false); setCached(false); setLoading(true); setError(''); setLocalQuery('mode', e.target.value); setMode(e.target.value as typeof mode) }}><option value="fixture">편집 시안</option><option value="live-local">로컬 AI 결과</option><option value="local-db">로컬 승인 DB</option></select></div></div>
    <header className="experience-nav"><a className="experience-logo" href="#dashboard">LATAM <span>FX</span><small>MARKET INTELLIGENCE</small></a><nav><a href="#dashboard" aria-current={isDashboard ? 'page' : undefined}>대시보드</a><a href="#report" aria-current={!isDashboard && !isEvidenceReview && !isDbReview ? 'page' : undefined}>환율 리포트</a>{mode === 'live-local' ? <a href="#evidence-review" aria-current={isEvidenceReview ? 'page' : undefined}>근거 검토</a> : mode === 'local-db' ? <a href="#review-db" aria-current={isDbReview ? 'page' : undefined}>관리자 검토</a> : null}</nav><span className="nav-note">공개 정보로 읽는 소비와 통화</span></header>
    <main className="experience-main">{error ? <div className="local-notice" role="alert">{error} <button onClick={() => location.reload()}>다시 시도</button></div> : null}{cached ? <div className="local-notice">캐시 자료입니다. 보고서의 원래 기준일을 확인해 주세요.</div> : null}
      {!reportsEnabled ? <div className="local-notice">리포트 기능을 끈 로컬 복구 화면입니다. 환율 조회를 유지합니다.</div> : null}
      {reportsEnabled && mode === 'live-local' && !isEvidenceReview && !isSimulation ? <GenerationStatus/> : null}
      {reportsEnabled && mode === 'live-local' && isDashboard ? <OfficialCalendar/> : null}
      {isSimulation ? <ReviewSimulation/> : null}
      {isDbReview ? <DbReview/> : null}
      {mode === 'live-local' && currency === 'CLP' && selected ? <ComparisonPanel run={selected.id} onRun={chooseRun}/> : null}
      {isEvidenceReview ? <EvidenceReviewStudio/> : null}
      <div className="experience-route-content" data-mode={mode} hidden={isEvidenceReview || isSimulation || isDbReview}>
      {mode==='local-db' && !isDbReview ? <p className="small-note">승인된 로컬 DB 보고서만 표시합니다. 합성 연결 시험 자료는 제목과 생성 표시에서 구분합니다.</p> : null}
      {isDashboard ? <><div className="dashboard-intro"><span className="overline">NUMBERS INTO CONTEXT</span><h1>숫자에서, 맥락으로.</h1><p>환율을 확인하고, 통화별 해석으로 이어 읽으세요.</p></div>{dataset ? <Dashboard data={dataset} filters={{ currency: 'ALL', year: Number(dataset.baseDate.slice(0, 4)), month: Number(dataset.baseDate.slice(5, 7)), rateType: 'LOCAL_PER_USD' }} businessPlan={{ leading: {}, moving: {} }} renderReportLink={c => { const item = latestReports(items).find(i => i.currency === c); return item ? <a className="kpi-report-link" href={`#report/${c}`} onClick={e => { e.preventDefault(); go(`report/${c}`) }}><strong>{c} 해석 읽기 ↗</strong><small>보고서 {item.baseDate} · {mode === 'fixture' ? '편집 시안' : '로컬 초안'}</small></a> : null }}/>: <p>환율 데이터를 불러오는 중입니다.</p>}</> : currency ? <><div className="currency-tabs">{(['BRL', 'MXN', 'CLP', 'COP', 'PEN', 'ARS'] as const).map(c => <a href={`#report/${c}`} key={c} aria-current={currency === c ? 'page' : undefined}>{COUNTRY[c].name} <b>{c}</b></a>)}<select aria-label="보고서 이력" value={selected?.baseDate ?? ''} onChange={e => go(`report/${currency}/${e.target.value}`)}>
        <option value="" disabled>발행일 선택</option>
        {selected && !historyFor(items, currency).some(i => i.baseDate === selected.baseDate) ? <option value={selected.baseDate}>{selected.baseDate} · 검토 초안</option> : null}
        {historyFor(items, currency).map(i => <option key={i.id} value={i.baseDate}>{i.baseDate}</option>)}
      </select></div>{!indexReady ? <p role="status">리포트 목록을 불러오는 중입니다.</p> : !selected ? <div className="report-empty"><h1>아직 읽을 보고서가 없습니다.</h1><p>새로운 근거가 있는 보고서가 준비되면 여기에 표시됩니다.</p><a href="#report">리포트 목록으로</a></div> : error && report?.id !== selected.id ? <p>보고서를 표시하지 못했습니다. 위의 다시 시도를 눌러 주세요.</p> : loading || report?.id !== selected.id ? <p role="status">리포트를 불러오는 중입니다.</p> : <Detail key={report.id} report={report} onBack={back}/>}</> : <><div className="report-list-heading"><span className="overline">CURRENCY BRIEFS</span><h1>환율 뒤의 이야기.</h1><p>왜 움직였는지, 소비와 판매 환경에는 어떤 의미인지.</p></div><div className="brief-list">{latestReports(items).map(i => <a key={i.id} className={`brief-list-card currency-${i.currency.toLowerCase()}`} href={`#report/${i.currency}/${i.baseDate}`}><span className="list-country">{COUNTRY[i.currency].en} <b>{i.currency}</b></span><h2>{i.title}</h2><p>{i.summary}</p><div><time>{i.baseDate}</time><span>한 장 읽기 ↗</span></div></a>)}</div>{indexReady && !items.length ? <div className="report-empty">생성된 로컬 보고서가 없습니다. 편집 시안 모드에서 디자인을 먼저 확인할 수 있습니다.</div> : null}<p className="sample-note">{mode === 'fixture' ? '공개 자료로 작성한 검토용 편집 시안입니다. 운영 게시물이나 AI 생성 결과가 아닙니다.' : '정제된 로컬 AI 초안입니다. 운영 사이트에는 게시되지 않습니다.'}</p></>}
      </div>
    </main><footer className="experience-footer">LATAM FX 2.0 · 로컬 검토 환경 · A안 기준 · 콘텐츠 검증 중</footer></div>
}
