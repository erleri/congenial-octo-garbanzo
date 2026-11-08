// Explicit local saved JSON input only. No credential, collection or dispatch.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {fingerprint} from './research-harness.js'
import {preparePublisherClosePair} from './publisher-close-pair.js'
import {verifiedFxMovement} from './fx-cause-input.js'

export async function preparePublisherClosePairLocal({input,workspace=process.cwd()}={}) {
 const root=await fs.realpath(workspace),expected=path.join(root,'.local-reports/private'),privateRoot=await fs.realpath(expected)
 const file=await fs.realpath(path.resolve(root,input)),relative=path.relative(privateRoot,file),stat=await fs.stat(file)
 if(privateRoot!==expected||!relative||relative.startsWith('..')||path.isAbsolute(relative)||!file.endsWith('.json')
  ||!stat.isFile()||stat.size>8_000_000)throw new Error('private_price_pair_input_required')
 const raw=await fs.readFile(file,'utf8'),config=JSON.parse(raw)
 if(Object.keys(config).some(k=>!['currency','captures','reviews','asOf'].includes(k)))throw new Error('price_pair_config_fields_required')
 const prepared=preparePublisherClosePair(config),movement=verifiedFxMovement(prepared.packet)
 if(raw!==await fs.readFile(file,'utf8'))throw new Error('saved_price_pair_input_changed')
 const directory=await fs.mkdtemp(path.join(privateRoot,`${config.currency}-reported-close-`))
 await fs.writeFile(path.join(directory,'prepared.json'),JSON.stringify({...prepared,movement,inputBinding:fingerprint(raw)},null,2),{flag:'wx'})
 return {directory:path.relative(root,directory),currency:config.currency,priceStatus:'two_reported_session_closes_verified',movement,
  writingEligibility:'separate_source_use_and_fx_cause_review_required',publicationApproved:false,paidCallAuthorized:false,
  networkCalls:0,modelCalls:0,newPaidCostUsd:0}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 const {values}=parseArgs({options:{input:{type:'string'}},strict:true})
 preparePublisherClosePairLocal(values).then(r=>console.log(JSON.stringify(r,null,2))).catch(()=>{
  console.error('publisher_close_pair_preparation_failed: inspect private captures and bound reviews');process.exitCode=1})
}
