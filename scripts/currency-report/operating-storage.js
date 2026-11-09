// Server-only lossless storage. No policy, price projection or model input edits.
import {createHash} from 'node:crypto'
import {gzipSync, gunzipSync} from 'node:zlib'

export const STORAGE_LIMITS=Object.freeze({chunk:512*1024,manifest:256*1024,raw:128*1024*1024,compressed:32*1024*1024})
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const fail=(reason,stats)=>{const error=Error('operating_storage_'+reason);if(stats)error.storageStats=stats;throw error}
const json=value=>Buffer.from(JSON.stringify(value),'utf8')
const roles=['dataset','prepared']
export function encodeOperatingInput(payload,limits=STORAGE_LIMITS){
 if(payload?.version!=='operating-frozen-input/1'||!payload.dataset||!payload.prepared)fail('format_invalid')
 const objects=roles.map(role=>{
  const raw=json(payload[role])
  if(raw.length>limits.raw)fail('raw_limit',{rawBytes:raw.length,limits})
  const compressed=gzipSync(raw,{level:6})
  if(compressed.length>limits.compressed)fail('compressed_limit',{rawBytes:raw.length,compressedBytes:compressed.length,limits})
  const chunks=[]
  for(let offset=0;offset<compressed.length;offset+=limits.chunk)chunks.push(compressed.subarray(offset,offset+limits.chunk))
  return {role,metadata:{id:hash(raw),codec:'gzip-json/1',rawBytes:raw.length,compressedBytes:compressed.length,
   compressedHash:hash(compressed),chunkCount:chunks.length},chunks}
 })
 const rawBytes=objects.reduce((n,o)=>n+o.metadata.rawBytes,0),compressedBytes=objects.reduce((n,o)=>n+o.metadata.compressedBytes,0)
 if(rawBytes>limits.raw)fail('raw_limit',{rawBytes,compressedBytes,limits})
 if(compressedBytes>limits.compressed)fail('compressed_limit',{rawBytes,compressedBytes,limits})
 // Replacing existing keys preserves the original JSON property order.
 const template={...payload,dataset:null,prepared:null}
 const manifest={version:'operating-frozen-input/2',datasetBinding:payload.datasetBinding,policyBinding:payload.policyBinding,
  resumeIdentity:payload.resumeIdentity,...(payload.testOnly?{testOnly:true}:{}),template:JSON.stringify(template),
  payloadHash:hash(json(payload)),objects:objects.map(o=>({role:o.role,...o.metadata}))}
 const manifestBytes=json(manifest).length
 if(manifestBytes>limits.manifest)fail('manifest_limit',{rawBytes,compressedBytes,manifestBytes,limits})
 return {manifest,objects,stats:{rawBytes,compressedBytes,manifestBytes,objects:objects.map(o=>({role:o.role,...o.metadata})),limits}}
}
export function validateOperatingManifest(manifest,limits=STORAGE_LIMITS){
 if(manifest?.version!=='operating-frozen-input/2'||json(manifest).length>limits.manifest
  ||!Array.isArray(manifest.objects)||manifest.objects.length!==2)fail('manifest_invalid')
 let raw=0,compressed=0
 for(const role of roles){
  const matches=manifest.objects.filter(o=>o.role===role),o=matches[0]
  if(matches.length!==1||o.codec!=='gzip-json/1'||!(/^[a-f0-9]{64}$/.test(o.id))||!(/^[a-f0-9]{64}$/.test(o.compressedHash))
   ||![o.rawBytes,o.compressedBytes,o.chunkCount].every(n=>Number.isSafeInteger(n)&&n>0)
   ||o.chunkCount!==Math.ceil(o.compressedBytes/limits.chunk))fail('reference_invalid')
  raw+=o.rawBytes;compressed+=o.compressedBytes
 }
 if(raw>limits.raw||compressed>limits.compressed)fail('reference_limit')
 return manifest
}
export async function decodeOperatingInput(manifest,readChunk,limits=STORAGE_LIMITS){
 validateOperatingManifest(manifest,limits)
 let payload
 try{payload=JSON.parse(manifest.template)}catch{fail('template_invalid')}
 if(payload?.version!=='operating-frozen-input/1'||payload.dataset!==null||payload.prepared!==null)fail('template_invalid')
 for(const o of manifest.objects){
  const chunks=[]
  for(let index=0;index<o.chunkCount;index++){
   const chunk=await readChunk(o,index)
   if(!Buffer.isBuffer(chunk)||chunk.length!==Math.min(limits.chunk,o.compressedBytes-index*limits.chunk))fail('chunk_invalid')
   chunks.push(chunk)
  }
  const compressed=Buffer.concat(chunks)
  if(hash(compressed)!==o.compressedHash)fail('compressed_hash_mismatch')
  let raw
  try{raw=gunzipSync(compressed,{maxOutputLength:Math.min(o.rawBytes,limits.raw)})}catch{fail('decompression_failed')}
  if(raw.length!==o.rawBytes||hash(raw)!==o.id)fail('raw_hash_mismatch')
  try{payload[o.role]=JSON.parse(raw.toString('utf8'))}catch{fail('json_invalid')}
 }
 if(hash(json(payload))!==manifest.payloadHash||hash(json(payload.dataset))!==manifest.datasetBinding
  ||payload.datasetBinding!==manifest.datasetBinding||payload.policyBinding!==manifest.policyBinding
  ||payload.resumeIdentity!==manifest.resumeIdentity||Boolean(payload.testOnly)!==Boolean(manifest.testOnly))fail('payload_hash_mismatch')
 return payload
}
export async function inspectOperatingStorage(encoded,store){
 if(typeof store.storageInspect!=='function')fail('capability_missing')
 const result=await store.storageInspect(encoded.manifest.objects.map(o=>o.id))
 if(result?.version!=='operating-storage/2')fail('capability_missing')
 const ready=new Set((result.objects??[]).filter(o=>o.sealed).map(o=>o.id))
 const unique=[...new Map(encoded.objects.map(o=>[o.metadata.id,o])).values()]
 return {...encoded.stats,status:'storage_preflight_passed',retention:result.retention??null,newBytes:unique.filter(o=>!ready.has(o.metadata.id)).reduce((n,o)=>n+o.metadata.compressedBytes,0),
  reusedBytes:unique.filter(o=>ready.has(o.metadata.id)).reduce((n,o)=>n+o.metadata.compressedBytes,0)}
}
export async function storeOperatingInput(encoded,store){
 for(const object of encoded.objects){
  const state=await store.storagePrepare(object.metadata)
  if(!state.sealed){
   for(let index=0;index<object.chunks.length;index++)await store.storageChunk(object.metadata.id,index,object.chunks[index].toString('base64'))
   await store.storageSeal(object.metadata.id)
  }
 }
 // Read back every object before claiming an execution. Lost acknowledgements
 // are handled by an explicit next run, never a hidden provider retry.
 return decodeOperatingInput(encoded.manifest,(o,index)=>store.storageReadChunk(o.id,index).then(value=>Buffer.from(value,'base64')))
}
export async function restoreFrozenInput(stored,store,legacyReader){
 const manifest=legacyReader(stored)
 if(manifest.version==='operating-frozen-input/1')return manifest
 return decodeOperatingInput(manifest,(o,index)=>store.storageReadChunk(o.id,index).then(value=>Buffer.from(value,'base64')))
}
