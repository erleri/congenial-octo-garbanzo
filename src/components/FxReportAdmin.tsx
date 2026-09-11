import { useEffect, useState } from 'react'
import { loadFxReportRuns, reviewFxReport } from '../lib/fxReportRemote'
import type { FxReportRun } from '../types/fxReport'
import FxReportContentView from './FxReportContentView'

interface Props { canReview: boolean }

export default function FxReportAdmin({ canReview }: Props) {
  const [runs, setRuns] = useState<FxReportRun[]>([])
  const [reason, setReason] = useState('')
  const [working, setWorking] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = async () => setRuns(await loadFxReportRuns())
  useEffect(() => {
    let mounted = true
    if (!canReview) return () => { mounted = false }
    void loadFxReportRuns().then((rows) => { if (mounted) setRuns(rows) }).catch(() => { if (mounted) setNotice('리포트 실행 기록을 불러오지 못했습니다.') })
    return () => { mounted = false }
  }, [canReview])

  if (!canReview) return (
    <div className="table-card" style={{ marginTop: 12 }}><h3>2.0 리포트 검토</h3><p className="table-help">active admin 로그인 후 초안과 검증 결과를 확인할 수 있습니다.</p></div>
  )
  const pending = runs.filter((run) => run.status === 'pending_review')

  const decide = async (run: FxReportRun, decision: 'approved' | 'rejected') => {
    try {
      setWorking(run.id); setNotice(null)
      await reviewFxReport(run.id, decision, reason)
      setReason(''); await reload(); setNotice(decision === 'approved' ? '리포트를 공개했습니다.' : '리포트를 반려했습니다.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '검토 결과를 저장하지 못했습니다.')
    } finally { setWorking(null) }
  }

  return (
    <div className="table-card report-admin-card" style={{ marginTop: 12 }}>
      <div className="panel-header-inline"><div><h3>2.0 리포트 검토</h3><p className="table-help">표시 문장은 편집하지 않고 승인 또는 반려만 합니다.</p></div><span className="scope-badge scope-badge-operational">대기 {pending.length}</span></div>
      {notice ? <p className="inline-notice info-notice">{notice}</p> : null}
      {!pending.length ? <p className="table-help">검토 대기 중인 리포트가 없습니다.</p> : null}
      {pending.map((run) => (
        <article className="report-review-item" key={run.id}>
          <div className="report-review-meta"><strong>{run.baseDate} · attempt {run.attempt}</strong><span>{run.generationMode === 'ai_enhanced' ? `AI 보강 · ${run.aiModel ?? '-'}` : '자동 분석'}</span><span>{run.validation.valid ? '검증 통과' : `검증 실패: ${run.validation.errors.join(', ')}`}</span></div>
          {run.errorMessage ? <p className="inline-notice warning-notice">AI 보강 미사용: {run.errorMessage}</p> : null}
          <FxReportContentView content={run.selectedContent} evidence={run.evidence} />
          <div className="report-review-actions">
            <input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="반려 사유 (선택)" aria-label="반려 사유" />
            <button type="button" className="quiet-button" disabled={working === run.id} onClick={() => void decide(run, 'rejected')}>반려</button>
            <button type="button" className="header-refresh-button" disabled={working === run.id || !run.validation.valid} onClick={() => void decide(run, 'approved')}>승인·공개</button>
          </div>
          <details className="report-limitations"><summary>관리자 기술 정보</summary><pre>{JSON.stringify({ provider: run.aiProvider, model: run.aiModel, validation: run.validation, createdAt: run.createdAt }, null, 2)}</pre></details>
        </article>
      ))}
    </div>
  )
}
