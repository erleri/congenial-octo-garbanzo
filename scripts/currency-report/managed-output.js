import fs from 'node:fs/promises'
import path from 'node:path'
import {writeDataBundle,readDataBundle,dataHash} from './data-ledger.js'
export async function beginManagedOutput(directory){await fs.writeFile(path.join(directory,'.data-pending'),'managed-output/1',{flag:'wx'})}
export async function completeManagedOutput({directory,workspace=process.cwd(),kind,currency=null,costState='not_called'}){
 const names=(await fs.readdir(directory)).filter(n=>!n.startsWith('.'))
 const resources=[]
 for(const [i,name] of names.entries()){
  const file=path.join(directory,name),s=await fs.lstat(file)
  if(!s.isFile()||s.isSymbolicLink())throw Error('managed_output_file_required')
  const raw=await fs.readFile(file)
  resources.push({id:`file_${i}`,kind:'source_snapshot',value:{name,sourceHash:dataHash(raw),bytes:raw.length,body:raw.toString('utf8')}})
 }
 const receipt=await writeDataBundle({root:path.join(workspace,'.local-reports/private/data-ledger'),id:path.basename(directory),kind,currency,
  resources,costState,protection:['pending_review_dependency',...(costState==='unknown'?['unresolved_cost']:[])]})
 await fs.writeFile(path.join(directory,'.data-receipt.json'),JSON.stringify(receipt),{flag:'wx'})
 return receipt
}
export async function verifyManagedFile(file,{workspace=process.cwd()}={}){
 const directory=path.dirname(file)
 try{await fs.access(path.join(directory,'.data-pending'))}catch(e){if(e.code==='ENOENT')return {status:'legacy'};throw e}
 const receipt=JSON.parse(await fs.readFile(path.join(directory,'.data-receipt.json'),'utf8'))
 const b=await readDataBundle(receipt.id,{root:path.join(workspace,'.local-reports/private/data-ledger')})
 if(b.receipt.manifestHash!==receipt.manifestHash)throw Error('managed_output_receipt_changed')
 const source=Object.values(b.resources).find(r=>r.name===path.basename(file))
 if(!source||source.sourceHash!==dataHash(await fs.readFile(file)))throw Error('managed_output_file_changed')
 return {status:'complete',receipt}
}
