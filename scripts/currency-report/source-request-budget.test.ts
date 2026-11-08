import {it,expect,vi} from 'vitest'
import fs from 'node:fs'
import {sourceAttemptMinimum,allocateSourceRequests,automaticSourceRequestLimit} from './source-request-budget.js'
import {collectionDiagnostics} from './collection-diagnostics.js'
import {runtimeFixture} from './runtime-fixture.js'
import {acquireRuntimeResearch} from './runtime-supply.js'
import {fetchLocalSourceDiscovery} from './local-source-discovery.js'

it('reserves discovery plus one article without raising an explicit small budget or exceeding the free ceiling',()=>{
 const minimums=[2,6,2,3,4,4],weights=minimums.map(()=>1)
 const limit=automaticSourceRequestLimit(minimums)
 expect(limit).toBe(21)
 expect(allocateSourceRequests({minimums,weights,maxNetworkRequests:limit})).toEqual({limits:minimums,minimumCoverage:true,minimumRequired:21})
 const capped=allocateSourceRequests({minimums,weights,maxNetworkRequests:16})
 expect(capped.minimumCoverage).toBe(false);expect(capped.limits.reduce((a,b)=>a+b,0)).toBe(16)
 expect(automaticSourceRequestLimit(Array(10).fill(6))).toBe(32)
 expect(()=>allocateSourceRequests({minimums,weights,maxNetworkRequests:33})).toThrow('source_request_budget_invalid')
 expect(sourceAttemptMinimum({kind:'news_listing',access:{indexUrl:'registered-index',sitemapUrl:'registered-sitemap'}})).toBe(6)
 expect(allocateSourceRequests({minimums:[4,4,3],weights:[2,1,1],maxNetworkRequests:16}).limits).toEqual([8,4,4])
})

it('uses registered route depth through the automatic PEN path and keeps caller budgets explicit, with no model or evidence approval',async()=>{
 const sourcePlan=JSON.parse(fs.readFileSync('docs/2.0/six-currency-explanation-sources-20261027.json','utf8'))
 const sourceRegister=JSON.parse(fs.readFileSync('docs/2.0/six-currency-source-register-20261027.json','utf8'))
 const f=runtimeFixture('PEN'),fetchImpl=vi.fn(()=>{throw Error('no_saved_mode_network')})
 const args={snapshot:f.task.snapshot,asOf:'2026-10-28T12:00:00Z',commentaryTarget:{date:'2026-10-27',basis:'test_search_target'},
  sourcePlan,sourceRegister,mode:'saved',fetchImpl}
 const automatic=await acquireRuntimeResearch(args)
 expect(automatic.collection.sourceBudgetCoverage).toMatchObject({minimumCoverage:true,minimumRequired:21,maxNetworkRequests:21})
 expect(automatic.collection.sourceRequestBudgets.find(r=>r.sourceId==='pen-revistaeconomia').limit).toBe(6)
 const explicit=await acquireRuntimeResearch({...args,maxNetworkRequests:16})
 expect(explicit.collection.sourceBudgetCoverage).toMatchObject({minimumCoverage:false,maxNetworkRequests:16})
 expect(fetchImpl).not.toHaveBeenCalled();expect(automatic.collection.modelCalls).toBe(0)
 expect(automatic.collection.publicationApproved).toBe(false)
})

it('preserves local request exhaustion separately from a transport failure in the publisher adapter',async()=>{
 const budget=await fetchLocalSourceDiscovery({currency:'CLP',baseDate:'2026-11-08',fetchImpl:async()=>{throw Error('local_source_request_limit')}})
 expect(budget.sourceResults.every(s=>s.issues.every(i=>i.reason==='source_request_budget'))).toBe(true)
 const network=await fetchLocalSourceDiscovery({currency:'CLP',baseDate:'2026-11-08',fetchImpl:async()=>{throw Error('connection_failed')}})
 expect(network.sourceResults.every(s=>s.issues.every(i=>i.reason==='network_or_timeout'))).toBe(true)
})

it('deduplicates question/date diagnostics, retains paywall detail and never treats a missing candidate as proven absence',()=>{
 const row={sourceId:'registered-publisher',period:'2026-11-06',status:'access_failed',reason:'publisher_paywall',originalIds:[],
  issues:[{status:'access_failed',reason:'publisher_paywall'}]}
 const result=collectionDiagnostics({networkCalls:4,outcomes:[row,row,{...row,period:'2026-11-05'},
  {sourceId:'budgeted-publisher',period:'2026-11-06',status:'not_attempted',reason:'source_request_budget',originalIds:[]},
  {sourceId:'working-publisher',period:'2026-11-06',status:'collected_pending_review',reason:null,originalIds:['a']},
  {sourceId:'working-publisher',period:'2026-11-05',status:'no_candidates_in_listing',reason:'no_candidates_in_attempt',originalIds:[]}]})
 expect(result.lookupFailures).toHaveLength(1)
 expect(result.lookupFailures[0].requestedPeriods).toEqual(['2026-11-06','2026-11-05'])
 expect(result.collectionGaps.map(g=>g.category)).toEqual(['access_failure','request_budget','no_matching_candidate'])
 expect(result.sourceCoverage.find(s=>s.sourceId==='working-publisher')).toMatchObject({collectedOriginals:1,contentReviewed:false})
 expect(result.contentQualityEvaluated).toBe(false);expect(result.publicationApproved).toBe(false)
})
