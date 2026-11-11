import {it,expect} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import {ReportRecoveryView} from './ReportRecoveryStatus'
it('separates funded uncertainty, a job retry, global accounting failure and retry exhaustion',()=>{
 const html=renderToStaticMarkup(<ReportRecoveryView value={{policy:{enabled:true,revision:2},items:[
  {id:'a',currency:'ARS',base_date:'2026-11-10',status:'recovery_retry_wait',scope:'job',reservedUsd:.0949025,costState:'unknown',attempt:0,lookupReason:'record_not_found',checkedAt:null,nextLookupAt:'2026-11-11T00:00:00Z'},
  {id:'b',currency:'PEN',base_date:'2026-11-10',status:'cost_still_unconfirmed',scope:'global',reservedUsd:.01,costState:'unknown',attempt:0,lookupReason:'timeout',checkedAt:null},
  {id:'c',currency:'COP',base_date:'2026-11-10',status:'recovery_retry_exhausted',scope:'job',reservedUsd:0,costState:'confirmed',attempt:1,lookupReason:'confirmed',checkedAt:null},
 ]}}/>)
 for(const text of ['전액 예약 유지','재시도 대기','공통 차단','자동 재시도 소진','조회 기록 없음','시간 초과','09:00','KST'])expect(html).toContain(text)
 expect(html).toContain('비용이 확인된 상태는 아닙니다')
 expect(html).not.toContain('response_id');expect(html).not.toContain('gen-')
})
it('does not label a disabled or empty policy as no users or completed recovery',()=>{
 const html=renderToStaticMarkup(<ReportRecoveryView value={{policy:{enabled:false,revision:1},items:[]}}/>)
 expect(html).toContain('비활성');expect(html).toContain('저장된 복구 판정이 없습니다')
})
