import {useEffect,useState} from 'react'
import {getReportClient} from '../lib/reports/client'
import {withConnectionDeadline} from '../lib/reports/connection-deadline'
type Item={id:string;currency:string;base_date:string;status:string;scope:string;reservedUsd:number;costState:string;attempt:number;lookupReason:string|null;checkedAt:string|null;nextLookupAt?:string|null;routeBlockedUntil?:string|null}
type Recovery={policy:{enabled:boolean;revision:number};items:Item[];globalBlocked?:boolean;totalItems?:number}
const recoveryLabels:Record<string,string>={recovery_retry_wait:'전액 예약 유지 · 재시도 대기',recovery_retry_exhausted:'자동 재시도 소진',
 cost_fully_reserved_unconfirmed:'전액 예약 유지 · 비용 미확정',cost_still_unconfirmed:'비용 미확정 · 공통 유료 처리 보류',
 execution_uncertain:'처리 여부 미확인',execution_active:'진행 중 작업 확인',cost_lookup_security_hold:'비용 조회 인증·식별 확인 필요',
 cost_exceeded:'예약 한도 초과',expense_reconciled_valid_response:'비용 확인 완료',response_failed_no_automatic_retry:'비용 확인 완료 · 응답 실패',recovery_route_missing:'제공 경로 기록 확인 필요',recovery_retry_completed:'재시도 처리 완료 · 원요청 비용 별도 확인'}
const lookupLabels:Record<string,string>={confirmed:'확정',record_not_found:'조회 기록 없음',authentication_error:'인증 오류',permission_error:'권한 오류',
 lookup_rate_limited:'조회 제한',provider_error:'제공자 오류',http_error:'조회 오류',timeout:'시간 초과',network_error:'연결 실패',invalid_json:'응답 형식 오류',
 identity_mismatch:'요청 식별 불일치',completion_not_confirmed:'종료 정보 미확인',cost_missing:'비용 정보 미제공',lookup_error:'조회 미확인'}
const time=(value:string)=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})+' KST':'시각 미확인'
export default function ReportRecoveryStatus(){
 const [value,setValue]=useState<Recovery|null>(null),[failed,setFailed]=useState(false)
 useEffect(()=>{
  let active=true
  const load=()=>withConnectionDeadline(async signal=>{
   const client=await getReportClient(),r=await client.rpc('currency_report_recovery_summary').abortSignal(signal)
   if(r.error||!r.data?.policy||!Array.isArray(r.data.items)||r.data.items.some((i:Item)=>!Number.isFinite(i.reservedUsd)||typeof i.id!=='string'))throw Error('recovery_status_unavailable')
   if(active){setValue(r.data as Recovery);setFailed(false)}
  },3000).catch(()=>{if(active)setFailed(true)})
  void load();const timer=setInterval(()=>void load(),30000)
  return()=>{active=false;clearInterval(timer)}
 },[])
 if(failed)return <p className="table-help">공통 복구 정책 연결을 확인하지 못했습니다. 비용 확인 완료로 판단하지 않습니다.</p>
 if(!value)return <p className="table-help">공통 복구 상태 확인 중</p>
 return <ReportRecoveryView value={value}/>
}
export function ReportRecoveryView({value}:{value:Recovery}){
 return <section aria-label="공통 복구 상태"><h4>공통 복구</h4><p>자동 복구 정책 {value.policy.enabled?'활성':'비활성'} · 추가 재시도 최대 1회</p>
 {value.globalBlocked&&<p>새 유료 처리 공통 보류 · 기존 공개 리포트와 환율은 유지됩니다.</p>}
 {(value.totalItems??0)>value.items.length&&<p className="table-help">전체 {value.totalItems}건 중 최근 {value.items.length}건 표시 · 공통 차단 여부는 전체 기록 기준입니다.</p>}
 {!value.items.length?<p className="table-help">저장된 복구 판정이 없습니다.</p>:<ul>{value.items.map(i=><li key={i.id}>
  <strong>{i.currency}</strong> · {recoveryLabels[i.status]??'복구 확인 필요'}{i.scope==='global'?' · 공통 차단':''}
  <p className="table-help">{i.base_date} · 미확정 예약 ${i.reservedUsd.toFixed(5)} · 추가 시도 {i.attempt}/1
   {i.lookupReason?` · 비용 조회: ${lookupLabels[i.lookupReason]??'확인 필요'}`:''}</p>
  {i.status==='recovery_retry_wait'&&<p className="table-help">다음 실행에서 대기 시간·예산·근거 자격을 다시 확인합니다. 비용이 확인된 상태는 아닙니다.</p>}
  {i.costState==='unknown'&&i.nextLookupAt&&<p className="table-help">다음 비용 조회 가능: {time(i.nextLookupAt)} 이후 실행</p>}
  {i.routeBlockedUntil&&<p className="table-help">제공 경로 대기: {time(i.routeBlockedUntil)}까지</p>}
 </li>)}</ul>}</section>
}
