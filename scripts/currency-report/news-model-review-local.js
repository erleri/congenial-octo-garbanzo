// The prepare mode reads no credentials and makes no network/model requests.
// Execute requires a separately approved, exact six-country campaign plan.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {parse} from 'dotenv'
import {fingerprint} from './research-harness.js'
import {prepareNewsNotesModelReview,inspectNewsModelEndpoint,executeNewsModelReview,callNewsModelReview,NEWS_REVIEW_POLICY} from './news-model-review.js'

export async function newsModelReviewLocal({mode='prepare',manifest,campaign,approval,workspace=process.cwd(),fetchImpl=fetch}){
 const root=await fs.realpath(workspace),privateRoot=path.join(root,'.local-reports','private')
 if(await fs.realpath(privateRoot)!==privateRoot)throw new Error('unsafe_news_review_root')
 const safePath=async file=>{
   const resolved=await fs.realpath(path.resolve(root,file)),relative=path.relative(privateRoot,resolved),stat=await fs.stat(resolved)
   if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)||!stat.isFile()||stat.size>20_000_000)
     throw new Error('private_news_review_file_required')
   return resolved
 }
 const read=async file=>JSON.parse(await fs.readFile(await safePath(file),'utf8'))
 const parent=path.join(privateRoot,'news-model-campaigns')
 await fs.mkdir(parent,{recursive:true})
 if(await fs.realpath(parent)!==parent)throw new Error('unsafe_news_review_output')
 const save=(dir,name,value)=>fs.writeFile(path.join(dir,name),JSON.stringify(value,null,2),{flag:'wx'})
 if(mode==='prepare'){
   const input=await read(manifest)
   if(!Array.isArray(input.inputs)||!input.inputs.length||input.inputs.length>6||new Set(input.inputs.map(i=>i.currency)).size!==input.inputs.length)
     throw new Error('invalid_news_review_manifest')
   const directory=await fs.mkdtemp(path.join(parent,'campaign-')),asOf=new Date().toISOString(),entries=[]
   for(const row of input.inputs){
     const data=await read(row.inputFile)
     if(row.currency!==data.packet?.currency)throw new Error('news_review_country_mismatch')
     const plan=prepareNewsNotesModelReview({...data,asOf})
     await save(directory,`${row.currency}-plan.json`,plan)
     entries.push({currency:row.currency,inputFile:path.relative(root,await safePath(row.inputFile)),inputHash:fingerprint(data),
       planFile:path.relative(root,path.join(directory,`${row.currency}-plan.json`)),planHash:fingerprint(plan),
       status:plan.status,maximumUsd:plan.maximumUsd,holds:plan.holds})
   }
   const plans={version:'news-model-campaign/1',asOf,entries,maximumCalls:entries.filter(e=>e.status==='prepared_not_called').length,
     maximumUsd:Number(entries.filter(e=>e.status==='prepared_not_called').reduce((n,e)=>n+e.maximumUsd,0).toFixed(9)),
     sourceMode:'reviewer_authored_notes',originalEntailmentVerified:false,retries:0,publicationApproved:false}
   await save(directory,'campaign.json',plans)
   return {directory:path.relative(root,directory),campaignHash:fingerprint(plans),...plans,modelCalls:0,newPaidCostUsd:0}
 }
 if(mode!=='execute')throw new Error('invalid_news_review_mode')
 const campaignFile=await safePath(campaign),directory=path.dirname(campaignFile),data=await read(campaign),consent=await read(approval)
 if(data.version!=='news-model-campaign/1'||!Array.isArray(data.entries)||data.entries.length>6
   ||consent?.authorized!==true||consent.campaignHash!==fingerprint(data)||consent.maximumCalls!==data.maximumCalls
   ||typeof consent.budgetUsd!=='number'||!Number.isFinite(consent.budgetUsd)||consent.budgetUsd<data.maximumUsd
   ||consent.budgetUsd>1||data.maximumCalls<1||data.maximumCalls>NEWS_REVIEW_POLICY.maxCalls)
   throw new Error('separate_exact_news_campaign_approval_required')
 const plans=[]
 for(const row of data.entries){
   const original=await read(row.inputFile),plan=await read(row.planFile)
   if(fingerprint(original)!==row.inputHash||fingerprint(plan)!==row.planHash
     ||fingerprint(prepareNewsNotesModelReview({...original,asOf:data.asOf}))!==row.planHash)throw new Error('news_review_source_or_policy_changed')
   if(plan.status==='prepared_not_called')plans.push(plan)
 }
 if(plans.length!==data.maximumCalls||Math.abs(plans.reduce((n,p)=>n+p.maximumUsd,0)-data.maximumUsd)>1e-9)
   throw new Error('news_review_campaign_limits_changed')
 const lock=await fs.open(path.join(parent,'campaign.lock'),'wx')
 const claimsRoot=path.join(parent,'claims')
 let calls=0
 try{
   await fs.mkdir(claimsRoot,{recursive:true})
   if(await fs.realpath(claimsRoot)!==claimsRoot)throw new Error('unsafe_news_review_claims')
   const previous=[]
   for(const name of await fs.readdir(claimsRoot)){
     if(!/^[a-f0-9]{64}$/.test(name))throw new Error('unknown_news_review_claim')
     const claimDir=path.join(claimsRoot,name)
     if(await fs.realpath(claimDir)!==claimDir)throw new Error('unsafe_news_review_claim')
     const reserved=JSON.parse(await fs.readFile(path.join(claimDir,'reservation.json'),'utf8'))
     let result
     try{result=JSON.parse(await fs.readFile(path.join(claimDir,'result.json'),'utf8'))}catch{}
     previous.push({...reserved,costUsd:result?.costUsd??null})
   }
   if(previous.some(r=>r.costUsd===null||r.costUsd>r.maximumUsd)||plans.some(p=>previous.some(r=>r.dedupKey===p.dedupKey)))
     throw new Error('news_review_prior_unknown_cost_or_duplicate')
   // Public, unauthenticated endpoint checks precede every paid reservation.
   const get=async url=>{const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(20000)})
     if(!response.ok)throw new Error('news_review_endpoint_unavailable');return response.json()}
   const [catalog,zdr]=await Promise.all([get(`https://openrouter.ai/api/v1/models/${NEWS_REVIEW_POLICY.model}/endpoints`),get('https://openrouter.ai/api/v1/endpoints/zdr')])
   plans.forEach(p=>inspectNewsModelEndpoint(p,catalog,zdr))
   const apiKey=parse(await fs.readFile(path.join(root,'.env.report.local'),'utf8')).OPENROUTER_API_KEY?.trim()
   if(!apiKey)throw new Error('missing_local_review_key')
   const output=await fs.mkdtemp(path.join(directory,'execution-')),journal=[],results=[]
   await save(output,'authorization.json',{...consent,approvedAt:new Date().toISOString(),campaignHash:fingerprint(data)})
   for(const plan of plans){
     const claimDir=path.join(claimsRoot,plan.dedupKey)
     let sequence=0,claimed=false
     const result=await executeNewsModelReview({plan,approval:{authorized:true,planHash:fingerprint(plan),budgetUsd:consent.budgetUsd},journal,
       preflight:async p=>inspectNewsModelEndpoint(p,catalog,zdr),claim:async record=>{
         await fs.mkdir(claimDir)
         await save(claimDir,'reservation.json',{...record,campaignHash:fingerprint(data),claimedAt:new Date().toISOString()})
         claimed=true
       },invoke:async p=>{
         calls++
         return callNewsModelReview({plan:p,apiKey,fetchImpl,checkpoint:async value=>{
           if(JSON.stringify(value).includes(apiKey))throw new Error('credential_in_review_checkpoint')
           await save(output,`${p.currency}-checkpoint-${sequence++}.json`,value)
         }})
       }})
     if(claimed)await save(claimDir,'result.json',result)
     await save(output,`${plan.currency}-result.json`,result)
     results.push(result);journal.push({...result,dedupKey:plan.dedupKey,maximumUsd:plan.maximumUsd})
     if(['cost_unresolved','cost_exceeded'].includes(result.status))break
   }
   const summary={directory:path.relative(root,output),results,modelCalls:calls,
     confirmedCostUsd:results.reduce((n,r)=>n+(r.costUsd??0),0),unknownReservedUsd:results.reduce((n,r)=>n+r.reservedUsd,0),
     originalEntailmentVerified:false,sourceMode:'reviewer_authored_notes',publicationApproved:false}
   await save(output,'summary.json',summary)
   return {...summary,results:results.map(r=>({currency:r.currency,status:r.status,costUsd:r.costUsd,
     reviewStatus:r.review?.status,items:r.review?.items.map(i=>({resourceId:i.resourceId,role:i.role,status:i.status}))}))}
 }finally{await lock.close();await fs.unlink(path.join(parent,'campaign.lock'))}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const {values}=parseArgs({options:{mode:{type:'string'},manifest:{type:'string'},campaign:{type:'string'},approval:{type:'string'}},strict:true})
 newsModelReviewLocal(values).then(r=>console.log(JSON.stringify(r,null,2))).catch(error=>{
   console.error(/^[a-z_]+$/.test(error.message??'')?error.message:'local_news_review_stopped');process.exitCode=1
 })
}
