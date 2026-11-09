// Explicit isolated-DB, zero-provider-call replay. Never load cloud credentials.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'
import {createClient} from '@supabase/supabase-js'
import {randomBytes} from 'node:crypto'
import {assertLocalApi} from './local-db.js'
import {createRuntimeStore,restoreOperatingPayload} from './runtime-store.js'
import {encodeOperatingInput,decodeOperatingInput,storeOperatingInput,inspectOperatingStorage,restoreFrozenInput} from './operating-storage.js'
import {fingerprint} from './research-harness.js'
import {operatingFixture} from './operating-fixture.js'
import {runOperatingCycle} from './operating-cycle.js'
import {automaticReferenceCalendars} from './operating-entry.js'

const keys=JSON.parse(await fs.readFile('../latamfx-main-verify/.local-reports/private/local-db/connection.json','utf8'))
assertLocalApi(keys.url)
const store=createRuntimeStore({url:keys.url,key:keys.serviceKey,mode:'local'})
const timings=[]
for(const method of ['storageInspect','storagePrepare','storageChunk','storageSeal','storageReadChunk']){
 const call=store[method];store[method]=async(...args)=>{const start=performance.now();try{return await call(...args)}finally{timings.push({method,ms:performance.now()-start})}}
}
const dataset=JSON.parse(await fs.readFile('data/fx-full-history.json','utf8'))
assert.equal(dataset.baseDate,'2026-11-09')
// Preserved actual six-country execution; no edits or approval to old records.
const legacy=await store.operatingBatch('1e8246a87605a16836252d766a48639d6059d00d03b234b933a28d98bdcdf7d3')
const saved=restoreOperatingPayload(legacy.payload)
assert.equal(saved.prepared.privateCountries.length,6)
assert.equal(fingerprint((await restoreFrozenInput(legacy.payload,store,restoreOperatingPayload)).dataset),saved.datasetBinding)
const payload={...saved,dataset,datasetBinding:fingerprint(dataset)}
const start=performance.now(),encoded=encodeOperatingInput(payload)
const before=await inspectOperatingStorage(encoded,store),restored=await storeOperatingInput(encoded,store)
assert.equal(JSON.stringify(restored),JSON.stringify(payload))
const originalCost=legacy.result
assert.deepEqual((await store.operatingBatch(legacy.batch_key)).result,originalCost)
const after=await inspectOperatingStorage(encoded,store)
assert.equal(after.newBytes,0)
const realMs=performance.now()-start
// Growth is explicitly synthetic, preserving the real record separately.
const growth={...payload,dataset:{...dataset,dailyRates:[...dataset.dailyRates,...dataset.dailyRates]},
 prepared:{...saved.prepared,syntheticLongMaterials:'긴 기사·공식 자료 증가 시험 '.repeat(50000)}}
growth.datasetBinding=fingerprint(growth.dataset)
const large=encodeOperatingInput(growth),largeRestored=await storeOperatingInput(large,store)
assert.equal(fingerprint(largeRestored),fingerprint(growth))
// Lost acknowledgement, conflicts and restart of client using immutable keys.
const interrupted=encodeOperatingInput({...payload,dataset:{nonce:randomBytes(900000).toString('base64')},datasetBinding:'unused'})
const object=interrupted.objects[0]
await store.storagePrepare(object.metadata)
await store.storageChunk(object.metadata.id,0,object.chunks[0].toString('base64'))
await assert.rejects(store.storageSeal(object.metadata.id))
await assert.rejects(store.storageReadChunk(object.metadata.id,0))
await assert.rejects(store.storageChunk(object.metadata.id,0,Buffer.alloc(object.chunks[0].length,1).toString('base64')))
const restarted=createRuntimeStore({url:keys.url,key:keys.serviceKey,mode:'local'})
for(let i=0;i<object.chunks.length;i++)await restarted.storageChunk(object.metadata.id,i,object.chunks[i].toString('base64'))
await restarted.storageSeal(object.metadata.id)
await restarted.storageChunk(object.metadata.id,0,object.chunks[0].toString('base64'))
await assert.rejects(restarted.storagePrepare({...object.metadata,rawBytes:object.metadata.rawBytes+1}))
// Full free preparation with saved material. Past sources are not relabelled current.
const fixture=await operatingFixture(),storageMethods=Object.fromEntries(Object.keys(store).filter(k=>k.startsWith('storage')).map(k=>[k,store[k]]))
const asOf='2026-11-09T14:00:00Z'
const common=await runOperatingCycle({...fixture,dataset,asOf,calendarByCurrency:automaticReferenceCalendars(dataset,asOf),
 store:{...fixture.store,...storageMethods},verifyStorage:true,
 acquire:async({snapshot})=>{
  const country=saved.prepared.privateCountries.find(c=>c.currency===snapshot.currency)
  return {collection:structuredClone(country.collection),officialBackground:structuredClone(country.officialBackground),completedAt:asOf}
 },send:()=>{throw Error('provider_forbidden_in_storage_test')}})
assert.equal(common.modelCalls,0);assert.equal(common.status,'storage_verified');assert.equal(fixture.state.batch,null)
// Authenticated readers and admins must not access raw storage RPCs.
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}
const anon=createClient(keys.url,keys.anonKey,options)
const accounts=JSON.parse(await fs.readFile('../latamfx-main-verify/.local-reports/private/local-db/accounts.json','utf8'))
const permissionResults=[]
for(const [role,account] of [['anon',null],['reader',accounts.reader],['admin',accounts.admin]]){
 const client=account?createClient(keys.url,keys.anonKey,options):anon
 if(account){const login=await client.auth.signInWithPassword(account);assert.equal(login.error,null)}
 for(const [name,args] of [['currency_report_storage_inspect',{p_ids:[object.metadata.id]}],
  ['prepare_currency_report_storage_object',{p_meta:object.metadata}],['put_currency_report_storage_chunk',{p_id:object.metadata.id,p_index:0,p_data:object.chunks[0].toString('base64')}],
  ['read_currency_report_storage_chunk',{p_id:object.metadata.id,p_index:0}],['seal_currency_report_storage_object',{p_id:object.metadata.id}],
  ['record_currency_report_storage_incident',{p_stage:'write',p_reason:'synthetic',p_healthy:false}]]){
  const result=await client.rpc(name,args);assert.ok(result.error,role+':'+name);permissionResults.push(role+':'+name+':denied')
 }
 if(role==='admin'){
  await store.storageIncident({stage:'write',reason:'synthetic_storage_verification',healthy:false,stats:{rawBytes:123,secret:'MUST_NOT_APPEAR'}})
  const first=await client.rpc('currency_report_review_inbox');assert.equal(first.error,null)
  const a=first.data.items.find(i=>i.reason.includes('synthetic_storage_verification'));assert.ok(a)
  await store.storageIncident({stage:'write',reason:'synthetic_storage_verification',healthy:false,stats:{rawBytes:124}})
  const second=await client.rpc('currency_report_review_inbox'),b=second.data.items.find(i=>i.id===a.id)
  assert.equal(b.version,a.version)
  const target=await client.rpc('currency_report_review_target',{p_kind:'incident',p_id:a.id,p_version:a.version})
  assert.equal(target.data.state,'current');assert.equal(target.data.item.target_id,a.id)
  assert.ok(!JSON.stringify(first.data).includes('MUST_NOT_APPEAR'))
  await storeOperatingInput(encoded,store) // verified recovery, not a dismiss button
  await store.storageIncident({stage:'write',healthy:true})
  const resolved=await client.rpc('currency_report_review_target',{p_kind:'incident',p_id:a.id,p_version:a.version})
  assert.equal(resolved.data.state,'resolved_or_unavailable')
 }
}
// The old saved full input itself must round-trip, independent of combined replay.
const oldEncoded=encodeOperatingInput(saved)
assert.equal(fingerprint(await decodeOperatingInput(oldEncoded.manifest,async(o,i)=>oldEncoded.objects.find(x=>x.role===o.role).chunks[i])),fingerprint(saved))
const result={status:'isolated_storage_verified',checkedAt:new Date().toISOString(),providerCalls:0,productionChanges:0,
 real:{fxBaseDate:dataset.baseDate,preparedBaseDate:saved.prepared.asOf,description:'Saved six-country material plus full Nov9 FX; not fresh source eligibility or AI quality',
 oldDuplicateBytes:Buffer.byteLength(JSON.stringify(payload))+Buffer.byteLength(JSON.stringify(JSON.stringify(payload)))+64,
 ...encoded.stats,newBytes:before.newBytes,reusedBytes:after.reusedBytes,roundTripMs:realMs,payloadHash:encoded.manifest.payloadHash},
 syntheticGrowth:large.stats,commonPipeline:{status:common.status,rows:common.rows,storage:common.storage,modelCalls:0},
 permissions:permissionResults,maxIndividualRpcMs:Math.max(...timings.map(t=>t.ms)),peakRssBytes:process.resourceUsage().maxRSS*1024,
 legacyHashPreserved:true,originalCostPreserved:true,incidentDedupAndResolve:true}
assert.ok(result.maxIndividualRpcMs<15000)
await fs.mkdir('.local-reports/private/frozen-storage-20261110',{recursive:true})
await fs.writeFile('.local-reports/private/frozen-storage-20261110/verification.json',JSON.stringify(result,null,2))
console.log(JSON.stringify(result))
