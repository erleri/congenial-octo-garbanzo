import {parseArgs} from 'node:util'
import {createAdminReviewStore,deliverAdminReviewEmail} from './email/admin-review.js'
import {assertAdminReviewSendEnvironment,createSmtpEmailTransport} from './email/smtp-transport.js'
const {values}=parseArgs({options:{plan:{type:'boolean',default:false},send:{type:'boolean',default:false}},strict:true})
if(values.plan===values.send)throw Error('choose_review_email_plan_or_send')
try {
  // Recipient is a private server setting, never the reader mailing list.
  if(values.send)assertAdminReviewSendEnvironment(process.env)
  if(!process.env.FX_ADMIN_REVIEW_EMAIL_TO)throw Error('review_email_recipient_missing')
  const store=createAdminReviewStore({url:process.env.VITE_SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,mode:'workflow',env:process.env})
  const result=await deliverAdminReviewEmail({recipient:process.env.FX_ADMIN_REVIEW_EMAIL_TO,store,plan:values.plan,
    transport:values.send?createSmtpEmailTransport({channel:'admin-review'}):undefined})
  // No titles, addresses, private URLs or message bodies in public Actions logs.
  console.log(JSON.stringify({status:result.status,count:result.count??0,transportCalls:result.transportCalls}))
  if(!['accepted','already_recorded','no_new_items','plan_only'].includes(result.status))process.exitCode=1
}catch{console.error('admin_review_email_hold: check private configuration and ledger; no automatic resend');process.exitCode=1}
