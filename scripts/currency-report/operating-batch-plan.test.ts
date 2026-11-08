import {it,expect} from 'vitest'
import fs from 'node:fs'
import {originalPipelineFixture} from './original-news-pipeline-fixture.js'
import {runtimeFixture} from './runtime-fixture.js'
import {proposeOperatingPolicy,prepareOperatingBatch} from './operating-batch-plan.js'
import {fingerprint} from './research-harness.js'
import {oneTimeOperatingPolicy,assertOperatingPolicy,operatingPolicyDraft} from './operating-policy.js'
import {bindSelectedOriginalReview} from './selected-source-collection.js'

async function fixture(){
 const f=await originalPipelineFixture(),asOf='2026-11-01T04:00:00Z'
 const currencies=['BRL','MXN','COP','PEN','CLP','ARS'],examples=currencies.map(c=>runtimeFixture(c))
 const dataset={...examples[0].dataset,dailyRates:examples.flatMap(f=>f.dataset.dailyRates)}
 const countries=examples.map(e=>({currency:e.currency,calendar:e.calendar,collection:e.currency==='COP'?f.collection:
  {version:'selected-source-collection/1',currency:e.currency,asOf,originals:[],reviewQueue:[],outcomes:[]}}))
 const processingRules=JSON.parse(fs.readFileSync('docs/2.0/material-processing-rules.json','utf8'))
 const registry=JSON.parse(fs.readFileSync('docs/2.0/original-news-source-policy-20261028.json','utf8'))
 const config={sourcePlan:f.sourcePlan,sourceRegister:f.sourceRegister,processingRules}
 return {...config,registry,dataset,countries,asOf,publicationsByCurrency:Object.fromEntries(currencies.map(c=>[c,[]])),
  control:{enabled:false,review_enabled:false,writer:'sol',monthly_limit_nano:0},policy:proposeOperatingPolicy(config),originalFixture:f}
}
it('binds an explicitly selected US Azure writer without changing the default model or original-source route',async()=>{
 const f=await fixture(),defaults=operatingPolicyDraft(f)
 const trial=oneTimeOperatingPolicy({config:f,writer:'sol-us',datasetBinding:fingerprint(f.dataset),
  authorizationReference:'synthetic-explicit-us-writer',configuredAt:f.asOf,expiresAt:'2026-11-01T08:00:00Z',budgetUsd:8,maxCalls:62})
 expect(defaults.writer).toBe('sol')
 expect(defaults.destination.writerProvider).toBe('azure')
 expect(trial.writer).toBe('sol-us')
 expect(trial.destination).toMatchObject({provider:'azure',writerProvider:'azure/us',model:defaults.destination.model,zdr:true})
 expect(assertOperatingPolicy(trial)).toBe(trial)
 const legacy=structuredClone(defaults);delete legacy.destination.writerProvider;delete legacy.binding;legacy.binding=fingerprint(legacy)
 expect(assertOperatingPolicy(legacy)).toBe(legacy)
 const changed=structuredClone(trial);changed.destination.writerProvider='azure';delete changed.binding;changed.binding=fingerprint(changed)
 expect(()=>assertOperatingPolicy(changed)).toThrow()
 delete changed.destination.writerProvider;delete changed.binding;changed.binding=fingerprint(changed)
 expect(()=>assertOperatingPolicy(changed)).toThrow()
})
it('automatically prepares new registered articles and exact budgets while keeping both transmission and recurring spending unapproved',async()=>{
 const f=await fixture(),before=fingerprint(f)
 const first=prepareOperatingBatch(f)
 expect(first.rows.find(r=>r.currency==='COP')).toMatchObject({purpose:'initial_check',maxCalls:4})
 expect(first.sourcePlans).toHaveLength(1)
 expect(first.holds).toEqual(expect.arrayContaining(['external_processing_configuration_pending','standing_budget_configuration_pending','runtime_not_enabled']))
 expect(first.authorizationCandidate.authorized).toBe(false)
 expect(first).toMatchObject({modelCalls:0,networkCalls:0,externalApprovalInherited:false,recurringSpendAuthorized:false})
 const another=await originalPipelineFixture('different-new-url')
 const countries=structuredClone(f.countries);countries.find(c=>c.currency==='COP').collection=another.collection
 const next=prepareOperatingBatch({...f,countries})
 expect(next.sourcePlans).toHaveLength(1)
 expect(next.sourcePlans[0].binding).not.toBe(first.sourcePlans[0].binding)
 expect(next.holds).not.toContain('source_configuration_changed')
 expect(fingerprint(f)).toBe(before)
})
it('does not authorize an unregistered host, an edited configuration or an unknown publication history',async()=>{
 const f=await fixture(),country=f.countries.find(c=>c.currency==='COP'),original=country.collection.originals[0]
 const record={...original,url:'https://outside.example.org/article'};delete record.id
 const bound=bindSelectedOriginalReview({request:{sourceId:'cop-larepublica',period:'2026-10-26'},record,
  adapter:'reviewed_news_notes',requestIds:['synthetic'],currency:'COP',asOf:f.asOf,targets:[{needId:'market',requestedPeriod:'2026-10-26'}]})
 country.collection={...country.collection,originals:[bound.original],reviewQueue:[bound.review]}
 const result=prepareOperatingBatch(f)
 expect(result.sourcePlans).toHaveLength(0)
 expect(result.rows.find(r=>r.currency==='COP').sources[0].status).toBe('source_outside_registered_scope')
 expect(result.rows.find(r=>r.currency==='COP').holds).not.toContain('unregistered_source_not_authorized')
 expect(result.privateCountries.find(r=>r.currency==='COP').collection.reviewQueue).toEqual([])
 const changed={...f.sourcePlan,rules:[...f.sourcePlan.rules,'Synthetic changed configuration']}
 expect(prepareOperatingBatch({...f,sourcePlan:changed}).holds).toContain('source_configuration_changed')
 const missing=structuredClone(f.publicationsByCurrency);delete missing.MXN
 expect(prepareOperatingBatch({...f,publicationsByCurrency:missing}).rows.find(r=>r.currency==='MXN').holds).toContain('published_history_unavailable')
 const tampered=structuredClone(f.policy);tampered.destination.zdr=false
 expect(()=>prepareOperatingBatch({...f,policy:tampered})).toThrow('bound_operating_policy_required')
})
it('isolates an unregistered article while retaining a valid same-country source plan and all other country preparations',async()=>{
 const f=await fixture(),country=f.countries.find(c=>c.currency==='COP'),record={...country.collection.originals[0],url:'https://outside.example.org/dolar',collectedAt:'2026-11-02T04:00:00Z'}
 delete record.id
 const bound=bindSelectedOriginalReview({request:{sourceId:'cop-larepublica',period:'2026-10-26'},record,
  adapter:'reviewed_news_notes',requestIds:['synthetic'],currency:'COP',asOf:f.asOf,targets:[{needId:'market',requestedPeriod:'2026-10-26'}]})
 const baseline=prepareOperatingBatch(f)
 country.collection.originals.push(bound.original);country.collection.reviewQueue.push(bound.review)
 const before=fingerprint(f),result=prepareOperatingBatch(f)
 expect(result.sourcePlans.map(p=>p.binding)).toEqual(baseline.sourcePlans.map(p=>p.binding))
 expect(result.rows.find(r=>r.currency==='COP')).toMatchObject({status:'planned',holds:[],maxCalls:4})
 expect(result.privateCountries.find(r=>r.currency==='COP').collection.originals).toHaveLength(1)
 expect(result.privateCountries.find(r=>r.currency==='COP').collection.originals[0].url).not.toContain('outside')
 expect(result.rows.filter(r=>r.currency!=='COP')).toEqual(baseline.rows.filter(r=>r.currency!=='COP'))
 expect(fingerprint(f)).toBe(before)
})
it('holds an oversized batch instead of truncating articles or adding calls beyond the proposed ceiling',async()=>{
 const f=await fixture(),country=f.countries.find(c=>c.currency==='COP'),original=country.collection.originals[0]
 const pairs=Array.from({length:25},(_,i)=>{
  const record={...original,url:`https://www.larepublica.co/finanzas/synthetic-${i}`};delete record.id
  return bindSelectedOriginalReview({request:{sourceId:'cop-larepublica',period:'2026-10-26'},record,adapter:'reviewed_news_notes',requestIds:['synthetic'],
   currency:'COP',asOf:f.asOf,targets:[{needId:'market',requestedPeriod:'2026-10-26'}]})
 })
 country.collection={...country.collection,originals:pairs.map(p=>p.original),reviewQueue:pairs.map(p=>p.review)}
 const result=prepareOperatingBatch(f)
 expect(result.maxCalls).toBe(62)
 expect(result.holds).toContain('batch_call_count_exceeds_configuration')
 expect(result.sourcePlans).toHaveLength(25)
 expect(result.authorizationCandidate.authorized).toBe(false)
 expect(result.networkCalls).toBe(0)
 const extended=oneTimeOperatingPolicy({config:f,datasetBinding:fingerprint(f.dataset),authorizationReference:'synthetic-bound-extended-trial',
  configuredAt:f.asOf,expiresAt:'2026-11-01T08:00:00Z',budgetUsd:8,maxCalls:62})
 const allowed=prepareOperatingBatch({...f,policy:extended})
 expect(allowed.maxCalls).toBe(62)
 expect(allowed.holds).not.toContain('batch_call_count_exceeds_configuration')
 expect(allowed.sourcePlans).toHaveLength(25)
 expect(allowed.authorizationCandidate.authorized).toBe(false)
 expect(allowed.holds).toContain('runtime_not_enabled')
})

it('keeps the extended bound exclusive to explicit trials and preserves standard defaults and authorization gates',async()=>{
 const f=await fixture(),draft=operatingPolicyDraft(f)
 expect(draft.limits).toMatchObject({batchUsd:7,maxCalls:60,monthlyUsd:0})
 const trial=oneTimeOperatingPolicy({config:f,datasetBinding:fingerprint(f.dataset),authorizationReference:'synthetic-extended-only',
  configuredAt:f.asOf,expiresAt:'2026-11-01T08:00:00Z',budgetUsd:8,maxCalls:62})
 expect(assertOperatingPolicy(trial)).toBe(trial)
 const seal=(value:Record<string,unknown>)=>{delete value.binding;return {...value,binding:fingerprint(value)}}
 for(const limits of [{batchUsd:8.000000001},{maxCalls:63},{perCallUsd:.250000001}])
  expect(()=>assertOperatingPolicy(seal({...trial,limits:{...trial.limits,...limits}}))).toThrow('server_operating_policy_invalid')
 for(const limits of [{batchUsd:7.01},{maxCalls:61}])
  expect(()=>assertOperatingPolicy(seal({...draft,limits:{...draft.limits,...limits}}))).toThrow('server_operating_policy_invalid')
 const recurring=seal({...trial,state:'operator_configured',budgetScope:'recurring_service_separate_from_single_trial_approval',
  recurringBudgetAuthorization:'approved_by_operator',limits:{...trial.limits,monthlyUsd:20}})
 expect(()=>assertOperatingPolicy(recurring)).toThrow('server_operating_policy_invalid')
 expect(()=>assertOperatingPolicy(seal({...trial,authorizationReference:null}))).toThrow('explicit_one_time_configuration_required')
 expect(()=>assertOperatingPolicy(seal({...trial,datasetBinding:'unbound'}))).toThrow('explicit_one_time_configuration_required')
 expect(()=>assertOperatingPolicy(seal({...trial,recurringBudgetAuthorization:'approved_by_operator'}))).toThrow('explicit_one_time_configuration_required')
})
