// Local-only original extraction/comparison. Plan/replay never read keys.
// Live execution is one explicitly approved article with at most two calls.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {parse} from 'dotenv'
import {fingerprint} from './research-harness.js'
import {prepareOriginalNewsCase,runOriginalNewsCase,originalNewsModelAdapter,ORIGINAL_NEWS_PIPELINE_VERSION} from './original-news-pipeline.js'
import {NEWS_REVIEW_POLICY} from './news-model-review.js'
import {applyMaterialProcessing} from './material-processing.js'
import {beginManagedOutput,completeManagedOutput,verifyManagedFile} from './managed-output.js'

export async function originalNewsPipelineLocal({collection,sourceUse,policy,responses,approval,mode='plan',url,workspace=process.cwd(),fetchImpl=fetch}){
 if(!['plan','replay','execute'].includes(mode))throw new Error('invalid_original_pipeline_mode')
 const root=await fs.realpath(workspace),privateRoot=path.join(root,'.local-reports','private')
 if(await fs.realpath(privateRoot)!==privateRoot)throw new Error('unsafe_original_private_root')
 const read=async file=>{
   const resolved=await fs.realpath(path.resolve(root,file)),relative=path.relative(privateRoot,resolved),stat=await fs.stat(resolved)
   if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)||!stat.isFile()||stat.size>20_000_000)
     throw new Error('private_original_pipeline_input_required')
   await verifyManagedFile(resolved,{workspace:root})
   return JSON.parse(await fs.readFile(resolved,'utf8'))
 }
 const wrapped=await read(collection),data=wrapped.result??wrapped
 if(policy&&sourceUse)throw new Error('one_original_use_input_required')
 const evaluatedOn=new Date().toISOString().slice(0,10)
 const uses=sourceUse?await read(sourceUse):applyMaterialProcessing({collection:data,evaluatedOn,
   legacyRegistry:policy?await read(policy):JSON.parse(await fs.readFile(path.join(root,'docs/2.0/original-news-source-policy-20261028.json'),'utf8')),
   rules:JSON.parse(await fs.readFile(path.join(root,'docs/2.0/material-processing-rules.json'),'utf8'))})
 const cards=data.reviewQueue.filter(c=>c.materialKind==='article'&&(!url||c.url===url))
 if(!cards.length||cards.length>24||url&&cards.length!==1)throw new Error('explicit_collected_article_required')
 const plans=cards.map(card=>prepareOriginalNewsCase({collection:data,card,sourceUse:uses}))
 const parent=path.join(privateRoot,'original-pipeline-runs')
 await fs.mkdir(parent,{recursive:true})
 if(await fs.realpath(parent)!==parent)throw new Error('unsafe_original_output')
 const directory=await fs.mkdtemp(path.join(parent,'run-'))
 await beginManagedOutput(directory)
 const save=(name,value)=>fs.writeFile(path.join(directory,name),JSON.stringify(value,null,2),{flag:'wx'})
 await save('plans.json',plans)
 await save('source-use-applied.json',uses)
 let stored=[]
 if(mode==='replay'){
   if(!responses)throw new Error('saved_original_stage_responses_required')
   stored=await read(responses)
   if(!Array.isArray(stored)||stored.length>24||new Set(stored.map(r=>r.cardBinding)).size!==stored.length
     ||stored.some(r=>!cards.some(c=>c.binding===r.cardBinding)))throw new Error('invalid_original_saved_stage_responses')
 }
 let liveAdapter,lock
 const results=[]
 try{
   if(mode==='execute'){
     if(plans.length!==1||plans[0].holds.length)throw new Error('one_source_eligible_original_required')
     const plan=plans[0],consent=await read(approval)
     if(consent?.authorized!==true||consent.planBinding!==plan.binding||typeof consent.budgetUsd!=='number'
       ||!Number.isFinite(consent.budgetUsd)||consent.budgetUsd<plan.maximumUsd||consent.budgetUsd>.25)
       throw new Error('separate_original_pipeline_budget_required')
     const claimsRoot=path.join(privateRoot,'original-pipeline-claims')
     await fs.mkdir(claimsRoot,{recursive:true})
     if(await fs.realpath(claimsRoot)!==claimsRoot)throw new Error('unsafe_original_claims')
     lock=await fs.open(path.join(claimsRoot,'campaign.lock'),'wx')
     for(const name of await fs.readdir(claimsRoot)){
       if(!name.endsWith('-reservation.json'))continue
       const reserved=JSON.parse(await fs.readFile(path.join(claimsRoot,name),'utf8'))
       let settled
       try{settled=JSON.parse(await fs.readFile(path.join(claimsRoot,name.replace('-reservation','-result')),'utf8'))}catch{}
       if(!settled||typeof settled.costUsd!=='number'||settled.costUsd>reserved.maximumUsd)throw new Error('prior_original_cost_unresolved')
     }
     const original=data.originals.find(o=>o.id===plan.originalId)
     const contentKey=fingerprint({version:ORIGINAL_NEWS_PIPELINE_VERSION,url:original.url,rawSha256:original.sha256,model:NEWS_REVIEW_POLICY.model})
     try{await fs.access(path.join(claimsRoot,`${contentKey}-extract-reservation.json`));throw new Error('duplicate_original_generation')}catch(error){if(error.code!=='ENOENT')throw error}
     const apiKey=parse(await fs.readFile(path.join(root,'.env.report.local'),'utf8')).OPENROUTER_API_KEY?.trim()
     if(!apiKey)throw new Error('missing_original_review_key')
     const get=async target=>{const r=await fetchImpl(target,{redirect:'error',signal:AbortSignal.timeout(20000)})
       if(!r.ok)throw new Error('original_endpoint_unavailable');return r.json()}
     const [catalog,zdr]=await Promise.all([get(`https://openrouter.ai/api/v1/models/${NEWS_REVIEW_POLICY.model}/endpoints`),get('https://openrouter.ai/api/v1/endpoints/zdr')])
     let sequence=0
     liveAdapter=originalNewsModelAdapter({plan,approval:consent,apiKey,fetchImpl,preflight:async()=>({catalog,zdr}),
       reserve:async record=>{
         await fs.writeFile(path.join(claimsRoot,`${contentKey}-${record.stage}-reservation.json`),JSON.stringify(record,null,2),{flag:'wx'})
         await save(`${record.stage}-reservation.json`,record)
       },saveResult:async result=>{
         if(JSON.stringify(result).includes(apiKey))throw new Error('credential_in_original_result')
         await fs.writeFile(path.join(claimsRoot,`${contentKey}-${result.stage}-result.json`),JSON.stringify(result,null,2),{flag:'wx'})
         await save(`${result.stage}-accounting.json`,result)
       },checkpoint:async record=>{
         if(JSON.stringify(record).includes(apiKey))throw new Error('credential_in_original_checkpoint')
         await save(`checkpoint-${sequence++}.json`,record)
       }})
     await save('authorization.json',{...consent,version:ORIGINAL_NEWS_PIPELINE_VERSION})
   }
   for(const [index,card] of cards.entries()){
     const plan=plans[index],base={collection:data,card,sourceUse:uses,checkedOn:uses.evaluatedOn}
     let result
     if(mode==='plan')result={status:plan.status,holds:plan.holds,stageInvocations:0}
     else if(mode==='execute')result=await runOriginalNewsCase({...base,...liveAdapter})
     else{
       const row=stored.find(r=>r.cardBinding===card.binding)
       result=await runOriginalNewsCase({...base,...(row?{
         extract:async()=>row.extract,compare:async()=>row.compare}:{} )})
     }
     results.push({cardId:card.id,sourceId:card.sourceId,currency:data.currency,executionMode:mode,...result})
   }
   const result={version:ORIGINAL_NEWS_PIPELINE_VERSION,directory:path.relative(root,directory),results,
     accounting:liveAdapter?.getAccounting()??{calls:0,committedUsd:0,stopped:false,retries:0},
     executionMode:mode,semanticReviewOrigin:mode==='execute'?'model_original_comparison':mode==='replay'?'saved_stage_replay_not_new_AI_review':'not_performed',
     paidTrialPerformed:(liveAdapter?.getAccounting().calls??0)>0,manualUserTasks:[],writingEligibility:'not_assessed',publicationApproved:false}
   await save('result.json',result)
   const storageReceipt=await completeManagedOutput({directory,workspace:root,kind:'original_news_review',currency:data.currency,
    costState:result.accounting.calls>0?(result.accounting.stopped?'unknown':'confirmed'):'not_called'})
   return {...result,storageReceipt,results:results.map(r=>({cardId:r.cardId,sourceId:r.sourceId,currency:r.currency,status:r.status,holds:r.holds,stageInvocations:r.stageInvocations}))}
 }finally{if(lock){await lock.close();await fs.unlink(path.join(privateRoot,'original-pipeline-claims','campaign.lock'))}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const {values}=parseArgs({options:{collection:{type:'string'},sourceUse:{type:'string'},policy:{type:'string'},responses:{type:'string'},approval:{type:'string'},
   mode:{type:'string'},url:{type:'string'}},strict:true})
 originalNewsPipelineLocal(values).then(r=>console.log(JSON.stringify(r,null,2))).catch(error=>{
   console.error(/^[a-z_]+$/.test(error.message??'')?error.message:'local_original_pipeline_stopped');process.exitCode=1
 })
}
