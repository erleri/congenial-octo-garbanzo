import { useEffect, useState } from 'react'
interface Calendar {
  checkedAt: string
  entries: { title: string; country: string; kind: string; state: string; plannedDate: string | null; publishedAt: string | null; publishedDate: string | null; sourceTime: string | null; timezone: string | null; period: string | null; url: string; source: string }[]
  sources: { id: string; country: string; status: string; coverage: string; url: string }[]
}
export default function OfficialCalendar() {
  const [data, setData] = useState<Calendar | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { let active = true; void fetch('/__report/official-calendar').then(r => { if (r.status === 404) return null; if (!r.ok) throw new Error(); return r.json() }).then(d => {
    if (d && (typeof d.checkedAt !== 'string' || !Array.isArray(d.entries) || !Array.isArray(d.sources) || d.entries.some((e: Calendar['entries'][number]) => typeof e.title !== 'string' || typeof e.state !== 'string' || typeof e.url !== 'string'))) throw new Error('invalid_calendar_projection')
    if (active) setData(d)
  }).catch(() => { if (active) setFailed(true) }); return () => { active = false } }, [])
  if (failed) return <p role="status">경제 일정 확인이 지연되고 있습니다.</p>
  if (!data) return null
  const upcoming = data.entries.filter(e => e.state === 'scheduled' && e.plannedDate && e.plannedDate >= data.checkedAt.slice(0, 10)).slice(0, 6)
  const releases = data.entries.filter(e => e.state === 'original_pending').slice(-4).reverse()
  return <details className="generation-status"><summary><strong>핵심 경제 일정과 최근 발표</strong> · 확인 {data.checkedAt.slice(0, 10)}</summary>
    <p>일정 탐색 결과입니다. 원문·대상 기간·이용 조건의 검토와 리포트 채택은 별도로 진행합니다.</p>
    <div className="generation-status-grid">{[...upcoming, ...releases].map((e, i) => <article key={`${e.source}-${i}`}><small>{e.country === 'GLOBAL' ? '미국 공통' : e.country} · {e.state === 'scheduled' ? '예정' : '발표 원문 검토 대기'}</small>
      <h3><a href={e.url} target="_blank" rel="noreferrer">{e.title} ↗</a></h3><p>{e.plannedDate ?? e.publishedDate ?? e.publishedAt?.slice(0, 10) ?? '날짜 미확인'}</p>
      <small>{e.sourceTime ?? '시각 미확인'} · {e.timezone ?? '현지 시간대 미확인'}</small>{e.period ? <p>대상 {e.period}</p> : null}</article>)}</div>
    <p>칠레·멕시코는 현재 공식 원문 수동 확인 경로를 준비했습니다. 목록이 비어 있어도 발표가 없었다고 판단하지 않습니다.</p>
  </details>
}
