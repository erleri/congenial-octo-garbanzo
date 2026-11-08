import {it,expect,vi} from 'vitest'
import {scanPublishedCorrections,recordPublishedCorrections} from './published-corrections.js'
import {fingerprint} from './research-harness.js'
import {newsEdition} from './operating-source-cache.js'
import {operatingFixture} from './operating-fixture.js'
import {runOperatingCycle} from './operating-cycle.js'
import {officialCountryProfiles,countryDefinitionId,OFFICIAL_COUNTRY_VERSION} from './official-country-statistics.js'
import {INEGI_REPORT_INDICATORS,INEGI_DEFINITION_VERSION,inegiDefinitionId} from './inegi-report-indicators.js'

// Synthetic protocol cases, not real publisher findings or economic quality.
const asOf='2026-11-01T13:00:00Z'
function fixture(currency='CLP'){
 const scope={metric:'retail',comparison:'year_over_year',unit:'percent',adjustment:'unadjusted',priceBasis:'real'}
 const statistic={seriesId:'SYNTHETIC_SERIES',definitionId:'same-definition',definitionVersion:'synthetic/1',fact:{id:'official_fact',value:4.4},releaseHash:'a'.repeat(64)}
 const evidence={id:'synthetic-official',url:'https://www.ine.gob.cl/synthetic',period:'2026-09',scope,officialStatistic:statistic}
 const block={title:'합성 소매 변화',text:'확인한 대상 월의 실질 매출은 전년 동월보다 늘었다.',evidenceIds:[evidence.id],factIds:[statistic.fact.id],kind:'fact'}
 const report={id:'SYNTHETIC-'+currency,baseDate:'2026-10-31',currency,testOnly:false,content:{title:'합성 시험',summary:'실제 원고 평가 아님',drivers:[],implications:[block],watch:[]},evidence:[evidence],facts:[statistic.fact]}
 const task={plan:{packet:{evidence:[evidence]}}},context={task}
 const history=[{report,publishedAt:'2026-10-31T12:00:00Z',runtimeContext:{...context,serializedRuntimeContext:JSON.stringify(context)}}]
 const fresh={...statistic,value:5,period:evidence.period,scope,release:{sha256:'b'.repeat(64)}}
 const reseal=(admitted=[fresh])=>{const data={version:'official-statistic-admission/1',currency,asOf,admitted};return {...data,binding:fingerprint(data)}}
 return {currency,asOf,history,admission:reseal(),reseal,fresh,evidence,report,scope}
}
it('applies the same revision rules to six currencies without mistaking a new month, new capture time or rounding for a correction',()=>{
 for(const currency of ['BRL','MXN','COP','PEN','CLP','ARS']){
  const f=fixture(currency),r=scanPublishedCorrections(f)
  expect(r.candidates).toHaveLength(2) // title and sentence are separate exact targets
  expect(r.candidates.every(c=>c.kind==='official_value_revised'&&c.before.value===4.4&&c.after.value===5)).toBe(true)
  expect(scanPublishedCorrections({...f,admission:f.reseal([{...f.fresh,period:'2026-10'}])}).candidates).toHaveLength(0)
  expect(scanPublishedCorrections({...f,admission:f.reseal([{...f.fresh,value:4.40000000001}])}).candidates).toHaveLength(0)
  expect(scanPublishedCorrections({...f,asOf:'2026-11-02T13:00:00Z'}).candidates.map(c=>c.key)).toEqual(r.candidates.map(c=>c.key))
 }
})
it('separates changed definitions from comparable revisions and retains precise scope instead of comparing incomparable values',()=>{
 const f=fixture(),admission=f.reseal([{...f.fresh,scope:{...f.scope,adjustment:'seasonally_adjusted'},definitionId:'redefined'}])
 const r=scanPublishedCorrections({...f,admission})
 expect(r.candidates.every(c=>c.kind==='official_definition_changed'&&c.after.scope.adjustment==='seasonally_adjusted')).toBe(true)
 expect(r.coverage.semanticComparison).toBe('not_performed')
 const tampered={...admission,admitted:[{...f.fresh,value:99}]}
 expect(scanPublishedCorrections({...f,admission:tampered})).toMatchObject({candidates:[],coverage:{issues:['current_statistics_binding_unverified']}})
})
it('recovers old omitted scope only from the exact registered definition and preserves an explicit gap for an unknown old version',()=>{
 for(const currency of ['BRL','MXN','COP','PEN','CLP','ARS']){
  const f=fixture(currency),profile=officialCountryProfiles().find(p=>p.currency===currency),inegi=INEGI_REPORT_INDICATORS[0]
  const registered=profile?{seriesId:profile.seriesId,definitionId:countryDefinitionId(profile),definitionVersion:OFFICIAL_COUNTRY_VERSION,scope:profile.scope}
   :{seriesId:inegi.indicatorId,definitionId:inegiDefinitionId(inegi),definitionVersion:INEGI_DEFINITION_VERSION,scope:inegi.scope}
  const {seriesId,definitionId,definitionVersion}=registered
  Object.assign(f.evidence.officialStatistic,{seriesId,definitionId,definitionVersion});delete f.evidence.scope
  const context={task:{plan:{packet:{evidence:[f.evidence]}}}}
  f.history[0].runtimeContext={...context,serializedRuntimeContext:JSON.stringify(context)}
  const admission=f.reseal([{...f.fresh,...registered}])
  expect(scanPublishedCorrections({...f,admission}).candidates.every(c=>c.kind==='official_value_revised')).toBe(true)
  expect(scanPublishedCorrections({...f,admission}).candidates).toHaveLength(2)
  f.evidence.officialStatistic.definitionVersion='unknown-old-definition'
  f.history[0].runtimeContext={...context,serializedRuntimeContext:JSON.stringify(context)}
  expect(scanPublishedCorrections({...f,admission})).toMatchObject({status:'partial_check',candidates:[],coverage:{issues:['published_indicator_definition_unavailable']}})
 }
})
it('detects changed cited articles once per exact sentence while ignoring unchanged bodies, unrelated articles and duplicate captures',async()=>{
 const x=await operatingFixture(),collection=structuredClone(x.collections.CLP),original=collection.originals[0],f=fixture()
 const identity=newsEdition(original).identity
 f.evidence.url=original.url
 f.evidence.officialStatistic=undefined as never
 const oldContext={task:{plan:{packet:{evidence:[{...f.evidence,originalCapture:{contentIdentity:'f'.repeat(64)}}]}}}}
 f.history[0].runtimeContext={...oldContext,serializedRuntimeContext:JSON.stringify(oldContext)}
 const r=scanPublishedCorrections({...f,collection,admission:null})
 expect(r.candidates).toHaveLength(2)
 expect(r.candidates.every(c=>c.kind==='cited_source_edition_changed'&&c.after.edition===identity)).toBe(true)
 const context={task:{plan:{packet:{evidence:[{...f.evidence,originalCapture:{contentIdentity:identity}}]}}}}
 const same=[{...f.history[0],runtimeContext:{...context,serializedRuntimeContext:JSON.stringify(context)}}]
 expect(scanPublishedCorrections({...f,history:same,collection,admission:null}).candidates).toHaveLength(0)
 expect(scanPublishedCorrections({...f,history:[...f.history,...f.history],collection,admission:null}).candidates.map(c=>c.key)).toEqual(r.candidates.map(c=>c.key))
 collection.originals[0].blocks[0].text+=' unbound change'
 expect(scanPublishedCorrections({...f,collection,admission:null}).coverage.issues).toContain('current_article_binding_unverified')
})
it('keeps historical/test/withdrawn/foreign reports out and records missing or changed old inputs instead of claiming semantic clearance',()=>{
 const f=fixture()
 for(const change of [{historicalReview:true},{testOnly:true},{currency:'MXN'}])expect(scanPublishedCorrections({...f,history:[{...f.history[0],report:{...f.report,...change}}]}).candidates).toHaveLength(0)
 expect(scanPublishedCorrections({...f,history:[{...f.history[0],withdrawnAt:asOf}]}).candidates).toHaveLength(0)
 expect(scanPublishedCorrections({...f,history:[{...f.history[0],runtimeContext:null}]})).toMatchObject({candidates:[],coverage:{missingSnapshotReports:1,differentSourceContradictions:'not_evaluated'}})
 f.history[0].runtimeContext.task.plan.packet.evidence=[]
 expect(scanPublishedCorrections(f).coverage.issues).toContain('published_snapshot_binding_unverified')
})
it('preserves evidence and quotes, deduplicates repeated detection, and never treats persistence failure as successful review',async()=>{
 const f=fixture(),before=JSON.stringify(f),saved=new Map(),store={recordCorrections:vi.fn(async r=>{
  let inserted=0;for(const c of r.candidates)if(!saved.has(c.key)){saved.set(c.key,c);inserted++}return {inserted,duplicates:r.candidates.length-inserted}
 })}
 expect(await recordPublishedCorrections(f,store)).toMatchObject({stored:2,duplicates:0})
 expect(await recordPublishedCorrections({...f,asOf:'2026-11-02T13:00:00Z'},store)).toMatchObject({stored:0,duplicates:2})
 expect(JSON.stringify(f)).toBe(before)
 expect(await recordPublishedCorrections(f,{recordCorrections:async()=>{throw Error('offline')}})).toMatchObject({status:'correction_storage_failed'})
})
it('runs correction recording before paid eligibility and even when an old batch is complete; recording failure prevents paid dispatch',async()=>{
 const f=await operatingFixture(),record=vi.spyOn(f.store,'recordCorrections'),send=vi.fn()
 await runOperatingCycle({...f,send,execute:false})
 expect(record).toHaveBeenCalledTimes(6);expect(send).not.toHaveBeenCalled()
 f.state.batch={batch_key:'unused',state:'completed'}
 f.store.operatingBatch=async()=>({state:'completed',result:{status:'old_complete'}})
 await runOperatingCycle({...f,send,execute:false})
 expect(record).toHaveBeenCalledTimes(12)
 f.store.recordCorrections=async()=>{throw Error('offline')}
 const failed=await runOperatingCycle({...f,send,execute:true})
 expect(failed.modelCalls).toBe(0)
 expect(failed.collectionResults.every(r=>r.acquisitionError==='correction_storage_failed')).toBe(true)
 expect(send).not.toHaveBeenCalled();expect(f.store.jobs).toHaveLength(0)
})
