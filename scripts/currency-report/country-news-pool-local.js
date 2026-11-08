// One local entry point joins all explicit collected batches to the existing
// shared handoff. It neither reads API keys nor performs network/model calls.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {prepareCountryNewsPool,COUNTRY_NEWS_POOL_VERSION} from './country-news-pool.js'
import {beginManagedOutput,completeManagedOutput,verifyManagedFile} from './managed-output.js'

export async function prepareCountryNewsPoolLocal({input,workspace=process.cwd()}={}) {
 const root=await fs.realpath(workspace),privateRoot=path.join(root,'.local-reports/private')
 if(await fs.realpath(privateRoot)!==privateRoot)throw new Error('private_root_required')
 const reads=[]
 const read=async location=>{
  const file=await fs.realpath(path.resolve(root,location)),relative=path.relative(privateRoot,file),stat=await fs.stat(file)
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!file.endsWith('.json')||!stat.isFile()||stat.size>16_000_000)
   throw new Error('private_news_pool_json_required')
  await verifyManagedFile(file,{workspace:root})
  const raw=await fs.readFile(file,'utf8');reads.push({file,raw});return JSON.parse(raw)
 }
 const config=await read(input)
 if(config.version!==COUNTRY_NEWS_POOL_VERSION
  ||Object.keys(config).some(k=>!['version','asOf','baseHandoffFile','batches'].includes(k))
  ||!Array.isArray(config.batches)||config.batches.length>16
  ||config.batches.some(b=>!b||Object.keys(b).some(k=>!['collectionFile','receiptsFile','newsResponsesFile','materialInputsFile'].includes(k))))
  throw new Error('country_news_pool_manifest_required')
 const handoff=await read(config.baseHandoffFile),batches=[]
 // Bad individual paths become batch failures. The other registered sources
 // remain usable; no caller is told to collect or approve articles manually.
 for(const b of config.batches){
  try{batches.push({collection:await read(b.collectionFile),
   receipts:b.receiptsFile?await read(b.receiptsFile):[],newsResponses:b.newsResponsesFile?await read(b.newsResponsesFile):[],
   materialInputs:b.materialInputsFile?await read(b.materialInputsFile):[]})}
  catch{batches.push({collection:null,readFailed:true})}
 }
 const sourcePlan=JSON.parse(await fs.readFile(path.join(root,'docs/2.0/six-currency-explanation-sources-20261027.json'),'utf8'))
 const sourceRegister=JSON.parse(await fs.readFile(path.join(root,'docs/2.0/six-currency-source-register-20261027.json'),'utf8'))
 const result=prepareCountryNewsPool({handoff,batches,sourcePlan,sourceRegister,asOf:config.asOf})
 for(const source of reads)if(source.raw!==await fs.readFile(source.file,'utf8'))throw new Error('news_pool_source_changed')
 const directory=await fs.mkdtemp(path.join(privateRoot,'country-news-pool-'))
 await beginManagedOutput(directory)
 await fs.writeFile(path.join(directory,`${handoff.materialConnection.currency}-handoff.json`),JSON.stringify(result.handoff,null,2),{flag:'wx'})
 await fs.writeFile(path.join(directory,'summary.json'),JSON.stringify(result.summary,null,2),{flag:'wx'})
 const storageReceipt=await completeManagedOutput({directory,workspace:root,kind:'country_news_pool',currency:handoff.materialConnection.currency})
 return {directory:path.relative(root,directory),...result.summary,storageReceipt}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const {values}=parseArgs({options:{input:{type:'string'}},strict:true})
 prepareCountryNewsPoolLocal(values).then(r=>console.log(JSON.stringify(r,null,2))).catch(()=>{
  console.error('country_news_pool_failed: check the private manifest and exact handoff bindings');process.exitCode=1})
}
