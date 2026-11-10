import {it,expect,vi} from 'vitest'
import {randomBytes} from 'node:crypto'
import {gzipSync} from 'node:zlib'
import {encodeOperatingInput,decodeOperatingInput,STORAGE_LIMITS,storeOperatingInput,inspectOperatingStorage,restoreFrozenInput} from './operating-storage.js'
import {memoryOperatingStorage} from './operating-storage-fixture.js'
import {fingerprint} from './research-harness.js'
import {restoreOperatingPayload} from './runtime-store.js'
import {operatingFixture} from './operating-fixture.js'
import {runOperatingCycle} from './operating-cycle.js'
const input=(data={z:'한글',a:[2,1]},prepared={body:'original',rows:[]})=>({version:'operating-frozen-input/1',datasetBinding:fingerprint(data),policyBinding:'policy',prepared,dataset:data,resumeIdentity:'key'})
const read=encoded=>async(o,index)=>encoded.objects.find(object=>object.role===o.role).chunks[index]
it('preserves exact JSON property order, UTF8 and existing bindings through the new manifest',async()=>{
 const p=input(),before=JSON.stringify(p),encoded=encodeOperatingInput(p)
 expect(JSON.stringify(await decodeOperatingInput(encoded.manifest,read(encoded)))).toBe(before)
 expect(JSON.stringify(p)).toBe(before)
 expect(encoded.manifest).not.toHaveProperty('dataset')
 expect(encoded.manifest).not.toHaveProperty('prepared')
})
it('enforces aggregate raw, compressed and manifest boundaries using byte counts',()=>{
 const p=input(),encoded=encodeOperatingInput(p),limits={...STORAGE_LIMITS,raw:encoded.stats.rawBytes,compressed:encoded.stats.compressedBytes,manifest:encoded.stats.manifestBytes}
 expect(()=>encodeOperatingInput(p,limits)).not.toThrow()
 for(const [key,value] of Object.entries({raw:'raw_limit',compressed:'compressed_limit',manifest:'manifest_limit'})){
  expect(()=>encodeOperatingInput(p,{...limits,[key]:limits[key]-1})).toThrow('operating_storage_'+value)
  try{encodeOperatingInput(p,{...limits,[key]:limits[key]-1})}catch(error){
   expect(error.storageStats[key+'Bytes']).toBeGreaterThan(limits[key]-1)
   expect(JSON.stringify(error.storageStats)).not.toContain('original')
  }
 }
})
it('detects missing, reordered, changed compressed bytes and wrong manifest bindings',async()=>{
 const encoded=encodeOperatingInput(input({body:randomBytes(900000).toString('base64')}))
 expect(encoded.objects[0].chunks.length).toBeGreaterThan(1)
 await expect(decodeOperatingInput(encoded.manifest,async()=>undefined)).rejects.toThrow('chunk_invalid')
 await expect(decodeOperatingInput(encoded.manifest,async(o,index)=>encoded.objects.find(x=>x.role===o.role).chunks[index?0:1])).rejects.toThrow()
 const corrupt=structuredClone(encoded.manifest);corrupt.payloadHash='a'.repeat(64)
 await expect(decodeOperatingInput(corrupt,read(encoded))).rejects.toThrow('payload_hash_mismatch')
 const b=Buffer.from(encoded.objects[0].chunks[0]);b[20]^=1
 await expect(decodeOperatingInput(encoded.manifest,async(o,i)=>o.role==='dataset'&&i===0?b:read(encoded)(o,i))).rejects.toThrow('compressed_hash_mismatch')
})
it('bounds decompression even when a caller supplies a valid compressed hash with a false raw size',async()=>{
 const encoded=encodeOperatingInput(input({body:'x'.repeat(200000)}))
 encoded.manifest.objects[0].rawBytes=20
 await expect(decodeOperatingInput(encoded.manifest,read(encoded))).rejects.toThrow('decompression_failed')
 expect(gzipSync(Buffer.from('x'.repeat(200000))).length).toBeLessThan(1000)
})
it('resumes after a lost chunk acknowledgement and reuses sealed objects without duplicate writes',async()=>{
 const encoded=encodeOperatingInput(input({body:randomBytes(900000).toString('base64')})),store=memoryOperatingStorage(),put=store.storageChunk
 let interrupted=false
 store.storageChunk=async(...args)=>{await put(...args);if(!interrupted){interrupted=true;throw Error('lost_ack')}}
 await expect(storeOperatingInput(encoded,store)).rejects.toThrow('lost_ack')
 const recovered=await storeOperatingInput(encoded,store)
 expect(recovered).toEqual(input(recovered.dataset))
 store.storageChunk=vi.fn(put)
 await storeOperatingInput(encoded,store)
 expect(store.storageChunk).not.toHaveBeenCalled()
 expect((await inspectOperatingStorage(encoded,store)).newBytes).toBe(0)
 expect(store.objects.size).toBe(2)
})
it('supports immutable legacy /1 without object storage or rebasing',async()=>{
 const p=input(),store=memoryOperatingStorage()
 const stored={...p,serializedOperatingPayload:JSON.stringify(p)}
 expect(await restoreFrozenInput(stored,store,restoreOperatingPayload)).toEqual(p)
 expect(store.objects.size).toBe(0)
})
it('plan checks real serialization/capability but never stores, claims, reserves or sends',async()=>{
 const f=await operatingFixture(),plan=await runOperatingCycle({...f,execute:false})
 expect(plan.storage.status).toBe('storage_preflight_passed')
 expect(f.store.objects.size).toBe(0);expect(f.state.batch).toBeNull();expect(f.store.jobs).toHaveLength(0)
 expect(f.state.posts).toHaveLength(0)
 f.store.storageInspect=async()=>{throw Error('db_feature_missing')}
 const failed=await runOperatingCycle({...f,execute:true})
 expect(failed.status).toBe('operating_storage_failure');expect(f.state.posts).toHaveLength(0)
 expect(f.store.incidents[0]).toMatchObject({stage:'preflight',healthy:false})
})
it('explicit storage verification uses the full common pipeline with zero paid work or execution locks',async()=>{
 const f=await operatingFixture(),verified=await runOperatingCycle({...f,verifyStorage:true})
 expect(verified).toMatchObject({status:'storage_verified',modelCalls:0,locksAcquired:false,budgetReserved:false})
 expect(f.store.objects.size).toBe(2);expect(f.state.batch).toBeNull();expect(f.store.jobs).toHaveLength(0);expect(f.state.posts).toHaveLength(0)
})
it('fails closed when the incident record cannot be saved',async()=>{
 const f=await operatingFixture();f.store.storageIncident=async()=>{throw Error('db_down')}
 const result=await runOperatingCycle({...f,execute:true})
 expect(result.status).toBe('operating_storage_failure');expect(result.reason).toBe('operating_incident_record_failed')
 expect(f.state.batch).toBeNull();expect(f.state.posts).toHaveLength(0)
})
it('does not resolve a repeated manifest-link failure merely because object storage passed',async()=>{
 const f=await operatingFixture();f.store.claimBatch=async()=>{throw Error('manifest_link_failed')}
 for(let i=0;i<2;i++)expect((await runOperatingCycle({...f,execute:true})).stage).toBe('link')
 expect(f.store.incidents.filter(i=>i.stage==='link')).toHaveLength(2)
 expect(f.store.incidents.filter(i=>i.stage==='link').every(i=>!i.healthy)).toBe(true)
 expect(f.state.posts).toHaveLength(0)
 await runOperatingCycle({...f,verifyStorage:true})
 expect(f.store.incidents.filter(i=>i.stage==='link').some(i=>i.healthy)).toBe(false)
})
it('detects a corrupted database readback before any execution claim or model reservation',async()=>{
 const f=await operatingFixture(),read=f.store.storageReadChunk
 f.store.storageReadChunk=async(...args)=>{const b=Buffer.from(await read(...args),'base64');b[15]^=1;return b.toString('base64')}
 const r=await runOperatingCycle({...f,execute:true})
 expect(r).toMatchObject({status:'operating_storage_failure',stage:'write',modelCalls:0})
 expect(f.state.batch).toBeNull();expect(f.store.jobs).toHaveLength(0);expect(f.state.posts).toHaveLength(0)
})
it('resumes an existing /1 paused run without converting its payload or changing its case budget',async()=>{
 const f=await operatingFixture()
 await runOperatingCycle({...f,execute:true,preflightSource:async()=>{if(f.state.batch)throw Error('synthetic_endpoint_outage');return f.preflightSource()}})
 const legacy=await restoreFrozenInput(f.state.batch.payload,f.store,restoreOperatingPayload)
 f.state.batch.payload={...legacy,serializedOperatingPayload:JSON.stringify(legacy)}
 const before=JSON.stringify(f.state.batch.payload),result=await runOperatingCycle({...f,execute:true})
 expect(result.rows.every(r=>r.status==='pending_admin_review')).toBe(true)
 expect(JSON.stringify(f.state.batch.payload)).toBe(before)
})
it('passes identical mock model request bodies and publication inputs before and after lossless restoration',async()=>{
 const first=await operatingFixture(),second=await operatingFixture(),requests=[[],[]]
 const encoded=encodeOperatingInput(input(second.dataset))
 second.dataset=(await decodeOperatingInput(encoded.manifest,read(encoded))).dataset
 for(const [index,f] of [first,second].entries()){
  const send=f.send
  await runOperatingCycle({...f,execute:true,send:async args=>{requests[index].push(JSON.stringify(args.body));return send(args)}})
 }
 expect(requests[0].length).toBeGreaterThan(0)
 expect(requests[1]).toEqual(requests[0])
 expect(second.state.inputHistory.map(t=>t.binding)).toEqual(first.state.inputHistory.map(t=>t.binding))
})
