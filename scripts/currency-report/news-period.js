import {validDate} from './core.js'
import {fingerprint} from './research-harness.js'
export const NEWS_PERIOD_VERSION='news-period/1'
export const NEWS_PERIOD_GUIDE='marketPeriod는 단일 거래일이면 null, 주간·월간·명시 구간 해설이면 {kind:week|month|range,start,end,quote,blockPositions}다. 구간은 원문으로 확인하고 eventDate는 빈 문자열로 둔다. 월만 명시되면 그 달의 달력 범위이며 마지막 거래일을 뜻하지 않는다. 서로 다른 기간·가격 종류·미래 전망을 한 요지로 합치지 않는다. 대조도 같은 marketPeriod와 모든 주장의 기간을 독립 확인한다. 구간 해설을 당일 원인으로 바꾸지 않는다.'
export function validMarketPeriod(p){
 if(!p||!['week','month','range'].includes(p.kind)||!validDate(p.start)||!validDate(p.end)||p.start>=p.end)return false
 const days=(Date.parse(p.end)-Date.parse(p.start))/86400000+1
 if(p.kind==='week'&&days>7||days>92)return false
 if(p.kind==='month'&&(p.start.slice(0,7)!==p.end.slice(0,7)||!p.start.endsWith('-01')
  ||new Date(Date.parse(p.end)+86400000).getUTCDate()!==1))return false
 return true
}
export const periodLabel=p=>p.kind==='month'?p.start.slice(0,7):`${p.start}/${p.end}`
export const periodIdentity=p=>({kind:p.kind,start:p.start,end:p.end})
export const samePeriod=(a,b)=>!!a&&!!b&&fingerprint([a.kind,a.start,a.end])===fingerprint([b.kind,b.start,b.end])
export function inspectMarketPeriod(job,candidate){
 const p=candidate.marketPeriod
 if(!validMarketPeriod(p)||candidate.eventDate!==''||candidate.eventDateEvidence?.basis!=='unknown'
  ||candidate.eventDateEvidence?.quote!==''||candidate.eventDateEvidence?.blockPositions?.length
  ||candidate.eventDateEvidence?.relation!=='none'||p.end>job.time.asOf.slice(0,10)
  ||typeof p.quote!=='string'||p.quote.length<4||p.quote.length>480||!Array.isArray(p.blockPositions)
  ||!p.blockPositions.length||p.blockPositions.length>8||new Set(p.blockPositions).size!==p.blockPositions.length
  ||p.blockPositions.some(i=>!Number.isInteger(i)||!job.blocks[i])
  ||!p.blockPositions.map(i=>job.blocks[i].text).join(' ').includes(p.quote))throw Error('market_period_evidence_required')
 if(!job.time.requestedDates.some(d=>d>=p.start&&d<=p.end))throw Error('market_period_outside_research_window')
 // Exact quote presence is only structural support; the separate comparison
 // must verify the normalized boundaries and every claim's scope.
 return p
}
export function fitsCommentary(item,connection){
 if(item.marketPeriod)return validMarketPeriod(item.marketPeriod)&&samePeriod(item.marketPeriod,connection.commentaryPeriod)
 return !connection.commentaryPeriod&&item.eventDate===connection.commentaryDate&&item.sourceSessionDate===connection.commentaryDate
}
