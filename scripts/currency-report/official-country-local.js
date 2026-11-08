// Free, local acquisition/replay only. No token, model, DB or activation path.
// Saved inputs retain their receipts; a failed live lookup is never relabelled
// a fresh success. Only new private output directories are written.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {createOfficialInputLoader} from './official-input-loader.js'
import {reviewOfficialStatistics} from './official-statistic-admission.js'
import {fingerprint} from './research-harness.js'

export async function runCountryOfficialLocal({input,mode='saved',workspace=process.cwd(),fetchImpl,extractPdf,now=()=>new Date().toISOString()}={}) {
 if(!['saved','live'].includes(mode))throw Error('official_local_mode_required')
 const root=await fs.realpath(workspace),privateRoot=path.join(root,'.local-reports/private'),reads=[]
 const read=async file=>{
  const resolved=await fs.realpath(path.resolve(root,file)),rel=path.relative(privateRoot,resolved),stat=await fs.stat(resolved)
  if(!rel||rel.startsWith('..')||path.isAbsolute(rel)||!stat.isFile()||stat.size>16_000_000||!resolved.endsWith('.json'))throw Error('private_official_input_required')
  const raw=await fs.readFile(resolved,'utf8');reads.push({resolved,hash:fingerprint(raw)});return JSON.parse(raw)
 }
 const m=await read(input)
 if(m.version!=='official-background-replay/1'||!Array.isArray(m.countries)||!m.countries.length||m.countries.length>5
  ||new Set(m.countries.map(c=>c.currency)).size!==m.countries.length||m.countries.some(c=>!['BRL','COP','PEN','CLP','ARS'].includes(c.currency))
  ||!Number.isFinite(Date.parse(m.asOf)))throw Error('official_country_manifest_required')
 const savedByCurrency={}
 for(const c of m.countries)if(c.officialInputsFile)savedByCurrency[c.currency]=await read(c.officialInputsFile)
 const parent=path.join(privateRoot,'official-country-runs');await fs.mkdir(parent,{recursive:true})
 if(await fs.realpath(parent)!==parent)throw Error('official_private_directory_required')
 const directory=await fs.mkdtemp(path.join(parent,mode+'-')),rows=[]
 const loader=createOfficialInputLoader({workspace:root,savedByCurrency,fetchImpl,extractPdf})
 for(const c of m.countries){
  const loaded=await loader({currency:c.currency,asOf:m.asOf,mode,now})
  const completedAt=mode==='live'?now():m.asOf
  if(Date.parse(completedAt)<Date.parse(m.asOf))throw Error('official_completion_clock_invalid')
  const admission=reviewOfficialStatistics({currency:c.currency,countryInputs:loaded.countryOfficialInputs,asOf:completedAt})
  await fs.writeFile(path.join(directory,c.currency+'.json'),JSON.stringify({inputs:loaded,admission}),{flag:'wx'})
  rows.push({currency:c.currency,inputState:loaded.inputState??'saved_inputs_replayed',networkCalls:loaded.inputNetworkCalls??0,
   lookupIssues:loaded.inputIssues??[],status:admission.status,admitted:admission.admitted.map(s=>({seriesId:s.seriesId,period:s.period,value:s.value,
    scope:s.scope,publishedOn:s.release.publishedOn,availableBy:s.collectedAt,availability:s.availability,sourceUrl:s.sourceUrl})),
   holds:admission.rows.filter(r=>r.reason).map(r=>r.reason)})
 }
 for(const r of reads)if(fingerprint(await fs.readFile(r.resolved,'utf8'))!==r.hash)throw Error('official_input_changed')
 const result={version:'official-country-local-result/1',mode,rows,networkCalls:rows.reduce((n,r)=>n+r.networkCalls,0),modelCalls:0,newPaidCostUsd:0,
  productionChanges:0,publicationApproved:false,inputsPreserved:true,directory:path.relative(root,directory)}
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2),{flag:'wx'})
 return result
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const {values}=parseArgs({options:{input:{type:'string'},mode:{type:'string',default:'saved'}},strict:true})
 runCountryOfficialLocal(values).then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('official_country_local_hold; private inputs preserved; no paid/DB/production action');process.exitCode=1})
}
