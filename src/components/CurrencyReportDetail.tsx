import { useState, type ReactNode } from 'react'
import Disclosure from './Disclosure'
import './report-detail-tools.css'
import type { CurrencyReport, ReportClaim } from '../types/currencyReport'
import { isHistoricalComparison } from '../lib/reports/provenance'
import { reportMetadata, evidenceMetadata } from '../lib/reports/metadata'
import { reportChartData } from '../lib/reports/chart-data'
import { REPORT_COUNTRIES as COUNTRY } from '../lib/reports/countries'
import { reportPriceSourceLabel } from '../lib/report-source-timing.js'
import { claimPresentation, sourceAttribution } from '../lib/reports/claimPresentation'
import { localReportMode } from '../lib/reports/client'
import { recordUsage } from '../lib/usage'
const KINDS = { fact: '확인된 사실', interpretation: '해석', mechanism: '일반적 전달 경로' }
function factText(text: string, report: CurrencyReport) {
  return text.replace(/\{\{([a-z_]+)\}\}/g, (_, id: string) => report.facts.find(f => f.id === id)?.label ?? '자료 없음')
}
function Claim({ claim, report }: { claim: ReportClaim; report: CurrencyReport }) {
  const display = claimPresentation(claim,report)
  return <article className="brief-claim"><div className="claim-heading"><h3>{claim.title}</h3><span>{KINDS[claim.kind]}</span></div><p>{display.text}</p>{display.bases.length > 0 && <details className="claim-basis-details"><summary>통계 비교 기준</summary><div className="claim-statistic-basis" aria-label="통계 비교 기준">{display.bases.map(basis => <span key={basis}>{basis}</span>)}</div></details>}<div className="claim-sources">{display.evidenceIds.map(id => {
    const e = report.evidence.find(x => x.id === id)
    return e ? <a href={`#source-${e.id}`} key={id} onClick={event => { event.preventDefault(); const el = document.getElementById(`source-${e.id}`); const d = el?.closest('details'); if (d) d.open = true; el?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}>{e.publisher}{e.period ? ` · ${e.period}` : ''} ↗</a> : null
  })}</div></article>
}
function Chart({ report }: { report: CurrencyReport }) {
  const [months, setMonths] = useState(3)
  const { points, sparse, x } = reportChartData(report, months)
  if (points.length < 2) return <p>차트를 표시할 관측값이 부족합니다.</p>
  const min = Math.min(...points.map(p => p.value)), max = Math.max(...points.map(p => p.value))
  const padding = (max - min || max * .01) * .16
  const low = min - padding, high = max + padding
  const y = (v: number) => 25 + (1 - (v - low) / (high - low)) * 195
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const last = points.at(-1)!
  return <section className="brief-chart"><div className="chart-toolbar"><div><span className="overline">THE CHANGE</span><h2>무엇이 달라졌나</h2></div><div className="range-tabs" aria-label="차트 기간">{[1, 3, 12].map(m => <button type="button" key={m} aria-pressed={months === m} onClick={() => setMonths(m)}>{m === 12 ? '1년' : `${m}개월`}</button>)}</div></div>
    <div className="chart-unit">1 USD당 {report.currency} · 아래로 갈수록 {COUNTRY[report.currency].unit} 강세</div>
    <svg viewBox="0 0 755 255" role="img" aria-label={`${report.currency} 환율 ${points[0].date}부터 ${last.date}까지. 시작 ${points[0].value}, 마지막 ${last.value}.`}>
      <defs><linearGradient id={`area-${report.currency}`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" stopOpacity=".14"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
      {[0, .5, 1].map(t => <g key={t}><line x1="25" x2="680" y1={25 + t * 195} y2={25 + t * 195} stroke="#dfe6e5" strokeDasharray="3 5"/><text x="695" y={29 + t * 195}>{(high - t * (high - low)).toFixed(2)}</text></g>)}
      {sparse ? points.map((p, i) => <circle key={`${p.date}-${i}`} cx={x(i)} cy={y(p.value)} r="4.5" fill="currentColor"><title>{p.date} · {p.value}</title></circle>) : <><path d={`${line} L675,220 L25,220 Z`} fill={`url(#area-${report.currency})`}/><path d={line} fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinejoin="round"/><circle cx="675" cy={y(last.value)} r="4.5" fill="currentColor"/></>}
      <text x="25" y="245">{points[0].date}</text><text x="595" y="245">{last.date}</text>
    </svg><div className="chart-foot">보고서 관측일 {report.observedDate} · {sparse ? '일부 날짜의 관측값만 표시하며 점 사이의 경로는 추정하지 않습니다.' : '보고서에 저장된 관측값 · 가로축은 실제 날짜 간격입니다.'}</div>
  </section>
}
export default function CurrencyReportDetail({ report, onBack, backLabel = '← 대시보드로', mobileNavigation, onRefresh }: { report: CurrencyReport; onBack: () => void; backLabel?: string; mobileNavigation?:ReactNode; onRefresh?:()=>void }) {
  const [copyState, setCopyState] = useState('링크 복사')
  const country = COUNTRY[report.currency]
  const metadata = reportMetadata(report)
  const attributions = sourceAttribution(report)
  const limitations = [...new Set([...report.content.limitations, ...report.limitations])]
  const referenceLabel = report.testOnly ? '합성 DB 연결 시험 · AI 미사용' : report.status === 'approved' ? (report.authorship === 'ai_with_manual_edit' ? 'AI 원고 · 수동 편집 · 승인 보고서' : 'AI 작성 · 승인 보고서') : report.comparison?.editorialRevision ? '수동 편집 사본 · AI 재생성 없음' : report.comparison?.citationRevision ? 'AI 원고 · 출처 연결 보완 · 재생성 없음' : report.comparison?.referenceOnly ? '편집 기준 예시 · OpenRouter 재호출 없음' : report.comparison?.rulesReviewOnly ? 'AI 작성 · 공통 규칙 내용 검토 미완료' : null
  return <>{report.status === 'rejected' ? <div className="local-notice" role="alert"><strong>내용 평가 미통과 · 비교용이며 채택·게시하지 않았습니다.</strong>{report.comparison?.reviewNotes?.length ? <ul>{report.comparison.reviewNotes.map(note => <li key={note}>{note}</li>)}</ul> : <p>근거가 뒷받침하지 않는 설명이 포함되어 있습니다.</p>}</div> : null}<div className={`detail-tools ${mobileNavigation?'has-mobile-navigation':''}`}><button onClick={onBack}><span className="report-back-full">{backLabel}</span><span className="report-back-short" aria-hidden="true">← 목록</span></button>{mobileNavigation&&<div className="report-mobile-navigation">{mobileNavigation}</div>}<Disclosure desktopOpen className="report-more-tools" summary="더보기" label="보고서 도구 더보기"><div><button onClick={async () => { try { await navigator.clipboard.writeText(location.href); setCopyState('복사됨') } catch { setCopyState('주소창에서 복사해 주세요') } }}>{copyState}</button><button onClick={() => window.print()}>인쇄 ↗</button>{onRefresh&&<button onClick={onRefresh}>게시 상태 새로고침</button>}</div></Disclosure></div>
    <article className={`currency-paper currency-${report.currency.toLowerCase()}`}>
      <div className="paper-masthead"><span>LATAM FX <b>/ CURRENCY BRIEF</b></span><span>{country.en} — {report.baseDate.replaceAll('-', '.')}</span></div>
      <header className="paper-hero"><div className="country-name"><span className="country-mark">{country.index}</span><span>{country.name} · {country.unit}</span><span className="currency-code">{report.currency}</span></div><h1>{report.content.title}</h1><p className="paper-deck">{factText(report.content.summary, report)}</p><div className="paper-meta"><span>{referenceLabel ?? (report.status === 'rejected' ? 'AI 작성 · 미채택 비교본' : report.generationMode === 'editorial_fixture' ? '공개 자료 기반 편집 시안 · AI 미사용' : 'AI 작성 · 검토 초안')}</span><span>보고서 기준 {report.baseDate}</span>{isHistoricalComparison(report) ? <span>과거 사례 사후 검토 · 현재 시장 보고서 아님</span> : null}</div>{report.comparison?.historicalReview === false ? <p className="small-note">{reportPriceSourceLabel(report) ? <>리포트용 검증 가격 자료 수집 {metadata.fetchedAt ?? '시각 미제공'} ·</> : <>운영 환율 수집 {report.comparison.datasetFetchedAt ?? '시각 미제공'} · 이후 장중 뉴스는 별도 시점의 설명입니다.</>} 생성 {report.comparison.model} · 비용 {report.comparison.costUsd === null ? '미확인' : `$${report.comparison.costUsd.toFixed(6)}`}</p> : null}</header>
      <div className="report-data-meta"><span>환율 관측일 {metadata.observedDate} · 관측시각 {metadata.observationAt ?? '미제공'}</span><span>자료 수집 {metadata.fetchedAt ?? '시각 미기록'} · {metadata.source} · {metadata.unit}</span></div>
      <div className="brief-stats">{report.facts.filter(f=>['spot','day','five','mtd'].includes(f.id)).map(f => <div key={f.id}><span>{({ spot: '기준 환율', day: '전 관측일', five: '5관측일', mtd: '월초 대비' } as Record<string, string>)[f.id]}</span><strong>{f.id === 'spot' ? f.value.toFixed(4) : `${f.value >= 0 ? '+' : ''}${f.value.toFixed(2)}%`}</strong><small>{f.id === 'spot' ? `${report.currency} / 1 USD` : f.value > 0 ? `${country.unit} 약세 방향` : f.value < 0 ? `${country.unit} 강세 방향` : '보합'}</small></div>)}</div>
      <div className="paper-body" style={report.content.drivers.length ? undefined : {gridTemplateColumns:'1fr'}}><div className="change-column"><Chart report={report}/><Claim claim={report.content.change} report={report}/></div>{report.content.drivers.length > 0 && <section className="why-column"><span className="overline">THE CONTEXT</span><h2>{report.purpose === 'periodic_check' ? '이번 점검 배경' : report.purpose === 'economic_update' ? '경제·소비 환경의 새 정보' : '왜 움직였나'}</h2>{report.content.drivers.map(c => <Claim key={c.title} claim={c} report={report}/>)}</section>}</div>
      {report.content.implications.length > 0 && <section className="business-section"><div className="business-label"><span className="overline">THE SALES PERSPECTIVE</span><h2>영업 환경에는 <br/>어떤 의미인가</h2><span className="small-note">가전 · TV · 내구재 소비</span></div><div className="business-content">{report.content.implications.map(c => <Claim key={c.title} claim={c} report={report}/>)}</div></section>}
      {report.content.watch.length > 0 && <section className="watch-section"><div><span className="overline">WHAT COULD CHANGE</span><h2>흐름을 바꿀 변수</h2></div><div>{report.content.watch.map(c => <Claim key={c.title} claim={c} report={report}/>)}</div></section>}
      <details className="brief-evidence" onToggle={event=>{if(event.currentTarget.open&&report.status==='approved'&&!report.testOnly)void recordUsage({event:'evidence_open',screen:'reports',currency:report.currency,reportId:report.id})}}><summary>근거와 해석의 한계 <span>{report.evidence.length}개 공개 출처 · 펼쳐 읽기</span></summary><div className="evidence-body">{report.evidence.map(e => { const meta = evidenceMetadata(e, report); return <section id={`source-${e.id}`} key={e.id}><h3><a href={e.url} target="_blank" rel="noreferrer">{e.publisher} — {e.title} ↗</a></h3><p>{meta.source} · {meta.source === '일반 원리' ? `확인 ${e.collectedAt || '확인일 미기록'}` : `발표 ${meta.publishedAt} · 수집 ${e.collectedAt || '시각 미기록'}`} · 대상 {meta.period}{meta.sourceTiming ? ` · ${meta.sourceTiming.label}` : null}</p><p>{e.summary}</p></section> })}<ul>{limitations.map(t => <li key={t}>{t}</li>)}</ul></div></details>
      <div className="print-sources">{report.evidence.map(e => <p key={e.id}>{e.publisher} · 발표 {e.publishedAt || '미제공'} · 대상 {e.period || '미제공'} · {e.url}{e.provenance==='official'?<> · {e.summary}</>:null}</p>)}</div>
      {attributions.map(a=><p className="small-note source-license" key={a.host}>{a.text} {a.license?<><a href={a.license} target="_blank" rel="noreferrer">{a.label}</a> · </>:null}<a href={a.terms} target="_blank" rel="noreferrer">출처 이용 조건</a></p>)}
      <footer className="paper-footer"><span>LATAM FX / PUBLIC INFORMATION, BUSINESS CONTEXT</span><span>{report.testOnly?'합성 연결 시험':report.status==='approved'?'승인 보고서':'검토본'}{localReportMode()?' · 로컬 검증 · 운영 미게시':''}</span></footer>
    </article></>
}
