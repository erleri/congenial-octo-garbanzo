import {it,expect} from 'vitest'
import {operatingFixture} from './operating-fixture.js'
import {runOperatingCycle} from './operating-cycle.js'
import {planAutomaticSupply} from './automatic-supply-plan.js'
import {operatingMaterialHash,newOfficialMaterialCandidates,savedSourceReview} from './operating-source-cache.js'

// Stage-5 adversarial protocol checks. All calls/responses are synthetic;
// these are not extra economic quality samples or real provider executions.
it('preserves each country preparation hold through cached review execution while allowing the other five countries',async()=>{
 const baseline=await operatingFixture()
 await runOperatingCycle({...baseline,execute:true})
 for(const currency of ['BRL','MXN','COP','PEN','CLP','ARS']){
  const f=await operatingFixture(),acquire=f.acquire
  // Exercise production case identity against an in-memory store. Transport
  // remains synthetic and never contacts a provider or any database.
  f.testOnly=false
  f.state.sourceCache=structuredClone(baseline.state.sourceCache)
  f.acquire=async args=>({...await acquire(args),...(args.snapshot.currency===currency?{completedAt:'2026-10-01T00:00:00Z'}:{})})
  const plan=await runOperatingCycle({...f,execute:false})
  expect(plan.rows.find(r=>r.currency===currency)?.holds).toContain('source_acquisition_failed')
  const executed=await runOperatingCycle({...f,execute:true})
  expect(executed.rows.find(r=>r.currency===currency)).toMatchObject({status:'country_preparation_hold',modelCalls:0,runId:null})
  expect(f.store.drafts.map(d=>d.candidate.currency)).not.toContain(currency)
  expect(f.store.drafts).toHaveLength(5)
  expect([...f.state.cases.values()].some(c=>c.currency===currency)).toBe(false)
  f.acquire=acquire
  const recovered=await runOperatingCycle({...f,execute:true})
  expect(recovered.rows.find(r=>r.currency===currency)).toMatchObject({status:'pending_admin_review',modelCalls:2})
  expect(recovered.rows.filter(r=>r.currency!==currency).every(r=>r.modelCalls===0)).toBe(true)
  expect(f.store.drafts).toHaveLength(6)
 }
},20000)

it('budgets only new article calls and preserves cached holds and damaged-cache rejection without resending sources',async()=>{
 const baseline=await operatingFixture()
 await runOperatingCycle({...baseline,execute:true})
 const f=await operatingFixture()
 f.state.sourceCache=structuredClone(baseline.state.sourceCache)
 const acquire=async args=>({...await f.acquire(args),savedSourceReviews:f.state.sourceCache.filter(r=>r.currency===args.snapshot.currency).map(r=>r.review)})
 const plan=await planAutomaticSupply({...f,policy:f.state.policy,acquire})
 expect(plan.sourceMaximumUsd).toBe(0);expect(plan.maxCalls).toBe(12)
 expect(plan.sourcePlans).toHaveLength(0)
 expect(plan.maximumUsd).toBe(3) // Conservative writer/reviewer ceiling, not actual cost.
 const executed=await runOperatingCycle({...f,execute:true})
 expect(executed.modelCalls).toBe(12)
 expect(f.state.posts.some(name=>name.startsWith('original_news_'))).toBe(false)
 expect(f.store.drafts).toHaveLength(6)
 const card=f.collections.CLP.reviewQueue[0],held={cardBinding:card.binding,heldStatus:'source_card_hold',holds:['unsupported_claim']}
 expect(savedSourceReview([held],card)).toEqual(held)
 expect(()=>savedSourceReview([held,held],card)).toThrow('ambiguous_saved_review')
 expect(()=>savedSourceReview([{cardBinding:card.binding,receipt:{cardBinding:'wrong'}}],card)).toThrow('saved_review_binding_changed')
})

it('keeps official-material identity stable across row order but changes it for values, definitions and editions',()=>{
 const stats=['a','b'].map((seriesId,i)=>({seriesId,definitionId:seriesId,definitionVersion:'synthetic/1',period:'2026-09',value:i+1,
  scope:{comparison:'year_over_year'},release:{url:`https://example.org/${seriesId}`,sha256:seriesId,publishedOn:'2026-10-31'}}))
 const identity=admitted=>operatingMaterialHash({collection:{originals:[]},officialBackground:{admission:{admitted,rows:[]}}})
 expect(identity([...stats].reverse())).toBe(identity(stats))
 for(const patch of [{value:42},{definitionVersion:'synthetic/2'},{release:{...stats[0].release,sha256:'revised'}}]){
  expect(identity([{...stats[0],...patch},stats[1]])).not.toBe(identity(stats))
 }
})

it('retains a same-day date-only official release for investigation without treating it as an approved new event',()=>{
 const statistic={seriesId:'a',definitionId:'a',period:'2026-09',value:1,scope:{comparison:'year_over_year'},
  release:{url:'https://example.org/a',sha256:'a',publishedOn:'2026-10-31'}}
 const publication={state:'published',approved:true,withdrawn:false,publishedAt:'2026-10-31T01:00:00Z',materialEditions:[]}
 const candidates=newOfficialMaterialCandidates({admitted:[statistic]},[publication])
 expect(candidates).toHaveLength(1)
 expect(newOfficialMaterialCandidates({admitted:[statistic]},[{...publication,materialEditions:candidates}])).toHaveLength(0)
 expect(newOfficialMaterialCandidates({admitted:[{...statistic,release:{...statistic.release,publishedOn:'2026-10-30'}}]},[publication])).toHaveLength(0)
 expect(candidates[0]).not.toHaveProperty('publicationApproved',true)
})
