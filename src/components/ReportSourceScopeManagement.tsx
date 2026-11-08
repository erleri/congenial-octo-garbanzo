import {useState} from 'react'
import {getReportClient} from '../lib/reports/client'
import {withConnectionDeadline} from '../lib/reports/connection-deadline'
import {sourcePolicyStatus} from '../lib/reports/source-management-status'
export type SourceScopes={discover:boolean;collect:boolean;analyze:boolean;publishNotes:boolean}
export type SourcePolicy={id:string;currency:string;host:string;pathPrefix:string;publisher:string;termsUrl:string;action:string;revision:number;
 scopes:SourceScopes;approvedTermsHash:string|null;reason:string|null;decidedAt:string;expiresAt:string|null}
export type SourceTerms={policyId:string;url:string;status:string;checkedAt:string;hash:string|null;excerpt:string|null}
type Candidate={binding:string;currency:string;url:string;host:string;publisher:string|null;status:string;articleChecks?:{ownArticle:boolean;freeAccess:boolean;bodyVerified:boolean}}
const labels:Record<keyof SourceScopes,string>={discover:'링크 탐색',collect:'본문 수집',analyze:'AI 비공개 분석',publishNotes:'검토된 사실·견해 활용'}
const allScopes:SourceScopes={discover:true,collect:true,analyze:true,publishNotes:true}
async function rpc(name:string,args:Record<string,unknown>){
 return withConnectionDeadline(async signal=>{
  const client=await getReportClient(),result=await client.rpc(name,args).abortSignal(signal)
  if(result.error)throw result.error
 },6000)
}
function PolicyRow({policy,terms,now,onSaved,focused=false}:{policy:SourcePolicy;terms?:SourceTerms;now:number;onSaved:()=>Promise<void>;focused?:boolean}){
 const [scopes,setScopes]=useState(policy.action==='prepare'?allScopes:policy.scopes),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 const current=terms?.status==='available'&&terms.url===policy.termsUrl&&Date.parse(terms.checkedAt)<=now&&now-Date.parse(terms.checkedAt)<86400000
 const change=(key:keyof SourceScopes,value:boolean)=>{
  const keys=Object.keys(labels) as (keyof SourceScopes)[],index=keys.indexOf(key)
  setScopes(prev=>Object.fromEntries(keys.map((k,i)=>[k,value&&i<=index?true:!value&&i>=index?false:prev[k]])) as SourceScopes)
 }
 const save=async(action:string)=>{
  setBusy(true);setMessage('')
  try{await rpc('decide_currency_report_source_policy',{p_id:policy.id,p_revision:policy.revision,p_action:action,p_scopes:scopes,p_terms_hash:terms?.hash??null,p_reason:reason.trim()});await onSaved()}
  catch{setMessage('결정을 저장하지 못했습니다. 권한·이용 조건·다른 관리자의 변경을 새로 확인해 주세요.')}
  finally{setBusy(false)}
 }
 return <li className="source-management-row" id={`review-target-${policy.id}`} tabIndex={-1}><p><strong>{policy.currency} · {policy.publisher}</strong> · {sourcePolicyStatus(policy,terms,now)}</p>
  <p>{policy.host}{policy.pathPrefix} · 자체 무료 기사에 한함</p>
  <a href={policy.termsUrl} target="_blank" rel="noopener noreferrer">검토할 이용 조건</a>
  {terms&&<p className="table-help">최근 확인: {new Date(terms.checkedAt).toLocaleString('ko-KR')} · {terms.status==='available'?'내용 확보':'조회 실패'}</p>}
  <details open={focused||undefined}><summary>기준 확인·변경</summary>
   {terms?.excerpt&&<blockquote>{terms.excerpt}</blockquote>}
   <p className="table-help">조건 원문에서 아래 범위를 확인한 뒤 적용합니다. 자동 조회 성공 자체가 이용 허가는 아닙니다. 전재·유료·제한 기사는 별도 제외합니다.</p>
   <fieldset disabled={busy}><legend>재사용할 처리 범위</legend>{(Object.keys(labels) as (keyof SourceScopes)[]).map(k=><label key={k} style={{display:'block'}}><input type="checkbox" checked={scopes[k]} onChange={e=>change(k,e.target.checked)}/>{labels[k]}</label>)}</fieldset>
   <label>결정 근거<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={480} minLength={20} disabled={busy}/></label>
   <div style={{display:'flex',flexWrap:'wrap',gap:8}}>{[['apply','이 범위에 적용'],['hold','보류'],['exclude','제외']].map(([action,label])=><button type="button" className="quiet-button" key={action}
    disabled={busy||reason.trim().length<20||action==='apply'&&!current} onClick={()=>void save(action)}>{label}</button>)}</div>
   <p className="table-help">적용 후 90일 이내 재검토 · 이용 조건은 자동 운영에서 매일 확인 · 리포트 게시는 별도 승인</p>
   {policy.reason&&<p>이전 결정 근거: {policy.reason}</p>}
  </details>{message&&<p role="status">{message}</p>}
 </li>
}
export default function ReportSourceScopeManagement({proofs,policies,terms,now,onSaved,focusId=null}:{proofs:Candidate[];policies:SourcePolicy[];terms:SourceTerms[];now:number;onSaved:()=>Promise<void>;focusId?:string|null}){
 const candidates=proofs.filter(p=>p.status!=='exclude'&&p.publisher&&p.articleChecks?.ownArticle&&p.articleChecks.freeAccess&&p.articleChecks.bodyVerified)
 const [binding,setBinding]=useState(''),[prefix,setPrefix]=useState('/'),[url,setUrl]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 const proof=candidates.find(p=>p.binding===binding),existing=policies.find(p=>p.currency===proof?.currency&&p.host===proof?.host&&p.pathPrefix===prefix)
 const prepare=async()=>{
  if(!proof)return
  setBusy(true);setMessage('')
  try{await rpc('prepare_currency_report_source_policy',{p_binding:proof.binding,p_prefix:prefix,p_terms_url:url,p_revision:existing?.revision??0});setMessage('확인을 요청했습니다. 다음 무과금 자료 점검에서 조건을 가져온 뒤 적용 범위를 결정할 수 있습니다.');await onSaved()}
  catch{setMessage('요청을 저장하지 못했습니다. 같은 매체의 조건 주소와 적용 경로, 최신 권한을 확인해 주세요.')}
  finally{setBusy(false)}
 }
 return <section aria-label="매체별 재사용 기준"><h4>매체별 재사용 기준</h4>
  <p className="table-help">한 번 검토한 기준을 같은 매체·섹션의 다음 기사에 적용합니다. 기사 한 건의 허가를 매체 전체로 확대하지 않습니다.</p>
  <ul>{policies.map(p=><PolicyRow key={`${p.id}:${p.revision}`} policy={p} focused={focusId===p.id} terms={terms.find(t=>t.policyId===p.id)} now={now} onSaved={onSaved}/>)}</ul>
  <details><summary>매체·섹션 기준 준비</summary>
   <label>확인된 기사<select aria-label="확인된 기사" value={binding} disabled={busy} onChange={e=>{setBinding(e.target.value);setUrl('');setPrefix('/')}}><option value="">선택</option>{candidates.map(p=><option value={p.binding} key={p.binding}>{p.currency} · {p.publisher} · {new URL(p.url).pathname}</option>)}</select></label>
   <label>적용 경로<input value={prefix} onChange={e=>setPrefix(e.target.value)} maxLength={160} disabled={busy}/></label>
   <p className="table-help">예: /economia/ · /는 매체 전체입니다. 확인할 조건이 실제로 적용되는 범위만 지정하세요.</p>
   <label>같은 매체의 이용 조건 주소<input type="url" value={url} onChange={e=>setUrl(e.target.value)} maxLength={400} disabled={busy}/></label>
   <button type="button" className="quiet-button" onClick={()=>void prepare()} disabled={busy||!proof||!url.startsWith(`https://${proof.host}/`)}>{existing?'조건 주소 재확인 요청':'이용 조건 확인 요청'}</button>
   {existing&&<p className="table-help">재요청하면 기존 범위의 자동 적용을 보류하고 새 조건 확인부터 진행합니다.</p>}
   {message&&<p role="status">{message}</p>}
  </details>
 </section>
}
