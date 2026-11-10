import {it,expect,vi} from 'vitest'
import {randomBytes} from 'node:crypto'
import {encodeRuntimeDocument,restoreRuntimeDocument,persistRuntimeDocument} from './runtime-document.js'
import {memoryOperatingStorage} from './operating-storage-fixture.js'
import {runtimeFixture} from './runtime-fixture.js'
import {fingerprint} from './research-harness.js'
import {countryContinuation,sourceContinuation} from './research-continuation.js'
import {operatingResultState} from './operating-result.js'

const restore=encoded=>restoreRuntimeDocument(encoded.stored,async(_m,i)=>encoded.chunks[i])
it('restores exact ordered task/context bytes including a full history and an unchanged model request',async()=>{
 const task=runtimeFixture().task
 task.snapshot.series=Array.from({length:20000},(_,i)=>({date:`1980-${i}`,value:i+.1234,note:'합성 증가 이력'}))
 task.plan.packet.series=structuredClone(task.snapshot.series)
 const before=JSON.stringify(task),requestHash=fingerprint(task.plan.body)
 for(const [kind,value] of [['task',task],['context',{writer:'sol',packet:task.plan.packet,task,request:task.plan.body,
  operatingBatchKey:'a'.repeat(64),operatingCaseKey:'b'.repeat(64),operatingOwner:'test-owner'}]] as const){
  const encoded=encodeRuntimeDocument(value,kind)
  expect(encoded.stats.rawBytes).toBeGreaterThan(900000)
  expect(encoded.stats.manifestBytes).toBeLessThan(262144)
  const actual=await restore(encoded)
  expect(JSON.stringify(actual)).toBe(JSON.stringify(value))
  expect(fingerprint(kind==='task'?actual.plan.body:actual.request)).toBe(requestHash)
 }
 expect(JSON.stringify(task)).toBe(before)
})
it('resumes an interrupted object write and protects the same immutable bytes',async()=>{
 const store=memoryOperatingStorage(),registerRuntimeDocument=vi.fn(),chunk=store.storageChunk
 let fail=true
 const value={writer:'sol',request:{data:randomBytes(900000).toString('base64')}}
 const encoded=encodeRuntimeDocument(value,'context')
 const interrupted={...store,registerRuntimeDocument,storageChunk:async(...args)=>{
  if(args[1]===1&&fail){fail=false;throw Error('synthetic_ack_lost')}
  return chunk(...args)
 }}
 await expect(persistRuntimeDocument(encoded,interrupted)).rejects.toThrow('synthetic_ack_lost')
 expect(registerRuntimeDocument).not.toHaveBeenCalled()
 const stored=await persistRuntimeDocument(encoded,interrupted)
 expect(await restoreRuntimeDocument(stored,async(m,i)=>Buffer.from(await store.storageReadChunk(m.id,i),'base64'))).toEqual(value)
 expect(registerRuntimeDocument).toHaveBeenCalledTimes(1)
})
it('rejects missing/reordered/tampered chunks and altered control projections',async()=>{
 const encoded=encodeRuntimeDocument({writer:'sol',request:{data:randomBytes(900000).toString('base64')}},'context')
 await expect(restoreRuntimeDocument(encoded.stored,async()=>undefined)).rejects.toThrow('chunk_invalid')
 await expect(restoreRuntimeDocument(encoded.stored,async(_m,i)=>encoded.chunks[encoded.chunks.length-1-i])).rejects.toThrow()
 const changed={...encoded.stored,writer:'other'}
 await expect(restoreRuntimeDocument(changed,async(_m,i)=>encoded.chunks[i])).rejects.toThrow('projection_changed')
 const corrupted=encoded.chunks.map(b=>Buffer.from(b));corrupted[0][0]^=1
 await expect(restoreRuntimeDocument(encoded.stored,async(_m,i)=>corrupted[i])).rejects.toThrow('compressed_hash_mismatch')
})
it('bounds uncompressed bytes, compressed bytes, manifests and decompression output separately',async()=>{
 const value={writer:'sol',request:'x'.repeat(4000)},limits={raw:5000,compressed:1000,manifest:2000,chunk:512*1024}
 const encoded=encodeRuntimeDocument(value,'context',limits)
 expect(encoded.stats.rawBytes).toBeLessThan(limits.raw)
 expect(()=>encodeRuntimeDocument(value,'context',{...limits,raw:4000})).toThrow('raw_limit')
 expect(()=>encodeRuntimeDocument(value,'context',{...limits,compressed:10})).toThrow('compressed_limit')
 expect(()=>encodeRuntimeDocument(value,'context',{...limits,manifest:20})).toThrow('manifest_limit')
 const wrong=structuredClone(encoded.stored);wrong.runtimeDocument.rawBytes=20
 await expect(restoreRuntimeDocument(wrong,async(_m,i)=>encoded.chunks[i],limits)).rejects.toThrow('decompression_failed')
 expect(()=>encodeRuntimeDocument({writer:'sol',request:'Bearer test-secret-value'},'context')).toThrow('sensitive_content')
})
it('keeps runtime storage faults technical and preserves endpoint priority over source deferral',()=>{
 for(const reason of ['unsafe_or_oversized_runtime_payload','runtime_document_raw_limit','runtime_document_projection_changed']){
  const continuation=sourceContinuation({reason})
  expect(continuation).toMatchObject({category:'technical',action:'await_pipeline_repair',resumeExact:true})
  expect(operatingResultState({rows:[{continuation}]})).toMatchObject({kind:'action_required',exitCode:2})
 }
 const row={status:'source_dispatch_deferred',sourceHolds:['source_endpoint_preflight_hold'],sourceIssues:[{status:'source_budget_deferred'}]}
 expect(countryContinuation(row)).toMatchObject({category:'temporary',resumeExact:true})
 expect(countryContinuation({status:'source_dispatch_deferred',sourceIssues:[]})).toMatchObject({category:'budget',resumeExact:false})
 expect(countryContinuation({...row,sourceIssues:[{status:'source_cost_unresolved'}]})).toMatchObject({category:'accounting',action:'stop_paid_work'})
})
