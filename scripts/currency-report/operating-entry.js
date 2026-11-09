// Concrete local/workflow entry. Defaults to inspection; executing never enables
// controls, installs a policy, retries, falls back or publishes. The local sender
// code scope was explicitly authorized on 2026-11-01, not a paid run/activation.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {loadOperationalFxDataset} from '../load-fx-dataset.js'
import {createRuntimeStore} from './runtime-store.js'
import {operatingPolicyDraft,assertOperatingPolicy,oneTimeOperatingPolicy,recurringOperatingPolicy} from './operating-policy.js'
import {fingerprint} from './research-harness.js'
import {runOperatingCycle} from './operating-cycle.js'
import {REPORT_CURRENCIES} from './shared-price-contract.js'
import {dashboardReferenceState} from './dashboard-reference-state.js'
import {eventTrialEndpointPreflight} from './lifecycle-control.js'
import {callOpenRouterStream,reconcileGenerationCost} from './openrouter-stream.js'
import {NEWS_REVIEW_POLICY} from './news-model-review.js'
import {operatingResultState,referenceReadiness} from './operating-result.js'
import {createOfficialInputLoader} from './official-input-loader.js'
import {acquireRuntimeResearch} from './runtime-supply.js'
import {withOfficialInputCache} from './official-input-cache.js'
import {acquireOfficialBackground} from './runtime-official-supply.js'

export function automaticReferenceCalendars(dataset,asOf) {
 // Share the dashboard's stored selection, carry-forward provenance and age
 // reminder. This confirms the chosen reference date, never an exchange holiday.
 return Object.fromEntries(REPORT_CURRENCIES.map(currency=>{
  const state=dashboardReferenceState(dataset,currency,asOf)
  return [currency,state.status==='usable_reference'
   ?{status:'confirmed',expectedReferenceDate:dataset.baseDate,basis:'existing_dashboard_reference_selection',referenceState:state}
   :{status:'unverified',reason:state.status==='late'?'dashboard_reference_update_due':'dashboard_reference_invalid',referenceState:state}]
 }))
}
export async function operatingEntry({action='inspect',input,requireReady=false,env=process.env,workspace=process.cwd(),store,
 asOf=new Date().toISOString(),fetchImpl=fetch,transport,acquire}={}) {
 if(!['inspect','draft-policy','draft-trial','draft-recurring','configure-policy','plan','verify-storage','execute'].includes(action))throw Error('operating_action_required')
 if(requireReady&&action!=='plan')throw Error('reference_readiness_is_plan_only')
 const root=await fs.realpath(workspace),privateRoot=path.join(root,'.local-reports/private')
 const readPrivate=async file=>{
  const target=await fs.realpath(path.resolve(root,file)),relative=path.relative(privateRoot,target),stat=await fs.stat(target)
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!stat.isFile()||stat.size>32000000||!target.endsWith('.json'))throw Error('private_operating_json_required')
  return JSON.parse(await fs.readFile(target,'utf8'))
 }
 const [sourcePlan,sourceRegister,registry,processingRules]=await Promise.all([
  'six-currency-explanation-sources-20261027.json','six-currency-source-register-20261027.json',
  'original-news-source-policy-20261028.json','material-processing-rules.json'].map(f=>fs.readFile(path.join(root,'docs/2.0',f),'utf8').then(JSON.parse)))
 if(action==='draft-policy'){
  const directory=path.join(privateRoot,'operating-configuration');await fs.mkdir(directory,{recursive:true})
  const filename=path.join(directory,`policy-proposal-${Date.now()}.json`)
  await fs.writeFile(filename,JSON.stringify(operatingPolicyDraft({sourcePlan,sourceRegister,processingRules}),null,2),{flag:'wx'})
  return {status:'proposal_created_not_installed',file:path.relative(root,filename),modelCalls:0}
 }
 if(action==='draft-trial'){
  if(env.GITHUB_ACTIONS==='true'||!input)throw Error('explicit_local_trial_configuration_required')
  const scope=await readPrivate(input)
  if(scope.version!=='operating-trial-configuration/1')throw Error('explicit_local_trial_configuration_required')
  const dataset=await readPrivate(scope.datasetFile)
  const policy=oneTimeOperatingPolicy({config:{sourcePlan,sourceRegister,processingRules},datasetBinding:fingerprint(dataset),
   authorizationReference:scope.authorizationReference,configuredAt:asOf,expiresAt:scope.expiresAt,budgetUsd:scope.budgetUsd,maxCalls:scope.maxCalls})
  const directory=path.join(privateRoot,'operating-configuration');await fs.mkdir(directory,{recursive:true})
  const filename=path.join(directory,`trial-proposal-${Date.now()}.json`)
  await fs.writeFile(filename,JSON.stringify(policy,null,2),{flag:'wx'})
  return {status:'one_time_trial_proposal_not_installed',file:path.relative(root,filename),modelCalls:0,recurringSpendAuthorized:false}
 }
 if(action==='draft-recurring'){
  if(env.GITHUB_ACTIONS==='true'||!input)throw Error('explicit_local_recurring_configuration_required')
  const scope=await readPrivate(input)
  if(scope.version!=='operating-recurring-configuration/1')throw Error('explicit_local_recurring_configuration_required')
  const policy=recurringOperatingPolicy({...scope,config:{sourcePlan,sourceRegister,processingRules},configuredAt:asOf})
  const directory=path.join(privateRoot,'operating-configuration');await fs.mkdir(directory,{recursive:true})
  const filename=path.join(directory,`recurring-proposal-${Date.now()}.json`)
  await fs.writeFile(filename,JSON.stringify(policy,null,2),{flag:'wx'})
  return {status:'recurring_proposal_not_installed',file:path.relative(root,filename),writer:policy.writer,
   modelCalls:0,controlsChanged:false,productionChanges:0}
 }
 const workflow=env.GITHUB_ACTIONS==='true'
 if(!store){
  const credentials=workflow?{url:env.VITE_SUPABASE_URL,serviceKey:env.SUPABASE_SERVICE_ROLE_KEY}
   :await readPrivate('.local-reports/private/local-db/connection.json')
  store=createRuntimeStore({url:credentials.url,key:credentials.serviceKey,mode:workflow?'workflow':'local',env})
 }
 if(action==='inspect'){
  const [configured,control]=await Promise.all([store.operatingPolicy(),store.control()])
  return {status:configured?.policy?.state??'not_configured',revision:configured?.revision??0,
   enabled:control.enabled,reviewEnabled:control.review_enabled,monthlyLimitUsd:Number(control.monthly_limit_nano)/1e9,modelCalls:0}
 }
 if(action==='configure-policy'){
  if(workflow||!input)throw Error('explicit_local_policy_file_required')
  const policy=assertOperatingPolicy(await readPrivate(input)),current=await store.operatingPolicy()
  const revision=await store.configureOperatingPolicy(policy,current?.revision??0)
  const control=await store.control()
  return {status:'policy_saved_controls_unchanged',revision,enabled:control.enabled,modelCalls:0}
 }
 const manifest=input?await readPrivate(input):null
 if(manifest&&manifest.version!=='operating-local-manifest/1')throw Error('operating_manifest_required')
 if(workflow&&manifest)throw Error('workflow_server_configuration_only')
 const dataset=manifest?await readPrivate(manifest.datasetFile):await loadOperationalFxDataset()
 const capturesByCurrency={}
 if(manifest)for(const [currency,file] of Object.entries(manifest.capturesByCurrency??{})){
  if(!REPORT_CURRENCIES.includes(currency))throw Error('registered_capture_currency_required')
  capturesByCurrency[currency]=await readPrivate(file)
 }
 const operatingAsOf=manifest?.asOf??asOf
 const officialInputsByCurrency={}
 for(const [currency,file] of Object.entries(manifest?.officialInputsByCurrency??{})){
  if(!REPORT_CURRENCIES.includes(currency))throw Error('registered_official_currency_required')
  officialInputsByCurrency[currency]=await readPrivate(file)
 }
 const officialInputLoader=withOfficialInputCache({
  loader:createOfficialInputLoader({workspace:root,env,savedByCurrency:officialInputsByCurrency,fetchImpl}),store,
  review:async({currency,inputs,asOf})=>(await acquireOfficialBackground({...inputs,snapshot:{currency},asOf,sourcePlan,sourceRegister,mode:'saved',
   fetchImpl:()=>{throw Error('official_cache_review_network_forbidden')}})).admission})
 let adapters={}
 if(action==='execute'){
  // No key is loaded for plan/inspect. Disabled or unconfigured execution stops
  // inside the coordinator before preflight/POST; a missing key fails there.
  const send=transport??(args=>{
   if(!env.OPENROUTER_API_KEY)throw Error('operating_model_key_missing')
   return callOpenRouterStream({...args,apiKey:env.OPENROUTER_API_KEY,fetchImpl,timeoutMs:120000,maxBytes:250000})
  })
  const get=async url=>{
   const r=await fetchImpl(url,{signal:AbortSignal.timeout(15000)})
   if(!r.ok)throw Error('operating_endpoint_metadata_unavailable')
   return r.json()
  }
  adapters={send,dispatchHolds:!transport&&!env.OPENROUTER_API_KEY?['operating_model_key_missing']:[],preflightWriter:(body,profile)=>eventTrialEndpointPreflight(body,fetchImpl,profile),
   preflightSource:async()=>{
    const [catalog,zdr]=await Promise.all([
     get(`https://openrouter.ai/api/v1/models/${NEWS_REVIEW_POLICY.model}/endpoints`),get('https://openrouter.ai/api/v1/endpoints/zdr')])
    return {catalog,zdr}
   },reconcile:args=>reconcileGenerationCost({...args,apiKey:env.OPENROUTER_API_KEY,fetchImpl})}
 }
 const calendars=manifest?.calendarByCurrency??automaticReferenceCalendars(dataset,operatingAsOf)
 if(workflow&&env.FX_REPORT_DATA_REFRESH==='not_confirmed')for(const calendar of Object.values(calendars)){
  calendar.status='unverified';calendar.reason='upstream_fx_refresh_not_confirmed'
 }
 const result=await runOperatingCycle({dataset,asOf:operatingAsOf,store,sourcePlan,sourceRegister,registry,processingRules,env,
  calendarByCurrency:calendars,
  mode:workflow?'live':manifest?.mode??'saved',capturesByCurrency,execute:action==='execute',verifyStorage:action==='verify-storage',
  acquire:acquire??(args=>acquireRuntimeResearch({...args,fetchImpl,officialInputLoader})),...adapters})
 return requireReady?{...result,referenceReadiness:referenceReadiness(result)}:result
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const {values}=parseArgs({options:{action:{type:'string',default:'inspect'},input:{type:'string'},'require-ready':{type:'boolean',default:false}},strict:true})
 operatingEntry({action:values.action,input:values.input,requireReady:values['require-ready']}).then(async result=>{
  const outcome=operatingResultState(result)
  console.log(JSON.stringify({...result,operatingOutcome:outcome}))
  if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
   `\n### Currency report execution\n\n${outcome.kind==='action_required'||outcome.kind==='failure'?'기술 장애':outcome.kind==='review_wait'?'관리자 검토 대기':outcome.kind==='waiting'?'자료 보류':result.status==='no_report_due'?'대상 없음':'준비 완료'} (${result.status}). Model calls: ${Number.isInteger(result.modelCalls)?result.modelCalls:'unconfirmed'}. Publication: administrator review required.\n`
   +(result.storage?`\nStorage: ${result.storage.rawBytes} raw bytes → ${result.storage.compressedBytes} gzip bytes. Manifest: ${result.storage.manifestBytes} bytes. New: ${result.storage.newBytes}; reusable: ${result.storage.reusedBytes}.\n`:'')
   +(result.incident?.recordFailure?'\nIncident record failed. Check report job logs; do not treat the workflow as healthy.\n':''))
  process.exitCode=outcome.exitCode
 })
  .catch(async()=>{console.error('operating_hold: inspect private records and admin status; no retry/fallback');
   if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,'\n### Currency report: 기술 장애\n\nThe report worker could not finish or confirm its incident record. FX/mail are separate jobs; report success is not confirmed.\n').catch(()=>{})
   process.exitCode=1})
}
