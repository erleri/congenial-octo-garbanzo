import { useEffect, useState } from 'react'
import { getReportClient, localReportMode } from '../lib/reports/client'
interface ReportRow {report_id:string;currency:string;title:string|null;base_date:string|null;available:boolean;opens:number;dwell:number;evidence:number;email:number}
interface UsageSummary {version:2;enabled:boolean;activatedAt:string|null;from:string;to:string;latestDay:string|null;totals:Record<string,number>;daily:{day:string;event:string;count:number}[];dimensions:{screen:string;view:string;currency:string;count:number}[];reportTotal:number;page:number;reports:ReportRow[]}
const labels:Record<string,string>={page_view:'화면 조회',email_entry:'메일 유입',report_open:'리포트 열기',report_30s:'30초 표시',evidence_open:'근거 펼침',dashboard_report:'대시보드에서 진입',dashboard:'대시보드',trends:'환율 추이',reports:'리포트',daily:'일별',monthly:'월별',comparison:'상세 비교'}
const count=(value:number|undefined)=>Number(value??0).toLocaleString()
export default function UsagePanel(){
 const [data,setData]=useState<UsageSummary|null>(null),[error,setError]=useState(false),[loading,setLoading]=useState(true)
 const [days,setDays]=useState(30),[page,setPage]=useState(0),[revision,setRevision]=useState(0)
 useEffect(()=>{let active=true
  void(async()=>{setLoading(true);setError(false)
   try{const client=await getReportClient(),result=await client.rpc('admin_app_usage_v2',{p_days:days,p_page:page,p_scope:localReportMode()?'local':'production'})
    if(result.error||result.data?.version!==2)throw Error('usage_summary_unavailable')
    if(active)setData(result.data as UsageSummary)
   }catch{if(active){setData(null);setError(true)}}finally{if(active)setLoading(false)}
  })();return()=>{active=false}
 },[days,page,revision])
 const totals=data?.totals??{},empty=Object.values(totals).every(n=>Number(n)===0)
 const status=loading?'집계 조회 중':error?'조회 장애 · 연결과 관리자 권한을 확인해 주세요':!data?.enabled?'집계 꺼짐':empty?'활성화 후 해당 기간의 기록 없음':'정상 집계'
 const daily=new Map<string,Record<string,number>>()
 for(const row of data?.daily??[]){const values=daily.get(row.day)??{};values[row.event]=Number(row.count);daily.set(row.day,values)}
 const chartDays:{day:string;views:number;opens:number}[]=[]
 if(data)for(let day=data.from;day<=data.to&&chartDays.length<31;day=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10)){
  const values=daily.get(day)??{};chartDays.push({day,views:values.page_view??0,opens:values.report_open??0})
 }
 const ceiling=Math.max(1,...chartDays.map(d=>Math.max(d.views,d.opens)))
 const points=(key:'views'|'opens')=>chartDays.map((d,i)=>(20+i*560/Math.max(1,chartDays.length-1))+','+(122-d[key]/ceiling*100)).join(' ')
 return <section className="usage-panel" aria-busy={loading}>
  <div className="usage-toolbar"><strong role="status">{status}</strong><div className="usage-controls"><label>기간 <select value={days} onChange={e=>{setDays(Number(e.target.value));setPage(0)}}><option value={7}>최근 7일</option><option value={30}>최근 30일</option></select></label><button className="quiet-button" onClick={()=>setRevision(n=>n+1)}>새로고침</button></div></div>
  <p className="table-help">익명 행동 횟수입니다. 고유 독자 수·정독률·메일 오픈율을 측정하지 않습니다. 로그인·관리자·미리보기·추적 거부 환경은 제외합니다.</p>
  {data&&<><p className="table-help">한국시간 · {data.from} ~ {data.to} · 최근 기록 {data.latestDay??'없음'}{localReportMode()?' · 로컬 시험':''}<br/>활성화 {data.activatedAt?new Date(data.activatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'미설정'} · 이전 UTC 집계는 포함하지 않습니다.</p>
  <div className="usage-kpis">{['page_view','email_entry','report_open','report_30s'].map(event=><div key={event}><span>{labels[event]}</span><strong>{count(totals[event])}</strong></div>)}</div>
  <details className="usage-definitions"><summary>지표 안내</summary><p>메일 유입은 표시가 있는 독자 메일 링크로 앱에 들어온 횟수이며, 전달된 메일도 포함합니다. 리포트별 메일 수치는 해당 유입에서 본문을 연 횟수입니다. 30초 표시는 같은 리포트를 전면 탭에서 연속 30초 표시한 횟수입니다. 근거 펼침은 출처 영역을 처음 연 행동입니다.</p></details>
  {!empty&&<div className="usage-chart"><h4>일별 이용 추이</h4><svg viewBox="0 0 600 150" role="img" aria-label="날짜별 화면 조회와 리포트 열기 추이. 아래 표에서 정확한 값을 확인할 수 있습니다."><line x1="20" y1="122" x2="580" y2="122" stroke="#cad5df"/><polyline points={points('views')} fill="none" stroke="#183b56" strokeWidth="3"/><polyline points={points('opens')} fill="none" stroke="#087e76" strokeWidth="3" strokeDasharray="6 3"/><text x="20" y="146">{data.from.slice(5)}</text><text x="580" y="146" textAnchor="end">{data.to.slice(5)}</text></svg><p className="table-help">실선: 화면 조회 · 점선: 리포트 열기 · 최대 {count(ceiling)}회</p></div>}
  {!empty&&<><details><summary>일별 수치</summary><div className="table-scroll"><table className="dense-table"><thead><tr><th>날짜</th>{['page_view','email_entry','report_open','report_30s'].map(e=><th key={e}>{labels[e]}</th>)}</tr></thead><tbody>{[...daily].sort(([a],[b])=>b.localeCompare(a)).map(([day,values])=><tr key={day}><th>{day}</th>{['page_view','email_entry','report_open','report_30s'].map(e=><td key={e}>{count(values[e])}</td>)}</tr>)}</tbody></table></div></details>
  <h4>메뉴·통화별 조회</h4><div className="table-scroll"><table className="dense-table"><thead><tr><th>화면</th><th>통화</th><th>조회</th></tr></thead><tbody>{data.dimensions.map(row=><tr key={[row.screen,row.view,row.currency].join(':')}><td>{labels[row.screen]} {labels[row.view]??''}</td><td>{row.currency||'전체·공통'}</td><td>{count(row.count)}</td></tr>)}</tbody></table></div></>}
  <h4>리포트별 이용</h4>{data.reportTotal===0?<p>해당 기간에 열린 공개 리포트가 없습니다.</p>:<><div className="table-scroll usage-report-table"><table className="dense-table"><thead><tr><th>리포트</th><th>열기</th><th>30초</th><th>근거</th><th>메일 유입 열기</th></tr></thead><tbody>{data.reports.map(row=><tr key={row.report_id}><th><span className="table-help">{row.currency} · {row.base_date??'공개 종료'}</span><br/>{row.available?<a href={'/?run='+encodeURIComponent(row.report_id)+'#report/'+row.currency+'/'+row.base_date}>{row.title}</a>:<span>현재 공개되지 않은 리포트</span>}</th><td>{count(row.opens)}</td><td>{count(row.dwell)}</td><td>{count(row.evidence)}</td><td>{count(row.email)}</td></tr>)}</tbody></table></div><div className="usage-controls"><button className="quiet-button" disabled={page===0||loading} onClick={()=>setPage(n=>n-1)}>이전</button><span>{page+1} / {Math.ceil(data.reportTotal/20)}</span><button className="quiet-button" disabled={(page+1)*20>=data.reportTotal||loading} onClick={()=>setPage(n=>n+1)}>다음</button></div></>}
  </>}
 </section>
}
