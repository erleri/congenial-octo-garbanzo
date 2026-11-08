import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {fileURLToPath} from 'node:url'
import {assertEmailFrame} from './email/delivery-core.js'
import {createEmailDeliveryStore} from './email/delivery-store.js'
import {deliverDashboardEmail,planDashboardEmail} from './email/delivery-worker.js'
import {createSmtpEmailTransport,assertEmailSendEnvironment} from './email/smtp-transport.js'

const {values}=parseArgs({options:{send:{type:'boolean',default:false},plan:{type:'boolean',default:false},'local-connection':{type:'string'}},strict:true})
if(values.send===values.plan) throw Error('choose_email_plan_or_send')
if(process.env.FX_EMAIL_REPORT_MODE!=='approved') throw Error('approved_email_mode_required')
const frame=assertEmailFrame(JSON.parse(await fs.readFile('email-compose-context.json','utf8')))
// The same existing mailing-list file is used. Addresses are never printed or
// copied into public build artifacts, DB rows or the step summary.
const recipients=JSON.parse(await fs.readFile('data/mailing_list.json','utf8'))
let connection={url:process.env.VITE_SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,mode:'workflow'}
if(values['local-connection']) {
  if(values.send) throw Error('local_cli_cannot_send_email')
  const repository=fileURLToPath(new URL('../',import.meta.url))
  const privateRoot=await fs.realpath(path.join(repository,'.local-reports/private'))
  const file=await fs.realpath(values['local-connection'])
  if(!file.startsWith(privateRoot+path.sep)||path.extname(file)!=='.json') throw Error('private_local_email_connection_required')
  const local=JSON.parse(await fs.readFile(file,'utf8'))
  connection={url:local.url,key:local.serviceKey,mode:'local'}
}
const store=createEmailDeliveryStore({...connection,env:process.env})
let result
if(values.plan) {
  const preview=await planDashboardEmail({frame,recipients,store})
  const directory=path.resolve('.local-reports/private/email-delivery')
  await fs.mkdir(directory,{recursive:true})
  const file=path.join(directory,`plan-${Date.now()}.json`)
  await fs.writeFile(file,JSON.stringify(preview,null,2),{flag:'wx'})
  result={...preview,rows:preview.rows.map(({reportCount,lookupStatus})=>({reportCount,lookupStatus}))}
} else {
  assertEmailSendEnvironment(process.env)
  if(frame.workflowRunId!==process.env.GITHUB_RUN_ID) throw Error('email_workflow_identity_mismatch')
  const chartBase64=(await fs.readFile('email-chart.png')).toString('base64')
  const chartSnapshot=JSON.parse(await fs.readFile('email-chart-meta.json','utf8'))
  result=await deliverDashboardEmail({frame,chartBase64,chartSnapshot,recipients,store,transport:createSmtpEmailTransport()})
  result={...result,rows:result.rows.map(({status,code,reportCount,noticeCount,lookupStatus})=>({status,code,reportCount,noticeCount,lookupStatus}))}
}
console.log(JSON.stringify(result))
if(process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
  `\n### Dashboard email\nMode: ${values.plan?'plan only':'SMTP attempt'} · ${result.status}\n\n`
  +result.rows.map((r,i)=>`- Recipient ${i+1}: ${r.status??r.lookupStatus} · reports ${r.reportCount??'-'}${r.code?` · SMTP ${r.code}`:''}`).join('\n')+'\n')
if(!['completed','no_recipients','plan_only'].includes(result.status)||result.rows.some(r=>r.lookupStatus==='unavailable')) process.exitCode=1
