import {useCallback,useEffect,useRef,useState} from 'react'
import {getReportClient} from '../lib/reports/client'
import {withConnectionDeadline} from '../lib/reports/connection-deadline'
import ReportSourceScopeManagement from './ReportSourceScopeManagement'
import type {SourcePolicy,SourceTerms} from './ReportSourceScopeManagement'
import {sourceArticleStatus} from '../lib/reports/source-management-status'
import type {InboxItem} from './AdminReviewInbox'

type Scopes={discover:boolean;collect:boolean;analyze:boolean;publishNotes:boolean}
type Proof={binding:string;currency:string;url:string;host:string;publisher:string|null;status:string;reason:string;expiresAt:string;licenseUrl:string|null;scopes:Scopes;captureHash:string;articleBinding?:string}
type Decision={currency:string;url:string;revision:number;action:string;proofBinding:string;scopes:Scopes;decidedAt:string;captureHash?:string;articleBinding?:string;basis?:{reason:string;evidenceUrl:string}|null}
type History={currency?:string;url?:string;id?:string;revision:number;action:string;decidedAt:string;reason?:string|null}
type Summary={proofs:Proof[];decisions:Decision[];policies?:SourcePolicy[];terms?:SourceTerms[];history?:History[];policyHistory?:History[]}
const scopeLabels:Record<keyof Scopes,string>={discover:'링크 탐색',collect:'본문 수집',analyze:'AI 비공개 분석',publishNotes:'검토된 사실·견해 공개'}
const reasons:Record<string,string>={explicit_article_license_matches_policy:'기사별 명시 조건이 공통 기준과 일치합니다.',use_scope_unconfirmed:'사용 조건의 확인 근거가 필요합니다.',
 conflicting_or_third_party_rights:'다른 권리자 또는 상충하는 조건을 확인해야 합니다.',free_access_declaration_missing:'무료 공개 범위를 확인해야 합니다.',
 source_evidence_expired:'확인 근거가 만료됐습니다.',robots_unconfirmed:'자동 수집 조건을 확인하지 못했습니다.',automated_access_restricted:'자동 수집이 제한되어 있습니다.',
 access_restricted:'접근이 제한되어 있습니다.',recorded_processing_restriction:'기록된 처리 제한이 있습니다.',article_identity_unconfirmed:'기사 식별을 확인하지 못했습니다.',
 publisher_identity_unconfirmed:'발행 매체를 확인하지 못했습니다.',publication_metadata_unconfirmed:'발표 시점을 확인하지 못했습니다.',structured_article_body_unconfirmed:'본문을 확인하지 못했습니다.'}
const labels:Record<string,string>={apply:'적용',hold:'확인 대기',exclude:'제외'}

function SourceRow({proof,decision,onSaved,checkedAt,policies,terms,focused=false}:{proof:Proof;decision?:Decision;onSaved:()=>Promise<void>;checkedAt:number;policies:SourcePolicy[];terms:SourceTerms[];focused?:boolean}) {
 const [scopes,setScopes]=useState<Scopes>(decision?.scopes??{discover:true,collect:true,analyze:true,publishNotes:true})
 const [evidence,setEvidence]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 const manual=proof.status==='hold'&&['use_scope_unconfirmed','conflicting_or_third_party_rights','free_access_declaration_missing'].includes(proof.reason)
 const expired=Date.parse(proof.expiresAt)<=checkedAt
 const applicable=!expired&&(proof.status==='eligible'||manual)
 const changeScope=(key:keyof Scopes,value:boolean)=>{
  const order=Object.keys(scopeLabels) as (keyof Scopes)[],index=order.indexOf(key)
  setScopes(prev=>Object.fromEntries(order.map((k,i)=>[k,value&&i<=index?true:!value&&i>=index?false:prev[k]])) as Scopes)
 }
 const save=async(action:string)=>{
  setBusy(true);setMessage('')
  try{
   await withConnectionDeadline(async signal=>{
    const client=await getReportClient()
    const result=await client.rpc('decide_currency_report_source',{p_binding:proof.binding,p_revision:decision?.revision??0,
     p_action:action,p_scopes:scopes,p_evidence_url:manual&&action==='apply'?evidence:null,p_reason:manual&&action==='apply'?reason:null}).abortSignal(signal)
    if(result.error)throw result.error
   },6000)
   setMessage(`${labels[action]} 기록을 저장했습니다. 다음 수집에서 반영합니다.`)
   await onSaved()
  }catch{setMessage('저장을 확인하지 못했습니다. 권한이나 자료가 변경됐을 수 있습니다. 새로 확인한 뒤 다시 결정해 주세요.')}
  finally{setBusy(false)}
 }
 return <li className="source-management-row" id={`review-target-${proof.binding}`} tabIndex={-1}>
  <p><strong>{proof.currency} · {proof.publisher??proof.host}</strong> · {sourceArticleStatus(proof,decision,policies,terms,checkedAt)}</p>
  <a href={proof.url} target="_blank" rel="noopener noreferrer">대상 기사 확인</a>
  <p>{expired?'확인 근거가 만료되어 새 확인이 필요합니다.':reasons[proof.reason]??'출처 조건을 확인해 주세요.'}</p>
  {proof.licenseUrl&&<p><a href={proof.licenseUrl} target="_blank" rel="noopener noreferrer">기사에 명시된 이용 조건</a></p>}
  <details open={focused||undefined}><summary>처리 범위·결정</summary>
   <p className="table-help">이 기사에만 적용합니다. 원문 공개나 리포트 게시는 허용하지 않습니다.</p>
   <fieldset disabled={busy||!applicable}><legend>처리 범위</legend>
    {(Object.keys(scopeLabels) as (keyof Scopes)[]).map(key=><label key={key} style={{display:'block'}}>
     <input type="checkbox" checked={scopes[key]} onChange={e=>changeScope(key,e.target.checked)}/> {scopeLabels[key]}
    </label>)}
   </fieldset>
   {manual&&<><label style={{display:'block'}}>확인한 이용 조건 주소<input type="url" value={evidence} onChange={e=>setEvidence(e.target.value)} maxLength={400} disabled={busy}/></label>
    <label style={{display:'block'}}>이 범위로 사용할 수 있다고 판단한 근거<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={20} maxLength={480} disabled={busy}/></label>
    <p className="table-help">출처의 조건을 확인한 기록입니다. 관리자 선택 자체가 매체의 이용 허가를 대신하지 않습니다.</p></>}
   <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:12}}>
    <button type="button" className="quiet-button" disabled={busy||!applicable||manual&&(!evidence.startsWith('https://')||reason.trim().length<20)} onClick={()=>void save('apply')}>{busy?'저장 중…':'기존 정책 적용'}</button>
    <button type="button" className="quiet-button" disabled={busy} onClick={()=>void save('hold')}>추가 확인 대기</button>
    <button type="button" className="quiet-button" disabled={busy} onClick={()=>void save('exclude')}>제외</button>
   </div>
   {decision&&<p className="table-help">최근 결정: {labels[decision.action]} · {new Date(decision.decidedAt).toLocaleString('ko-KR')} · 이력 {decision.revision}
    {decision.basis&&<> · <a href={decision.basis.evidenceUrl} target="_blank" rel="noopener noreferrer">확인 근거</a> · {decision.basis.reason}</>}
   </p>}
  </details>
  {message&&<p role="status">{message}</p>}
 </li>
}

export default function ReportSourceManagement({focus=null}:{focus?:InboxItem|null}){
 const [summary,setSummary]=useState<Summary|null>(null),[failed,setFailed]=useState(false)
 const [checkedAt,setCheckedAt]=useState(0),active=useRef(true)
 const refresh=useCallback(async()=>{
  try{
   const result=await withConnectionDeadline(async signal=>{
    const client=await getReportClient()
    const r=await client.rpc('currency_report_source_admission_summary').abortSignal(signal)
    if(r.error)throw r.error
    const value=r.data as Summary
    if(!Array.isArray(value?.proofs)||!Array.isArray(value.decisions))throw Error('invalid_source_summary')
    return value
   },5000)
   if(active.current){setSummary(result);setFailed(false);setCheckedAt(Date.now())}
  }catch{if(active.current){setSummary(null);setFailed(true)}}
 },[])
 useEffect(()=>{active.current=true;void Promise.resolve().then(refresh);return()=>{active.current=false}},[refresh])
 return <details className="source-management" open={!!focus&&['source','policy'].includes(focus.kind)||undefined}><summary>출처 관리</summary>
  <p className="table-help">조건이 명확한 기사는 공통 기준으로 처리하고, 나머지는 여기서 확인합니다. 보류·제외한 출처 때문에 다른 출처의 처리를 멈추지는 않습니다.</p>
  <button type="button" className="quiet-button" onClick={()=>void refresh()}>새로 확인</button>
  {failed?<p role="status">출처 관리 연결을 확인하지 못했습니다. 새 결정을 적용하기 전에 다시 확인해 주세요. 기존 출처 처리는 유지됩니다.</p>:!summary?<p>확인 중입니다.</p>:<>
   <ReportSourceScopeManagement focusId={focus?.kind==='policy'?focus.target_id:null} proofs={summary.proofs} policies={summary.policies??[]} terms={summary.terms??[]} now={checkedAt} onSaved={refresh}/>
   <h4>기사별 확인·예외</h4>
   {summary.proofs.length===0?<p>판정 근거가 준비된 새 출처가 없습니다. 발견만 된 후보는 아래 수집 상태에서 확인할 수 있습니다.</p>:<ul>{summary.proofs.map(p=><SourceRow key={`${p.binding}:${summary.decisions.find(d=>d.currency===p.currency&&d.url===p.url)?.revision??0}`} proof={p} focused={focus?.kind==='source'&&focus.target_id===p.binding} checkedAt={checkedAt} decision={summary.decisions.find(d=>d.currency===p.currency&&d.url===p.url)} policies={summary.policies??[]} terms={summary.terms??[]} onSaved={refresh}/>)}</ul>}
   <details><summary>최근 결정 이력</summary><p className="table-help">기사별·매체별 최근 100건씩 표시합니다. 이전 기록도 서버에 보존됩니다.</p>
    <ul>{[...(summary.history??[]),...(summary.policyHistory??[])].sort((a,b)=>b.decidedAt.localeCompare(a.decidedAt)).map((h,i)=><li key={`${h.id??h.url}:${h.revision}:${i}`}>{new Date(h.decidedAt).toLocaleString('ko-KR')} · {h.currency??'매체 기준'} · {labels[h.action]??'기준 준비'} · {h.reason??'기사별 결정'} · 이력 {h.revision}</li>)}</ul>
   </details></>}
 </details>
}
