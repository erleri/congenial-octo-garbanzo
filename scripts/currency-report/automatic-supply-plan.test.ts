import {it,expect,vi} from 'vitest'
import fs from 'node:fs'
import {runtimeFixture} from './runtime-fixture.js'
import {planAutomaticSupply} from './automatic-supply-plan.js'
import {proposeOperatingPolicy} from './operating-batch-plan.js'

it('plans every due country from the registered acquisition adapter, isolates a failed country and never activates or spends',async()=>{
 const currencies=['BRL','MXN','COP','PEN','CLP','ARS'],examples=currencies.map(c=>runtimeFixture(c))
 const dataset={...examples[0].dataset,dailyRates:examples.flatMap(f=>f.dataset.dailyRates)},asOf='2026-11-01T04:00:00Z'
 const sourcePlan=JSON.parse(fs.readFileSync('docs/2.0/six-currency-explanation-sources-20261027.json','utf8'))
 const sourceRegister=JSON.parse(fs.readFileSync('docs/2.0/six-currency-source-register-20261027.json','utf8'))
 const processingRules=JSON.parse(fs.readFileSync('docs/2.0/material-processing-rules.json','utf8'))
 const registry=JSON.parse(fs.readFileSync('docs/2.0/original-news-source-policy-20261028.json','utf8'))
 const acquire=vi.fn(async args=>{
  if(args.snapshot.currency==='BRL')throw Error('synthetic_collection_failure')
  return {collection:{version:'selected-source-collection/1',currency:args.snapshot.currency,asOf,
   originals:[],reviewQueue:[],outcomes:[]},completedAt:'2026-11-01T04:00:03Z'}
 })
 const store={history:async()=>[],control:async()=>({enabled:false,review_enabled:false,writer:'sol',monthly_limit_nano:0})}
 const result=await planAutomaticSupply({dataset,asOf,calendarByCurrency:Object.fromEntries(examples.map(f=>[f.currency,f.calendar])),store,
  policy:proposeOperatingPolicy({sourcePlan,sourceRegister,processingRules}),sourcePlan,sourceRegister,registry,processingRules,acquire})
 expect(acquire).toHaveBeenCalledTimes(6)
 expect(result.asOf).toBe('2026-11-01T04:00:03Z')
 expect(result.collectionResults[0]).toMatchObject({currency:'BRL',status:'collection_or_history_failed'})
 expect(result.collectionResults.slice(1).every(r=>r.status==='collection_returned_not_approved')).toBe(true)
 expect(result.rows[0].holds).toContain('source_acquisition_failed')
 expect(result.authorizationCandidate.authorized).toBe(false)
 expect(result).toMatchObject({standingPolicyActivated:false,modelCalls:0,publicationApproved:false})
 expect(acquire.mock.calls.every(([args])=>args.mode==='saved')).toBe(true)
})
