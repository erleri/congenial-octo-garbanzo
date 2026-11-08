import { useEffect, useState } from 'react'
import type { DatasetSource, ExchangeRateDataset } from '../types/exchangeRate'
import { DATASET_SOURCE_LABELS } from '../types/exchangeRate'
import { datasetStatus } from '../lib/dataStatus'
import { buildInfo } from '../buildInfo'

const time=(value?:string)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'미기록'
export default function DataStatus({data,source,busy,error}:{data:ExchangeRateDataset|null;source:DatasetSource;busy:boolean;error:string|null}) {
  const [now,setNow]=useState(Date.now)
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60_000);return()=>clearInterval(timer)},[])
  const status=datasetStatus(data,now)
  return <div className="data-status"><span className="status-item">환율 {data?.baseDate??'확인 중'}</span>
    <span className={`data-age ${status.state}`} role="status">{busy?'조회 중':error?'연결 확인 필요':status.label}</span>
    <details className="data-info"><summary>자료 정보</summary><div className="data-info-content">
      <p>조회 {busy?'진행 중':error?'확인 필요':'완료'} · {DATASET_SOURCE_LABELS[source]} · 수집 {time(data?.fetchedAt)} KST</p>
      <p>기준일은 저장 자료의 날짜입니다. 거래 종가·회사 기준환율과의 일치는 별도 확인 대상입니다.</p>
      <div className="table-scroll"><table><thead><tr><th>통화</th><th>공급자 / 가격</th><th>공급자 기준일</th></tr></thead><tbody>{status.quotes.map(q=><tr key={q.currency}><th>{q.currency}</th><td>{q.source} · {q.price}{!q.observed?' · 값/관측 확인 필요':''}</td><td>{q.providerDate??'미기록'}{q.providerUpdatedAt?<small>갱신 {time(q.providerUpdatedAt)} KST</small>:null}</td></tr>)}</tbody></table></div>
      <p>달력 기본값은 주말 제외·2영업일 경과 안내입니다. 국가별 휴일·공급 시각이 확인되지 않은 자료를 최신이라고 보증하지 않습니다.</p>
      <p className="technical-note">build {buildInfo.commit} · {buildInfo.branch} · 빌드 {time(buildInfo.builtAt)}</p>
    </div></details>
  </div>
}
