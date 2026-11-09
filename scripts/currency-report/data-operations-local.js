import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {readDataBundle,ledgerRoot} from './data-ledger.js'
import {assessRetention,assessCapacity,DATA_OPERATIONS_POLICY} from './data-operations-policy.js'
// Read-only inventory. References not yet verified outside this ledger are never deletion candidates.
export async function inspectDataOperations({root=ledgerRoot,now=Date.now(),store,metrics=['github_actions','netlify','supabase_database','supabase_egress'].map(id=>({id,verified:false}))}={}){
 const entries=await fs.readdir(root,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e})
 const bundles=[]
 for(const entry of entries.filter(e=>e.isDirectory()&&!e.name.startsWith('.'))){
  try{const b=await readDataBundle(entry.name,{root});bundles.push({id:entry.name,manifest:b.manifest,status:'complete'})}
  catch{bundles.push({id:entry.name,status:'incomplete_or_changed'})}
 }
 const referenced=new Set(bundles.flatMap(b=>(b.manifest?.parents??[]).map(p=>p.id)))
 const items=bundles.map(b=>{
  if(!b.manifest)return {id:b.id,status:b.status,delete:false}
  const m=b.manifest
  return assessRetention({id:b.id,class:m.kind==='writer_result'?'run_detail':null,eligibleFrom:m.createdAt,
   storageAllowed:null,referencesVerified:false,referenceCount:referenced.has(b.id)?1:0,
   holds:[...m.protection,...(referenced.has(b.id)?['pending_review_dependency']:[])],costState:m.costState,
   bytes:m.resources.reduce((n,r)=>n+r.bytes,0)},{now})
 })
 const frozenStorage=store?await store.storageInspect([]).then(r=>({status:'verified',...r.retention})).catch(()=>({status:'unavailable',deleteEnabled:false})):{status:'not_checked',deleteEnabled:false}
 return {version:DATA_OPERATIONS_POLICY.version,mode:'dry_run',deleteEnabled:false,items,capacity:assessCapacity(metrics),frozenStorage,
  note:'No deletion. Storage rights and references beyond this ledger require explicit review.'}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 inspectDataOperations().then(r=>console.log(JSON.stringify(r,null,2))).catch(()=>{console.error('local_data_inventory_failed');process.exitCode=1})
}
