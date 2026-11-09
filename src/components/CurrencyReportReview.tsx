import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getReportClient, localReportMode } from '../lib/reports/client'
import ReportReviewCard, { type ReviewRun as Run } from './ReportReviewCard'
import './admin-review.css'
import { withConnectionDeadline } from '../lib/reports/connection-deadline'
import AdminOverview from './AdminOverview'
import type { AdminAccess } from '../hooks/useAdminAccess'
import type { DatasetSource, ExchangeRateDataset } from '../types/exchangeRate'
import AdminReviewInbox from './AdminReviewInbox'
import type {InboxItem} from './AdminReviewInbox'
import {parseReviewRequest} from '../lib/review-request.js'

interface Correction {key:string;revision:number;createdAt:string;status:string;lastReview?:{reason:string;decision:string;createdAt:string}|null;record:{currency:string;reportId:string;baseDate:string;claimId:string;quote:string;kind:string;reason:string;sourceUrl:string;before:{value?:number;period?:string};after:{value?:number;period?:string};testOnly:boolean}}
interface Corrections {items:Correction[];pending:number;checks:{currency:string;checkedAt:string;coverage:{reportsChecked:number;missingSnapshotReports:number;unmappedEvidence:number;historyWindowLimited?:boolean;issues:string[]}}[]}
const correctionIssues:Record<string,string>={current_article_binding_unverified:'기사 원자료 검사 미확인',current_statistics_binding_unverified:'새 통계 입력 검사 미확인',published_snapshot_binding_unverified:'발행 당시 입력 일치 여부 미확인',published_indicator_definition_unavailable:'과거 지표 정의 복원 불가',candidate_display_safety_hold:'후보 문장의 표시 안전성 확인 필요',candidate_capacity_review_required:'후보 상한에 도달해 일부 기록 보류'}
export default function CurrencyReportReview({dataset=null,datasetSource='none',access}:{dataset?:ExchangeRateDataset|null;datasetSource?:DatasetSource;access:AdminAccess}) {
  const {canManage,recheck,revision}=access
  const [admin, setAdmin] = useState(false)
  const [runs, setRuns] = useState<Run[]>([]), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [includeTest,setIncludeTest]=useState(false)
  const [pendingTotal,setPendingTotal]=useState(0)
  const [revisions,setRevisions]=useState<Record<string,string>>({})
  const [corrections,setCorrections]=useState<Corrections|null>(null),[correctionReasons,setCorrectionReasons]=useState<Record<string,string>>({})
  const [correctionPages,setCorrectionPages]=useState<{at:string;key:string}[]>([])
  const target=useMemo(()=>parseReviewRequest(window.location.search),[])
  const [targetState,setTargetState]=useState('checking'),[targetItem,setTargetItem]=useState<InboxItem|null>(null)
  const epoch = useRef(0)
  const attended = useRef(true)
  const invalidate = useCallback(() => { epoch.current++ }, [])
  const reset = useCallback(() => { invalidate(); setRuns([]);setPendingTotal(0); setAdmin(false); setReason('');setRevisions({});setCorrections(null);setCorrectionReasons({});setTargetItem(null);setTargetState('checking') }, [invalidate])
  const load = useCallback(async () => {
    if(!attended.current || !canManage)return
    const version = ++epoch.current
    try {
      const snapshot = await withConnectionDeadline(async signal => {
        const client = await getReportClient()
        const { data: { session }, error } = await client.auth.getSession()
        if (error) throw error
        if (!session) return { signedIn: false, admin: false, runs: [] as Run[],pending:0 }
        const role = await client.from('business_plan_admins').select('active').eq('email', (session.user.email ?? '').toLowerCase()).abortSignal(signal).maybeSingle()
        if (role.error) throw role.error
        if (role.data?.active !== true) return { signedIn: true, admin: false, runs: [] as Run[],pending:0 }
        const base=()=>{const query=client.from('currency_report_runs').select('id,status,candidate,validation,attempt,storage_required,created_at,cost');return includeTest?query:query.or('candidate->>testOnly.is.null,candidate->>testOnly.eq.false')}
        let countQuery=client.from('currency_report_runs').select('id',{head:true,count:'exact'}).eq('status','pending_review')
        if(!includeTest)countQuery=countQuery.or('candidate->>testOnly.is.null,candidate->>testOnly.eq.false')
        const [pending,recent,total]=await Promise.all([
          base().eq('status','pending_review').order('created_at',{ascending:false}).limit(20).abortSignal(signal),
          base().in('status',['published','failed','rejected']).order('created_at',{ascending:false}).limit(20).abortSignal(signal),
          countQuery.abortSignal(signal),
        ])
        for(const result of [pending,recent,total])if(result.error)throw result.error
        const selected=target?await client.rpc('currency_report_review_target',{p_kind:target.kind,p_id:target.id,p_version:target.version}).abortSignal(signal):null
        const targetData=selected&&!selected.error?selected.data as {state:string;item?:InboxItem;run?:Run;correction?:Correction}:null
        const rows=[...(pending.data??[]),...(recent.data??[])] as Run[]
        if(targetData?.state==='current'&&targetData.run&&!rows.some(r=>r.id===targetData.run?.id))rows.unshift(targetData.run)
        const managed=rows.filter(r=>r.storage_required)
        const receipts=managed.length?await client.from('currency_report_storage_receipts').select('run_id').in('run_id',managed.map(r=>r.id)).abortSignal(signal):{data:[],error:null}
        if(receipts.error)throw receipts.error
        const complete=new Set((receipts.data??[]).map(r=>r.run_id))
        const expected=await Promise.all(rows.map(async r=>{
          if(r.status!=='pending_review')return null
          const current=await client.rpc('resolve_currency_report',{p_currency:r.candidate.currency,p_date:r.candidate.baseDate,p_include_test:true}).abortSignal(signal)
          if(current.error)throw current.error
          return current.data?.id??null
        }))
        const cursor=correctionPages.at(-1)
        const correctionResult=await client.rpc('currency_report_corrections',{p_include_test:includeTest,p_before:cursor?.at??null,p_before_key:cursor?.key??null}).abortSignal(signal)
        // Missing migration is shown explicitly; never hide existing draft review.
        const correctionData=correctionResult.error?null:correctionResult.data as Corrections|null
        if(targetData?.state==='current'&&targetData.correction&&correctionData&&!correctionData.items.some(c=>c.key===targetData.correction?.key))correctionData.items.unshift(targetData.correction)
        return { signedIn: true, admin: true,targetData,corrections:correctionData?.items&&Array.isArray(correctionData.checks)?correctionData:null,pending:total.count??0, runs:rows.map((r,i)=>({...r,expectedPublicId:expected[i],storageComplete:complete.has(r.id),validation:{...r.validation,storageRequired:r.storage_required,storageComplete:complete.has(r.id)}})) }
      }, 5000)
      if (epoch.current !== version) return
      setAdmin(snapshot.admin);setPendingTotal(snapshot.pending);setCorrections('corrections' in snapshot?snapshot.corrections??null:null); setRuns(previous=>snapshot.runs.map(r=>{const old=previous.find(p=>p.id===r.id);return {...r,expectedPublicId:old?old.expectedPublicId:r.expectedPublicId}}))
      setTargetState('targetData' in snapshot?snapshot.targetData?.state??'unavailable':'unavailable');setTargetItem('targetData' in snapshot?snapshot.targetData?.item??null:null)
      setNotice(previous=>previous==='연결 실패. 이전 초안은 숨겼습니다.'?'':previous)
      if(!snapshot.admin){setReason('');void recheck()}
    } catch { if (epoch.current === version) { setAdmin(false); setRuns([]);setCorrections(null);setCorrectionReasons({});setTargetState('unavailable');setTargetItem(null); setNotice('연결 실패. 이전 초안은 숨겼습니다.') } }
  }, [includeTest,canManage,recheck,correctionPages,target])
  useEffect(() => {
    let active = true
    queueMicrotask(()=>{if(active)void load()})
    const refresh=()=>{if(active&&document.visibilityState==='visible'&&attended.current)void load()}
    const focus=()=>{attended.current=true;refresh()}
    const hide=()=>{attended.current=false;reset()}
    const visibility=()=>document.visibilityState==='hidden'?hide():document.hasFocus()?focus():undefined
    const timer = setInterval(refresh,30_000)
    window.addEventListener('focus',focus);window.addEventListener('blur',hide);document.addEventListener('visibilitychange',visibility)
    return () => { active = false; invalidate(); clearInterval(timer);window.removeEventListener('focus',focus);window.removeEventListener('blur',hide);document.removeEventListener('visibilitychange',visibility) }
  }, [load, reset, invalidate, revision])
  async function review(runId: string, decision: string) {
    if (busy) return
    setBusy(true)
    const version=epoch.current
    try {
      const run=runs.find(r=>r.id===runId)
      const client = await getReportClient()
      const requested=target?.kind==='report'&&target.id===runId
      const result = await client.rpc(requested?'review_currency_report_request':'review_currency_report_version',{p_run_id:runId,...(requested?{p_version:target.version}:{}),p_decision:decision,p_reason:reason.trim() || null,p_expected_public_id:run?.expectedPublicId??null,p_revision_kind:revisions[runId]||null,
        p_report_kind:run?.candidate.purpose==='periodic_check'?'periodic':run?.candidate.purpose==='fx_explanation'?'movement':undefined})
      if(epoch.current!==version||!attended.current)return
      if (result.error) {
        if (result.error.code === '42501') {reset();void access.recheck()}
        if(result.error.code==='55000'){setRuns([]);setRevisions({})}
        setNotice(result.error.code === '55000' ? '공개 판본이 바뀌었거나 이미 처리됐습니다. 갱신된 대상과 교체 유형을 다시 확인해 주세요.' : result.error.code === '42501' ? '관리자 권한이 해제되었습니다.' : '처리하지 못했습니다. 검증 결과와 사유를 확인해 주세요.')
      } else { setNotice(decision === 'approved' ? '승인 결과를 공개 목록에 저장했습니다.' : decision === 'withdrawn' ? '정정 대상으로 철회했습니다. 원고와 감사 이력은 보존됩니다.' : '반려했습니다. 이전 공개 보고서를 유지합니다.'); setReason('') }
      await load()
    } catch { reset(); setNotice('연결을 확인하지 못해 초안을 숨겼습니다.') }
    finally { setBusy(false) }
  }
  async function reviewCorrection(item:Correction,decision:string){
    if(busy)return
    setBusy(true);const version=epoch.current
    try{
      const client=await getReportClient(),result=await client.rpc('review_currency_report_correction',{
        p_key:item.key,p_decision:decision,p_reason:(correctionReasons[item.key]??'').trim(),p_revision:item.revision})
      if(epoch.current!==version||!attended.current)return
      if(result.error){
        if(result.error.code==='42501'){reset();void recheck()}
        setNotice(result.error.code==='55000'?'대상 공개본 또는 검토 기록이 바뀌었습니다. 다시 확인해 주세요.':'정정 후보 검토를 저장하지 못했습니다.')
      }else{setNotice('후보 검토 기록을 저장했습니다. 공개 원고는 변경하지 않았습니다.');setCorrectionReasons({})}
      await load()
    }catch{reset();setNotice('연결 실패로 비공개 검토 정보를 숨겼습니다.')}
    finally{setBusy(false)}
  }
  const renderRun=(run:Run)=><ReportReviewCard key={run.id} run={run} busy={busy} reason={reason} revision={revisions[run.id]??''} focused={target?.kind==='report'&&target.id===run.id} targetUnavailable={target?.kind==='report'&&target.id===run.id&&targetState!=='current'} onRevision={value=>setRevisions(old=>({...old,[run.id]:value}))} onReview={decision=>void review(run.id,decision)}/>
  return <section className="generation-status db-review" aria-label="관리자 리포트 검토">
    <div className="review-page-heading"><h2>데이터·리포트 관리</h2><a className="quiet-button" href="#report">승인 보고서 목록 →</a></div>{localReportMode()&&<p className="local-notice">격리된 로컬 DB · 운영 반영 없음</p>}
    {notice&&<p role="status" className="review-notice">{notice}</p>}
    {access.canManage && admin ? <><AdminReviewInbox target={target} state={targetState} item={targetItem}/><details className="review-operations" open={targetState==='current'&&!!targetItem&&['source','policy','incident'].includes(targetItem.kind)||undefined}><summary>운영 현황·연결·이용 정보</summary><AdminOverview focus={targetState==='current'?targetItem:null} runs={runs} pendingTotal={pendingTotal} dataset={dataset} datasetSource={datasetSource}/></details><div className="review-section-heading"><h2>리포트 검토 <small>대기 {pendingTotal}건</small></h2><button disabled={busy} onClick={()=>void load()}>상태 다시 읽기</button></div><div className="review-toolbar">{localReportMode()&&<label><input type="checkbox" checked={includeTest} onChange={event=>{reset();setIncludeTest(event.target.checked)}}/>합성 연결 시험 포함</label>}{pendingTotal>20&&<p>검토 대기 {pendingTotal}건 중 최근 20건과 메일에서 요청한 대상을 표시합니다.</p>}<label>반려·철회 사유 <input maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="반려·철회할 원고의 사유"/></label></div>
      {runs.filter(r=>r.status==='pending_review').map(renderRun)}{pendingTotal===0&&<p className="review-empty">검토 대기 원고가 없습니다.</p>}
      <details className="review-published" open={target?.kind==='report'&&runs.some(r=>r.id===target.id&&r.status==='published')||undefined}><summary>승인된 리포트 · {runs.filter(r=>r.status==='published').length}건</summary>
      {runs.filter(r=>r.status==='published').map(renderRun)}
      </details>
      <section className="review-corrections" aria-label="공개 리포트 정정 후보"><h2>공개 리포트 재검토</h2>
        <p className="table-help">수정값·인용 출처의 변경 신호입니다. 과거 원고의 오류 확정이나 자동 정정이 아닙니다.</p>
        {corrections?<><p>미확인 후보 {corrections.pending}건</p>
          {corrections.items.slice(0,30).map(item=><article className="db-review-run" key={item.key} id={`review-target-${item.key}`} tabIndex={-1}>
            <p><strong>{item.record.currency} · {item.record.baseDate}</strong> · {({pending_review:'검토 대기',acknowledged:'확인·후속 검토',dismissed:'정정 불필요 판단',stale_target:'대상 공개본 교체·철회됨'} as Record<string,string>)[item.status]??'상태 확인 필요'}{item.record.testOnly?' · 합성 시험':''}</p>
            <blockquote>{item.record.quote}</blockquote><p>{item.record.reason}</p>
            {item.lastReview&&<p>최근 판단 사유: {item.lastReview.reason}</p>}
            {item.record.kind==='official_value_revised'&&<p>대상 {item.record.before.period} · 발행 당시 {item.record.before.value} → 새 판본 {item.record.after.value}</p>}
            <p><a href={`?run=${encodeURIComponent(item.record.reportId)}#report/${item.record.currency}/${item.record.baseDate}`}>대상 리포트</a> · {item.record.sourceUrl.startsWith('https://')&&<a href={item.record.sourceUrl} target="_blank" rel="noreferrer">변경 출처</a>}</p>
            {item.status!=='stale_target'&&<><label>검토 사유 <input aria-label={`${item.record.currency} ${item.record.claimId} 검토 사유`} maxLength={500} value={correctionReasons[item.key]??''} onChange={e=>setCorrectionReasons(old=>({...old,[item.key]:e.target.value}))}/></label>
              <button disabled={busy||!correctionReasons[item.key]?.trim()} onClick={()=>void reviewCorrection(item,'acknowledged')}>확인·후속 검토</button>
              <button disabled={busy||!correctionReasons[item.key]?.trim()} onClick={()=>void reviewCorrection(item,item.status==='dismissed'?'pending_review':'dismissed')}>{item.status==='dismissed'?'검토 다시 열기':'정정 불필요'}</button></>}
          </article>)}
          {correctionPages.length>0&&<button disabled={busy} onClick={()=>setCorrectionPages(old=>old.slice(0,-1))}>이전 후보</button>}
          {corrections.items.length>30&&<button disabled={busy} onClick={()=>{const last=corrections.items[29];setCorrectionPages(old=>[...old,{at:last.createdAt,key:last.key}])}}>다음 후보</button>}
          <details><summary>자동 점검 범위</summary><p>다른 기사의 의미상 반박 여부는 이번 무과금 검사에서 판단하지 않습니다. 후보 0건은 전체 내용에 문제가 없다는 뜻이 아닙니다.</p>
            <ul>{corrections.checks.map(c=><li key={c.currency}>{c.currency} · {new Date(c.checkedAt).toLocaleString('ko-KR')} · {c.coverage.reportsChecked?`발행본 ${c.coverage.reportsChecked}건`:'비교할 운영 발행본 없음'} · 입력 원자료 미확보 {c.coverage.missingSnapshotReports}건 · 문장 연결 미확인 {c.coverage.unmappedEvidence}건{c.coverage.historyWindowLimited?' · 이력 범위 확인 필요':''}{c.coverage.issues.map(code=><p key={code}>{correctionIssues[code]??'입력 자료 확인 필요'}</p>)}</li>)}</ul>
          </details></>:<p role="status">정정 후보 저장·조회 연결을 확인하지 못했습니다. 검사 완료로 처리하지 않습니다.</p>}
      </section></> : null}
  </section>
}
