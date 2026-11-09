import {expect,it} from 'vitest'
import fs from 'node:fs'
import yaml from 'js-yaml'
import {runInNewContext} from 'node:vm'
import {dailyRunScope} from './daily-run-scope.js'
type Step={name?:string;run?:string;if?:string;uses?:string;with?:Record<string,string>;env?:Record<string,string>}
type Job={needs?:string;outputs?:Record<string,string>;if?:string;steps:Step[];permissions?:Record<string,string>;env?:Record<string,string>;'continue-on-error'?:boolean|string;'timeout-minutes'?:number|string;strategy?:{'max-parallel':number;'fail-fast':boolean;matrix:{currency:string[]}}}
const workflow=yaml.load(fs.readFileSync('.github/workflows/generate-data.yml','utf8')) as {jobs:Record<string,Job>;on:{workflow_dispatch:{inputs:{run_scope:{default:string;options:string[]}}};schedule:unknown[]}}
const context=(scope='daily',mode='plan')=>({
 vars:{FX_REPORT_GENERATOR:'currency',FX_REPORT_ENABLED:'true',FX_REPORT_OPERATIONAL_HOLD:'false',FX_REPORT_PUBLISH_MODE:'review',FX_REPORT_EXECUTION_MODE:mode},
 needs:{'generate-data-and-send-email':{result:'success',outputs:{run_scope:scope,dataset_ref:'committed-sha'}}},
 steps:{run_scope:{outputs:{scope}},mailing:{outputs:{emails:'synthetic@example.invalid'}},email:{outputs:{delivery_mode:'legacy',report_mode:'legacy',mail_hold:'false'}}},always:()=>true,cancelled:()=>false})
const evaluate=(expression:string|boolean|number|undefined,ctx:ReturnType<typeof context>)=>typeof expression==='string'
 ?runInNewContext(expression.trim().replace(/^\$\{\{\s*|\s*\}\}$/g,'').replaceAll('needs.generate-data-and-send-email',"needs['generate-data-and-send-email']"),ctx):expression
it('keeps administrator notices opt-in and after drafting, without email in data-check mode',()=>{
 const job=workflow.jobs['admin-review-notices']
 expect(job.needs).toEqual(['generate-data-and-send-email','currency-review-report'])
 expect(job.permissions).toEqual({contents:'read'});expect(job['timeout-minutes']).toBe(5)
 const run=(scope:string,enabled='true',approved='true',ref='refs/heads/main')=>{
  const ctx={...context(scope),github:{ref}};Object.assign(ctx.vars,{FX_ADMIN_REVIEW_EMAIL_ENABLED:enabled,FX_ADMIN_REVIEW_EMAIL_SEND_APPROVED:approved})
  return evaluate(job.if,ctx)
 }
 expect(run('daily')).toBe(true);expect(run('data-check')).toBe(false);expect(run('daily','false')).toBe(false);expect(run('daily','true','false')).toBe(false);expect(run('daily','true','true','refs/heads/topic')).toBe(false)
 const send=job.steps.find(s=>s.run?.includes('send-admin-review-email'))!
 expect(send.env?.FX_ADMIN_REVIEW_EMAIL_TO).toBe('${{ secrets.FX_ADMIN_REVIEW_EMAIL_TO }}')
 expect(job.steps.some(s=>s.env?.OPENROUTER_API_KEY||s.run?.includes('mailing_list')||s.run?.includes('git push'))).toBe(false)
})
it('isolates review generation on a bounded read-only runner without putting it upstream of FX or email',()=>{
 const main=workflow.jobs['generate-data-and-send-email'],review=workflow.jobs['optional-review-report']
 expect(main.needs).toBeUndefined()
 expect(review.needs).toBe('generate-data-and-send-email')
 expect(review['continue-on-error']).toBe(true)
 expect(review['timeout-minutes']).toBeLessThanOrEqual(5)
 expect(review.permissions).toEqual({contents:'read'})
 expect(review.steps.filter(s=>s.run?.includes('git push')||s.env?.SMTP_PASSWORD)).toEqual([])
 expect(review.steps.find(s=>s.uses?.startsWith('actions/checkout'))?.with?.ref).toContain('outputs.dataset_ref')
 expect(review.steps.find(s=>s.run==='npm run generate:report')?.env).toMatchObject({FX_EMAIL_DATA_SOURCE:'json',FX_REPORT_PUBLISH_MODE:'review'})
})
it('keeps automatic-mode report enrichment before email and gates review mode on an exact committed dataset',()=>{
 const main=workflow.jobs['generate-data-and-send-email'],review=workflow.jobs['optional-review-report']
 const generate=main.steps.findIndex(s=>s.name==='Generate optional FX 2.0 report'),store=main.steps.findIndex(s=>s.name==='Store optional FX 2.0 report'),email=main.steps.findIndex(s=>s.name==='Compose email metadata')
 expect(generate).toBeLessThan(email);expect(store).toBeLessThan(email)
 expect(main.steps[generate].if).toContain("vars.FX_REPORT_PUBLISH_MODE == 'automatic'")
 expect(main.steps[generate].if).toContain("vars.FX_REPORT_GENERATOR != 'currency'")
 expect(main.steps[store].if).toBe(main.steps[generate].if)
 expect(review.if).toContain("vars.FX_REPORT_PUBLISH_MODE != 'automatic'")
 expect(review.if).toContain("outputs.dataset_ref != ''")
 expect(review.if).toContain("vars.FX_REPORT_OPERATIONAL_HOLD != 'true'")
 expect(review.if).toContain('!cancelled()')
})
it('makes the six-currency worker an exclusive, opt-in, serial consumer of the committed dataset without publishing artifacts or mail',()=>{
 const old=workflow.jobs['optional-review-report'],current=workflow.jobs['currency-review-report']
 expect(old.if).toContain("vars.FX_REPORT_GENERATOR != 'currency'")
 expect(current.if).toContain("vars.FX_REPORT_GENERATOR == 'currency'")
 expect(current.if).toContain("vars.FX_REPORT_ENABLED == 'true'")
 expect(current.if).toContain("vars.FX_REPORT_OPERATIONAL_HOLD != 'true'")
 const failedDefault=context();failedDefault.needs['generate-data-and-send-email'].result='failure';failedDefault.needs['generate-data-and-send-email'].outputs.dataset_ref=''
 expect(evaluate(current.if,failedDefault)).toBe(true)
 expect(current.env?.FX_REPORT_DATA_REFRESH).toContain("outputs.dataset_ref != ''")
 expect(current.needs).toBe('generate-data-and-send-email')
 expect(current.permissions).toEqual({contents:'read'});expect(evaluate(current['continue-on-error'],context())).toBe(false)
 expect(current.strategy).toBeUndefined()
 expect(evaluate(current['timeout-minutes'],context())).toBe(150)
 expect(current.steps.find(s=>s.uses?.startsWith('actions/checkout'))?.with?.ref).toContain('outputs.dataset_ref')
 expect(current.steps.find(s=>s.uses?.startsWith('actions/checkout'))?.with?.ref).toContain('|| github.sha')
 const worker=current.steps.find(s=>s.run==='npm run report:operate -- --action plan')!
 const execute=current.steps.find(s=>s.run==='npm run report:operate -- --action execute')!
 expect(evaluate(worker.if,context('daily','plan'))).toBe(true)
 expect(evaluate(worker.if,context('daily','execute'))).toBe(false)
 expect(evaluate(execute.if,context('daily','execute'))).toBe(true)
 expect(current.env).toMatchObject({FX_EMAIL_DATA_SOURCE:'json',FX_REPORT_GENERATOR:'currency',FX_REPORT_PUBLISH_MODE:'review'})
 expect(current.env?.OPENROUTER_API_KEY).toBeUndefined()
 expect(worker.env?.OPENROUTER_API_KEY).toBeUndefined()
 expect(execute.env?.OPENROUTER_API_KEY).toBe('${{ secrets.OPENROUTER_API_KEY }}')
 expect(current.steps.filter(s=>s.run?.includes('report:operate'))).toHaveLength(3)
 expect(current.steps.filter(s=>s.run?.includes('persist:report')||s.run?.includes('git push')||s.env?.SMTP_PASSWORD||s.uses?.startsWith('actions/upload-artifact'))).toEqual([])
})

it('keeps schedule and legacy manual defaults and restricts the explicit data check to main',()=>{
 const input=workflow.on.workflow_dispatch.inputs.run_scope
 expect(input.default).toBe('daily');expect(input.options).toEqual(['daily','data-check'])
 expect(dailyRunScope({eventName:'schedule',ref:'refs/heads/main'})).toEqual({scope:'daily',mailAllowed:true,modelExecutionAllowed:true})
 expect(dailyRunScope({eventName:'workflow_dispatch',ref:'refs/heads/main'}).scope).toBe('daily')
 expect(dailyRunScope({eventName:'workflow_dispatch',ref:'refs/heads/main',inputScope:'data-check'})).toEqual({scope:'data-check',mailAllowed:false,modelExecutionAllowed:false})
 expect(()=>dailyRunScope({eventName:'workflow_dispatch',ref:'refs/heads/topic',inputScope:'data-check'})).toThrow('requires_main')
 expect(()=>dailyRunScope({eventName:'workflow_dispatch',ref:'refs/heads/main',inputScope:'unexpected'})).toThrow('invalid_daily_run_scope')
 expect(workflow.on.schedule).toHaveLength(1)
})

it('cannot mail or generate through either model path in data-check mode even when server settings enable execution',()=>{
 const main=workflow.jobs['generate-data-and-send-email'],current=workflow.jobs['currency-review-report'],legacy=workflow.jobs['optional-review-report']
 const ctx=context('data-check','execute');ctx.vars.FX_REPORT_GENERATOR='legacy';ctx.vars.FX_REPORT_PUBLISH_MODE='automatic'
 for(const delivery of ['legacy','approved']){
  ctx.steps.email.outputs={delivery_mode:delivery,report_mode:delivery,mail_hold:'false'}
  for(const step of main.steps.filter(s=>s.env?.SMTP_PASSWORD||s.env?.OPENROUTER_API_KEY||s.name?.includes('mail')||s.name==='Create market context'))
   expect(evaluate(step.if,ctx),step.name).toBe(false)
 }
 expect(evaluate(legacy.if,ctx)).toBe(false);expect(evaluate(current.if,ctx)).toBe(true)
 const paid=current.steps.find(s=>s.run?.endsWith('--action execute'))!,free=current.steps.find(s=>s.run?.endsWith('--action plan --require-ready'))!
 expect(evaluate(paid.if,ctx)).toBe(false);expect(evaluate(free.if,ctx)).toBe(true)
 expect(free.env?.OPENROUTER_API_KEY).toBeUndefined();expect(current.env?.OPENROUTER_API_KEY).toBeUndefined()
 expect(evaluate(current['continue-on-error'],ctx)).toBe(false);expect(evaluate(current['timeout-minutes'],ctx)).toBe(20)
})

it('requires a successful committed FX refresh for manual readiness while preserving normal automatic-mode enrichment',()=>{
 const current=workflow.jobs['currency-review-report'],ctx=context('data-check')
 ctx.needs['generate-data-and-send-email'].result='failure';expect(evaluate(current.if,ctx)).toBe(false)
 ctx.needs['generate-data-and-send-email'].result='success';ctx.needs['generate-data-and-send-email'].outputs.dataset_ref=''
 expect(evaluate(current.if,ctx)).toBe(false)
 const normal=context();normal.vars.FX_REPORT_GENERATOR='legacy';normal.vars.FX_REPORT_PUBLISH_MODE='automatic'
 const main=workflow.jobs['generate-data-and-send-email']
 expect(evaluate(main.steps.find(s=>s.name==='Generate optional FX 2.0 report')!.if,normal)).toBe(true)
 expect(evaluate(main.steps.find(s=>s.name==='Send dashboard email')!.if,normal)).toBe(true)
 expect(main.steps.findIndex(s=>s.name==='Validate requested run scope')).toBeLessThan(main.steps.findIndex(s=>s.name==='Validate required exchange API secrets'))
})
