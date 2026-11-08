// Reads only explicit private JSON files; no credentials, fetch or execution.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {fingerprint} from './research-harness.js'
import {prepareSixCurrencyInputs,SIX_CURRENCY_PREPARATION_VERSION,SIX_CURRENCY_CURRENT_VERSION} from './six-currency-preparation.js'
import {beginManagedOutput,completeManagedOutput,verifyManagedFile} from './managed-output.js'

export async function prepareSixCurrencyInputsLocal({input,workspace=process.cwd(),historicalReplay=false}={}) {
 const root=await fs.realpath(workspace),expected=path.join(root,'.local-reports/private'),privateRoot=await fs.realpath(expected)
 if(privateRoot!==expected)throw new Error('private_root_required')
 const reads=[]
 const read=async name=>{
  const file=await fs.realpath(path.resolve(root,name)),relative=path.relative(privateRoot,file),stat=await fs.stat(file)
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!file.endsWith('.json')||!stat.isFile()||stat.size>8_000_000)
   throw new Error('private_saved_json_required')
  await verifyManagedFile(file,{workspace:root})
  const raw=await fs.readFile(file,'utf8');reads.push({file,raw});return JSON.parse(raw)
 }
 const config=await read(input)
 const isHistorical=config.version===SIX_CURRENCY_PREPARATION_VERSION
 if((isHistorical?!historicalReplay:config.version!==SIX_CURRENCY_CURRENT_VERSION||historicalReplay)
  ||Object.keys(config).some(k=>!['version','asOf','cases','datasetFile'].includes(k))
  ||!Array.isArray(config.cases)||config.cases.length!==6||config.cases.some(c=>!c
   ||isHistorical&&c.materialReviewFile!==undefined
   ||c.materialReviewFile!==undefined&&!c.commentaryDate
   ||c.newsResponsesFile!==undefined&&!c.collectionFile
   ||Object.keys(c).some(k=>!['currency','kind','inputFile','collectionFile','receiptsFile','newsResponsesFile','commentaryDate','materialReviewFile'].includes(k))))
  throw new Error('six_currency_manifest_required')
 const cases=[]
 for(const c of config.cases) {
  // Missing/invalid input in one country does not discard the other five.
  let value
  try {
   value={currency:c.currency,kind:c.kind,input:await read(c.inputFile),...(c.commentaryDate?{commentaryDate:c.commentaryDate}:{})}
  }catch{cases.push({currency:c.currency,kind:c.kind,input:null});continue}
  try{if(c.materialReviewFile)value.materialReview=await read(c.materialReviewFile)}
  catch{value.materialReviewReadFailed=true}
  try {
   if(c.collectionFile)value.collection=await read(c.collectionFile)
   if(c.receiptsFile)value.receipts=await read(c.receiptsFile)
   if(c.newsResponsesFile)value.newsResponses=await read(c.newsResponsesFile)
  }catch{delete value.collection;delete value.receipts;delete value.newsResponses;value.collectionReadFailed=true}
  cases.push(value)
 }
 const dataset=isHistorical?undefined:await read(config.datasetFile)
 const {handoffs,...summary}=prepareSixCurrencyInputs({asOf:config.asOf,cases,dataset,mode:isHistorical?'historical_replay':'shared_dashboard'})
 for(const source of reads)if(source.raw!==await fs.readFile(source.file,'utf8'))throw new Error('saved_source_changed')
 const directory=await fs.mkdtemp(path.join(privateRoot,'six-currency-preparation-'))
 await beginManagedOutput(directory)
 for(const {currency,handoff} of handoffs)await fs.writeFile(path.join(directory,`${currency}-handoff.json`),JSON.stringify(handoff,null,2),{flag:'wx'})
 const result={...summary,directory:path.relative(root,directory),
  sourceBindings:reads.map(r=>({file:path.relative(root,r.file),binding:fingerprint(r.raw)}))}
 await fs.writeFile(path.join(directory,'summary.json'),JSON.stringify(result,null,2),{flag:'wx'})
 const storageReceipt=await completeManagedOutput({directory,workspace:root,kind:'six_currency_preparation'})
 return {...result,storageReceipt}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 const {values}=parseArgs({options:{input:{type:'string'},'historical-replay':{type:'boolean'}},strict:true})
 prepareSixCurrencyInputsLocal({input:values.input,historicalReplay:values['historical-replay']}).then(r=>console.log(JSON.stringify(r,null,2))).catch(()=>{
  console.error('six_currency_preparation_failed: inspect the private manifest and source bindings');process.exitCode=1})
}
