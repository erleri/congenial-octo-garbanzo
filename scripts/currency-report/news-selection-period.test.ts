import {it,expect,vi} from 'vitest'
import {originalPipelineFixture} from './original-news-pipeline-fixture.js'
import {prepareOriginalNewsCase,completeOriginalNewsReview,inspectExtractedNews} from './original-news-pipeline.js'
import {admitRuntimeNotes} from './runtime-note-material.js'
import {fingerprint} from './research-harness.js'
import {runtimeFixture} from './runtime-fixture.js'
import {supplyRuntimeInput,latestReviewedMarketPeriod} from './runtime-supply.js'
import {discoverRegisteredNews} from './registered-material-adapters.js'
import {researchFeedback,sourceContinuation} from './research-continuation.js'
import {assertSharedPacket} from './shared-writing-contract.js'
import {sharedCoverageRequirements} from './shared-input-policy.js'
import {validMarketPeriod} from './news-period.js'
import {evaluateRules} from './rules.js'
import {syntheticCase,syntheticLedger} from './rule-fixtures.js'
import {sealSharedPacket} from './shared-writing-contract.js'

it('selects explanatory discovery hints ahead of price-only rows even with legacy rejected URL feedback',()=>{
 const base='https://rpp.pe/economia',cause=base+'/economia/dolar-en-peru-a-que-se-debe-noticia-1234567'
 const price=base+'/economia/precio-del-dolar-peru-hoy-noticia-1234568'
 const html=`<a href="${price}">Precio del dólar Perú y tipo de cambio hoy</a><a href="${cause}">Dólar en Perú sube: ¿a qué se debe?</a>`
 const result=discoverRegisteredNews(html,base,'PEN',{sourceId:'pen-rpp',limit:1,deprioritizeUrls:[cause]})
 expect(result.candidates.map(c=>c.url)).toEqual([cause])
 expect(result.absenceVerified).toBe(false)
 const feedback=researchFeedback([{original:{url:cause},review:{heldStatus:'original_pipeline_failed',holds:['invalid_original_comparison']}}])
 expect(feedback.deprioritizeUrls).toEqual([])
 expect(feedback.preservedForReviewUrls).toEqual([cause])
})

it('keeps collection/access/period/output/content/capacity problems distinct from proven news absence',()=>{
 const cases={saved_capture_missing:'capture',publisher_paywall:'access',market_period_outside_research_window:'period',
  invalid_original_comparison:'output',insufficient_information:'content',source_request_budget:'capacity'}
 for(const [reason,category] of Object.entries(cases))expect(sourceContinuation({reason})).toMatchObject({category,paidCallAuthorized:false,automaticRetry:false})
})

it('carries independently compared period evidence through the shared pool and writer without inventing a session or sending original quote text',async()=>{
 const f=await originalPipelineFixture('period-fixture',false,true),before=fingerprint(f.collection),plan=prepareOriginalNewsCase(f)
 const reviewed=completeOriginalNewsReview({...f,plan})
 expect(reviewed.status).toBe('source_card_prepared')
 const {resourceId,resourceBinding,...template}=f.sourceUse.reviews[0];void resourceId;void resourceBinding
 const p={sourceId:f.card.sourceId,currency:'COP',origin:new URL(f.url).origin,pathPrefix:'/finanzas/',materialKind:'independently_authored_facts_and_attributed_views',
  status:'reviewed',checkedOn:f.checkedOn,reviewedUse:template}
 const registry={version:'runtime-note-use-policies/1',policies:[{...p,binding:fingerprint(p)}]}
 const material=admitRuntimeNotes({...f,reviewed,asOf:'2026-10-28T12:00:00Z',registry})
 expect(material.packet.evidence[0]).toMatchObject({eventDate:null,period:'2026-10-20/2026-10-26'})
 const stage=vi.fn(async()=> 'synthetic-period-input'),fx=runtimeFixture('COP')
 const result=await supplyRuntimeInput({...fx,handoff:undefined,commentaryTarget:{date:'2026-10-26',basis:'synthetic'},sourcePlan:f.sourcePlan,sourceRegister:f.sourceRegister,
  store:{stage},acquire:async()=>({collection:f.collection,sources:[f.card.sourceId],networkCalls:0}),
  review:async()=>({receipts:[reviewed.receipt],materialInputs:[{cardBinding:f.card.binding,input:material}],items:[],modelCalls:0,newPaidCostUsd:0})})
 expect(result.status,JSON.stringify(result)).toBe('input_staged')
 expect(stage).toHaveBeenCalledTimes(1)
 const packet=result.task.plan.packet,input=JSON.parse(result.task.plan.body.messages[1].content)
 expect(packet.sharedReference.commentaryPeriod).toEqual({kind:'week',start:'2026-10-20',end:'2026-10-26'})
 expect(packet.evidence.every(e=>e.eventDate===null)).toBe(true)
 expect(input.commentaryPeriod.kind).toBe('week')
 expect(JSON.stringify(input)).not.toContain(f.candidate.marketPeriod.quote)
 expect(sharedCoverageRequirements(packet).some(r=>r.id==='shared_market_period'&&r.required)).toBe(true)
 expect(()=>assertSharedPacket(packet)).not.toThrow()
 const content=syntheticCase('COP').content
 const inspect=p=>evaluateRules({packet:p,content,ledger:syntheticLedger(p,content),safety:{valid:true,errors:[]}}).checks.filter(c=>c.ruleId==='R04'&&c.status==='hold')
 expect(inspect(packet)).toEqual([])
 const changed=structuredClone(packet);changed.evidence[0].marketPeriod.end='2026-10-25'
 expect(inspect(sealSharedPacket(changed)).length).toBeGreaterThan(0)
 const missing=structuredClone(packet);delete missing.sharedReference.commentaryPeriod
 expect(inspect(sealSharedPacket(missing)).length).toBeGreaterThan(0)
 expect(result.modelCalls).toBe(0);expect(fingerprint(f.collection)).toBe(before)
})

it('holds ungrounded/future/nonmatching periods and independent comparison disagreement; never promotes a quote-only or mixed price group',async()=>{
 expect(validMarketPeriod({kind:'month',start:'2026-10-01',end:'2026-10-31'})).toBe(true)
 expect(validMarketPeriod({kind:'month',start:'2026-10-01',end:'2026-10-30'})).toBe(false)
 expect(validMarketPeriod({kind:'month',start:'2026-10-01',end:'2026-11-30'})).toBe(false)
 const f=await originalPipelineFixture('period-negative',false,true),plan=prepareOriginalNewsCase(f)
 for(const patch of [{quote:'not in supplied original'},{end:'2026-11-30'},{start:'2026-10-01'}]){
  expect(()=>inspectExtractedNews(plan.job,{...f.candidate,marketPeriod:{...f.candidate.marketPeriod,...patch}})).toThrow()
 }
 expect(()=>completeOriginalNewsReview({...f,plan,comparison:{...f.comparison,marketPeriod:{...f.comparison.marketPeriod,end:'2026-10-25'}}})).toThrow('invalid_original_comparison')
 const material=(role:string,basis='wholesale')=>({input:{materials:[{record:{sessionDate:null,marketPeriod:f.candidate.marketPeriod,priceBasis:basis,claimRoles:{a:role}}}]}})
 for(const currency of ['BRL','MXN','COP','PEN','CLP','ARS']){
  const args={currency,asOf:'2026-10-28T12:00:00Z',requestedDates:['2026-10-26'],allowed:true}
  expect(latestReviewedMarketPeriod({...args,materialInputs:[material('market_observation')]})).toBeNull()
  expect(latestReviewedMarketPeriod({...args,materialInputs:[material('market_observation'),material('attributed_fx_explanation','ccl')]})).toBeNull()
  expect(latestReviewedMarketPeriod({...args,materialInputs:[material('market_observation','not_stated'),material('attributed_fx_explanation','not_stated')]})).toBeNull()
  expect(latestReviewedMarketPeriod({...args,materialInputs:[material('market_observation'),material('attributed_fx_explanation')]})).toEqual(f.candidate.marketPeriod)
  expect(latestReviewedMarketPeriod({...args,allowed:false,materialInputs:[material('market_observation'),material('attributed_fx_explanation')]})).toBeNull()
 }
})
