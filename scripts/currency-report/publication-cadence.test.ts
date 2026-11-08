import {expect,it} from 'vitest'
import {evaluatePublicationCadence,koreaDate,periodicDueDate} from './publication-cadence.js'
import {buildSharedDashboardPriceSnapshot,REPORT_REFERENCE_POLICY,SHARED_REPORT_RULE_VERSION} from './shared-price-contract.js'
import {fingerprint} from './research-harness.js'

function snapshot(value=100,date='2026-10-19',currency='CLP'){
 const s={currency,unit:`${currency}_per_USD`,dateMeaning:'stored_dataset_date',ruleVersion:SHARED_REPORT_RULE_VERSION,
  current:{currency,date,value,status:'ok',source:'API',imputationMethod:'NONE',rateType:'LOCAL_PER_USD'},
  numericStatus:'pass',referenceBasis:{...REPORT_REFERENCE_POLICY,status:'pass'},
  lineage:{current:{provider:null}},series:[{currency,date:'2026-10-02',value:100,rateType:'LOCAL_PER_USD',source:'API',imputationMethod:'NONE',status:'ok'}]}
 return {...s,snapshotId:fingerprint(s)}
}
const publication=(extra={})=>({id:'published-one',currency:'CLP',kind:'market',state:'published',origin:'published_record',
 publishedAt:'2026-10-05T00:00:00Z',stored:true,approved:true,priceReviewed:true,historical:false,editorialOnly:false,withdrawn:false,
 snapshot:snapshot(100,'2026-10-02'),...extra})
const inspect=(s=snapshot(100),extra={})=>evaluatePublicationCadence({snapshot:s,asOf:'2026-10-19T03:00:00Z',publications:[publication()],
 calendar:{status:'confirmed',expectedReferenceDate:s.current.date},...extra})

it('detects compounded small moves and direction without rounding a below-threshold value into a trigger',()=>{
 expect(inspect(snapshot(100*1.003**6)).triggers).not.toContain('cumulative')
 expect(inspect(snapshot(100*1.003**7))).toMatchObject({thresholdPct:2,direction:'local_currency_weaker'})
 expect(inspect(snapshot(100*1.003**7)).triggers).toContain('cumulative')
 expect(inspect(snapshot(97.9)).direction).toBe('local_currency_stronger')
 expect(inspect(snapshot(101.9999)).triggers).not.toContain('cumulative')
})

it('merges cumulative, due and event reasons into one anchor case and blocks the same daily check twice',()=>{
 const first=inspect(snapshot(103),{eventCandidateIds:['rate-statement-v2']})
 expect(first.triggers).toEqual(['cumulative','periodic','event_research'])
 const second=inspect(snapshot(103.2),{openCase:{id:'research-one',caseId:first.caseId,state:'evidence_wait'}})
 expect(second).toMatchObject({caseId:first.caseId,status:'existing_case_update',paidCallAuthorized:false,publicationApproved:false})
 expect(inspect(snapshot(103),{eventCandidateIds:['rate-statement-v2'],previousChecks:[first.checkId],asOf:'2026-10-19T08:00:00Z'}))
  .toMatchObject({status:'duplicate_check',researchAllowed:false})
 expect(inspect(snapshot(101),{asOf:'2026-10-09T03:00:00Z',calendar:{status:'confirmed',expectedReferenceDate:'2026-10-09'},snapshot:snapshot(101,'2026-10-09'),
  openCase:{id:'research-one',caseId:first.caseId,state:'research'}}).triggers).toEqual([])
})

it('uses report base dates and keeps an overdue Monday check pending into Tuesday',()=>{
 expect(koreaDate('2026-10-04T16:00:00Z')).toBe('2026-10-05')
 expect(periodicDueDate('2026-10-05')).toBe('2026-10-19')
 expect(periodicDueDate('2026-10-09')).toBe('2026-10-26')
 expect(()=>periodicDueDate('2026-10-09T00:00:00Z')).toThrow('explicit_report_base_date_required')
 const tuesday=inspect(snapshot(100,'2026-10-19'),{asOf:'2026-10-20T00:00:00Z'})
 expect(tuesday).toMatchObject({periodicDueDate:'2026-10-19',resetPublicationAnchor:false})
 expect(tuesday.triggers).toContain('periodic')
})

it('resets only from a successful current market publication, and restores a valid older anchor after withdrawal',()=>{
 const newer=publication({id:'newer',publishedAt:'2026-10-16T00:00:00Z',snapshot:snapshot(104,'2026-10-15')})
 for(const extra of [{stored:false},{approved:false},{state:'pending'},{historical:true},{editorialOnly:true},{kind:'policy'},{priceReviewed:false}])
  expect(inspect(snapshot(),{publications:[publication(),{...newer,...extra}]}).anchorId).toBe('published-one')
 expect(inspect(snapshot(),{publications:[publication(),newer]})).toMatchObject({anchorId:'newer',periodicDueDate:'2026-11-02'})
 expect(inspect(snapshot(),{publications:[publication(),{...newer,withdrawn:true}]}).anchorId).toBe('published-one')
 expect(inspect(snapshot(),{publications:[]})).toMatchObject({anchorId:null,cumulativePct:null,triggers:['bootstrap']})
})

it('requires the expected reference date explicitly instead of guessing holidays or converting missing prices to zero change',()=>{
 const friday=snapshot(103,'2026-10-16')
 expect(inspect(friday,{calendar:{status:'confirmed',expectedReferenceDate:'2026-10-16'}}).status).toBe('research_candidate')
 expect(inspect(friday,{calendar:null})).toMatchObject({status:'data_wait',cumulativePct:null})
 expect(inspect(friday,{calendar:{status:'confirmed',expectedReferenceDate:'2026-10-19'}}).dataHolds).toContain('expected_reference_not_available')
 const imputed=snapshot();imputed.current.source='IMPUTED'
 expect(inspect(imputed).status).toBe('data_wait')
 const dataset={baseDate:'2026-10-16',fetchedAt:'2026-10-16T20:00:00Z',dailyRates:['2026-10-02','2026-10-15','2026-10-16'].map(date=>
  ({currency:'CLP',date,value:date==='2026-10-16'?103:100,status:'ok',source:'API',imputationMethod:'NONE',rateType:'LOCAL_PER_USD'}))}
 const saved=buildSharedDashboardPriceSnapshot({dataset,currency:'CLP',asOf:'2026-10-19T03:00:00Z'})
 expect(saved.numericHolds).toEqual(['older_saved_dataset_not_current_market'])
 expect(inspect(saved,{calendar:{status:'confirmed',expectedReferenceDate:'2026-10-16'}}))
  .toMatchObject({status:'research_candidate',calendarFreshnessAccepted:true,cumulativePct:expect.closeTo(3)})
 expect(inspect({...saved,numericHolds:[...saved.numericHolds,'dataset_collection_time_unverified']}).status).toBe('data_wait')
})

it('keeps the published denominator through history updates while holding incompatible price definitions',()=>{
 const revised=snapshot(103);revised.series[0].value=99
 expect(inspect(revised)).toMatchObject({status:'research_candidate',cumulativePct:expect.closeTo(3),comparisonHolds:[],
  comparisonDetails:[{date:'2026-10-02',publishedValue:100,currentHistoryValue:99,publishedProvider:null,currentProvider:null,
   resolution:'use_frozen_publication_value'}]})
 const other=snapshot(103);other.lineage.current.provider='new-provider'
 const old=publication();old.snapshot.lineage.current.provider='old-provider'
 expect(inspect(other,{publications:[old]}).comparisonHolds).toContain('reference_provider_changed')
 expect(inspect({...snapshot(),series:[]}).comparisonHolds).toEqual([])
 const imputedAnchor=snapshot(103);imputedAnchor.series[0].source='IMPUTED'
 expect(inspect(imputedAnchor).comparisonHolds).toEqual([])
 expect(inspect({...snapshot(),unit:'USD_per_CLP'}).comparisonHolds).toContain('reference_definition_changed')
})

it('prioritizes correction even during a price outage and keeps event investigation separate from price readiness',()=>{
 const result=inspect(snapshot(),{calendar:null,correctionReportIds:['published-one']})
 expect(result).toMatchObject({status:'correction_required',researchAllowed:true,resetPublicationAnchor:false})
 expect(inspect(snapshot(),{calendar:null,eventCandidateIds:['published-policy-v2']})).toMatchObject({status:'data_wait',researchAllowed:true,paidCallAuthorized:false})
 expect(inspect(snapshot(),{correctionReportIds:['unknown-report']}).triggers).not.toContain('correction')
 for(const extra of [{stored:false},{approved:false},{publishedAt:'2026-10-20T00:00:00Z'}])
  expect(inspect(snapshot(),{publications:[publication(extra)],correctionReportIds:['published-one']}).triggers).not.toContain('correction')
})

it('uses the confirmed six-country policy, rejects per-run overrides and leaves archived records untouched',()=>{
 for(const currency of ['BRL','MXN','COP','PEN','CLP','ARS']){
  const s=snapshot(103,'2026-10-19',currency),p=publication({currency,snapshot:snapshot(100,'2026-10-02',currency)})
  const old=structuredClone(p)
  expect(inspect(s,{publications:[p]})).toMatchObject({version:'publication-cadence/3',policyVersion:'six-currency-cadence/3',
   policyStatus:'confirmed',thresholdPct:2,periodicDueDate:'2026-10-19',triggers:['cumulative','periodic'],
   paidCallAuthorized:false,publicationApproved:false})
  expect(p).toEqual(old)
  expect(()=>inspect(s,{publications:[p],mode:'saved_replay',proposalThresholdPct:3})).toThrow('proposal_replay_only')
  expect(()=>inspect(s,{publications:[p],proposalThresholdPct:2})).toThrow('proposal_replay_only')
 }
 expect(()=>inspect(snapshot(),{proposalThresholdPct:3,mode:'saved_replay'})).toThrow('proposal_replay_only')
})

it('starts the fortnight on the report date, not delayed approval or a holiday observation, without reverting to older reports',()=>{
 for(const currency of ['BRL','MXN','COP','PEN','CLP','ARS']){
  const p=publication({currency,report:{baseDate:'2026-11-02'},publishedAt:'2026-11-08T02:13:00Z',snapshot:snapshot(100,'2026-10-30',currency)})
  const before=structuredClone(p)
  const run=(day:string,publications=[p])=>inspect(snapshot(100,day,currency),{asOf:`${day}T03:00:00Z`,publications})
  expect(run('2026-11-08')).toMatchObject({anchorBaseDate:'2026-11-02',anchorObservedDate:'2026-10-30',periodicDueDate:'2026-11-16',triggers:[],status:'no_active_trigger'})
  expect(run('2026-11-15').triggers).not.toContain('periodic')
  expect(run('2026-11-16').triggers).toContain('periodic')
  expect(run('2026-11-17').triggers).toContain('periodic')
  const older=publication({...p,id:'delayed-older',report:{baseDate:'2026-10-29'},snapshot:snapshot(99,'2026-10-28',currency),publishedAt:'2026-11-09T00:00:00Z'})
  expect(run('2026-11-16',[p,older]).anchorId).toBe(p.id)
  const next=publication({...p,id:'next',report:{baseDate:'2026-11-16'},snapshot:snapshot(100,'2026-11-16',currency),publishedAt:'2026-11-17T00:00:00Z'})
  expect(run('2026-11-17',[p,next])).toMatchObject({anchorId:'next',periodicDueDate:'2026-11-30',triggers:[]})
  expect(p).toEqual(before)
 }
})
