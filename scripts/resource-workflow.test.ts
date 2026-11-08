import {expect,it} from 'vitest'
import fs from 'node:fs'
import yaml from 'js-yaml'
type Step={name?:string;run?:string;if?:string;uses?:string;with?:Record<string,string>;env?:Record<string,string>}
type Job={needs?:string;outputs?:Record<string,string>;if?:string;steps:Step[];permissions?:Record<string,string>;env?:Record<string,string>;'continue-on-error'?:boolean;'timeout-minutes'?:number;strategy?:{'max-parallel':number;'fail-fast':boolean;matrix:{currency:string[]}}}
const workflow=yaml.load(fs.readFileSync('.github/workflows/generate-data.yml','utf8')) as {jobs:Record<string,Job>}
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
 expect(current.if).not.toContain("outputs.dataset_ref != ''")
 expect(current.env?.FX_REPORT_DATA_REFRESH).toContain("outputs.dataset_ref != ''")
 expect(current.needs).toBe('generate-data-and-send-email')
 expect(current.permissions).toEqual({contents:'read'});expect(current['continue-on-error']).toBe(true)
 expect(current.strategy).toBeUndefined()
 expect(current['timeout-minutes']).toBe(150)
 expect(current.steps.find(s=>s.uses?.startsWith('actions/checkout'))?.with?.ref).toContain('outputs.dataset_ref')
 expect(current.steps.find(s=>s.uses?.startsWith('actions/checkout'))?.with?.ref).toContain('|| github.sha')
 const worker=current.steps.find(s=>s.run==='npm run report:operate -- --action plan')!
 const execute=current.steps.find(s=>s.run==='npm run report:operate -- --action execute')!
 expect(worker.if).toBe("vars.FX_REPORT_EXECUTION_MODE != 'execute'")
 expect(execute.if).toBe("vars.FX_REPORT_EXECUTION_MODE == 'execute'")
 expect(current.env).toMatchObject({FX_EMAIL_DATA_SOURCE:'json',FX_REPORT_GENERATOR:'currency',FX_REPORT_PUBLISH_MODE:'review'})
 expect(current.env?.OPENROUTER_API_KEY).toBeUndefined()
 expect(worker.env?.OPENROUTER_API_KEY).toBeUndefined()
 expect(execute.env?.OPENROUTER_API_KEY).toBe('${{ secrets.OPENROUTER_API_KEY }}')
 expect(current.steps.filter(s=>s.run?.includes('report:operate'))).toHaveLength(2)
 expect(current.steps.filter(s=>s.run?.includes('persist:report')||s.run?.includes('git push')||s.env?.SMTP_PASSWORD||s.uses?.startsWith('actions/upload-artifact'))).toEqual([])
})
