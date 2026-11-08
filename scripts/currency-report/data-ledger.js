// Local immutable bundles. A receipt proves stored bytes, never meaning or permission.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
export const LEDGER_VERSION='report-data-ledger/2'
const READ_VERSIONS=['report-data-ledger/1',LEDGER_VERSION]
export const ledgerRoot=path.resolve('.local-reports/private/data-ledger')
export const dataHash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex')
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(v)
async function safeRoot(root){
 const resolved=path.resolve(root)
 if(!resolved.split(path.sep).join('/').includes('/.local-reports/private/'))throw Error('private_ledger_root_required')
 await fs.mkdir(resolved,{recursive:true})
 if(await fs.realpath(resolved)!==resolved)throw Error('ledger_symlink_forbidden')
 return resolved
}
async function safeDirectory(root,id){
 if(!validId(id))throw Error('invalid_ledger_id')
 const target=path.join(await safeRoot(root),id)
 if(await fs.realpath(target)!==target)throw Error('ledger_symlink_forbidden')
 return target
}
export async function writeDataBundle({root=ledgerRoot,id,kind,currency=null,resources,edges=[],parents=[],protection=[],costState='not_called',now=new Date().toISOString()}){
 if(!validId(id)||!validId(kind)||!['BRL','MXN','CLP','COP','PEN','ARS',null].includes(currency)
  ||!Array.isArray(resources)||!resources.length||resources.length>64||new Set(resources.map(r=>r.id)).size!==resources.length
  ||resources.some(r=>!validId(r.id)||['manifest','complete'].includes(r.id)||!validId(r.kind)||r.value===undefined)
  ||!Array.isArray(edges)||edges.length>256||edges.some(e=>!resources.some(r=>r.id===e.from)||!resources.some(r=>r.id===e.to)||!validId(e.role))
  ||!Array.isArray(parents)||parents.length>16||new Set(parents.map(p=>p.id)).size!==parents.length
  ||!['not_called','confirmed','unknown'].includes(costState)||!Array.isArray(protection)||protection.some(x=>!validId(x))||!Number.isFinite(Date.parse(now)))throw Error('invalid_data_bundle')
 for(const parent of parents){const b=await readDataBundle(parent.id,{root});if(b.receipt.manifestHash!==parent.manifestHash)throw Error('parent_bundle_changed')}
 const encoded=resources.map(r=>({...r,body:JSON.stringify(r.value)}))
 if(encoded.some(r=>/sk-or-[A-Za-z0-9_-]{16,}|bearer\s+[A-Za-z0-9._-]{16,}|-----BEGIN .*PRIVATE KEY/i.test(r.body)))throw Error('credential_in_data_bundle')
 if(encoded.reduce((n,r)=>n+Buffer.byteLength(r.body),0)>32_000_000)throw Error('data_bundle_size_limit')
 const parent=await safeRoot(root),dir=path.join(parent,id)
 // mkdir without recursive is the reservation; interrupted and duplicate IDs stay blocked.
 await fs.mkdir(dir)
 const objectDir=path.join(parent,'.objects')
 await fs.mkdir(objectDir,{recursive:true})
 if(await fs.realpath(objectDir)!==objectDir)throw Error('ledger_symlink_forbidden')
 const rows=[]
 for(const r of encoded){
  const hash=dataHash(r.body),file=`.objects/${hash}.json`,target=path.join(parent,file)
  const temporary=path.join(objectDir,`.tmp-${randomUUID()}`)
  const handle=await fs.open(temporary,'wx')
  try{await handle.writeFile(r.body);await handle.sync()}finally{await handle.close()}
  // Publish only completed objects, so concurrent bundles never see a half-written file.
  try{await fs.link(temporary,target)}catch(e){if(e.code!=='EEXIST')throw e}finally{await fs.unlink(temporary)}
  // Never overwrite an existing object, including an interrupted or corrupted one.
  if(await fs.realpath(target)!==target||dataHash(await fs.readFile(target))!==hash)throw Error('stored_resource_changed')
  rows.push({id:r.id,kind:r.kind,file,hash,bytes:Buffer.byteLength(r.body)})
 }
 const manifest={version:LEDGER_VERSION,id,kind,currency,createdAt:now,resources:rows,edges,parents,protection:[...new Set(protection)],costState}
 const body=JSON.stringify(manifest)
 await fs.writeFile(path.join(dir,'manifest.json'),body,{flag:'wx'})
 // Read back every object before the final completion marker.
 for(const r of rows)if(dataHash(await fs.readFile(path.join(parent,r.file)))!==r.hash)throw Error('stored_resource_changed')
 const receipt={version:LEDGER_VERSION,id,manifestHash:dataHash(body),state:'complete'}
 await fs.writeFile(path.join(dir,'complete.json'),JSON.stringify(receipt),{flag:'wx'})
 return receipt
}
export async function readDataBundle(id,{root=ledgerRoot,ancestors=[]}={}){
 if(ancestors.includes(id)||ancestors.length>=16)throw Error('invalid_bundle_dependency_chain')
 const dir=await safeDirectory(root,id)
 const [receipt,body]=await Promise.all([fs.readFile(path.join(dir,'complete.json'),'utf8').then(JSON.parse),fs.readFile(path.join(dir,'manifest.json'),'utf8')])
 if(!READ_VERSIONS.includes(receipt.version)||receipt.id!==id||receipt.state!=='complete'||receipt.manifestHash!==dataHash(body))throw Error('bundle_incomplete_or_changed')
 const manifest=JSON.parse(body)
 if(manifest.version!==receipt.version||manifest.id!==id||!Array.isArray(manifest.resources))throw Error('invalid_bundle_manifest')
 const resources={}
 for(const r of manifest.resources){
  const shared=manifest.version===LEDGER_VERSION
  if(!validId(r.id)||!/^[a-f0-9]{64}$/.test(r.hash)||r.file!==(shared?`.objects/${r.hash}.json`:`${r.id}.json`))throw Error('invalid_bundle_resource')
  const file=path.join(shared?await safeRoot(root):dir,r.file)
  if(await fs.realpath(file)!==file)throw Error('ledger_symlink_forbidden')
  const raw=await fs.readFile(file)
  if(raw.length!==r.bytes||dataHash(raw)!==r.hash)throw Error('stored_resource_changed')
  resources[r.id]=JSON.parse(raw.toString('utf8'))
 }
 for(const p of manifest.parents??[]){const parent=await readDataBundle(p.id,{root,ancestors:[...ancestors,id]});if(parent.receipt.manifestHash!==p.manifestHash)throw Error('parent_bundle_changed')}
 return {receipt,manifest,resources}
}
