// Synthetic end-to-end protocol fixture. No original support/permissions,
// actual provider use, real economic quality or actual spending is established.
import fs from 'node:fs'
import {fingerprint} from './research-harness.js'
import {runtimeFixture,memoryRuntimeStore,syntheticRuntimeTransport,runtimeTestEnv} from './runtime-fixture.js'
import {originalPipelineFixture} from './original-news-pipeline-fixture.js'
import {bindSelectedOriginalReview} from './selected-source-collection.js'
import {operatingPolicyDraft} from './operating-policy.js'
import {NEWS_REVIEW_POLICY} from './news-model-review.js'
import {prepareRuntimeReview} from './runtime.js'

export async function operatingFixture({nonce=null,newsDate='2026-10-27'}={}){
 const read=f=>JSON.parse(fs.readFileSync('docs/2.0/'+f,'utf8'))
 const source=await originalPipelineFixture(),examples=['BRL','MXN','COP','PEN','CLP','ARS'].map(c=>runtimeFixture(c))
 const config={sourcePlan:source.sourcePlan,sourceRegister:source.sourceRegister,
  registry:read('original-news-source-policy-20261028.json'),processingRules:read('material-processing-rules.json')}
 const policy=operatingPolicyDraft(config)
 Object.assign(policy,{state:'operator_configured',externalTransmissionAuthorization:'approved_by_operator',
  recurringBudgetAuthorization:'approved_by_operator',authorizationReference:'synthetic-only-no-real-authorization',configuredAt:'2026-10-28T12:00:00Z'})
 policy.limits.monthlyUsd=7;delete policy.binding;policy.binding=fingerprint(policy)
 const state={batch:null,batches:new Map(),cases:new Map(),inputs:new Map(),inputHistory:[],sourceCache:[],corrections:new Map(),policy,posts:[]}
 const base=memoryRuntimeStore();base.config.monthly_limit_nano=7e9
 const store={...base,environment:'local',history:async()=>[],
  recordCorrections:async r=>{let inserted=0;for(const c of r.candidates)if(!state.corrections.has(c.key)){state.corrections.set(c.key,structuredClone(c));inserted++}return {inserted,duplicates:r.candidates.length-inserted}},
  operatingPolicy:async()=>({revision:1,policy:state.policy}),operatingBatch:async key=>structuredClone(state.batches.get(key)??null),
  pendingBatches:async()=>[...state.batches.values()].filter(b=>['paused','cost_unresolved','running'].includes(b.state)).map(b=>structuredClone(b)),
  supersedeBatch:async r=>{
   const b=state.batches.get(r.key);b.state='completed';b.result={status:r.reason,previousResult:b.result}
   for(const c of state.cases.values())if(c.batchKey===r.key&&['paused','running'].includes(c.state)){
    c.state='held';c.result={status:r.reason,previousResult:c.result}
   }
   return {superseded:true}
  },
  claimBatch:async r=>{
   if(state.batch?.state==='running')return {claimed:false,reason:'operating_batch_busy'}
   state.batch=state.batches.get(r.key)??{batch_key:r.key,policy_revision:r.revision,payload:{...r.payload,serializedOperatingPayload:JSON.stringify(r.payload)}}
   Object.assign(state.batch,{state:'running',owner:r.owner});state.batches.set(r.key,state.batch)
   return {claimed:true}
  },batchCheckpoint:async r=>{Object.assign(state.batch,{state:r.state,result:r.result})},
  claimCase:async r=>{
   if([...state.cases.values()].some(c=>c.currency===r.currency&&c.caseId===r.caseId&&c.state==='pending_admin_review'))
    return {claimed:false,reason:'pending_admin_review'}
   const prior=state.cases.get(r.key)
   if(prior&&prior.batchKey===r.batchKey&&['running','paused'].includes(prior.state)){
    prior.state='running';return {claimed:true,resumed:true}
   }
   if(prior)return {claimed:false,reason:'unchanged_case_already_processed'}
   state.cases.set(r.key,{...r,state:'running'});return {claimed:true}
  },finishCase:async r=>{Object.assign(state.cases.get(r.key),{state:r.state,result:r.result})},
  stage:async task=>{
   if(state.inputHistory.some(t=>t.binding===task.binding))throw Error('synthetic_db_unique_payload_hash')
   state.inputHistory.push(structuredClone(task));state.inputs.set(task.currency,structuredClone(task));return 'synthetic-input'
  },
  input:async(currency,snapshotId)=>structuredClone([...state.inputHistory].reverse().find(t=>t.currency===currency&&(!snapshotId||t.snapshot.snapshotId===snapshotId))??null),
  sourceCache:async(currency,rulesBinding)=>state.sourceCache.filter(c=>c.currency===currency&&c.rulesBinding===rulesBinding),
  saveSourceReview:async r=>{if(!state.sourceCache.some(c=>c.key===r.key))state.sourceCache.push(structuredClone(r))},
  job:base.job}
 const sites={BRL:['brl-agenciabrasil','https://agenciabrasil.ebc.com.br/economia/noticia/2026-10/synthetic'],
  MXN:['mxn-eleconomista','https://www.eleconomista.com.mx/mercados/synthetic'],COP:['cop-larepublica',source.url],
  PEN:['pen-rpp','https://rpp.pe/economia/economia/synthetic-noticia-123'],
  CLP:['clp-existing-four-outlets','https://www.emol.com/noticias/Economia/2026/10/27/1000000/synthetic.html'],
  ARS:['ars-infobae','https://www.infobae.com/economia/2026/10/27/synthetic/']}
 const collections=Object.fromEntries(examples.map(f=>{
  const materialAsOf=newsDate>'2026-10-28'?'2026-11-01T04:00:00Z':f.asOf
  const [sourceId,baseUrl]=sites[f.currency],record=structuredClone(source.collection.originals[0])
  const locator=new URL(baseUrl);if(nonce)locator.pathname=locator.pathname.replace(/(\.html)?\/?$/,(_,extension)=>`-${nonce}${extension??''}`)
  const url=locator.href
  delete record.id;delete record.sourceId
  record.url=url;record.metadata.publishedAt=newsDate+'T20:00:00Z'
  record.blocks[0].text=`El dólar subió en el mercado local durante la sesión del ${newsDate}.`
  if(newsDate!=='2026-10-27')record.collectedAt=newsDate+'T21:00:00Z'
  const bound=bindSelectedOriginalReview({record,request:{sourceId,period:newsDate},adapter:'reviewed_news_notes',requestIds:['synthetic'],
   currency:f.currency,asOf:materialAsOf,targets:[{needId:'market',requestedPeriod:newsDate}]})
  return [f.currency,{...structuredClone(source.collection),currency:f.currency,baseDate:materialAsOf.slice(0,10),asOf:materialAsOf,originals:[bound.original],reviewQueue:[bound.review]}]
 }))
 let active=null
 const transports=new Map()
 const transportFor=task=>{
  if(!transports.has(task.binding)){
   const transport=syntheticRuntimeTransport(task)
   transports.set(task.binding,{transport,reviewHash:fingerprint(prepareRuntimeReview(task,transport.compiled).body)})
  }
  return transports.get(task.binding)
 }
 const send=async args=>{
  const input=JSON.parse(args.body.messages[1].content),name=args.body.response_format.json_schema.name
  state.posts.push(name)
  if(name.startsWith('original_news_')){
   active=input.currency
   const output=structuredClone(name==='original_news_extract'?source.candidate:source.comparison)
   output.eventDate=newsDate
   if(name==='original_news_extract'){
    output.claims[0].text='합성 원문은 해당 국가 현지 시장에서 달러 가격이 상승했다고 보도한다.'
    output.eventDateEvidence={basis:'explicit',quote:input.blocks[0].text,blockPositions:[0],relation:'none'}
   }
   return {valid:true,actualModel:args.body.model,costUsd:.001,responseId:'gen-operating-synthetic-'+state.posts.length,
    payload:{choices:[{message:{content:JSON.stringify(output)}}]},generationCalls:1,retries:0}
  }
  if(input.currency)active=input.currency
  if(name==='currency_runtime_review'){
   const hash=fingerprint(args.body)
   const matching=[...state.inputs.values()].find(task=>transportFor(task).reviewHash===hash)
   if(!matching)throw Error('synthetic_review_input_missing')
   active=matching.currency
  }
  const task=state.inputs.get(active)
  if(!task)throw Error('synthetic_writer_input_missing')
  return transportFor(task).transport.send(args)
 }
 const p=NEWS_REVIEW_POLICY
 const metadata={catalog:{data:{endpoints:[{model_id:p.model,tag:p.route,status:0,context_length:100000,max_completion_tokens:8192,
  supported_parameters:['reasoning','response_format','structured_outputs',p.outputField],pricing:{prompt:p.prompt/1e6,completion:p.completion/1e6}}]}},zdr:{data:[{model_id:p.model,tag:p.route}]}}
 return {...config,dataset:{...examples[0].dataset,dailyRates:examples.flatMap(f=>f.dataset.dailyRates)},asOf:'2026-11-01T04:00:00Z',
  calendarByCurrency:Object.fromEntries(examples.map(f=>[f.currency,f.calendar])),store,state,env:runtimeTestEnv,
  acquire:async({snapshot})=>({collection:collections[snapshot.currency],completedAt:'2026-11-01T04:00:00Z',networkCalls:0}),
  preflightSource:async()=>metadata,preflightWriter:async(body,profile)=>({model:body.model,route:profile.route,zdr:true,dataCollection:'deny'}),
  send,testOnly:true,collections}
}
