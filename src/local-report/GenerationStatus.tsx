import { useEffect, useState } from 'react'

interface StatusProjection {
  checkedAt: string
  datasetBaseDate: string
  decisions: { currency: string; status: string; observedDate: string | null; priceIssues: string[]; windows: { key: string; changePct: number | null; candidate: boolean; status: string }[]; events: { id: string; status: string; reason: string }[] }[]
}
const LABELS: Record<string, string> = { draft_candidate: '새 설명 검토 완료 · 작성 승인 대기', research_candidate: '배경 확인 중', evidence_pending: '근거 검토 대기', duplicate: '이미 검토한 사건', no_new_interpretation: '추가 해석 없음', data_failed: '자료 확인 실패 또는 지연', correction_required: '기존 해석 재검토' }
export default function GenerationStatus() {
  const [data, setData] = useState<StatusProjection | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    void fetch('/__report/generation-status').then(r => { if (r.status === 404) return null; if (!r.ok) throw new Error(); return r.json() }).then(value => {
      if (value && (typeof value.checkedAt !== 'string' || typeof value.datasetBaseDate !== 'string' || !Array.isArray(value.decisions) || value.decisions.some((d: StatusProjection['decisions'][number]) => typeof d.currency !== 'string' || !Array.isArray(d.priceIssues) || !Array.isArray(d.windows) || d.windows.some(w => w.changePct !== null && !Number.isFinite(w.changePct))))) throw new Error('invalid_status_projection')
      if (active) setData(value)
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [])
  if (failed) return <p role="status">리포트 확인 상태를 불러오지 못했습니다. 기존 보고서의 기준일을 확인해 주세요.</p>
  if (!data) return null
  return <section className="generation-status" aria-label="통화별 리포트 확인 상태">
    <div className="generation-status-heading"><h2>리포트 확인 현황</h2><span>확인 {data.checkedAt.slice(0, 10)} · 저장 자료 기준 {data.datasetBaseDate}</span></div>
    <p>새로 설명할 정보와 근거가 준비된 때에만 작성합니다. 아래 확인일은 기존 보고서의 발행일을 바꾸지 않습니다.</p>
    <div className="generation-status-grid">{data.decisions.map(d => <article key={d.currency}>
      <strong>{d.currency}</strong><p>{LABELS[d.status] ?? '검토 필요'}</p><small>마지막 가격 관측 {d.observedDate ?? '없음'}</small>
      <details><summary>판단 근거</summary>{d.priceIssues.length ? <p>가격 자료의 최신성·비교 기준을 다시 확인해야 합니다.</p> : null}
        <ul>{d.windows.map(w => <li key={w.key}>{({ daily: '전 관측일', five: '5관측일', twenty: '20관측일' } as Record<string, string>)[w.key]}: {w.changePct === null ? '자료 부족' : `${w.changePct >= 0 ? '+' : ''}${w.changePct.toFixed(2)}%`}{w.status === 'unverified' ? ' · 비교 미검증' : w.candidate ? ' · 조사 후보' : ''}</li>)}</ul>
        <p>생성·공개 승인은 별도 검토합니다.</p></details>
    </article>)}</div>
  </section>
}
