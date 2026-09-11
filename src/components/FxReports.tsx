import { useEffect, useState } from 'react'
import { loadPublishedFxReports } from '../lib/fxReportRemote'
import type { PublishedFxReport } from '../types/fxReport'
import FxReportContentView from './FxReportContentView'

export default function FxReports() {
  const [reports, setReports] = useState<PublishedFxReport[]>([])
  const [selected, setSelected] = useState<PublishedFxReport | null>(null)
  const [cached, setCached] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    void loadPublishedFxReports(30).then((result) => {
      if (!mounted) return
      setReports(result.reports); setSelected(result.reports[0] ?? null); setCached(result.cached)
    }).catch((loadError) => {
      if (mounted) setError(loadError instanceof Error ? loadError.message : '리포트를 불러오지 못했습니다.')
    })
    return () => { mounted = false }
  }, [])

  if (error) return <div className="panel empty"><h2>리포트를 불러오지 못했습니다.</h2><p className="error-message">{error}</p></div>
  if (!selected) return <div className="panel empty"><h2>아직 공개된 환율 리포트가 없습니다.</h2><p className="table-help">관리자 검토가 완료되면 이 화면에 표시됩니다.</p></div>

  return (
    <div className="report-page-grid">
      <aside className="panel report-history-panel">
        <h2>최근 리포트</h2>
        <p className="table-help">최근 30개 기준일</p>
        <div className="report-history-list">
          {reports.map((report) => (
            <button key={report.baseDate} type="button" className={selected.baseDate === report.baseDate ? 'active' : ''} onClick={() => setSelected(report)}>
              <strong>{report.baseDate}</strong>
              <span>{report.generationMode === 'ai_enhanced' ? 'AI 보강' : '자동 분석'}</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="panel report-detail-panel">
        <div className="panel-header-inline">
          <div><h2>환율 변동 리포트</h2><p className="table-help">기준일 {selected.baseDate} · 게시 {new Date(selected.publishedAt).toLocaleString('ko-KR')}</p></div>
          <span className="scope-badge">{selected.generationMode === 'ai_enhanced' ? 'AI 보강' : '자동 분석'}{cached ? ' · 캐시' : ''}</span>
        </div>
        {cached ? <p className="inline-notice warning-notice">운영 데이터 연결이 원활하지 않아 마지막 캐시를 표시합니다.</p> : null}
        <FxReportContentView content={selected.content} evidence={selected.evidence} />
        {selected.evidence.news.length ? (
          <section className="report-section report-news-index"><h4>선별 뉴스 근거</h4><ul>{selected.evidence.news.map((item) => <li key={item.id}><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a><span>{item.source}{item.publishedAt ? ` · ${new Date(item.publishedAt).toLocaleString('ko-KR')}` : ''}</span></li>)}</ul></section>
        ) : null}
      </section>
    </div>
  )
}
