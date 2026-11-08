import {useEffect,useState} from 'react'
import './ApiStatusPanel.css'
import type {ApiHealthSnapshot} from '../types/apiHealth'

const states={not_checked:'미점검',sample_ok:'표본 정상',needs_configuration:'설정 필요',check_failed:'점검 실패'}
const failures:Record<string,string>={authentication_failed:'인증 거부',access_denied:'접근 차단',rate_limited:'호출 한도',timeout:'응답 시간 초과',
  connection_failed:'연결 실패',schema_changed:'응답 구조 변경',provider_unavailable:'기관 응답 오류',empty_result:'조회 범위에 자료 없음',
  values_missing:'값 결측',missing_credentials:'키 설정 필요',invalid_local_format:'로컬 키 형식 확인',invalid_json:'JSON 응답 아님',
  redirect_blocked:'다른 주소로 이동 차단',credential_echo_blocked:'민감정보 응답 차단',provider_rejected:'기관 요청 거부',http_error:'HTTP 오류',
  response_too_large:'응답 용량 초과',empty_body:'빈 응답',definition_mismatch:'지표 단위·출처 정의 불일치',missing_or_invalid_credentials:'로컬 키 설정·형식 확인'}
const time=(value:string|null)=>value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'기록 없음'

function validHealth(value:ApiHealthSnapshot) {
  return value?.version==='local-api-health/1'&&value.scope==='local_saved_checks'&&Array.isArray(value.providers)&&value.providers.length<=32
    &&Number.isFinite(Date.parse(value.generatedAt))&&value.providers.every(p=>typeof p.id==='string'&&Object.hasOwn(states,p.status)
      &&[p.name,p.kind,p.role,p.stage].every(s=>typeof s==='string'&&s.length<240)
      &&[p.checkedAt,p.lastSuccessAt].every(s=>s===null||Number.isFinite(Date.parse(s)))
      &&(p.sample===null||typeof p.sample.seriesId==='string'&&typeof p.sample.use==='string'))
}

export default function ApiStatusPanel() {
  const [health,setHealth]=useState<ApiHealthSnapshot|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0),[loading,setLoading]=useState(true)
  const [kind,setKind]=useState('전체')
  useEffect(()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000)
    let active=true
    void fetch('/__local-api/status',{signal:controller.signal,cache:'no-store'}).then(async response=>{
      if(!response.ok)throw new Error('status_unavailable')
      const value=await response.json() as ApiHealthSnapshot
      if(!validHealth(value))throw new Error('invalid_status')
      if(active)setHealth(value)
    }).catch(()=>{if(active){setHealth(null);setError('점검 기록을 읽지 못했습니다. API 장애 여부는 확인되지 않았습니다.')}})
      .finally(()=>{clearTimeout(timer);if(active)setLoading(false)})
    return()=>{active=false;controller.abort();clearTimeout(timer)}
  },[reload])
  const rows=health?.providers.filter(p=>kind==='전체'||p.kind===kind)??[]
  return <section className="api-status-panel table-card" aria-labelledby="api-status-title">
    <div className="api-status-heading"><div><span className="scope-badge scope-badge-local">로컬 점검</span><h3 id="api-status-title">API·자료 연결 상태</h3></div>
      <button type="button" className="quiet-button" disabled={loading} onClick={()=>{setLoading(true);setError('');setReload(n=>n+1)}}>점검 결과 다시 읽기</button></div>
    <p className="table-help">어떤 연결이 무슨 용도인지와 마지막 점검 결과를 확인합니다. 이 화면을 열거나 새로 읽어도 외부 API와 AI를 호출하지 않습니다.</p>
    {error&&<p role="alert" className="inline-notice warning-notice">{error}</p>}
    {loading&&<p role="status">저장된 점검 기록을 읽는 중입니다.</p>}
    {health&&<><div className="api-status-toolbar"><label>종류 <select value={kind} onChange={event=>setKind(event.target.value)}>
      {['전체',...new Set(health.providers.map(p=>p.kind))].map(value=><option key={value}>{value}</option>)}</select></label>
      <span>표본 정상 {health.providers.filter(p=>p.status==='sample_ok').length} · 미점검 {health.providers.filter(p=>p.status==='not_checked').length}</span></div>
      <div className="api-status-table-wrap"><table className="api-status-table"><thead><tr><th>연결·용도</th><th>확인 상태</th><th>최근 점검 / 성공</th></tr></thead><tbody>
        {rows.map(p=><tr key={p.id}><td><strong>{p.name}</strong><small>{p.kind} · {p.stage}</small><p>{p.role}</p></td>
          <td><span className={`api-status-badge ${p.status}`}>{states[p.status]}</span>{p.outdated&&<small>점검 후 24시간 경과 · 재확인 필요</small>}
            {p.errorType&&<p>{failures[p.errorType]??'확인 필요'}</p>}{p.sample&&<><small>{p.sample.seriesId} · {p.sample.use}</small>
              {p.sample.latestPeriod&&<small>통계 대상 {p.sample.latestPeriod} · 점검일과 구분</small>}</>}</td>
          <td><small>점검 {time(p.checkedAt)}</small><small>성공 {time(p.lastSuccessAt)}</small></td></tr>)}</tbody></table></div>
      <p className="table-help api-status-limit">{health.limitation}</p>
      <p className="table-help">토큰·계정·인증 주소·원본 오류는 표시하지 않습니다. 운영용 자동 점검과 관리자 권한 연결은 별도 작업입니다.</p></>}
  </section>
}
