import {it,expect,vi} from 'vitest'
import {publishedHanaComparisonDates,prepareHanaTransition} from './hana-transition'
import {hanaComparison} from '../src/lib/hana-comparison'
import {getDashboardDailyChange} from '../src/lib/dashboard-price'
import {runtimeFixture} from './currency-report/runtime-fixture.js'
import {buildSharedDashboardPriceSnapshot} from './currency-report/shared-price-contract.js'
import {evaluatePublicationCadence} from './currency-report/publication-cadence.js'
import {prepareRuntimeTask} from './currency-report/runtime.js'
import {fingerprint} from './currency-report/research-harness.js'
import type {FxPriceSource,HanaComparisonQuote} from '../src/types/exchangeRate'
import {buildReferenceContext,attachReferenceContext} from '../src/lib/reference-context'

const quote=(date:string,raw='0.0100'):HanaComparisonQuote=>({currency:'BRL',requestedDate:date,date,value:1/Number(raw),source:{
 provider:'hana_bank',endpoint:'https://www.kebhana.com/cms/rate/wpfxd651_01i_01.do',capturedAt:'2026-10-28T02:00:00Z',responseSha256:'a'.repeat(64),digestMeaning:'parsed_json',providerDate:date,
 providerUpdatedAt:null,providerTimestampLocal:null,providerTimeZone:'Asia/Seoul',dateMeaning:'provider_payload_date',priceKind:'conversion_reference',
 observedAt:null,localSessionDate:null,origin:'response',transport:'direct',bankQuote:{kind:'initial',rawValue:raw,unit:'USD_per_local',bulletin:1}}})
function fixture(){
 const f=runtimeFixture(),dataset=structuredClone(f.dataset),q=quote('2026-10-28','0.0099')
 dataset.dailyRates[0].value=90;dataset.dailyRates[1].value=q.value
 dataset.dailyRates.unshift({...dataset.dailyRates[0],date:'2026-10-05',value:70})
 dataset.hanaTransition={version:'hana-transition/1',effectiveFrom:'2026-10-28',quotes:[quote('2026-10-05'),quote('2026-10-27')]}
 const legacy:FxPriceSource={...q.source,provider:'exchange_rate_api',endpoint:'https://v6.exchangerate-api.com/v6',providerDate:'2026-10-27'}
 delete legacy.bankQuote
 dataset.priceProvenance={version:'fx-price-provenance/1',sources:{bank:q.source,legacy},quotesByDate:{'2026-10-28':{BRL:{sourceId:'bank',value:q.value}},'2026-10-27':{BRL:{sourceId:'legacy',value:90}}}}
 const snapshot=buildSharedDashboardPriceSnapshot({...f,dataset})
 const old=buildSharedDashboardPriceSnapshot({dataset:{...f.dataset,baseDate:'2026-10-05',fetchedAt:'2026-10-05T02:00:00Z',dailyRates:[{...f.dataset.dailyRates[0],date:'2026-10-04',value:69},{...f.dataset.dailyRates[0],date:'2026-10-05',value:70}]},currency:'BRL',asOf:'2026-10-05T12:00:00Z'})
 old.lineage.current.provider='exchange_rate_api'
 const publications=[{id:'old-publication',currency:'BRL',kind:'market',state:'published',origin:'published_record',approved:true,stored:true,priceReviewed:true,historical:false,editorialOnly:false,withdrawn:false,publishedAt:'2026-10-05T12:00:00Z',snapshot:old,report:{content:{summary:'전회 공개 설명',drivers:[],implications:[]}}}]
 const {binding,...connection}=f.handoff.materialConnection;expect(binding).toBeTruthy()
 connection.referenceSnapshotId=snapshot.snapshotId
 const handoff={...f.handoff,reportPriceSnapshot:snapshot,materialConnection:{...connection,binding:fingerprint(connection)}}
 return {...f,dataset,snapshot,publications,handoff}
}
it('preserves the report date and original value while comparing Hana against Hana for daily and cumulative changes',()=>{
 const f=fixture(),before=JSON.stringify(f.publications)
 const cadence=evaluatePublicationCadence({...f,snapshot:f.snapshot,eventCandidateIds:['news']})
 expect(cadence.cumulativePct).toBeCloseTo(1.010101)
 expect(cadence.triggers).toEqual(['periodic','event_research'])
 expect(cadence.periodicDueDate).toBe('2026-10-19')
 expect(cadence.comparisonHolds).toEqual([])
 expect(JSON.stringify(f.publications)).toBe(before)
 expect(getDashboardDailyChange(f.snapshot.current,f.snapshot.previous,f.dataset)).toBeCloseTo(.01010101)
 const task=prepareRuntimeTask({...f,eventCandidateIds:['news']})
 expect(task).toMatchObject({status:'prepared',purpose:'periodic'})
 const facts=task.plan.packet.facts
 expect(facts.find(f=>f.id==='previous').value).toBe(100)
 expect(facts.find(f=>f.id==='published_previous').value).toBe(70)
 expect(facts.find(f=>f.id==='comparable_previous').value).toBe(100)
 expect(facts.find(f=>f.id==='published_change').value).toBeCloseTo(1.010101)
})
it('holds a missing or changed comparison and resumes normal calculation for same-provider reports',()=>{
 const f=fixture()
 f.snapshot.hanaTransition.quotes[0].value=99
 expect(evaluatePublicationCadence({...f,snapshot:f.snapshot}).comparisonHolds).toContain('reference_source_bridge_missing')
 const current=fixture();current.publications[0].snapshot.lineage.current.provider='hana_bank'
 expect(evaluatePublicationCadence({...current,snapshot:current.snapshot}).cumulativePct).toBeCloseTo((current.snapshot.current.value/70-1)*100)
 expect(hanaComparison(f.dataset,'BRL','2026-10-05')).toBeNull()
})
it('finishes public-history pagination and fails on a partial lookup',async()=>{
 const fetchImpl=vi.fn(async(target:URL)=>{
  expect(target.searchParams.get('order')).toBe('currency,base_date')
  return new Response(JSON.stringify(target.searchParams.get('offset')==='0'?Array(1000).fill({date:'2026-11-02'}):target.searchParams.get('offset')==='1000'?[{date:'2026-11-13'}]:[]))
 })
 expect(await publishedHanaComparisonDates('https://example.supabase.co','synthetic-key',fetchImpl)).toEqual(['2026-11-02','2026-11-13'])
 expect(fetchImpl).toHaveBeenCalledTimes(3)
 await expect(publishedHanaComparisonDates('https://example.supabase.co','synthetic-key',async()=>new Response('',{status:500}))).rejects.toThrow('hana_comparison_history_unavailable')
})
it('preserves exact saved comparisons and cannot silently change the effective date',async()=>{
 const f=fixture(),collect=vi.fn(async()=>{throw Error('unexpected_fetch')})
 await expect(prepareHanaTransition(f.dataset,[],'2026-10-29',collect)).rejects.toThrow('hana_cutover_date_changed')
 const result=await prepareHanaTransition(f.dataset,[],'2026-10-28',collect,()=>f.asOf)
 expect(result).toEqual(f.dataset.hanaTransition)
 expect(collect).not.toHaveBeenCalled()
})
it('keeps a versioned context for DB-loaded dashboards and rejects another generation',()=>{
 const f=fixture(),context=buildReferenceContext(f.dataset,'generation-one')
 const db={...f.dataset,hanaTransition:undefined,priceProvenance:undefined}
 const hydrated=attachReferenceContext(db,'generation-one',context)
 expect(getDashboardDailyChange(f.snapshot.current,f.snapshot.previous,hydrated)).toBeCloseTo(.01010101)
 expect(hydrated.hanaTransition).toEqual(f.dataset.hanaTransition)
 expect(()=>attachReferenceContext(db,'generation-two',context)).toThrow('reference_context_version_mismatch')
 expect(()=>attachReferenceContext({...db,fetchedAt:'2026-10-28T03:00:00Z'},'generation-one',context)).toThrow('reference_context_version_mismatch')
})
