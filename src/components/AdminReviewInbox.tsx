import {useCallback,useEffect,useRef,useState} from 'react'
import {getReportClient} from '../lib/reports/client'
import {withConnectionDeadline} from '../lib/reports/connection-deadline'
import {reviewRequestPath,validReviewTarget,type ReviewTarget} from '../lib/review-request.js'

export interface InboxItem extends ReviewTarget {currency:string|null;base_date:string|null;title:string;summary:string;reason:string;target_id:string}
const labels:Record<string,string>={report:'리포트 승인',correction:'공개 원고 재검토',source:'기사 이용 범위',policy:'매체 이용 기준',incident:'운영 확인'}
export function ReviewRequestNotice({target,state,item}:{target:ReviewTarget|null;state:string;item:InboxItem|null}) {
  if(!target)return null
  return <aside className="review-request-notice" role="status" aria-label="메일에서 요청한 검토">
    <strong>메일에서 요청한 검토</strong>
    {state==='current'&&item?<><p>{labels[item.kind]} · {item.currency??'공통'}{item.base_date?` · ${item.base_date}`:''}</p><p>{item.title}</p><p>{item.reason}</p><p className="table-help">현재 대상과 메일의 버전이 일치합니다. 아래 근거와 본문을 확인한 뒤 결정해 주세요.</p><button className="inline-link" onClick={()=>{const node=document.getElementById(`review-target-${item.target_id}`);node?.scrollIntoView({block:'start'});node?.focus()}}>해당 검토로 이동</button></>:
      <p>{state==='changed'?'메일 발송 후 대상이 변경됐습니다. 아래 검토함에서 현재 버전을 다시 여세요.':state==='resolved_or_unavailable'?'이미 처리됐거나 현재 검토 대상이 아닙니다.':state==='unavailable'?'검토 대상 연결을 확인하지 못했습니다. 현재 상태를 다시 확인해 주세요.':'검토 대상과 버전을 확인하는 중입니다.'}</p>}
  </aside>
}
export default function AdminReviewInbox({target,state,item}:{target:ReviewTarget|null;state:string;item:InboxItem|null}) {
  const [items,setItems]=useState<InboxItem[]>([]),[total,setTotal]=useState(0),[failed,setFailed]=useState(false)
  const [loading,setLoading]=useState(true)
  const [mailState,setMailState]=useState<string|null>(null)
  const epoch=useRef(0)
  const invalidate=useCallback(()=>{epoch.current++},[])
  const refresh=useCallback(async()=>{
    const version=++epoch.current
    setLoading(true)
    try{
      const result=await withConnectionDeadline(async signal=>{
        const client=await getReportClient(),r=await client.rpc('currency_report_review_inbox').abortSignal(signal)
        if(r.error||!Array.isArray(r.data?.items)||!Number.isInteger(r.data.total)||r.data.items.some((i:unknown)=>!validReviewTarget(i)))throw Error('review_inbox_unavailable')
        return r.data as {items:InboxItem[];total:number;latestMail?:{state:string}|null}
      },5000)
      if(epoch.current===version){setItems(result.items);setTotal(result.total);setMailState(result.latestMail?.state??null);setFailed(false)}
    }catch{if(epoch.current===version){setItems([]);setFailed(true)}}
    finally{if(epoch.current===version)setLoading(false)}
  },[])
  useEffect(()=>{let active=true;queueMicrotask(()=>{if(active)void refresh()});return()=>{active=false;invalidate()}},[refresh,invalidate])
  return <section className="admin-review-inbox" aria-label="관리자 검토함"><h2>검토함</h2>
    <ReviewRequestNotice target={target} state={state} item={item}/>
    {mailState&&['sending','unknown','rejected','failed_before_send','reserved'].includes(mailState)&&<p className="table-help">최근 검토 알림: {mailState==='unknown'||mailState==='sending'?'전송 결과 확인 필요':mailState==='rejected'?'수신 서버 거절':mailState==='failed_before_send'?'전송 전 실패':'발송 준비 기록 확인 필요'} · 자동 재전송하지 않습니다.</p>}
    {loading?<p>검토함을 확인하는 중입니다.</p>:failed?<p role="status">검토함 연결을 확인하지 못했습니다. 기존 리포트·출처 검토는 아래에서 계속할 수 있습니다.</p>:<>
      <p>{total?`확인이 필요한 항목 ${total}건`:'새 검토 요청이 없습니다.'}</p>
      {total>100&&<p className="table-help">먼저 들어온 100건을 표시합니다. 메일 링크는 목록 범위 밖의 대상도 직접 확인합니다.</p>}
      <ul>{items.map(i=><li key={`${i.kind}:${i.id}`}><a href={reviewRequestPath(i)}>{i.currency?`${i.currency} · `:''}{i.title}</a><small> · {labels[i.kind]}</small></li>)}</ul>
    </>}
    <button className="quiet-button" onClick={()=>void refresh()}>검토함 새로 확인</button>
  </section>
}
