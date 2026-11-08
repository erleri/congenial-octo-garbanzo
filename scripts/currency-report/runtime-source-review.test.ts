import {it,expect,vi} from 'vitest'
import {originalPipelineFixture} from './original-news-pipeline-fixture.js'
import {bindOriginalUsePolicy} from './original-news-use-policy.js'
import {reviewRuntimeSources} from './runtime-source-review.js'
import {admitRuntimeNotes} from './runtime-note-material.js'
import {fingerprint} from './research-harness.js'
import {completeOriginalNewsReview,prepareOriginalNewsCase} from './original-news-pipeline.js'
import {supplyRuntimeInput} from './runtime-supply.js'
import {runtimeFixture} from './runtime-fixture.js'
import {collectionAtReviewCutoff} from './selected-source-collection.js'

async function example(){
 const f=await originalPipelineFixture()
 const {resourceId,resourceBinding,...template}=f.sourceUse.reviews[0]
 void resourceId;void resourceBinding
 const policy={version:'original-news-use-policy/1',id:'synthetic-original',sourceId:f.card.sourceId,currency:'COP',
  origin:new URL(f.url).origin,pathPrefix:'/finanzas/',materialKind:'publisher_article_text',status:'reviewed',checkedOn:f.checkedOn,
  reason:'Synthetic offline source policy, not a permission for the real newspaper.',thirdParty:'hold_on_credited_origin',reviewedUse:template}
 const registry={version:'original-news-use-policy/1',policies:[bindOriginalUsePolicy(policy)]}
 return {...f,registry}
}
it('does not invoke an original reviewer when the publisher/material policy is absent',async()=>{
 const f=await example(),extract=vi.fn(),compare=vi.fn()
 const r=await reviewRuntimeSources({...f,asOf:'2026-10-29T02:00:00Z',registry:{version:'original-news-use-policy/1',policies:[]},extract,compare})
 expect(extract).not.toHaveBeenCalled();expect(compare).not.toHaveBeenCalled()
 expect(r.items[0]).toMatchObject({status:'original_use_or_input_hold'})
 expect(r).toMatchObject({modelCalls:0,newPaidCostUsd:0})
})
it('keeps unreviewed candidates explicitly pending in saved-only inspection and never grants them a receipt',async()=>{
 const f=await example(),extract=vi.fn(),compare=vi.fn()
 const result=await reviewRuntimeSources({...f,asOf:'2026-10-29T02:00:00Z',onlySaved:true,extract,compare})
 expect(result).toMatchObject({modelCalls:0,newPaidCostUsd:0,receipts:[],materialInputs:[]})
 expect(result.items[0].status).toBe('pending_original_review_not_admitted')
 expect(extract).not.toHaveBeenCalled();expect(compare).not.toHaveBeenCalled()
})
it('keeps two separately bound original stages and stops when their cost becomes unknown',async()=>{
 const f=await example(),compare=vi.fn()
 const r=await reviewRuntimeSources({...f,asOf:'2026-10-29T02:00:00Z',
  extract:async request=>({generationCalls:1,costUsd:null,requestHash:request.requestHash,output:f.candidate}),
  compare,admitNotes:vi.fn()})
 expect(r.status).toBe('source_cost_unresolved');expect(r.newPaidCostUsd).toBeNull();expect(compare).not.toHaveBeenCalled()
})
it('uses the new analysis cutoff for saved captures while preserving source times and rejecting genuinely future material',async()=>{
 const f=await example(),asOf='2026-10-29T02:00:00Z',before=fingerprint(f.collection)
 const times:Array<{asOf:string;collectedAt:string;collectionCutoffRelation:string}>=[]
 await reviewRuntimeSources({...f,asOf,extract:async r=>{times.push(JSON.parse(r.body.messages[1].content).time);return {generationCalls:1,costUsd:0,requestHash:r.requestHash,output:f.candidate}},
  compare:async r=>{times.push(JSON.parse(r.body.messages[1].content).time);return {generationCalls:1,costUsd:0,requestHash:r.requestHash,output:f.comparison}},admitNotes:async()=>null})
 expect(times).toHaveLength(2)
 expect(times.every(t=>t.asOf===asOf&&t.collectedAt===f.collection.originals[0].collectedAt&&t.collectionCutoffRelation==='by_cutoff')).toBe(true)
 expect(fingerprint(f.collection)).toBe(before)
 expect(()=>collectionAtReviewCutoff({collection:f.collection,asOf:'2026-10-26T00:00:00Z'})).toThrow('source_review_cutoff_before_available_capture')
})
it('preserves known call costs when the later local note bridge fails, and reports a separate input hold',async()=>{
 const f=await example(),extract=async request=>({generationCalls:1,costUsd:.01,requestHash:request.requestHash,responseId:'synthetic-extract',output:f.candidate})
 const compare=async request=>({generationCalls:1,costUsd:.01,requestHash:request.requestHash,responseId:'synthetic-compare',output:f.comparison})
 const r=await reviewRuntimeSources({...f,asOf:'2026-10-29T02:00:00Z',extract,compare,admitNotes:()=>{throw Error('local_note_binding_failed')}})
 expect(r).toMatchObject({modelCalls:2,newPaidCostUsd:.02,status:'source_reviews_returned'})
 expect(r.items[0]).toMatchObject({status:'source_review_hold',holds:['local_note_binding_failed']})
})
it('maps separately compared notes through a note policy without granting raw text or publication permission',async()=>{
 const f=await example(),plan=prepareOriginalNewsCase(f)
 const reviewed=completeOriginalNewsReview({...f,plan})
 expect(admitRuntimeNotes({...f,reviewed,asOf:'2026-10-29T02:00:00Z',registry:{version:'runtime-note-use-policies/1',policies:[]}})).toBeNull()
 const {resourceId,resourceBinding,...template}=f.sourceUse.reviews[0];void resourceId;void resourceBinding
 const p={sourceId:f.card.sourceId,currency:'COP',origin:new URL(f.url).origin,pathPrefix:'/finanzas/',
  materialKind:'independently_authored_facts_and_attributed_views',status:'reviewed',checkedOn:f.checkedOn,reviewedUse:template}
 const material=admitRuntimeNotes({...f,reviewed,asOf:'2026-10-29T02:00:00Z',registry:{version:'runtime-note-use-policies/1',policies:[{...p,binding:fingerprint(p)}]}})
 expect(material.materials[0].record.claimRoles).toEqual({'claim-n0':'market_observation','claim-n1':'attributed_fx_explanation'})
 expect(JSON.stringify(material)).not.toContain('El dólar subió en el mercado')
 expect(material.sourceUse.reviews[0].uses.public_display.status).toBe('pending')
 const global=structuredClone(reviewed);global.assessment.claimScopes[1].causalScope='global'
 expect(admitRuntimeNotes({...f,reviewed:global,asOf:'2026-10-29T02:00:00Z',registry:{version:'runtime-note-use-policies/1',policies:[{...p,binding:fingerprint(p)}]}}).materials[0].record.claimRoles['claim-n1']).toBe('global_context')
})
it('automatically connects two original review stages to a current shared-price writer input',async()=>{
 const f=await example(),fx=runtimeFixture('COP')
 const {resourceId,resourceBinding,...template}=f.sourceUse.reviews[0];void resourceId;void resourceBinding
 const p={sourceId:f.card.sourceId,currency:'COP',origin:new URL(f.url).origin,pathPrefix:'/finanzas/',
  materialKind:'independently_authored_facts_and_attributed_views',status:'reviewed',checkedOn:f.checkedOn,reviewedUse:template}
 const notePolicies={version:'runtime-note-use-policies/1',policies:[{...p,binding:fingerprint(p)}]}
 const stage=vi.fn(async()=> 'synthetic-bound-input')
 const result=await supplyRuntimeInput({...fx,handoff:undefined,commentaryTarget:{date:'2026-10-26',basis:'synthetic explicit research date'},
  sourcePlan:f.sourcePlan,sourceRegister:f.sourceRegister,store:{stage},
  acquire:async()=>({collection:f.collection,sources:[f.card.sourceId],networkCalls:0}),
  review:async({collection,asOf})=>reviewRuntimeSources({collection,asOf,registry:f.registry,
   extract:async request=>({generationCalls:1,costUsd:.01,requestHash:request.requestHash,responseId:'synthetic-extract',output:f.candidate}),
   compare:async request=>({generationCalls:1,costUsd:.01,requestHash:request.requestHash,responseId:'synthetic-compare',output:f.comparison}),
   admitNotes:args=>admitRuntimeNotes({...args,registry:notePolicies})})})
 expect(result).toMatchObject({status:'input_staged',modelCalls:2,newPaidCostUsd:.02,publicationApproved:false})
 expect(stage).toHaveBeenCalledTimes(1)
 expect(result.task.plan.body.model).toBe('openai/gpt-6.1-sol')
 expect(result.task.plan.packet.facts.find(f=>f.id==='spot').value).toBe(fx.task.snapshot.current.value)
 expect(JSON.stringify(result.task.plan.body)).not.toContain('El dólar subió en el mercado')
})
