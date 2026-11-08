// Explicit private files only. No credentials, network, state reset or publisher.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {buildSharedDashboardPriceSnapshot,REPORT_CURRENCIES} from './shared-price-contract.js'
import {evaluatePublicationCadence} from './publication-cadence.js'

export async function preparePublicationCadenceLocal({input,workspace=process.cwd()}){
 const root=await fs.realpath(workspace),privateRoot=path.join(root,'.local-reports','private'),reads=[]
 if(await fs.realpath(privateRoot)!==privateRoot)throw Error('private_cadence_root_required')
 const read=async file=>{
  const target=await fs.realpath(path.resolve(root,file??'')),relative=path.relative(privateRoot,target),stat=await fs.stat(target)
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!target.endsWith('.json')||!stat.isFile()||stat.size>16_000_000)
   throw Error('private_cadence_json_required')
  const raw=await fs.readFile(target,'utf8');reads.push({target,raw});return JSON.parse(raw)
 }
 const config=await read(input)
 if(config.version!=='publication-cadence-local/1'||!['local','saved_replay'].includes(config.mode)
  ||Object.keys(config).some(k=>!['version','mode','asOf','datasetFile','publicationsFile','cases'].includes(k))
  ||!Array.isArray(config.cases)||!config.cases.length||config.cases.length>6
  ||new Set(config.cases.map(c=>c.currency)).size!==config.cases.length
  ||config.cases.some(c=>!REPORT_CURRENCIES.includes(c.currency)||Object.keys(c).some(k=>
   !['currency','calendar','previousChecks','openCase','eventCandidateIds','correctionReportIds','proposalThresholdPct'].includes(k))))
  throw Error('explicit_cadence_manifest_required')
 const dataset=await read(config.datasetFile),publications=await read(config.publicationsFile),results=[]
 for(const c of config.cases){
  try{
   const snapshot=buildSharedDashboardPriceSnapshot({dataset,currency:c.currency,asOf:config.asOf})
   results.push(evaluatePublicationCadence({...c,snapshot,asOf:config.asOf,publications,mode:config.mode}))
  }catch(error){results.push({currency:c.currency,status:'invalid_input',reason:/^[a-z_]+$/.test(error.message??'')?error.message:'cadence_validation_failed',
    paidCallAuthorized:false,publicationApproved:false})}
 }
 for(const r of reads)if(await fs.readFile(r.target,'utf8')!==r.raw)throw Error('cadence_source_changed')
 const directory=await fs.mkdtemp(path.join(privateRoot,'publication-cadence-'))
 const result={version:config.version,mode:config.mode,asOf:config.asOf,results,networkCalls:0,modelCalls:0,
  newPaidCostUsd:0,publicationApproved:false,historyWritten:false}
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2),{flag:'wx'})
 return {directory:path.relative(root,directory),...result}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const {values}=parseArgs({options:{input:{type:'string'}},strict:true})
 preparePublicationCadenceLocal({input:values.input}).then(r=>console.log(JSON.stringify(r,null,2))).catch(()=>{
  console.error('publication_cadence_failed: verify explicit private input and reference calendar');process.exitCode=1
 })
}
