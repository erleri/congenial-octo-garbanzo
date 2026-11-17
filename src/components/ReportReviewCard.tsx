import type { CurrencyReport } from '../types/currencyReport'
import { claimPresentation } from '../lib/reports/claimPresentation'
import { readerText } from '../lib/reports/reader-display'
import { reportSummaryText } from '../lib/reports/fact-display'
import { approvalBlockers, missingReviewFacts, type ReviewValidation } from '../lib/reports/approval-readiness'

export interface ReviewRun {
  id: string; status: string; candidate: CurrencyReport; validation: ReviewValidation
  attempt: number; created_at: string; cost?: { costUsd?: number | null }
  referenceVersion?: string | null; editionKind?: string | null
  storage_required?: boolean; storageComplete?: boolean; expectedPublicId?: string | null
}

// Presentation only: current-version, permission and storage checks remain in the caller and DB.
export default function ReportReviewCard({run,busy,reason,revision,focused,targetUnavailable,onRevision,onReview,actionNotice}:{
  run: ReviewRun; busy: boolean; reason: string; revision: string; focused: boolean; targetUnavailable: boolean
  onRevision: (value:string)=>void; onReview: (decision:string)=>void
  actionNotice?:string
}) {
  const published=run.status==='published', blockers=approvalBlockers(run.validation)
  const missing=missingReviewFacts(run.candidate,!!run.referenceVersion||!!run.validation.generationReason)
  if(missing.length)blockers.push('저장 수치 확인 필요 · '+missing.join(', '))
  const decision=run.validation.generationReason
  const storedReason=({context_update:'새 자료에 따른 설명 업데이트',periodic_check:'정기 점검',initial_check:'첫 정기 점검'} as Record<string,string>)[run.editionKind??'']
  const reasonLabel=decision?{initial:'첫 정기 점검',periodic:'정기 점검 도래',market:'누적 변동 기준 도달',policy:'중요한 환율 설명 변화'}[decision.purpose]:
    storedReason??({periodic_check:'정기 점검',economic_update:'경제·시장 설명 업데이트',fx_explanation:'환율 변동 해설'} as const)[run.candidate.purpose!]
  return <article id={`review-target-${run.id}`} tabIndex={-1} className="db-review-run">
    <header className="review-card-heading">
      <div className="review-card-meta"><strong>{run.candidate.currency}</strong><span>{run.candidate.baseDate}</span><span>시도 {run.attempt}</span></div>
      <span className={`review-state ${published?'published':'pending'}`}>{published?'승인':'검토 대기'}</span>
    </header>
    {reasonLabel&&<p className="review-storage-note">{decision||storedReason?'생성 사유':'저장된 원고 유형'} · {reasonLabel}</p>}
    <h3>{run.candidate.content.title}</h3>
    <p className="review-card-summary">{reportSummaryText(run.candidate)}</p>
    <p className="review-storage-note">{run.storage_required ? run.storageComplete ? '자료 저장 완료 기록 있음 · 승인 시 일치 여부 재확인' : '자료 저장 확인 필요 — 승인 보류' : '기존 저장 방식의 보존 원고'}</p>
    {run.candidate.testOnly&&<p className="review-storage-note">합성 연결 시험 · AI 미사용</p>}
    <details className="review-body" open={focused||undefined}><summary>본문·근거·검증 결과</summary>
      <p className="table-help">환율 관측일 {run.candidate.observedDate}{run.candidate.observationAt?` · 관측시각 ${run.candidate.observationAt}`:''}</p>
      {decision&&<div className="table-help">
        <p>전일 대비 {run.candidate.facts.find(f=>f.id==='day')?.label??'자료 없음'}
          {decision.cumulativePct!=null&&Number.isFinite(decision.cumulativePct)&&<> · {decision.anchorBaseDate} 대비 {decision.cumulativePct>0?'+':''}{decision.cumulativePct.toFixed(2)}% (기준 ±{decision.thresholdPct}%)</>}
          {decision.periodicDueDate&&<> · 정기 점검 예정 {decision.periodicDueDate}</>}</p>
        {decision.comparison&&<p>누적 비교 기준 · {decision.comparison.date} 하나은행 {decision.comparison.value.toLocaleString('ko-KR',{maximumFractionDigits:6})} · 기존 공개 숫자는 발행 당시 값 보존</p>}
        {decision.change&&<p>{decision.change.reason} · {run.candidate.evidence.find(e=>e.id===decision.change?.evidenceId)?.publisher??'원고 근거 참조'}</p>}
      </div>}
      {[run.candidate.content.change,...run.candidate.content.drivers,...run.candidate.content.implications,...run.candidate.content.watch].filter(Boolean).map((claim,i)=>{
        const display=claimPresentation(claim,run.candidate)
        return <div className="review-claim" key={i}><h4>{claim.title}</h4><p>{readerText(display.text)}</p>
          {display.bases.length>0&&<small>{display.bases.join(' · ')}</small>}</div>
      })}
      <details><summary>사용한 수치와 출처</summary><dl>{run.candidate.facts.map(f=><div key={f.id}><dt>{f.label}</dt><dd>{String(f.value)}</dd></div>)}</dl><ul>{run.candidate.evidence.map(e=><li key={e.id}>{e.url.startsWith('https://')?<a href={e.url} target="_blank" rel="noreferrer">{e.publisher} · {e.title}</a>:e.title}<small> · 대상 기간 {e.period} · 발표 {e.publishedAt}</small></li>)}</ul></details>
      <p className="review-validation">구조 검사 {run.validation.structureValid?'통과':'미통과'} · 내용 검토 {run.validation.contentReview==='passed'?'통과':run.validation.contentReview??'미검증'}</p>
    </details>
    {!published&&blockers.length>0&&<p className="review-hold">승인 보류: {blockers.join(' · ')}</p>}
    {!published&&run.expectedPublicId&&<label className="review-replacement">공개본 교체 유형 <select aria-label="공개본 교체 유형" value={revision} onChange={e=>onRevision(e.target.value)}><option value="">유형 선택</option><option value="correction">사실·출처 정정</option><option value="editorial">문체·표현 편집</option><option value="replacement">동일 날짜 리포트 교체</option></select><small>현재 공개 ID {run.expectedPublicId}</small></label>}
    <footer className="review-card-actions">
      {published?<button className="review-danger" disabled={busy||!reason.trim()} onClick={()=>onReview('withdrawn')}>철회</button>:<><button className="review-primary" disabled={busy||targetUnavailable||blockers.length>0||!!run.expectedPublicId&&!revision} onClick={()=>onReview('approved')}>승인</button><button disabled={busy||targetUnavailable} onClick={()=>onReview('rejected')}>반려</button></>}
    </footer>
    {actionNotice&&<p role="status" className="review-notice">{actionNotice}</p>}
  </article>
}
