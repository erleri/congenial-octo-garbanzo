import {describe,it,expect} from 'vitest'
import {buildSharedDashboardPriceSnapshot,assessSharedReportContract,COUNTRY_REPORT_PROFILES,
 REPORT_REFERENCE_POLICY} from './shared-price-contract.js'

const row=(date:string,value:number|null,extra:Record<string,unknown>={})=>({date,value,currency:'CLP',rateType:'LOCAL_PER_USD',status:'ok',source:'API',imputationMethod:'NONE',...extra})
const input=()=>({asOf:'2026-10-28T12:00:00Z',currency:'CLP',dataset:{baseDate:'2026-10-28',fetchedAt:'2026-10-28T05:45:00Z',
 dailyRates:[row('2026-10-26',990),row('2026-10-27',1000),row('2026-10-28',1020)]}})

describe('Shared dashboard/report price contract',()=>{
 it('uses stored current and previous prices, exact calculation and frozen hash without manufacturing a market close',()=>{
  const data=input(),before=structuredClone(data),a=buildSharedDashboardPriceSnapshot(data)
  expect(a).toMatchObject({baseDate:'2026-10-28',current:{value:1020},previous:{value:1000,date:'2026-10-27'},
   changePct:2,direction:'local_currency_weaker',numericStatus:'pass',dateMeaning:'stored_dataset_date',
   basis:{provider:null,observedAt:null,localSessionDate:null,priceKind:null,status:'unverified'},articleCanReplacePrice:false})
  data.dataset.dailyRates[2].value=1040
  expect(a.current.value).toBe(1020);expect(a.series[2].value).toBe(1020)
  expect(buildSharedDashboardPriceSnapshot(data).snapshotId).not.toBe(a.snapshotId)
  expect(buildSharedDashboardPriceSnapshot(before).snapshotId).toBe(a.snapshotId)
 })
 it('inherits a valid dashboard forward-fill while preserving the original observed row',()=>{
  const data=input();data.dataset.baseDate='2026-10-26';data.asOf='2026-10-26T12:00:00Z';data.dataset.fetchedAt='2026-10-26T06:00:00Z'
  data.dataset.dailyRates=[row('2026-10-23',1000),row('2026-10-25',1000,{source:'IMPUTED',imputationMethod:'FFILL'}),row('2026-10-26',1010)]
  const result=buildSharedDashboardPriceSnapshot(data)
  expect(result.previous.date).toBe('2026-10-25');expect(result.changePct).toBe(1)
  expect(result.numericStatus).toBe('pass')
  expect(result.carryForward).toMatchObject({previousOrigin:{date:'2026-10-23',value:1000},holidayConfirmed:false})
  data.dataset.dailyRates[1].value=998
  expect(buildSharedDashboardPriceSnapshot(data).numericHolds).toContain('previous_price_imputed_or_unknown')
 })
 it('never uses an article price, another currency or KRW row as the reference and preserves dashboard first-row semantics',()=>{
  const data=input();data.dataset.dailyRates.unshift(row('2026-10-28',50,{currency:'PEN'}),row('2026-10-28',1.5,{rateType:'KRW'}))
  data.dataset.dailyRates.push(row('2026-10-28',888))
  Object.assign(data.dataset,{article:{close:999},provider:'claimed_provider'})
  const result=buildSharedDashboardPriceSnapshot(data)
  expect(result.current.value).toBe(1020);expect(result.basis.provider).toBeNull()
  expect(result.numericHolds).toContain('duplicate_stored_price_dates')
 })
 it('does not turn missing current prices into an older quote or zero movement',()=>{
  const data=input();data.dataset.dailyRates.pop()
  const result=buildSharedDashboardPriceSnapshot(data)
  expect(result.current).toBeNull();expect(result.changePct).toBeNull();expect(result.direction).toBe('unknown')
  expect(result.numericHolds).toContain('current_price_missing_or_invalid')
 })
 it('rejects zero denominator and unknown quality while leaving visible stored prices intact',()=>{
  const data=input();data.dataset.dailyRates[1].value=0;data.dataset.dailyRates[2].imputationMethod=''
  const result=buildSharedDashboardPriceSnapshot(data)
  expect(result.changePct).toBeNull();expect(result.current.value).toBe(1020)
  expect(result.numericHolds).toEqual(['current_price_imputed_or_unknown','previous_price_missing_or_invalid'])
 })
 it('distinguishes an old dataset from no movement, rejects future cutoffs, and never infers a session from collection time',()=>{
  const data=input();data.asOf='2026-10-29T12:00:00Z'
  const stale=buildSharedDashboardPriceSnapshot(data)
  expect(stale.numericHolds).toContain('older_saved_dataset_not_current_market')
  expect(assessSharedReportContract({snapshot:stale}).checks.find(c=>c.id==='price_quality').status).toBe('hold')
  data.asOf='2026-10-27T12:00:00Z'
  expect(()=>buildSharedDashboardPriceSnapshot(data)).toThrow('shared_dashboard_dataset_required')
  data.asOf='2026-10-28T04:00:00Z'
  expect(buildSharedDashboardPriceSnapshot(data).numericHolds).toContain('dataset_collection_time_unverified')
 })
 it('uses one price authority and confirmed cadence for all six countries without changing price meaning or direction',()=>{
  for(const currency of ['BRL','MXN','COP','PEN','CLP','ARS']){
   const data=input();data.currency=currency;data.dataset.dailyRates.forEach(r=>r.currency=currency);data.dataset.dailyRates[2].value=980
   expect(buildSharedDashboardPriceSnapshot(data)).toMatchObject({changePct:-2,direction:'local_currency_stronger',numericStatus:'pass',
    referenceBasis:{status:'pass',companyRateEquivalence:'assumed_pending_user_confirmation',companyRateVerified:false}})
   expect(COUNTRY_REPORT_PROFILES[currency].priceAuthority).toBe('dashboard_dataset')
   expect(COUNTRY_REPORT_PROFILES[currency]).toMatchObject({cumulativeThresholdPct:2,
    periodicPolicy:'first_monday_after_14_days_without_publication',cadencePolicyVersion:'six-currency-cadence/2'})
  }
 })
 it('reads bound provider metadata without promoting an API update timestamp to the observation or local session',()=>{
  const data=input(),source={provider:'exchange_rate_api',endpoint:'https://v6.exchangerate-api.com/v6',
   capturedAt:'2026-10-28T05:00:00Z',responseSha256:'a'.repeat(64),digestMeaning:'parsed_json',
   providerUpdatedAt:'2026-10-28T03:00:00Z',providerDate:'2026-10-28',dateMeaning:'utc_update_date',
   priceKind:'conversion_reference',providerTimeZone:null,observedAt:null,localSessionDate:null,origin:'response'}
  const book={version:'fx-price-provenance/1',sources:{s1:source},quotesByDate:{'2026-10-28':{CLP:{sourceId:'s1',value:1020}}}}
  Object.assign(data.dataset,{priceProvenance:book})
  const result=buildSharedDashboardPriceSnapshot(data)
  expect(result.lineage.current).toMatchObject({status:'recorded',provider:'exchange_rate_api',providerUpdatedAt:'2026-10-28T03:00:00Z',observedAt:null,localSessionDate:null})
  expect(result.basis).toMatchObject({status:'unverified',provider:'exchange_rate_api',priceKind:'conversion_reference'})
  expect(result.referenceBasis.status).toBe('pass')
  const a=result.snapshotId
  book.quotesByDate['2026-10-28'].CLP.value=1021
  expect(buildSharedDashboardPriceSnapshot(data).lineage.current.reason).toBe('source_record_price_mismatch')
  expect(buildSharedDashboardPriceSnapshot(data).snapshotId).not.toBe(a)
 })
 it('ignores cached identities, mismatched providers and credential-bearing source URLs instead of leaking or certifying them',()=>{
  const data=input(),source={provider:'currency_api',endpoint:'https://latest.currency-api.pages.dev/v1/currencies',
   capturedAt:'2026-10-28T05:00:00Z',responseSha256:'a'.repeat(64),digestMeaning:'parsed_json',
   providerUpdatedAt:null,providerDate:'2026-10-28',dateMeaning:'provider_payload_date',priceKind:'conversion_reference',
   providerTimeZone:null,observedAt:null,localSessionDate:null,origin:'response'}
  const book={version:'fx-price-provenance/1',sources:{s1:source},quotesByDate:{'2026-10-28':{CLP:{sourceId:'s1',value:1020}}}}
  Object.assign(data.dataset,{priceProvenance:book})
  for(const bad of [{...source,origin:'cache_without_source_record'},
   {...source,provider:'alpha_vantage'}, {...source,endpoint:source.endpoint+'?token=synthetic-secret'}]){
   book.sources.s1=bad
   const result=buildSharedDashboardPriceSnapshot(data)
   expect(result.lineage.current.status).toBe('unverified')
   expect(JSON.stringify(result)).not.toContain('synthetic-secret')
   expect(result.referenceBasis.status).toBe(bad.origin==='cache_without_source_record'?'pass':'hold')
  }
 })
 it('accepts the authorized reference assumption without inventing a company certification, close, evidence review or publication approval',()=>{
  const snapshot=buildSharedDashboardPriceSnapshot(input())
  const assessment=assessSharedReportContract({snapshot,legacyResult:{status:'saved_case_request_prepared'}})
  expect(snapshot.referenceBasis).toMatchObject({...REPORT_REFERENCE_POLICY,status:'pass',verificationStatus:'working_assumption',
   warnings:['current_source_record_missing','previous_source_record_missing']})
  expect(snapshot.basis).toMatchObject({required:false,status:'unverified',localSessionDate:null,observedAt:null})
  expect(assessment.checks.find(c=>c.id==='reference_rate_basis')).toMatchObject({status:'pass',
   reason:'user_authorized_reference_rate_working_assumption'})
  expect(assessment.holds).not.toContain('reference_rate_basis')
  expect(assessment.holds).toContain('evidence_period_and_scope')
  expect(assessment).toMatchObject({localCloseRequired:false,writingEligibility:'hold',request:null,
   paidCallAuthorized:false,publicationApproved:false})
 })
})
