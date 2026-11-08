// Offline recovery helpers. No environment loading, network, SQL execution or deletion.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto'
import {gzipSync,gunzipSync} from 'node:zlib'
import {dataHash,readDataBundle,ledgerRoot} from './data-ledger.js'
import {inspectDataOperations} from './data-operations-local.js'

export const RECOVERY_VERSION='report-recovery/1'
const MAGIC=Buffer.from('LFXBACKUP1'),MAX_BYTES=256_000_000,MAX_FILES=2000
const kinds=new Set(['database','reference_data','ledger','recovery_state','schema'])
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(v)
function safeName(value){
 if(typeof value!=='string'||value.length>240||value.includes('\\'))return false
 return value.split('/').every(p=>/^[A-Za-z0-9_.-]+$/.test(p)&&!['.','..',''].includes(p)&&!p.endsWith('.')
  &&!/^\.env|^(?:connection|accounts)\.json$|^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))
}
function validateEntries(entries){
 if(!Array.isArray(entries)||!entries.length||entries.length>MAX_FILES)throw Error('invalid_recovery_entries')
 const seen=new Set();let total=0
 for(const e of entries){
  if(!safeName(e.path)||seen.has(e.path.toLowerCase())||!kinds.has(e.kind)||e.backupAllowed!==true
   ||typeof e.permissionBasis!=='string'||!e.permissionBasis.trim()||e.permissionBasis.length>240||!Buffer.isBuffer(e.body))throw Error('unapproved_or_invalid_backup_entry')
  seen.add(e.path.toLowerCase());total+=e.body.length
  if(total>MAX_BYTES)throw Error('recovery_size_limit')
 }
}
function validKey(key){if(!Buffer.isBuffer(key)||key.length!==32)throw Error('recovery_key_required')}

export function sealRecoveryArchive(entries,{key,id,now=new Date().toISOString()}={}){
 validKey(key);validateEntries(entries)
 if(!validId(id)||!Number.isFinite(Date.parse(now)))throw Error('invalid_recovery_identity')
 const header=Buffer.from(JSON.stringify({version:RECOVERY_VERSION,id,createdAt:now,cipher:'AES-256-GCM',compression:'gzip'}))
 const manifest={version:RECOVERY_VERSION,id,createdAt:now,scope:'local_only',entries:entries.map(e=>({path:e.path,kind:e.kind,
  bytes:e.body.length,hash:dataHash(e.body),backupAllowed:true,permissionBasis:e.permissionBasis}))}
 const plain=Buffer.from(JSON.stringify({manifest,files:entries.map(e=>e.body.toString('base64'))}))
 if(plain.length>MAX_BYTES)throw Error('recovery_size_limit')
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(header)
 const encrypted=Buffer.concat([cipher.update(gzipSync(plain)),cipher.final()])
 const length=Buffer.alloc(4);length.writeUInt32BE(header.length)
 const archive=Buffer.concat([MAGIC,length,header,iv,cipher.getAuthTag(),encrypted])
 return {archive,manifest,archiveHash:dataHash(archive)}
}
export function openRecoveryArchive(archive,{key}={}){
 validKey(key)
 try{
  if(!Buffer.isBuffer(archive)||archive.length>MAX_BYTES||archive.length<80||!archive.subarray(0,MAGIC.length).equals(MAGIC))throw Error()
  const size=archive.readUInt32BE(MAGIC.length),offset=MAGIC.length+4
  if(size>2048||size<2||offset+size+28>=archive.length)throw Error()
  const header=archive.subarray(offset,offset+size),meta=JSON.parse(header.toString('utf8'))
  if(meta.version!==RECOVERY_VERSION||!validId(meta.id)||meta.cipher!=='AES-256-GCM'||meta.compression!=='gzip')throw Error()
  const start=offset+size,decipher=createDecipheriv('aes-256-gcm',key,archive.subarray(start,start+12))
  decipher.setAAD(header);decipher.setAuthTag(archive.subarray(start+12,start+28))
  const compressed=Buffer.concat([decipher.update(archive.subarray(start+28)),decipher.final()])
  const parsed=JSON.parse(gunzipSync(compressed,{maxOutputLength:MAX_BYTES}).toString('utf8')),m=parsed.manifest
  if(m.version!==RECOVERY_VERSION||m.id!==meta.id||m.createdAt!==meta.createdAt||m.scope!=='local_only'
   ||!Array.isArray(m.entries)||!Array.isArray(parsed.files)||parsed.files.length!==m.entries.length)throw Error()
  const entries=m.entries.map((e,i)=>({...e,body:Buffer.from(parsed.files[i],'base64')}))
  validateEntries(entries)
  for(const [i,e] of entries.entries())if(!Number.isSafeInteger(e.bytes)||e.body.length!==e.bytes||dataHash(e.body)!==e.hash
   ||e.body.toString('base64')!==parsed.files[i])throw Error()
  return {manifest:m,entries,archiveHash:dataHash(archive)}
 }catch{throw Error('recovery_archive_invalid_or_key_mismatch')}
}
export async function restoreRecoveryFiles({archive,key,target,paths}){
 const verified=openRecoveryArchive(archive,{key}),resolved=path.resolve(target)
 const privateRoot=path.resolve('.local-reports/private/recovery-restores')
 if(!resolved.startsWith(privateRoot+path.sep)||!validId(path.basename(resolved))||path.dirname(resolved)!==privateRoot)throw Error('fresh_private_restore_target_required')
 if(!Array.isArray(paths)||!paths.length||new Set(paths).size!==paths.length||paths.some(p=>!verified.entries.some(e=>e.path===p)))throw Error('explicit_restore_paths_required')
 await fs.mkdir(privateRoot,{recursive:true})
 if(await fs.realpath(privateRoot)!==privateRoot)throw Error('restore_symlink_forbidden')
 await fs.mkdir(resolved) // Exclusive target reservation: no merge or overwrite.
 for(const e of verified.entries.filter(e=>paths.includes(e.path))){
  const file=path.join(resolved,e.path);await fs.mkdir(path.dirname(file),{recursive:true})
  if(await fs.realpath(path.dirname(file))!==path.dirname(file))throw Error('restore_symlink_forbidden')
  await fs.writeFile(file,e.body,{flag:'wx'})
  if(dataHash(await fs.readFile(file))!==e.hash)throw Error('restored_file_changed')
 }
 const receipt={version:RECOVERY_VERSION,id:verified.manifest.id,archiveHash:verified.archiveHash,state:'files_verified',paths}
 await fs.writeFile(path.join(resolved,'restore-complete.json'),JSON.stringify(receipt),{flag:'wx'})
 return receipt
}

// Safe comparison only. Even a verified recovery never overwrites a running DB.
export function reconcileRecovery({restored,latest,latestVerified=false,filesVerified=false,dbVerified=false}={}){
 const invalid=s=>!s||!Array.isArray(s.plans)||!Array.isArray(s.reports)||!Array.isArray(s.admins)
 if(invalid(restored)||invalid(latest))throw Error('recovery_state_required')
 const changed=(old,now,key)=>now.filter(n=>!old.some(o=>key(o)===key(n)&&dataHash(o)===dataHash(n)))
 const planKey=x=>String(x.id),reportKey=x=>String(x.runId)
 for(const s of [restored,latest])for(const [rows,key,field] of [[s.plans,planKey,'id'],[s.reports,reportKey,'runId'],[s.admins,x=>String(x.id),'id']]){
  if(rows.some(x=>!x||typeof x[field]!=='string'||!x[field])||new Set(rows.map(key)).size!==rows.length)throw Error('invalid_recovery_state')
 }
 const planChanges=changed(restored.plans,latest.plans,planKey).map(x=>x.id)
 const planMissing=restored.plans.filter(o=>!latest.plans.some(n=>n.id===o.id)).map(x=>x.id)
 const blockedReports=restored.reports.filter(o=>o.withdrawn!==true&&!latest.reports.some(n=>n.runId===o.runId&&n.withdrawn!==true&&dataHash(n)===dataHash(o))).map(x=>x.runId)
 const reportChanges=changed(restored.reports,latest.reports,reportKey).map(x=>x.runId)
 const adminChanges=changed(restored.admins,latest.admins,x=>x.id).map(x=>x.id)
 const removedAdmins=restored.admins.filter(o=>!latest.admins.some(n=>n.id===o.id)).map(x=>x.id)
 const fresh=latestVerified===true&&dbVerified===true&&filesVerified===true
 const pending=planChanges.length+planMissing.length+blockedReports.length+reportChanges.length+adminChanges.length+removedAdmins.length
 return {version:RECOVERY_VERSION,status:!fresh?'hold_unverified':pending?'hold_reconciliation':'ready_for_separate_promotion_review',
  planChanges,planMissing,blockedReports,reportChanges,adminChanges,removedAdmins,
  publicReadsAllowed:fresh&&pending===0,automaticOverwriteAllowed:false,automaticPromotionAllowed:false,deleteEnabled:false,
  requiresFreshAuthorityAndCorrections:!fresh}
}

// References outside the ledger are explicit inputs; silence is never 'no refs'.
export async function inspectRecoveryReferences({root=ledgerRoot,dbReferences=[],now=Date.now()}={}){
 const resolved=path.resolve(root)
 if(!resolved.replaceAll('\\','/').includes('/.local-reports/private/')||await fs.realpath(resolved)!==resolved)throw Error('private_ledger_root_required')
 const inventory=await inspectDataOperations({root,now}),referencedObjects=new Map(),bundleIds=new Set(inventory.items.map(x=>x.id)),bundles=[]
 for(const item of inventory.items){try{
  const b=await readDataBundle(item.id,{root});bundles.push(b)
  for(const r of b.manifest.resources){const file=b.manifest.version==='report-data-ledger/2'?r.file:`${item.id}/${r.file}`
   const o=referencedObjects.get(file)??{file,bytes:r.bytes,hash:r.hash,bundles:[]};o.bundles.push(item.id);referencedObjects.set(file,o)}
 }catch{/* Retain incomplete records; they cannot be cleanup candidates. */}}
 const databaseRefs=[]
 for(const ref of dbReferences){let status='missing_or_changed';try{const b=await readDataBundle(ref.bundleId,{root});if(b.receipt.manifestHash===ref.manifestHash)status='verified'}catch{/* fail closed */}
  databaseRefs.push({bundleId:ref.bundleId,status})}
 const orphans=[]
 for(const e of await fs.readdir(path.join(root,'.objects'),{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e})){
  if(e.isFile()&&!referencedObjects.has(`.objects/${e.name}`))orphans.push({file:`.objects/${e.name}`,status:'unverified_external_references',delete:false})
 }
 return {...inventory,version:RECOVERY_VERSION,bundleCount:bundleIds.size,objects:[...referencedObjects.values()],databaseRefs,orphans,
  logicalReferencedBytes:bundles.reduce((n,b)=>n+b.manifest.resources.reduce((k,r)=>k+r.bytes,0),0),
  uniqueReferencedBytes:[...referencedObjects.values()].reduce((n,o)=>n+o.bytes,0),
  externalReferencesVerified:false,cleanupExecutable:false}
}
