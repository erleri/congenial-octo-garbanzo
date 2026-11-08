// Prepare only. There is deliberately no environment, API key or paid executor.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {prepareSharedWriter} from './shared-writer.js'
import {inspectWriterEndpoint} from './writer-policy.js'
import {writeDataBundle,ledgerRoot} from './data-ledger.js'
import {verifyManagedFile} from './managed-output.js'
export async function prepareSharedWriterLocal({input,workspace=process.cwd()}={}) {
 const root=await fs.realpath(workspace),privateRoot=path.join(root,'.local-reports/private')
 if(await fs.realpath(privateRoot)!==privateRoot)throw new Error('private_root_required')
 const reads=[]
 const read=async file=>{
  const resolved=await fs.realpath(path.resolve(root,file)),relative=path.relative(privateRoot,resolved),stat=await fs.stat(resolved)
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!resolved.endsWith('.json')||!stat.isFile()||stat.size>16_000_000)
   throw new Error('private_shared_writer_json_required')
  await verifyManagedFile(resolved,{workspace:root})
  const raw=await fs.readFile(resolved,'utf8');reads.push({file:resolved,raw});return JSON.parse(raw)
 }
 const config=await read(input)
 if(config.version!=='shared-writer-manifest/1'||Object.keys(config).some(k=>!['version','handoffFile','writer','modelCatalogFile','zdrCatalogFile','claimTypingReviewFile'].includes(k))
  ||typeof config.handoffFile!=='string'||Boolean(config.modelCatalogFile)!==Boolean(config.zdrCatalogFile))throw new Error('shared_writer_manifest_required')
 const handoff=await read(config.handoffFile),claimTypingReview=config.claimTypingReviewFile?await read(config.claimTypingReviewFile):undefined
 const plan=prepareSharedWriter({handoff,writer:config.writer,claimTypingReview})
 let endpoint={status:'unverified',reason:'saved_catalog_not_provided',executionAuthorized:false}
 if(config.modelCatalogFile&&plan.body){
  const catalog=await read(config.modelCatalogFile),zdr=await read(config.zdrCatalogFile)
  try{endpoint={status:'saved_metadata_pass',...inspectWriterEndpoint(plan.body,plan.writerProfile,catalog,zdr),
   freshLivePreflightRequired:true,executionAuthorized:false}}
  catch{endpoint={status:'hold',reason:'writer_endpoint_privacy_support_or_price_hold',executionAuthorized:false}}
 }
 for(const r of reads)if(r.raw!==await fs.readFile(r.file,'utf8'))throw new Error('shared_writer_source_changed')
 const dir=await fs.mkdtemp(path.join(privateRoot,'shared-writer-'))
 await fs.writeFile(path.join(dir,'plan.json'),JSON.stringify(plan,null,2),{flag:'wx'})
 const storageReceipt=await writeDataBundle({root:path.join(root,path.relative(process.cwd(),ledgerRoot)),id:path.basename(dir),kind:'writer_input',currency:plan.currency??handoff.materialConnection.currency,
  resources:[...reads.map((r,i)=>({id:`input_${i}`,kind:'source_snapshot',value:JSON.parse(r.raw)})),{id:'plan',kind:'writer_plan',value:plan}],
  edges:reads.map((_,i)=>({from:`input_${i}`,to:'plan',role:'input_to_plan'})),protection:['pending_review_dependency'],costState:'not_called'})
 const summary={version:'shared-writer-preparation/1',directory:path.relative(root,dir),status:plan.status,currency:plan.currency??handoff.materialConnection.currency,
  writer:plan.writerProfile?.selection??null,requestHash:plan.requestHash??null,inputTokenBound:plan.inputBound??null,
  maximumUsd:plan.maximumUsd??null,endpoint,storageReceipt,paidCallAuthorized:false,publicationApproved:false,modelCalls:0,networkCalls:0,newPaidCostUsd:0}
 await fs.writeFile(path.join(dir,'summary.json'),JSON.stringify(summary,null,2),{flag:'wx'})
 return summary
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const {values}=parseArgs({options:{input:{type:'string'}},strict:true})
 prepareSharedWriterLocal(values).then(r=>console.log(JSON.stringify(r,null,2))).catch(()=>{
  console.error('shared_writer_preparation_failed: check private paths, bindings and material holds');process.exitCode=1})
}
