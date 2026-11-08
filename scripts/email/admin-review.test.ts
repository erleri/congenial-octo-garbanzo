import {expect,it,vi} from 'vitest'
import {emailHash} from './delivery-core.js'
import {buildAdminReviewEmail,deliverAdminReviewEmail} from './admin-review.js'
import {assertAdminReviewSendEnvironment} from './smtp-transport.js'
const item={kind:'report',id:'91000000-0000-0000-0000-000000000001',version:'a'.repeat(64),currency:'CLP',base_date:'2026-11-09',title:'검토 원고',summary:'환율 변화의 설명',reason:'근거를 확인하세요.'}
function fixture({state='claimed',begin=true,finishError=false,malformed=false}={}){
 let payloadJson=''
 const store=vi.fn(async(action:string,input:Record<string,string>)=>{
  if(action==='claim'||action==='preview')return {status:action==='preview'?'plan_only':state,key:'b'.repeat(64),items:[item]}
  if(action==='freeze'){payloadJson=input.payloadJson;return {payloadHash:emailHash(payloadJson)}}
  if(action==='begin')return {started:begin,reason:'target_or_access_changed',payloadJson:malformed?'{}':payloadJson}
  if(action==='finish'){if(finishError)throw Error('receipt lost');return {recorded:true}}
 })
 const transport=vi.fn(async()=>({status:'accepted',code:250,reason:'smtp_accepted'}))
 return {store,transport}
}
it('creates an escaped, versioned review link without credentials or one-click approval',()=>{
 const payload=buildAdminReviewEmail([{...item,title:'<img src=x onerror=alert(1)>'}])
 expect(payload.html).not.toContain('<img');expect(payload.html).toContain('&lt;img')
 expect(payload.html).toContain('reviewVersion=');expect(payload.html).toContain('#admin')
 expect(payload.text).toContain('Dot에서:');expect(payload.text).toContain('승인되지는 않습니다')
 expect(()=>buildAdminReviewEmail([{...item,summary:'https://x.example/?token=secret'}])).toThrow()
 expect(()=>buildAdminReviewEmail([{...item,kind:'approve'}])).toThrow()
})
it('plans without ledger mutation or SMTP, and skips previously recorded or empty selections',async()=>{
 const f=fixture()
 expect(await deliverAdminReviewEmail({recipient:'admin@example.test',...f,plan:true})).toMatchObject({status:'plan_only',count:1,transportCalls:0})
 expect(f.store.mock.calls.map(c=>c[0])).toEqual(['preview']);expect(f.transport).not.toHaveBeenCalled()
 for(const state of ['already_recorded','no_new_items','recipient_not_active_admin']){
  const g=fixture({state});expect(await deliverAdminReviewEmail({recipient:'admin@example.test',...g})).toMatchObject({status:state,transportCalls:0});expect(g.transport).not.toHaveBeenCalled()
 }
})
it('rechecks current targets before sending and records an accepted single attempt',async()=>{
 const f=fixture()
 expect(await deliverAdminReviewEmail({recipient:'admin@example.test',...f})).toMatchObject({status:'accepted',transportCalls:1})
 expect(f.store.mock.calls.map(c=>c[0])).toEqual(['claim','freeze','begin','finish'])
 const g=fixture({begin:false})
 expect(await deliverAdminReviewEmail({recipient:'admin@example.test',...g})).toMatchObject({status:'target_or_access_changed',transportCalls:0})
 expect(g.transport).not.toHaveBeenCalled()
})
it('keeps unknown SMTP or lost persistence as uncertainty and never retries',async()=>{
 const f=fixture();f.transport.mockRejectedValueOnce(Error('lost acknowledgement'))
 expect(await deliverAdminReviewEmail({recipient:'admin@example.test',...f})).toMatchObject({status:'unknown',transportCalls:1})
 expect(f.transport).toHaveBeenCalledTimes(1)
 const g=fixture({finishError:true})
 expect(await deliverAdminReviewEmail({recipient:'admin@example.test',...g})).toMatchObject({status:'receipt_unconfirmed',transportCalls:1})
 expect(g.transport).toHaveBeenCalledTimes(1)
 const h=fixture({malformed:true})
 expect(await deliverAdminReviewEmail({recipient:'admin@example.test',...h})).toMatchObject({status:'ledger_or_payload_hold',transportCalls:0})
 expect(h.transport).not.toHaveBeenCalled()
})
it('requires the dedicated main-workflow activation and never inherits daily reader send permission',()=>{
 const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'erleri/congenial-octo-garbanzo',GITHUB_REF:'refs/heads/main',FX_ADMIN_REVIEW_EMAIL_ENABLED:'true',FX_ADMIN_REVIEW_EMAIL_SEND_APPROVED:'true'}
 expect(()=>assertAdminReviewSendEnvironment(env)).not.toThrow()
 for(const patch of [{FX_ADMIN_REVIEW_EMAIL_ENABLED:'false'},{FX_ADMIN_REVIEW_EMAIL_SEND_APPROVED:''},{GITHUB_REF:'refs/heads/review'}, {GITHUB_ACTIONS:'false'}])expect(()=>assertAdminReviewSendEnvironment({...env,...patch})).toThrow()
})
