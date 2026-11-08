import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { runLocalTrial } from './run-event-trial.js'
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
function trial() {
  const packet={currency:'BRL',baseDate:'2026-10-09',observedDate:'2026-10-09'}
  const body={model:'anthropic/claude-sonnet-5.5',max_tokens:8192,messages:[],reasoning:{effort:'medium'},provider:{only:['google-vertex/global'],allow_fallbacks:false,zdr:true,data_collection:'deny',require_parameters:true}}
  const plan={status:'prepared_not_called',currency:packet.currency,baseDate:packet.baseDate,packetHash:hash(packet),body,requestHash:hash(body),maximumUsd:.2,timeoutMs:120000,retries:0}
  return {packet,plan,approval:{authorized:true,planHash:hash(plan),budgetUsd:.75}}
}
describe('durable local trial reservation',()=>{
  it('preserves an uncertain expense and blocks the next transport before any connection',async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'latamfx-trial-reservation-')),data=trial()
    const result=await runLocalTrial({root,data,apiKey:'test-key',invoke:async({claim}:{claim:(v:unknown)=>Promise<void>})=>{
      await claim({currency:data.plan.currency,baseDate:data.plan.baseDate,requestHash:data.plan.requestHash,reservedUsd:.2})
      return {status:'cost_unresolved',costUsd:null,reservedUsd:.2}
    }})
    expect(result.costUsd).toBeNull()
    const journal=JSON.parse(await fs.readFile(path.join(root,'journal.json'),'utf8'))
    expect(journal[0]).toMatchObject({status:'cost_unresolved',costUsd:null,reservedUsd:.2})
    await expect(runLocalTrial({root,data,apiKey:'test-key'})).rejects.toThrow('duplicate_limit_or_unresolved_cost')
    expect(JSON.parse(await fs.readFile(path.join(root,'journal.json'),'utf8'))).toEqual(journal)
  })
  it('allows only one concurrent campaign owner and releases the lock after failure',async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'latamfx-trial-lock-')),data=trial()
    let entered!:()=>void,release!:()=>void
    const started=new Promise<void>(r=>{entered=r}),barrier=new Promise<void>(r=>{release=r})
    const running=runLocalTrial({root,data,apiKey:'test-key',invoke:async()=>{entered();await barrier;throw new Error('synthetic_preflight_failure')}})
    await started
    await expect(runLocalTrial({root,data,apiKey:'test-key'})).rejects.toThrow('trial_already_running_or_interrupted')
    release()
    await expect(running).rejects.toThrow('synthetic_preflight_failure')
    await expect(fs.stat(path.join(root,'campaign.lock'))).rejects.toMatchObject({code:'ENOENT'})
  })
})
