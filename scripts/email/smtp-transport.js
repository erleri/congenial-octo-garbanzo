import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'

export function assertEmailSendEnvironment(env) {
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='erleri/congenial-octo-garbanzo'
    ||env.FX_EMAIL_REPORT_MODE!=='approved'||env.FX_EMAIL_SEND_APPROVED!=='true'||env.FX_EMAIL_HOLD==='true') throw Error('explicit_workflow_email_send_required')
}
export function createSmtpEmailTransport({env=process.env,python='python'}={}) {
  assertEmailSendEnvironment(env)
  if(!env.SMTP_USERNAME?.trim()||!env.SMTP_PASSWORD?.trim()) throw Error('smtp_configuration_missing')
  return request=>new Promise(resolve=>{
    const child=spawn(python,[fileURLToPath(new URL('./smtp_transport.py',import.meta.url))],{
      windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...env},
    })
    let output='',settled=false,spawned=false
    const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);resolve(result)}
    const unknown={status:'unknown',code:null,reason:'transport_result_unknown'}
    const timer=setTimeout(()=>{child.kill();finish(unknown)},120000)
    child.stdout.on('data',chunk=>{output+=chunk.toString('utf8');if(output.length>4096){child.kill();finish(unknown)}})
    // Never copy a raw SMTP transcript or provider exception into CI output.
    child.stderr.resume()
    child.on('spawn',()=>{spawned=true})
    child.on('error',()=>finish(spawned?unknown:{status:'failed_before_send',code:null,reason:'pre_data_failure'}))
    child.on('close',code=>{if(code!==0)return finish(unknown);try{finish(JSON.parse(output))}catch{finish(unknown)}})
    child.stdin.on('error',()=>{child.kill();finish(unknown)})
    child.stdin.end(JSON.stringify(request))
  })
}
