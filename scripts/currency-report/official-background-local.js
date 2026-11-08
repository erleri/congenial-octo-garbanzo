// Offline replay of acquired official inputs through the same runtime adapter.
// No database, token read, network, model, publication or manuscript edits.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {fingerprint} from './research-harness.js'
import {REPORT_CURRENCIES} from './shared-price-contract.js'
import {acquireOfficialBackground} from './runtime-official-supply.js'

export async function replayOfficialBackground({input,workspace=process.cwd()}={}) {
 const root=await fs.realpath(workspace),privateRoot=path.join(root,'.local-reports/private'),readFiles=[]
 const read=async file=>{
  const resolved=await fs.realpath(path.resolve(root,file)),rel=path.relative(privateRoot,resolved),stat=await fs.stat(resolved)
  if(!rel||rel.startsWith('..')||path.isAbsolute(rel)||!stat.isFile()||stat.size>16_000_000||!resolved.endsWith('.json'))throw Error('private_official_replay_input_required')
  const raw=await fs.readFile(resolved,'utf8');readFiles.push({resolved,hash:fingerprint(raw)});return JSON.parse(raw)
 }
 const manifest=await read(input)
 if(manifest.version!=='official-background-replay/1'||!Array.isArray(manifest.countries)||manifest.countries.length>6||!manifest.countries.length
  ||new Set(manifest.countries.map(c=>c.currency)).size!==manifest.countries.length||manifest.countries.some(c=>!REPORT_CURRENCIES.includes(c.currency)))throw Error('official_replay_manifest_required')
 const [sourcePlan,sourceRegister]=await Promise.all(['six-currency-explanation-sources-20261027.json','six-currency-source-register-20261027.json'].map(f=>fs.readFile(path.join(root,'docs/2.0',f),'utf8').then(JSON.parse)))
 const parent=path.join(privateRoot,'official-background-runs');await fs.mkdir(parent,{recursive:true})
 if(await fs.realpath(parent)!==parent)throw Error('private_official_output_required')
 const directory=await fs.mkdtemp(path.join(parent,'replay-')),rows=[]
 for(const country of manifest.countries){
  const saved=country.officialInputsFile?await read(country.officialInputsFile):{}
  const captures=country.capturesFile?await read(country.capturesFile):[]
  const result=await acquireOfficialBackground({snapshot:{currency:country.currency},asOf:manifest.asOf,sourcePlan,sourceRegister,captures,
   ...saved,mode:'saved',fetchImpl:()=>{throw Error('offline_replay_network_forbidden')},now:()=>manifest.asOf})
  await fs.writeFile(path.join(directory,`${country.currency}.json`),JSON.stringify(result),{flag:'wx'})
  rows.push({currency:country.currency,status:result.status,admitted:result.admission.admitted.map(s=>({seriesId:s.seriesId,period:s.period,value:s.value,
   comparison:s.scope.comparison,publishedOn:s.release.publishedOn,source:s.sourceUrl,archivedAsOfRelease:false})),
   reasons:[...new Set(result.admission.rows.map(r=>r.reason).filter(Boolean))],
   sourceStates:result.states.flatMap(s=>s.sourceStates??[]),modelCalls:0,newPaidCostUsd:0,publicationApproved:false})
 }
 for(const file of readFiles)if(fingerprint(await fs.readFile(file.resolved,'utf8'))!==file.hash)throw Error('official_replay_input_changed')
 const summary={version:'official-background-replay-result/1',asOf:manifest.asOf,rows,inputsPreserved:true,networkCalls:0,modelCalls:0,newPaidCostUsd:0,
  semanticReview:'not_performed',productionChanges:0,publicationApproved:false,directory:path.relative(root,directory)}
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(summary,null,2),{flag:'wx'})
 return summary
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const {values}=parseArgs({options:{input:{type:'string'}},strict:true})
 replayOfficialBackground(values).then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('official_replay_hold; inspect private inputs; no network/model/DB changes');process.exitCode=1})
}
