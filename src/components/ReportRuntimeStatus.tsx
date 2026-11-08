import {useEffect,useState} from 'react'
import {getReportClient} from '../lib/reports/client'
import {withConnectionDeadline} from '../lib/reports/connection-deadline'
import ReportSourceManagement from './ReportSourceManagement'

interface Status {enabled:boolean;reviewEnabled:boolean;writer:string;monthlyLimitUsd:number;confirmedUsd:number;reservedUsd:number;unresolvedCalls:number;monthBasis:string;checks?:{currency:string;checkedAt:string;result:{status:string;baseDate:string|null;sources?:{sourceId:string;statuses:string[]}[]}}[]}
interface OperatingStatus {policyState:string;policyRevision:number|null;externalProcessingConfigured:boolean;recurringBudgetConfigured:boolean;cases:{currency:string;state:string;updatedAt:string;status:string|null;runId:string|null;testOnly?:boolean;sourceIssues?:{sourceId:string;status:string}[]}[]}
interface SourceMonitor {currency:string;checkedAt:string;gaps:string[];attentionRequired:boolean;omittedCandidates:number;sources:{sourceId:string;repeatedFailure:boolean}[];candidates:{domain:string;sampleUrl:string;discoveredSourceId:string;status:string;access:string;extraction:string;nextCheckAt:string|null}[]}
const candidateLabels:Record<string,string>={candidate_only:'후보 기록 · 사용 전',conditions_unconfirmed:'이용 범위 확인 필요',temporary_failure:'접근 실패 · 재확인 대기',processing_excluded:'접근 제한 · 처리 제외'}
const gapLabels:Record<string,string>={no_registered_capture:'등록 출처의 수집 자료 없음',repeated_source_failure:'출처 조회의 반복 실패',identical_capture_only:'확보한 본문이 모두 동일함',shared_credited_origin_only:'같은 원매체에 대한 의존 확인 필요',reviewed_explanation_gap:'이전 내용 검토에서 설명 근거 보완 필요'}
const statusLabels:Record<string,string>={runtime_disabled:'생성 중지',reviewed_input_wait:'자료 준비 대기',pending_admin_review:'관리자 검토 대기',content_review_hold:'내용 검토 보류',cost_unresolved:'비용 확인 대기',cost_exceeded:'비용 상한 확인 필요',duplicate_task:'기존 실행 유지',unresolved_or_inflight_call:'선행 호출 확인 대기',output_hold:'출력 검토 보류',structure_hold:'구조 검사 보류',execution_hold:'실행 기록 확인 필요'}
Object.assign(statusLabels,{input_staged:'집필 입력 준비 완료',source_use_wait:'자료 사용 범위 확인 대기',writing_input_hold:'설명 근거 준비 대기',cadence_hold:'발행 조건 대기',collection_or_review_hold:'자료 수집·검토 확인 필요',source_cost_unresolved:'자료 검토 비용 확인 대기',material_connection_hold:'근거 연결 확인 필요',writer_preparation_hold:'집필 입력 확인 필요',cache_validation_hold:'저장 자료 확인 필요'})
Object.assign(statusLabels,{source_review_wait:'자동 자료 검토 대기',analysis_context_wait:'문맥·출처 확인 대기',source_request_budget_wait:'자료 분석 예산 확인 대기'})
Object.assign(statusLabels,{source_monitor_storage_failed:'출처 후보 기록 확인 실패 · 기존 자료 처리 계속',source_monitor_update_deferred:'출처 후보 동시 갱신 · 다음 조회에서 확인'})
Object.assign(statusLabels,{source_refresh_time_budget:'새 출처 점검 시간 한도 · 다음 점검 대기',source_terms_check_pending:'새 출처 이용 조건 재확인 대기',
 source_admission_settings_unavailable:'새 출처 설정 확인 실패 · 기존 자료 처리 계속',source_supplement_failed:'새 출처 보조 수집 확인 필요'})
Object.assign(statusLabels,{running:'처리 중',paused:'중단 위치 보존',held:'보류',finished:'처리 완료',unchanged_case_already_processed:'같은 자료 처리 기록 유지',operating_batch_busy:'기존 실행 진행 중',existing_source_call_not_reusable:'기존 기사 검토 기록 확인 필요',existing_runtime_call_hold:'기존 집필 기록 확인 필요',execution_time_budget_wait:'실행시간 부족 · 다음 처리 대기'})
Object.assign(statusLabels,{access_failed:'조회 실패',extraction_failed:'본문 추출 실패',discovery_incomplete:'기사 탐색 미완료',period_mismatch:'대상 기간 불일치',source_review_hold:'내용 검토 보류',processing_restricted:'처리 범위 제한',source_metadata_hold:'발표 정보 확인 필요',original_pipeline_failed:'원문 검토 중단'})
Object.assign(statusLabels,{collection_returned_not_approved:'자료 수집 완료 · 내용 검토 전',official_inputs_collected:'공식 자료 새 조회 완료',
 official_inputs_partial:'일부 공식 자료 미확보',stored_official_inputs_after_lookup_failure:'신규 조회 실패 · 검증한 저장 자료 사용',
 official_access_barrier_not_statistic:'제공기관 접속 차단',official_cached_input_no_longer_eligible:'저장 자료 기간·정의 확인 필요',
 official_cache_reused_after_current_review:'저장 자료 재검사 완료',official_cache_write_failed:'공식 자료 캐시 저장 실패',
 official_cache_read_or_validation_failed:'공식 자료 캐시 조회·검사 실패',official_cache_capacity_hold:'공식 자료 캐시 용량 확인 필요',
 official_current_definition_edition_or_terms_hold:'새 지표 정의·수정본·이용 조건 확인 필요',
 official_emec_release_not_found:'EMEC 일부 조회 월의 발표 자료 미확보',official_inpc_release_not_found:'INPC 일부 조회 월의 발표 자료 미확보',
 inegi_credentials_missing:'INEGI 인증 설정 누락'})
export default function ReportRuntimeStatus() {
 const [status,setStatus]=useState<Status|null>(null),[failed,setFailed]=useState(false)
 const [operating,setOperating]=useState<OperatingStatus|null>(null)
 const [monitors,setMonitors]=useState<SourceMonitor[]|null>(null)
 useEffect(()=>{
  let active=true
  const refresh=()=>withConnectionDeadline(async signal=>{
   const client=await getReportClient()
   const result=await client.rpc('currency_report_runtime_summary').abortSignal(signal)
   if(result.error)throw result.error
   const value=result.data as Status
   if(!value||typeof value.enabled!=='boolean'||![value.monthlyLimitUsd,value.confirmedUsd,value.reservedUsd,value.unresolvedCalls].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0))throw Error('invalid_runtime_status')
   if(active){setStatus(value);setFailed(false)}
   const operatingResult=await client.rpc('currency_report_operating_summary').abortSignal(signal)
   const details=operatingResult.data as OperatingStatus|null
   if(active)setOperating(!operatingResult.error&&details&&typeof details.policyState==='string'&&Array.isArray(details.cases)?details:null)
   try{
    const monitorResult=await client.rpc('currency_report_source_monitor_summary').abortSignal(signal)
    if(active)setMonitors(!monitorResult.error&&Array.isArray(monitorResult.data)?monitorResult.data as SourceMonitor[]:null)
   }catch{if(active)setMonitors(null)}
  },3000).catch(()=>{if(active){setStatus(null);setOperating(null);setFailed(true)}})
  void refresh()
  const timer=setInterval(()=>void refresh(),30000)
  return()=>{active=false;clearInterval(timer)}
 },[])
 if(failed)return <p role="status">리포트 생성 연결 상태를 확인하지 못했습니다. 새 저장 구조의 적용 여부와 관리자 권한을 확인해 주세요.</p>
 if(!status)return <p>리포트 생성 상태를 확인하는 중입니다.</p>
 return <div className="runtime-status" role="status">
  <p><strong>새 리포트 생성 {status.enabled?'활성':'중지'}</strong> · 집필 {status.writer} · 자동 내용 검토 {status.reviewEnabled?'활성':'중지'}</p>
  <p>새 생성 경로 · 이번 달 확인 비용 ${status.confirmedUsd.toFixed(3)} · 미확정 예약 ${status.reservedUsd.toFixed(3)} · 한도 ${status.monthlyLimitUsd.toFixed(2)} <small>({status.monthBasis})</small></p>
  {status.unresolvedCalls>0&&<p>비용 확인이 필요한 호출 {status.unresolvedCalls}건 — 추가 생성을 보류합니다.</p>}
  {operating?<><p>자동 처리 설정 {operating.policyState==='operator_configured'?'등록됨':operating.policyState==='proposal_not_enabled'?'제안 · 실행 전':'미설정'} · 원문 비공개 분석 {operating.externalProcessingConfigured?'설정됨':'미확정'} · 반복 예산 {operating.recurringBudgetConfigured?'설정됨':'미확정'}</p>
   {operating.cases.length>0&&<ul>{operating.cases.map(c=><li key={c.currency}>{c.currency} · {statusLabels[c.status??'']??statusLabels[c.state]??'실행 기록 확인 필요'}{c.testOnly?' · 합성 연결 시험':''}
    {c.sourceIssues?.some(s=>statusLabels[s.status])&&<details><summary>자료 연결 확인</summary><ul>{c.sourceIssues.filter(s=>statusLabels[s.status]).map((s,i)=><li key={`${s.sourceId}-${i}`}>{s.sourceId} · {statusLabels[s.status]}</li>)}</ul></details>}
   </li>)}</ul>}</>:<p className="table-help">자동 처리 설정 상세는 아직 확인되지 않았습니다.</p>}
  {status.checks?.length?<ul>{status.checks.map(c=><li key={c.currency}>{c.currency} · {statusLabels[c.result.status]??'확인 필요'} · {c.result.baseDate??'기준일 미확인'}
   {c.result.sources?.some(s=>s.statuses?.some(code=>statusLabels[code]))&&<details><summary>공식 자료·조회 상태</summary><ul>{c.result.sources.flatMap(s=>(s.statuses??[]).filter(code=>statusLabels[code]).map(code=><li key={`${s.sourceId}-${code}`}>{s.sourceId} · {statusLabels[code]}</li>))}</ul></details>}
  </li>)}</ul>:<p>새 실행 기록 수신 전입니다.</p>}
  <ReportSourceManagement/>
  {monitors===null?<p className="table-help">출처 후보 관리 기록을 확인하지 못했습니다.</p>:monitors.some(m=>m.candidates.length||m.attentionRequired)&&<details><summary>뉴스 출처 후보·지속 장애</summary>
   <p className="table-help">후보는 리포트 근거로 사용하지 않습니다. 등록 출처의 처리는 계속됩니다. 수집 상태는 내용 검토 결과와 구분합니다.</p>
   <ul>{monitors.filter(m=>m.candidates.length||m.attentionRequired).map(m=><li key={m.currency}><strong>{m.currency}</strong> · {m.gaps.map(g=>gapLabels[g]??'자료 확인 필요').join(' · ')||'기존 출처 수집 유지'}
    {m.sources.filter(s=>s.repeatedFailure).map(s=><p key={s.sourceId}>{s.sourceId} · 반복 조회 실패</p>)}
    <ul>{m.candidates.map(c=><li key={c.domain}><a href={c.sampleUrl} target="_blank" rel="noopener noreferrer">{c.domain}</a> · {candidateLabels[c.status]??'후보 확인 필요'}
     {c.access==='public_capture'?' · 저장 응답 접근 확인':''}{c.extraction==='dated_metadata_present'?' · 발표일 정보 있음':''}
     <small> · 발견 경로 {c.discoveredSourceId}</small>
    </li>)}</ul>{m.omittedCandidates>0&&<p>후보 보관 한도 초과 {m.omittedCandidates}건 · 추가 연결 검토 필요</p>}
   </li>)}</ul>
  </details>}
  <p className="table-help">이 상태판의 생성 중지는 기존 승인 리포트의 공개 조회를 중단하지 않습니다.</p>
 </div>
}
