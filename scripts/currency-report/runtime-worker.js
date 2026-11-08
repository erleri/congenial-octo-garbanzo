// Explicit new-generator entry. Default legacy workflow does not call it.
// It reads the same committed full dataset as FX/email, never article prices.
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import path from 'node:path'
import {loadOperationalFxDataset} from '../load-fx-dataset.js'
import {runtimeMode,runCurrencyRuntime} from './runtime.js'
import {createRuntimeStore,runtimePublications,assertStagedRuntimeInput} from './runtime-store.js'
import {REPORT_CURRENCIES,buildSharedDashboardPriceSnapshot} from './shared-price-contract.js'
import {eventTrialEndpointPreflight} from './lifecycle-control.js'
import {callOpenRouterStream,reconcileGenerationCost} from './openrouter-stream.js'
import {fingerprint} from './research-harness.js'
import {koreaDate} from './publication-cadence.js'

export async function runRuntimeWorker({env=process.env,currency,store,loadDataset=loadOperationalFxDataset,
 asOf=new Date().toISOString(),preflight,send,reconcile,supplyInput,testOnly=false}={}) {
 const mode=runtimeMode(env)
 if(mode!=='currency')return {status:mode,modelCalls:0,publicationApproved:false}
 if(!REPORT_CURRENCIES.includes(currency))throw Error('one_registered_runtime_currency_required')
 if(!store)store=createRuntimeStore({url:env.VITE_SUPABASE_URL,key:env.SUPABASE_SERVICE_ROLE_KEY,mode:'workflow',env})
 const record=async(result,baseDate=null)=>{
  const view={status:result.status,baseDate,dataStatus:result.status==='reviewed_input_wait'?'input_missing':baseDate?'reference_bound':'unverified',
   qualityStatus:result.status==='pending_admin_review'?'agent_review_passed':result.status==='content_review_hold'?'held':'unverified'}
  if(store.check)await store.check({key:fingerprint({currency,date:asOf.slice(0,10),...view}),currency,checkedAt:asOf,result:view})
  return result
 }
 const control=await store.control()
 if(!control?.enabled)return record({status:'runtime_disabled',currency,modelCalls:0,publicationApproved:false})
 const dataset=await loadDataset()
 const snapshot=buildSharedDashboardPriceSnapshot({dataset,currency,asOf})
 let task=await store.input(currency,snapshot.snapshotId)
 // The producer owns collection/source review and durable registration. Reload
 // the stored value; never trust an in-memory task returned by a callback.
 if((!task||task.checkedOnKst!==koreaDate(asOf))&&supplyInput){
  await supplyInput({dataset,currency,asOf,store})
  task=await store.input(currency,snapshot.snapshotId)
 }
 if(!task)return record({status:'reviewed_input_wait',currency,snapshotId:snapshot.snapshotId,modelCalls:0,publicationApproved:false},dataset.baseDate)
 try {
  assertStagedRuntimeInput(task)
  const publications=runtimePublications(await store.history(currency),currency)
  if(!send&&!env.OPENROUTER_API_KEY)throw Error('runtime_key_missing')
  const apiKey=env.OPENROUTER_API_KEY
  const result=await runCurrencyRuntime({task,dataset,asOf,publications,env,store,testOnly,
   preflight:preflight??((body,profile)=>eventTrialEndpointPreflight(body,fetch,profile)),
   send:send??(args=>callOpenRouterStream({...args,apiKey,timeoutMs:120000,maxBytes:250000})),
   reconcile:reconcile??(args=>reconcileGenerationCost({...args,apiKey}))})
  return record(result,dataset.baseDate)
 } catch {
  // A persistence failure may follow a POST: never assert zero cost/calls here.
  return record({status:'execution_hold',currency,modelCalls:null,publicationApproved:false},dataset.baseDate)
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 const {values}=parseArgs({options:{currency:{type:'string'}},strict:true})
 runRuntimeWorker({currency:values.currency}).then(result=>console.log(JSON.stringify(result)))
  .catch(()=>{console.error('currency_runtime_held: inspect private runtime records and policy; no retry or fallback');process.exitCode=1})
}
