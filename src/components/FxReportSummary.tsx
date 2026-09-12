import { useEffect, useState } from 'react'
import { loadPublishedFxReports } from '../lib/fxReportRemote'
import type { PublishedFxReport } from '../types/fxReport'
import FxReportContentView from './FxReportContentView'

interface Props { onOpen: () => void }

export default function FxReportSummary({ onOpen }: Props) {
  const [report, setReport] = useState<PublishedFxReport | null>(null)
  const [cached, setCached] = useState(false)

  useEffect(() => {
    let mounted = true
    void loadPublishedFxReports(1).then((result) => {
      if (mounted) { setReport(result.reports[0] ?? null); setCached(result.cached) }
    }).catch(() => { /* The 1.x dashboard must remain usable without reports. */ })
    return () => { mounted = false }
  }, [])

  if (!report) return null
  return (
    <section className="panel fx-report-summary-panel">
      <div className="panel-header-inline">
        <div>
          <span className="scope-badge scope-badge-operational">LATAM FX 2.0</span>
          <h2>오늘의 환율 리포트</h2>
          <p className="table-help">기준일 {report.baseDate} · {report.generationMode === 'ai_enhanced' ? 'AI 보강' : '자동 분석'}{cached ? ' · 캐시' : ''}</p>
        </div>
        <button type="button" className="quiet-button" onClick={onOpen}>상세 리포트</button>
      </div>
      <FxReportContentView content={report.content} evidence={report.evidence} compact />
    </section>
  )
}
