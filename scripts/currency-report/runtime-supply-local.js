// Reproducible local supply batch. Collection never implies paid authorization.
// Reads private immutable inventory; stores no originals in a browser artifact.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {createRuntimeStore,runtimePublications} from './runtime-store.js'
import {supplyRuntimeInput,acquireRuntimeResearch,previousWeekdayTarget} from './runtime-supply.js'
import {reviewRuntimeSources} from './runtime-source-review.js'
import {REPORT_CURRENCIES} from './shared-price-contract.js'
import {fingerprint} from './research-harness.js'

export async function runtimeSupplyLocal({input,workspace=process.cwd(),fetchImpl=fetch}={}) {
 const root=await fs.realpath(workspace),privateRoot=path.join(root,'.local-reports/private')
 const read=async file=>{
  const actual=await fs.realpath(path.resolve(root,file)),relative=path.relative(privateRoot,actual),s=await fs.stat(actual)
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!s.isFile()||s.size>16000000||!actual.endsWith('.json'))throw Error('private_supply_json_required')
  return JSON.parse(await fs.readFile(actual,'utf8'))
 }
 const config=await read(input)
 if(config.version!=='runtime-supply-local/1'||!['saved','live'].includes(config.mode)||!config.datasetFile
  ||!Array.isArray(config.countries)||!config.countries.length||config.countries.length>6
  ||new Set(config.countries.map(c=>c.currency)).size!==config.countries.length
  ||config.countries.some(c=>!REPORT_CURRENCIES.includes(c.currency)))throw Error('local_supply_manifest_required')
 const credentials=await read('.local-reports/private/local-db/connection.json')
 const store=createRuntimeStore({url:credentials.url,key:credentials.serviceKey,mode:'local'})
 const dataset=await read(config.datasetFile),asOf=config.asOf??new Date().toISOString()
 const catalogs=await Promise.all(['six-currency-explanation-sources-20261027.json','six-currency-source-register-20261027.json',
  'original-news-source-policy-20261028.json'].map(file=>fs.readFile(path.join(root,'docs/2.0',file),'utf8').then(JSON.parse)))
 const [sourcePlan,sourceRegister,registry]=catalogs
 const processingRules=JSON.parse(await fs.readFile(path.join(root,'docs/2.0/material-processing-rules.json'),'utf8'))
 const parent=path.join(privateRoot,'runtime-supply-runs');await fs.mkdir(parent,{recursive:true})
 const directory=await fs.mkdtemp(path.join(parent,'run-')),rows=[]
 const save=(name,value)=>fs.writeFile(path.join(directory,name),JSON.stringify(value,null,2),{flag:'wx'})
 for(const country of config.countries){
  const currency=country.currency
  try{
   const seed=country.writerManifest?await read(country.writerManifest):null
   const handoff=seed?.handoffFile?await read(seed.handoffFile):undefined
   const claimTypingReview=seed?.claimTypingReviewFile?await read(seed.claimTypingReviewFile):undefined
   const publications=runtimePublications(await store.history(currency),currency)
   let seq=0
   const acquire=async args=>{
    const acquired=await acquireRuntimeResearch({...args,mode:config.mode,sourcePlan,sourceRegister,
     captures:country.capturesFile?await read(country.capturesFile):[],fetchImpl,
     checkpoint:async(kind,value)=>save(`${currency}-capture-${seq++}-${kind}.json`,value)})
    await save(`${currency}-collection.json`,acquired)
    return acquired
   }
   const review=async({collection,asOf})=>{
    const result=await reviewRuntimeSources({collection,asOf,registry,processingRules,saved:country.savedReviewsFile?await read(country.savedReviewsFile):[]})
    await save(`${currency}-source-review.json`,result);return result
   }
   const result=await supplyRuntimeInput({dataset,currency,asOf,
    calendar:country.calendar,commentaryTarget:country.commentaryTarget??previousWeekdayTarget(dataset.baseDate),
    publications,handoff,claimTypingReview,sourcePlan,sourceRegister,acquire,review,store,processingRules,
    writer:seed?.writer??'sol',periodicInput:country.periodicInputFile?await read(country.periodicInputFile):undefined})
   await save(`${currency}-supply.json`,result)
   rows.push({currency,status:result.status,baseDate:result.baseDate,targetDate:result.commentaryTarget.date,
    holds:result.holds,staged:result.staged,networkCalls:result.networkCalls,modelCalls:result.modelCalls,
    costUsd:result.newPaidCostUsd,writerMaximumUsd:result.writerMaximumUsd??null,pendingArticles:result.pendingArticles??0,
    sources:result.sources??[]})
  }catch(error){
   rows.push({currency,status:'supply_failed',reason:/^[a-z0-9_]+$/.test(error.message??'')?error.message:'local_supply_failed',
    modelCalls:0,costUsd:0,staged:false})
  }
  // A completed country is durable before the next one starts.
  await fs.writeFile(path.join(directory,'progress.json'),JSON.stringify({asOf,rows},null,2))
 }
 const result={version:'runtime-supply-local-result/1',asOf,baseDate:dataset.baseDate,datasetBinding:fingerprint(dataset),
  mode:config.mode,rows,productionWrites:0,paidCalls:0,publicationApproved:false,directory:path.relative(root,directory)}
 await save('result.json',result)
 return result
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const {values}=parseArgs({options:{input:{type:'string'}},strict:true})
 runtimeSupplyLocal(values).then(r=>console.log(JSON.stringify(r,null,2))).catch(()=>{
  console.error('local_supply_hold: inspect private paths, isolated DB and source state; no model request');process.exitCode=1})
}
