import { useEffect, useState } from 'react'
import { getReportClient, localReportMode } from '../lib/reports/client'
interface Row {day:string;scope:string;event:string;screen:string;currency:string;report_id:string;count:number}
const labels:Record<string,string>={page_view:'화면 조회',report_open:'리포트 열기',report_30s:'30초 표시',evidence_open:'근거 펼침',dashboard_report:'대시보드에서 진입'}
export default function UsagePanel(){
  const [rows,setRows]=useState<Row[]>([]),[state,setState]=useState('조회 중'),[revision,setRevision]=useState(0)
  useEffect(()=>{let active=true;const controller=new AbortController()
    void (async()=>{try{const client=await getReportClient(),since=new Date(Date.now()-29*86400000).toISOString().slice(0,10)
      const result=await client.from('app_usage_daily').select('day,scope,event,screen,currency,report_id,count').gte('day',since).eq('scope',localReportMode()?'local':'production').order('day',{ascending:false}).limit(1001).abortSignal(controller.signal)
      if(result.error)throw result.error
      if(active){setRows((result.data as Row[]).slice(0,1000));setState(result.data.length>=1000?'최근 1,000개 집계 묶음 · 부분 집계일 수 있음':'최근 30일')}
    }catch{if(active){setRows([]);setState('통계 저장소 연결·관리 권한 확인 필요')}}})()
    return()=>{active=false;controller.abort()}
  },[revision])
  return <section className="usage-panel"><p>{state}{localReportMode()?' · 로컬 시험 수치':''}</p><p className="table-help">익명 횟수입니다. 고유 독자 수나 실제 정독을 뜻하지 않습니다. 관리자·로그인·비교 프레임은 제외합니다.</p><button className="quiet-button" onClick={()=>setRevision(n=>n+1)}>집계 다시 읽기</button>
    <div className="table-scroll"><table className="dense-table"><thead><tr><th>행동</th><th>화면·통화</th><th>횟수</th></tr></thead><tbody>{Object.entries(rows.reduce<Record<string,number>>((all,row)=>{const key=`${row.event}|${row.screen}|${row.currency}`;all[key]=(all[key]??0)+Number(row.count);return all},{})).map(([key,count])=>{const [event,screen,currency]=key.split('|');return <tr key={key}><td>{labels[event]??event}</td><td>{({dashboard:'대시보드',trends:'환율 추이',reports:'리포트'} as Record<string,string>)[screen]??screen} {currency}</td><td>{count.toLocaleString()}</td></tr>})}</tbody></table></div>{rows.length===0&&<p>표시할 집계가 없습니다.</p>}
  </section>
}
