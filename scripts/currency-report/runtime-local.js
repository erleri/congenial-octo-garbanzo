// Local preparation, private staging and offline replay. Never invokes a model.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {prepareRuntimeTask,assertRuntimeTask,runCurrencyRuntime} from './runtime.js'
import {createRuntimeStore,runtimePublications,assertStagedRuntimeInput} from './runtime-store.js'
import {runtimeFixture,memoryRuntimeStore,syntheticRuntimeTransport,runtimeTestEnv} from './runtime-fixture.js'
import {REPORT_CURRENCIES} from './shared-price-contract.js'

export async function runtimeLocal({action='replay',input,asOf=new Date().toISOString(),workspace=process.cwd()}={}) {
 const root=await fs.realpath(workspace),privateRoot=path.join(root,'.local-reports/private')
 const read=async file=>{
  const target=await fs.realpath(path.resolve(root,file)),relative=path.relative(privateRoot,target),stat=await fs.stat(target)
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!target.endsWith('.json')||stat.size>1000000||!stat.isFile())throw Error('private_runtime_input_required')
  return JSON.parse(await fs.readFile(target,'utf8'))
 }
 const resultRoot=path.join(privateRoot,'runtime-20261031')
 await fs.mkdir(resultRoot,{recursive:true})
 const out=await fs.mkdtemp(path.join(resultRoot,'run-'))
 if(action==='replay') {
  const rows=[]
  for(const currency of REPORT_CURRENCIES) {
   const f=runtimeFixture(currency),store=memoryRuntimeStore()
   const result=await runCurrencyRuntime({...f,env:runtimeTestEnv,store,...syntheticRuntimeTransport(f.task)})
   rows.push({currency,status:result.status,simulatedModelInvocations:result.modelCalls,
    drafts:store.drafts.length,publicationApproved:result.publicationApproved,actualModelCalls:0,actualPaidUsd:0})
  }
  const result={version:'runtime-offline-replay/1',kind:'synthetic_contract_cases_not_real_report_quality',rows,actualModelCalls:0,actualPaidUsd:0,productionChanges:0}
  await fs.writeFile(path.join(out,'replay.json'),JSON.stringify(result,null,2),{flag:'wx'})
  return {...result,directory:path.relative(root,out)}
 }
 const credentials=await read('.local-reports/private/local-db/connection.json')
 const store=createRuntimeStore({url:credentials.url,key:credentials.serviceKey,mode:'local'})
 if(action==='inspect') {
  const c=await store.control()
  return {status:c.enabled?'enabled_local_only':'disabled',reviewEnabled:c.review_enabled,writer:c.writer,
   monthlyLimitUsd:c.monthly_limit_nano/1e9,modelCalls:0,paidUsd:0,productionChanges:0}
 }
 if(!['prepare','stage'].includes(action)||!input)throw Error('registered_runtime_local_action_required')
 const dataset=JSON.parse(await fs.readFile(path.join(root,'data/fx-full-history.json'),'utf8'))
 if(action==='prepare') {
  const manifest=await read(input)
  if(manifest.version!=='runtime-preparation-manifest/1'||!REPORT_CURRENCIES.includes(manifest.currency)
   ||Object.keys(manifest).some(k=>!['version','currency','handoffFile','calendarFile','periodicFile','claimTypingReviewFile','writer'].includes(k)))throw Error('runtime_preparation_manifest_required')
  const publications=runtimePublications(await store.history(manifest.currency),manifest.currency)
  const task=prepareRuntimeTask({dataset,currency:manifest.currency,asOf,publications,writer:manifest.writer,
   calendar:await read(manifest.calendarFile),handoff:manifest.handoffFile?await read(manifest.handoffFile):undefined,
   periodicInput:manifest.periodicFile?await read(manifest.periodicFile):undefined,
   claimTypingReview:manifest.claimTypingReviewFile?await read(manifest.claimTypingReviewFile):undefined})
  await fs.writeFile(path.join(out,'task.json'),JSON.stringify(task,null,2),{flag:'wx'})
  return {status:task.status,reason:task.reason??null,currency:manifest.currency,directory:path.relative(root,out),modelCalls:0,paidUsd:0,publicationApproved:false}
 }
 const task=assertStagedRuntimeInput(await read(input))
 assertRuntimeTask(task,{dataset,asOf,publications:runtimePublications(await store.history(task.currency),task.currency)})
 const id=await store.stage(task)
 return {status:'private_input_staged',inputId:id,currency:task.currency,modelCalls:0,paidUsd:0,publicationApproved:false}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 const {values}=parseArgs({options:{action:{type:'string',default:'replay'},input:{type:'string'},'as-of':{type:'string'}},strict:true})
 runtimeLocal({action:values.action,input:values.input,asOf:values['as-of']}).then(r=>console.log(JSON.stringify(r,null,2)))
  .catch(()=>{console.error('runtime_local_hold: verify isolated DB, private input, snapshot and preparation status');process.exitCode=1})
}
