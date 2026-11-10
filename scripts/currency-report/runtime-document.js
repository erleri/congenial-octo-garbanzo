// Lossless server-only runtime documents. Calculation/request objects stay intact.
// Only their persistence representation changes; existing inline records still read.
import {createHash} from 'node:crypto'
import {gzipSync,gunzipSync} from 'node:zlib'
import {STORAGE_LIMITS} from './operating-storage.js'

export const RUNTIME_DOCUMENT_VERSION='runtime-document/2'
const bytes=value=>Buffer.from(JSON.stringify(value),'utf8')
const hash=value=>createHash('sha256').update(value).digest('hex')
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value
const same=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b))
const fail=reason=>{throw Error('runtime_document_'+reason)}
const forbidden=/sk-or-|bearer\s+\S+|-----BEGIN .*PRIVATE KEY|[?&](?:token|api_?key)=/i
export const requiresRuntimeArchive=value=>bytes(value).length>200000
export function runtimeDocumentProjection(value,kind){
 if(kind==='task')return {version:value.version,status:value.status,currency:value.currency,baseDate:value.baseDate,
  binding:value.binding,taskKey:value.taskKey,snapshot:{snapshotId:value.snapshot?.snapshotId},
  purpose:value.purpose,cadence:value.cadence,publicationApproved:value.publicationApproved}
 if(kind==='context'){
  const {packet,task,request,serializedRuntimeContext,...control}=value
  void packet;void request;void serializedRuntimeContext
  return {...control,...(task?{task:{currency:task.currency,cadence:task.cadence}}:{})}
 }
 fail('kind_invalid')
}
export function encodeRuntimeDocument(value,kind,limits=STORAGE_LIMITS){
 const raw=bytes(value)
 if(raw.length>limits.raw)fail('raw_limit')
 if(forbidden.test(raw.toString('utf8')))fail('sensitive_content')
 const compressed=gzipSync(raw,{level:6})
 if(compressed.length>limits.compressed)fail('compressed_limit')
 const chunks=[]
 for(let offset=0;offset<compressed.length;offset+=limits.chunk)chunks.push(compressed.subarray(offset,offset+limits.chunk))
 const metadata={id:hash(raw),codec:'gzip-json/1',rawBytes:raw.length,compressedBytes:compressed.length,
  compressedHash:hash(compressed),chunkCount:chunks.length}
 const packetText=kind==='context'&&value.packet?JSON.stringify(value.packet):null
 const projection=runtimeDocumentProjection(value,kind)
 const manifest={version:RUNTIME_DOCUMENT_VERSION,kind,...metadata,packetHash:packetText?hash(Buffer.from(packetText)):null}
 const stored={...projection,runtimeDocument:manifest}
 if(bytes(stored).length>limits.manifest)fail('manifest_limit')
 return {stored,metadata,chunks,packetText,stats:{rawBytes:raw.length,compressedBytes:compressed.length,manifestBytes:bytes(stored).length}}
}
export function assertRuntimeDocumentCapacity(value,kind){
 encodeRuntimeDocument(value,kind)
 return value
}
export async function restoreRuntimeDocument(stored,readChunk,limits=STORAGE_LIMITS){
 const m=stored?.runtimeDocument
 if(m?.version!==RUNTIME_DOCUMENT_VERSION||!['task','context'].includes(m.kind)||m.codec!=='gzip-json/1'
  ||bytes(stored).length>limits.manifest||!(/^[a-f0-9]{64}$/.test(m.id))||!(/^[a-f0-9]{64}$/.test(m.compressedHash))
  ||![m.rawBytes,m.compressedBytes,m.chunkCount].every(n=>Number.isSafeInteger(n)&&n>0)
  ||m.rawBytes>limits.raw||m.compressedBytes>limits.compressed||m.chunkCount!==Math.ceil(m.compressedBytes/limits.chunk))fail('reference_invalid')
 const parts=[]
 for(let i=0;i<m.chunkCount;i++){
  const part=await readChunk(m,i)
  if(!Buffer.isBuffer(part)||part.length!==Math.min(limits.chunk,m.compressedBytes-i*limits.chunk))fail('chunk_invalid')
  parts.push(part)
 }
 const compressed=Buffer.concat(parts)
 if(hash(compressed)!==m.compressedHash)fail('compressed_hash_mismatch')
 let raw,value
 try{raw=gunzipSync(compressed,{maxOutputLength:m.rawBytes})}catch{fail('decompression_failed')}
 if(raw.length!==m.rawBytes||hash(raw)!==m.id)fail('raw_hash_mismatch')
 try{value=JSON.parse(raw.toString('utf8'))}catch{fail('json_invalid')}
 const {runtimeDocument,...projection}=stored;void runtimeDocument
 if(!same(projection,runtimeDocumentProjection(value,m.kind)))fail('projection_changed')
 if((value.packet?hash(bytes(value.packet)):null)!==m.packetHash)fail('packet_changed')
 return value
}
export async function persistRuntimeDocument(encoded,store){
 const prior=await store.storagePrepare(encoded.metadata)
 if(!prior.sealed){
  for(let i=0;i<encoded.chunks.length;i++)await store.storageChunk(encoded.metadata.id,i,encoded.chunks[i].toString('base64'))
  await store.storageSeal(encoded.metadata.id)
 }
 const restored=await restoreRuntimeDocument(encoded.stored,(m,i)=>store.storageReadChunk(m.id,i).then(b=>Buffer.from(b,'base64')))
 if(hash(bytes(restored))!==encoded.metadata.id)fail('roundtrip_changed')
 await store.registerRuntimeDocument(encoded.stored,encoded.packetText)
 return encoded.stored
}
