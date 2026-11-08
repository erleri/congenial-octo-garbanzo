import {describe,it,expect,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {writerProfile,applyWriterPolicy,assertWriterPolicy,inspectWriterEndpoint,writerReservation} from './writer-policy.js'
import {currentCase,writerDraft} from './test-support.js'
import {decodeGenerationOutput} from './generation-wire.js'
import {composeDraft,requestBody} from './openrouter.js'
import {executeEventTrial} from './lifecycle-control.js'
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
function input(){const x=currentCase('CLP');return {...x,request:requestBody(x.packet,'openrouter/free')}}
describe('local common writer selection',()=>{
 it.each(['sol','sonnet','argon'])('keeps the same evidence and full output validation when selecting %s',(selection)=>{
  const x=input(),before=structuredClone(x.request),a=applyWriterPolicy(x.request,selection)
  expect(a.status).toBe('prepared_not_called');expect(a.paidCallAuthorized).toBe(false)
  const sent=JSON.parse(a.body.messages[1].content),source=JSON.parse(x.request.messages[1].content)
  delete sent.outputLayout;expect(sent).toEqual(source)
  const d=writerDraft(x),wire=structuredClone(d)
  for(const [field,{max}]of Object.entries(a.outputContract.sections) as [string,{max:number}][]){
   wire[field]=Object.fromEntries(Array.from({length:max},(_,i)=>[`slot_${i}`,d[field][i]??null]))
  }
  const decoded=decodeGenerationOutput(wire,a.outputContract)
  expect(decoded).toEqual(d);expect(composeDraft(x.packet,decoded,true,true).validation.valid).toBe(true)
  const bad=structuredClone(decoded);bad.drivers[0].evidenceIds=['unknown-source']
  expect(composeDraft(x.packet,bad,true,true).validation.valid).toBe(false)
  expect(a.body.model).toBe(writerProfile(selection).model)
  expect(a.maximumUsd).toBe(writerReservation(a.body,a.profile));expect(x.request).toEqual(before)
 })
 it('uses Sol by default and refuses unregistered models or a weakened profile rather than falling back',()=>{
  const x=input()
  const a=applyWriterPolicy(x.request);expect(a.profile.selection).toBe('sol')
  for(const selection of ['openrouter/free','latest','unknown',null])expect(()=>writerProfile(selection)).toThrow('registered_writer_required')
  for(const provider of [{...a.body.provider,zdr:false},{...a.body.provider,data_collection:'allow'},{...a.body.provider,allow_fallbacks:true},{...a.body.provider,only:['other']}])
   expect(()=>assertWriterPolicy({...a.body,provider},a.profile)).toThrow('writer_policy_changed')
  expect(()=>assertWriterPolicy(a.body,{...a.profile,inputReservation:0})).toThrow('writer_policy_changed')
  expect(()=>applyWriterPolicy({...x.request,plugins:[{id:'web'}]})).toThrow('structured_writer_request_required')
 })
 it('holds oversized input and checks saved endpoint fixtures for support, ZDR, reasoning and all charge ceilings',()=>{
  const x=input(),a=applyWriterPolicy(x.request),p=a.profile
  const endpoint={tag:p.route,model_id:p.model,status:0,supported_parameters:['reasoning','response_format','structured_outputs',p.outputField],
   max_completion_tokens:9000,context_length:100000,pricing:{prompt:'0.000002',completion:'0.00001',input_cache_write:'0.0000025'}}
  const catalog={data:{endpoints:[endpoint]}},zdr={data:[endpoint]}
  expect(inspectWriterEndpoint(a.body,p,catalog,zdr).modelCalls).toBe(0)
  for(const e of [{...endpoint,supported_parameters:[]},{...endpoint,pricing:{...endpoint.pricing,input_cache_write:'0.000003'}},
    {...endpoint,pricing:{...endpoint.pricing,internal_reasoning:'0.000011'}},{...endpoint,pricing:{...endpoint.pricing,request:'.01'}}])
   expect(()=>inspectWriterEndpoint(a.body,p,{data:{endpoints:[e]}},zdr)).toThrow('writer_endpoint_privacy_support_or_price_hold')
  expect(()=>inspectWriterEndpoint(a.body,p,catalog,{data:[]})).toThrow('writer_endpoint_privacy_support_or_price_hold')
  const big=structuredClone(x.request);big.messages[0].content+='x'.repeat(180000)
  expect(applyWriterPolicy(big).status).toBe('request_budget_hold')
 })
 it('binds a new-model trial to its approval, reservation and one invocation, preserving unresolved cost',async()=>{
  const a=applyWriterPolicy(input().request),plan={version:'event-trial/2',writerProfile:a.profile,status:'prepared_not_called',
   currency:'BRL',baseDate:'2026-10-07',body:a.body,requestHash:hash(a.body),maximumUsd:a.maximumUsd,timeoutMs:120000,retries:0}
  const approval={authorized:true,planHash:hash(plan),budgetUsd:.75},claim=vi.fn(),invoke=vi.fn(async()=>{throw Error('synthetic_transport_loss')})
  const preflight=vi.fn(async()=>({model:a.profile.model,route:a.profile.route,zdr:true,dataCollection:'deny'}))
  const execute=(approvalInput=approval,journal=[])=>executeEventTrial({plan,approval:approvalInput,journal,claim,invoke,preflight})
  await expect(execute({...approval,authorized:false})).rejects.toThrow('separate_bound_paid_approval_required')
  expect(preflight).not.toHaveBeenCalled()
  const r=await execute();expect(r.status).toBe('cost_unresolved');expect(r.reservedUsd).toBe(a.maximumUsd)
  await expect(execute(approval,[r])).rejects.toThrow('duplicate_limit_or_unresolved_cost')
  expect(invoke).toHaveBeenCalledTimes(1);expect(claim).toHaveBeenCalledTimes(1)
 })
})
