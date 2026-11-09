import {renderToStaticMarkup} from 'react-dom/server'
import {expect,it} from 'vitest'
import {ReviewRequestNotice,type InboxItem} from './AdminReviewInbox'
const target={kind:'report' as const,id:'a'.repeat(64),version:'b'.repeat(64)}
const item:InboxItem={...target,currency:'CLP',base_date:'2026-11-09',title:'검토할 원고',summary:'요약',reason:'근거 확인',target_id:'a'.repeat(64)}
it('shows current and stale mail targets without an embedded approval action',()=>{
 const current=renderToStaticMarkup(<ReviewRequestNotice target={target} state="current" item={item}/>),stale=renderToStaticMarkup(<ReviewRequestNotice target={target} state="changed" item={item}/>)
 expect(current).toContain('현재 대상과 메일의 버전이 일치');expect(current).toContain('해당 검토로 이동')
 expect(stale).toContain('현재 버전을 다시');expect(stale).not.toContain('해당 검토로 이동')
 expect(current).not.toContain('>승인<');expect(stale).not.toContain('>승인<')
})
it('shows operational failures at the linked target without a false approval or dismissal action',()=>{
 const incident={...item,kind:'incident' as const,title:'입력 저장 확인',reason:'write · storage_failed',summary:'저장 장애로 새 생성 보류'}
 const html=renderToStaticMarkup(<ReviewRequestNotice target={incident} state="current" item={incident}/>)
 expect(html).toContain('review-target-'+incident.target_id)
 expect(html).toContain('정상 검사로 해결');expect(html).toContain(incident.reason)
 expect(html).not.toContain('해당 검토로 이동');expect(html).not.toContain('>승인<')
})
