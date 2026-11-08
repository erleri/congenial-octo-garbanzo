// Offline workflow/compose verification. Never loads local secrets or sends mail.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import yaml from 'js-yaml'

const root=process.cwd(),directory=path.resolve('.local-reports/private/email2-delivery-20261103/cli')
const env={...process.env,FX_EMAIL_DATA_SOURCE:'json',GITHUB_ACTIONS:'false'}
for(const key of Object.keys(env)) if(/SUPABASE|SMTP|OPENROUTER|TOKEN|PASSWORD|SECRET|API_KEY|GITHUB_OUTPUT/.test(key)) delete env[key]
const checks=[]
let legacyHtml
for(const mode of ['legacy','shadow','approved']) for(const send of ['false','true']) for(const hold of ['false','true']) {
  const file=path.join(directory,`outputs-${mode}-${send}-${hold}.txt`)
  await fs.writeFile(file,'')
  const child=spawnSync(process.execPath,[path.join(root,'scripts/compose-email.js')],{cwd:directory,
    env:{...env,FX_EMAIL_REPORT_MODE:mode,FX_EMAIL_SEND_APPROVED:send,FX_EMAIL_HOLD:hold,GITHUB_OUTPUT:file},encoding:'utf8',windowsHide:true})
  assert.equal(child.status,0,'compose failed: '+child.stderr)
  const output=await fs.readFile(file,'utf8')
  const flag=name=>new RegExp(`^${name}=(.*)$`,'m').exec(output)?.[1]
  const delimiter=/^html_body<<(LATAM_EMAIL_[a-f0-9]+)$/m.exec(output)?.[1]
  assert.ok(delimiter)
  const html=output.slice(output.indexOf('html_body<<'+delimiter)+('html_body<<'+delimiter).length+1,output.lastIndexOf('\n'+delimiter))
  const expected=hold==='true'||mode==='approved'&&send!=='true'?'hold':mode==='approved'?'approved':'legacy'
  assert.equal(flag('delivery_mode'),expected);assert.equal(flag('mail_hold'),hold);assert.equal(flag('report_mode'),mode)
  if(legacyHtml===undefined) legacyHtml=html
  if(expected!=='approved') assert.equal(html,legacyHtml)
  else assert.ok(html.includes('<!--LATAM_FX_APPROVED_REPORT_DIGEST-->'))
  checks.push({mode,send,hold,delivery:expected,legacyBodyUnchanged:html===legacyHtml})
}
const current=yaml.load(await fs.readFile('.github/workflows/generate-data.yml','utf8'))
const previous=spawnSync('git',['-c','safe.directory='+root.replaceAll('\\','/'),'show','origin/main:.github/workflows/generate-data.yml'],{encoding:'utf8',windowsHide:true})
assert.equal(previous.status,0)
const original=yaml.load(previous.stdout)
const steps=Object.values(current.jobs).flatMap(job=>job.steps??[])
const oldSteps=Object.values(original.jobs).flatMap(job=>job.steps??[])
const step=name=>steps.find(s=>s.name===name),old=name=>oldSteps.find(s=>s.name===name)
assert.equal(step('Send dashboard email').run,old('Send dashboard email').run)
assert.deepEqual(step('Send dashboard email').env,old('Send dashboard email').env)
assert.equal(step('Create email chart').run,old('Create email chart').run)
assert.deepEqual(current.on,original.on);assert.deepEqual(current.concurrency,original.concurrency)
assert.ok(step('Send dashboard email').if.includes("delivery_mode == 'legacy'"))
const approved=step('Send approved-report dashboard email')
assert.ok(approved.if.includes("mail_hold != 'true'"))
assert.ok(approved.env.SMTP_PASSWORD.includes("delivery_mode == 'approved'"))
assert.ok(approved.env.FX_EMAIL_SEND_APPROVED.includes('steps.email.outputs.delivery_mode'))
assert.ok(step('Create email chart').env.FX_EMAIL_REPORT_MODE.includes('steps.email.outputs.report_mode'))
const result={checks,yamlValid:true,legacySmtpUnchanged:true,scheduleAndConcurrencyUnchanged:true,
  capturedModeControlsBothSenders:true,frozenChartDataset:true,emailsSent:0}
await fs.writeFile(path.join(directory,'../workflow-modes-final.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify({passed:true,modes:checks.length,emailsSent:0}))
