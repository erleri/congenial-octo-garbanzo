import {expect,it} from 'vitest'
import {originalPipelineFixture} from './original-news-pipeline-fixture.js'
import {bindOriginalUsePolicy,applyOriginalUsePolicies,ORIGINAL_USE_POLICY_VERSION} from './original-news-use-policy.js'
import {prepareOriginalNewsCase} from './original-news-pipeline.js'

async function policyFixture(){
 const f=await originalPipelineFixture()
 const template=structuredClone(f.sourceUse.reviews[0])
 delete template.resourceId;delete template.resourceBinding
 template.conditions=[{id:'credit-url',text:'합성 정책의 원문 링크를 실제 외부 요청에 포함해야 한다.',status:'satisfied',
   delivery:{field:'sourceUrl',equals:'@sourceUrl',uses:['external_model','public_display']}}]
 template.uses.external_model.conditionIds=['credit-url']
 const policy=bindOriginalUsePolicy({version:ORIGINAL_USE_POLICY_VERSION,id:'synthetic-publisher-original-policy',sourceId:'cop-larepublica',
   currency:'COP',origin:'https://www.larepublica.co',pathPrefix:'/finanzas/',materialKind:'publisher_article_text',status:'reviewed',
   checkedOn:'2026-10-28',reason:'Synthetic policy judgment only, not a real publisher permission.',
   thirdParty:'hold_on_credited_origin',reviewedUse:template,attribution:'Synthetic Publisher - declared test credit, not a real licence.'})
 return {f,policy,registry:{version:ORIGINAL_USE_POLICY_VERSION,policies:[policy]}}
}

it('applies one reviewed material policy to distinct new originals and delivers each actual source link to the model projection',async()=>{
 const {f,registry}=await policyFixture(),other=await originalPipelineFixture('123457'),before=structuredClone(registry)
 const a=applyOriginalUsePolicies({collection:f.collection,registry,evaluatedOn:'2026-10-28'})
 const b=applyOriginalUsePolicies({collection:other.collection,registry,evaluatedOn:'2026-10-28'})
 expect(a.reviews[0].resourceBinding).not.toBe(b.reviews[0].resourceBinding)
 expect(a.policyDecisions[0].status).toBe('allowed');expect(b.policyDecisions[0].status).toBe('allowed')
 const plan=prepareOriginalNewsCase({...f,sourceUse:a})
 expect(plan.status).toBe('prepared_not_called')
 expect(JSON.parse(plan.extraction.body.messages[1].content).sourceCredits[0].sourceUrl).toBe(f.url)
 expect(JSON.parse(plan.extraction.body.messages[1].content).sourceCredits[0].attribution).toBe(registry.policies[0].attribution)
 expect(registry).toEqual(before)
})

it('keeps unknown, pending and third-party exceptions blocked without converting note use into article permission',async()=>{
 const {f,policy}=await policyFixture()
 const empty=applyOriginalUsePolicies({collection:f.collection,registry:{version:ORIGINAL_USE_POLICY_VERSION,policies:[]},evaluatedOn:'2026-10-28'})
 expect(empty.policyDecisions[0]).toMatchObject({status:'pending',reason:'matching_original_policy_missing'})
 const {binding:discarded,...unbound}=policy
 expect(discarded).toBeTruthy()
 const pending=bindOriginalUsePolicy({...unbound,status:'pending',reviewedUse:null})
 const held=applyOriginalUsePolicies({collection:f.collection,registry:{version:ORIGINAL_USE_POLICY_VERSION,policies:[pending]},evaluatedOn:'2026-10-28'})
 expect(held.reviews).toEqual([])
 for(const origin of ['Reuters','Bloomberg']){
  const credited=await originalPipelineFixture('123458',origin)
  const thirdParty=applyOriginalUsePolicies({collection:credited.collection,registry:{version:ORIGINAL_USE_POLICY_VERSION,policies:[policy]},evaluatedOn:'2026-10-28'})
  expect(thirdParty.policyDecisions[0]).toMatchObject({status:'pending',reason:'third_party_exception_requires_review'})
 }
 const notesOnly=bindOriginalUsePolicy({...unbound,materialKind:'reviewer_authored_notes'})
 expect(()=>applyOriginalUsePolicies({collection:f.collection,registry:{version:ORIGINAL_USE_POLICY_VERSION,policies:[notesOnly]},evaluatedOn:'2026-10-28'})).toThrow('material_mismatch')
})

it('rejects altered and overlapping policy records rather than guessing the more permissive one',async()=>{
 const {f,policy}=await policyFixture()
 const altered={...policy,reason:'An edited sentence has not received a new bound policy review.'}
 expect(()=>applyOriginalUsePolicies({collection:f.collection,registry:{version:ORIGINAL_USE_POLICY_VERSION,policies:[altered]},evaluatedOn:'2026-10-28'})).toThrow('binding_or_material')
 const {binding:discarded,...unbound}=policy
 expect(discarded).toBeTruthy()
 const overlap=bindOriginalUsePolicy({...unbound,id:'second-synthetic-policy'})
 const result=applyOriginalUsePolicies({collection:f.collection,registry:{version:ORIGINAL_USE_POLICY_VERSION,policies:[policy,overlap]},evaluatedOn:'2026-10-28'})
 expect(result.policyDecisions[0]).toMatchObject({status:'pending',reason:'ambiguous_source_policy'})
 expect(result.reviews).toEqual([])
})
