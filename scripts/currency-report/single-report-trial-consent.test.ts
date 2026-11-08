import {it,expect,vi} from 'vitest'
import {fingerprint} from './research-harness.js'
import {singleReportTrialAuthorized,SINGLE_REPORT_TRIAL_VERSION} from './single-report-trial-consent.js'
import {executeEventTrial} from './lifecycle-control.js'
import {writerProfile} from './writer-policy.js'

it('binds a one-country retest to its one new request and budget without fabricating initial country passes',async()=>{
 // Synthetic consent and transport doubles only. No real approval or model call.
 const body={model:'anthropic/claude-sonnet-5.5',max_tokens:8192,messages:[],reasoning:{effort:'medium'},
  provider:{only:['google-vertex/global'],require_parameters:true,zdr:true,data_collection:'deny',allow_fallbacks:false}}
 const plan={purpose:'fx_explanation',status:'prepared_not_called',currency:'MXN',baseDate:'2026-10-28',body,
  requestHash:fingerprint(body),maximumUsd:.14,timeoutMs:120000,retries:0,
  singleReportTrial:{version:SINGLE_REPORT_TRIAL_VERSION,requestHash:fingerprint(body),maximumNewCalls:1,proposalFile:'synthetic.json',proposalSha256:'a'.repeat(64)}}
 const approval={authorized:true,planHash:fingerprint(plan),budgetUsd:.20,singleReportTrialAuthorized:true,maximumNewCalls:1}
 const invoke=vi.fn(async()=>({valid:true,actualModel:body.model,costUsd:.03})),claim=vi.fn(),
  preflight=vi.fn(async()=>({model:body.model,route:'google-vertex/global',zdr:true,dataCollection:'deny'}))
 const attempt=(consent=approval,journal:unknown[]=[])=>executeEventTrial({plan,approval:consent,journal,invoke,claim,preflight})
 expect(singleReportTrialAuthorized(plan,{...approval,authorized:false},[])).toBe(false)
 await expect(attempt({...approval,singleReportTrialAuthorized:false})).rejects.toThrow('single_report_trial_consent')
 await expect(attempt({...approval,maximumNewCalls:2})).rejects.toThrow('single_report_trial_consent')
 await expect(attempt({...approval,budgetUsd:.30})).rejects.toThrow('single_report_trial_consent')
 await expect(attempt(approval,[{currency:'MXN',baseDate:plan.baseDate,requestHash:plan.requestHash,costUsd:.03,status:'output_hold'}])).rejects.toThrow('single_report_trial_consent')
 expect(invoke).not.toHaveBeenCalled()
 expect(await attempt()).toMatchObject({status:'schema_and_content_review_required',costUsd:.03})
 expect(invoke).toHaveBeenCalledTimes(1);expect(claim).toHaveBeenCalledTimes(1)
})
it('keeps the old default while registering the explicitly selected US route and its separate price ceiling',()=>{
 expect(writerProfile()).toMatchObject({selection:'sol',route:'azure',prompt:2,completion:10})
 expect(writerProfile('sol-us')).toMatchObject({model:writerProfile().model,route:'azure/us',prompt:2.2,completion:11,inputReservation:2.75,retries:0})
})
