import {expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {officialCacheRecord,assertOfficialCacheRecord,withOfficialInputCache,OFFICIAL_CACHE_DEFINITIONS,officialCacheDefinitions} from './official-input-cache.js'
import {OFFICIAL_COUNTRY_VERSION} from './official-country-statistics.js'
import {officialBackgroundCoverage} from './official-background-coverage.js'

// Synthetic cache protocol only. Economic admission is deliberately injected;
// real official captures are validated separately by the production reviewer.
const asOf='2026-11-01T16:00:00Z',collectedAt='2026-11-01T10:00:00Z'
function input(){const raw=Buffer.from('{"synthetic":"not an economic source"}');return {countryOfficialInputs:{version:OFFICIAL_COUNTRY_VERSION,currency:'BRL',proofs:[
 {id:'brl-pmc',url:'https://apisidra.ibge.gov.br/synthetic-cache-fixture',httpStatus:200,collectedAt,sha256:createHash('sha256').update(raw).digest('hex'),rawBase64:raw.toString('base64')}]},inputState:'official_inputs_collected',inputNetworkCalls:1,inputIssues:[]}}
function memory(){const records=new Map();return {records,saveOfficialInput:vi.fn(async r=>{if(!records.has(r.key))records.set(r.key,structuredClone(r));return {status:'stored'}}),
 officialInput:vi.fn(async()=>structuredClone([...records.values()].at(-1)??null))}}
const failure=()=>({inputState:'official_inputs_partial',inputIssues:['official_access_barrier_not_statistic'],inputNetworkCalls:1})
const review=async({inputs,asOf:clock})=>({currency:'BRL',admitted:inputs.countryOfficialInputs&&clock.startsWith('2026-11')?[{scope:{metric:'retail'},seriesId:'synthetic'}]:[],
 rows:[{reason:inputs.countryOfficialInputs?'official_background_outside_collection_window':'official_profile_capture_missing'}]})

it('invalidates only the affected provider envelope while retaining existing unrelated country cache definitions',()=>{
 for(const currency of ['BRL','MXN','CLP','COP','ARS'])expect(officialCacheDefinitions(currency)).toBe(OFFICIAL_CACHE_DEFINITIONS)
 expect(officialCacheDefinitions('PEN')).toBe(OFFICIAL_CACHE_DEFINITIONS+'|official-json-envelope/1')
 const existing=officialCacheRecord({currency:'BRL',inputs:input(),asOf})
 expect(existing.definitions).toBe(OFFICIAL_CACHE_DEFINITIONS)
 expect(assertOfficialCacheRecord(existing,'BRL',asOf)).toEqual(existing)
})

it('preserves original receipts across recaptures with the same body, while retaining actual changed editions',()=>{
 const first=input(),second=input();second.countryOfficialInputs.proofs[0].collectedAt='2026-11-01T12:00:00Z'
 const a=officialCacheRecord({currency:'BRL',inputs:first,asOf}),b=officialCacheRecord({currency:'BRL',inputs:second,asOf})
 expect(a.key).toBe(b.key);expect(a.binding).not.toBe(b.binding);expect(a.observedAt).toBe(collectedAt)
 second.countryOfficialInputs.proofs[0].sha256='b'.repeat(64)
 expect(officialCacheRecord({currency:'BRL',inputs:second,asOf}).key).not.toBe(a.key)
 expect(first.countryOfficialInputs.proofs[0].collectedAt).toBe(collectedAt)
})
it('stores a successful free capture and recovers it without an explicit saved file after a failed new lookup',async()=>{
 const store=memory(),loader=vi.fn().mockResolvedValueOnce(input()).mockResolvedValueOnce(failure()),checked=vi.fn(review)
 const run=withOfficialInputCache({loader,store,review:checked,now:()=>asOf})
 expect((await run({currency:'BRL',mode:'live',asOf})).officialCache.status).toBe('stored')
 const r=await run({currency:'BRL',mode:'live',asOf})
 expect(r).toMatchObject({inputState:'stored_official_inputs_after_lookup_failure',inputNetworkCalls:1,
  officialCache:{status:'reused_after_current_review',observedAt:collectedAt}})
 expect(r.inputIssues).toContain('official_access_barrier_not_statistic')
 expect(r.countryOfficialInputs.proofs[0].collectedAt).toBe(collectedAt)
 expect(checked).toHaveBeenCalledTimes(3);expect(store.records.size).toBe(1)
})
it('reruns current age checks and holds expired cached data without deleting or relabelling it',async()=>{
 const store=memory(),record=officialCacheRecord({currency:'BRL',inputs:input(),asOf});store.records.set(record.key,record)
 const run=withOfficialInputCache({loader:async()=>failure(),store,review,now:()=> '2026-12-01T16:00:00Z'})
 const result=await run({currency:'BRL',mode:'live',asOf:'2026-12-01T16:00:00Z'})
 expect(result.officialCache.status).toBe('expired_or_held');expect(result).not.toHaveProperty('countryOfficialInputs')
 expect([...store.records.values()][0]).toEqual(record)
})
it('does not hide a fetched but invalid new statistic with an older cached success',async()=>{
 const store=memory(),run=withOfficialInputCache({loader:async()=>({inputState:'official_inputs_collected'}),store,
  review:async()=>({admitted:[],rows:[{reason:'official_numeric_crosscheck_conflict'}]}),now:()=>asOf})
 expect((await run({currency:'BRL',mode:'live',asOf})).officialCache.status).toBe('current_integrity_hold_no_cache_substitution')
 expect(store.officialInput).not.toHaveBeenCalled()
 const changedTerms=withOfficialInputCache({loader:async()=>({inputState:'official_inputs_partial',officialTerms:{sha256:'changed'}}),store,
  review:async()=>({admitted:[],rows:[{reason:'official_numeric_use_terms_missing_or_changed'}]}),now:()=>asOf})
 expect((await changedTerms({currency:'MXN',mode:'live',asOf})).officialCache.status).toBe('current_integrity_hold_no_cache_substitution')
 expect(store.officialInput).not.toHaveBeenCalled()
})
it('keeps saved replay independent from the server cache and does not load or save anything',async()=>{
 const store=memory(),saved=input(),loader=vi.fn(async()=>saved),checked=vi.fn(review)
 const r=await withOfficialInputCache({loader,store,review:checked})({currency:'BRL',mode:'saved',asOf})
 expect(r).toBe(saved);expect(store.saveOfficialInput).not.toHaveBeenCalled();expect(store.officialInput).not.toHaveBeenCalled();expect(checked).not.toHaveBeenCalled()
})
it('records cache failure/quota distinctly while retaining the newly verified source for frozen-batch persistence',async()=>{
 const store=memory();store.saveOfficialInput.mockResolvedValueOnce({status:'capacity_hold'}).mockRejectedValueOnce(Error('db unavailable'))
 const run=withOfficialInputCache({loader:async()=>input(),store,review,now:()=>asOf})
 expect((await run({currency:'BRL',mode:'live',asOf})).inputIssues).toContain('official_cache_capacity_hold')
 const failed=await run({currency:'BRL',mode:'live',asOf})
 expect(failed.inputIssues).toContain('official_cache_write_failed');expect(failed.countryOfficialInputs).toEqual(input().countryOfficialInputs)
})
it('rejects altered/future/cross-country cache records before they can become current background',()=>{
 const r=officialCacheRecord({currency:'BRL',inputs:input(),asOf}),changed=structuredClone(r)
 changed.inputs.countryOfficialInputs.proofs[0].rawBase64='changed'
 expect(()=>assertOfficialCacheRecord(changed,'BRL',asOf)).toThrow('binding_or_version')
 expect(()=>assertOfficialCacheRecord(r,'PEN',asOf)).toThrow('binding_or_version')
 expect(()=>assertOfficialCacheRecord(r,'BRL','2026-11-01T09:00:00Z')).toThrow('binding_or_version')
})
it('reports actual supported questions without turning a credit product into a complete consumption picture',()=>{
 const a=officialBackgroundCoverage({currency:'PEN',admitted:[{seriesId:'PN07845NM',scope:{metric:'consumer_credit'}}]})
 expect(a.questions.filter(q=>q.status==='registered_numeric_context_available').map(q=>q.id)).toEqual(['financing_conditions'])
 expect(a).toMatchObject({numericContextAvailable:true,completeConsumerPicture:false,directFxCauseAllowed:false,publicationApproved:false})
 expect(officialBackgroundCoverage({currency:'PEN',admitted:[]}).numericContextAvailable).toBe(false)
})
