import { useEffect, useState } from 'react'
import type { EvidenceReview, EvidenceReviewSummary } from '../types/evidenceReview'

const COUNTRY = { BRL: '브라질 헤알', MXN: '멕시코 페소', CLP: '칠레 페소' }
const TIER = {
  official_review: '공식기관 확인 대상',
  trusted_reporting_review: '신뢰 보도 검토 대상',
  local_reporting_review: '현지 경제지 검토 대상',
  discovery_only: '발견 전용 · 근거 사용 불가',
}
const DISCOVERY_SOURCE = {
  gdelt: 'GDELT 검색',
  openrouter_web_search: 'OpenRouter 보강 검색',
  local_public_sitemap: '현지 공개 sitemap',
}
const BLOCKER: Record<string, string> = {
  invalid_or_future_publication_time: '발행시각이 유효하지 않거나 기준일 이후입니다.',
  domain_not_in_review_list: '현재 검토 대상 매체 목록에 포함되지 않았습니다.',
  observation_time_missing: '환율의 일중 관측시각이 없어 사건의 선후를 확정할 수 없습니다.',
  published_after_observation: '환율 관측 이후에 발행된 기사입니다.',
  direct_attribution_not_reviewed: '기사 원문이 변동 원인을 직접 설명하는지 아직 확인하지 않았습니다.',
}

export default function EvidenceReviewStudio() {
  const [items, setItems] = useState<EvidenceReviewSummary[]>([])
  const [selected, setSelected] = useState<EvidenceReview | null>(null)
  const [error, setError] = useState('')
  const load = (id: string) => fetch(`/__evidence-review/${encodeURIComponent(id)}`).then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<EvidenceReview> }).then(setSelected)
  useEffect(() => { void fetch('/__evidence-review/index').then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<EvidenceReviewSummary[]> }).then(result => { setItems(result); const requested = location.hash.replace(/^#evidence-review\/?/, ''); if (result.length) void load(requested || result[0].id) }).catch(() => setError('검토 자료를 불러오지 못했습니다.')) }, [])
  if (error) return <div className="report-empty"><h1>근거 검토 자료 오류</h1><p>{error}</p></div>
  if (!items.length) return <div className="report-empty"><h1>준비된 근거 검토 자료가 없습니다.</h1><p>로컬 수집 후 검토 자료 생성 명령을 실행해야 합니다.</p></div>
  if (!selected) return <p role="status">근거 검토 자료를 불러오는 중입니다.</p>
  const moveLabel = selected.movement.direction === 'local_weaker' ? '현지통화 약세 방향' : selected.movement.direction === 'local_stronger' ? '현지통화 강세 방향' : '보합'
  return <section className="evidence-studio">
    <header className="evidence-studio-head"><div><span className="overline">LOCAL EVIDENCE REVIEW</span><h1>{COUNTRY[selected.currency]} · 원인 근거 검토</h1><p>{selected.baseDate} 환율 움직임과 기사·공식 발표의 시간 관계를 대조합니다.</p></div><select aria-label="검토 자료" value={selected.id} onChange={event => { location.hash = `evidence-review/${event.target.value}`; void load(event.target.value) }}>{items.map(item => <option key={item.id} value={item.id}>{item.currency} · {item.baseDate}</option>)}</select></header>
    <div className="evidence-verdict"><span>현재 판정</span><strong>직접 원인 미확인</strong><p>근거가 승격되지 않았으므로 새 원인 리포트 발행은 차단되어 있습니다.</p></div>
    <div className="evidence-movement"><div><span>전 관측일</span><strong>{selected.movement.previousValue.toLocaleString()}</strong><small>{selected.movement.previousObservedDate}</small></div><div><span>기준일</span><strong>{selected.movement.currentValue.toLocaleString()}</strong><small>{selected.movement.observedDate}</small></div><div><span>변화</span><strong>{selected.movement.dailyPct >= 0 ? '+' : ''}{selected.movement.dailyPct.toFixed(2)}%</strong><small>{moveLabel}</small></div><div><span>관측 시각</span><strong>{selected.movement.observationAt ? selected.movement.observationAt.slice(11, 16) + ' UTC' : '확인 불가'}</strong><small>{selected.movement.observationAt ? '일중 선후 비교 가능' : '날짜 단위 비교만 가능'}</small></div></div>
    <div className="evidence-columns"><section><div className="evidence-section-title"><span className="overline">DISCOVERED COVERAGE</span><h2>기사 후보</h2></div>{selected.candidates.length ? selected.candidates.map(candidate => <article className="evidence-candidate" key={candidate.id}><div className="candidate-meta"><span className={`tier tier-${candidate.reviewTier}`}>{TIER[candidate.reviewTier]}</span><time>{candidate.publishedAt ?? '발행시각 없음'}</time></div><h3><a href={candidate.url} target="_blank" rel="noreferrer">{candidate.title} ↗</a></h3><p>{candidate.publisher} · {candidate.language ?? '언어 미상'} · {candidate.sourceCountry ?? '출처 국가 미상'} · {DISCOVERY_SOURCE[candidate.discoverySource]}{candidate.candidateFocus ? ` · ${candidate.candidateFocus === 'currency_move' ? '환율 변동 직접 보도' : '시장 배경'}` : ''}</p>{candidate.metadataSummary && <p>{candidate.metadataSummary}</p>}<ul>{candidate.blockers.map(blocker => <li key={blocker}>{BLOCKER[blocker] ?? blocker}</li>)}</ul><div className="candidate-status">{candidate.eligibleForTriggerReview ? '직접 원인 검토 가능 · 원문 확인 필요' : candidate.eligibleForContextReview ? '배경 근거 검토 가능 · 원문 확인 필요' : '현재 근거 사용 불가'}</div></article>) : <p>발견된 기사 후보가 없습니다.</p>}</section>
      <aside><div className="evidence-section-title"><span className="overline">OFFICIAL CROSS-CHECK</span><h2>공식 확인처</h2></div>{selected.officialReviewTargets.map(source => <a className="official-review-link" href={source.url} target="_blank" rel="noreferrer" key={source.id}><strong>{source.publisher}</strong><span>{source.kind} · 원문 확인 필요</span><b>열기 ↗</b></a>)}<div className="review-checklist"><h3>채택 전 필수 확인</h3><ol>{selected.requiredNextChecks.map(check => <li key={check}>{check}</li>)}</ol></div></aside></div>
  </section>
}
