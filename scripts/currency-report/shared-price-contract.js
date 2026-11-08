// Common admission contract for NEW local preparation. Archived manuscripts
// and their original price reviews remain immutable historical evidence.
import {createHash} from 'node:crypto'
import {validDate} from './core.js'
import {MARKET_ZONES} from './market-calendar.js'
import {getDashboardDaily,getDashboardPreviousDaily,getDashboardDailyChange} from '../../src/lib/dashboard-price.js'
import {referenceRowOrigin} from './dashboard-reference-state.js'

export const SHARED_REPORT_RULE_VERSION='shared-dashboard-report/3'
// Semantic price edition, shared by case ownership and paid request identity.
// Fetch clocks/response hashes do not turn unchanged reference values into new work.
export function referenceEdition(snapshot) {
 return {currency:snapshot.currency,baseDate:snapshot.baseDate,series:snapshot.series,
  referencePolicy:snapshot.referenceBasis.version,
  providers:Object.fromEntries(Object.entries(snapshot.lineage).map(([key,value])=>[key,{
   provider:value.provider,providerDate:value.providerDate,providerUpdatedAt:value.providerUpdatedAt,
   priceKind:value.priceKind,dateMeaning:value.dateMeaning}]))}
}
// A user-authorized working assumption, not a provider or company certification.
// Changing this policy creates a new snapshot; archived reports keep their basis.
export const REPORT_REFERENCE_POLICY=Object.freeze({
 version:'dashboard-reference-policy/1',priceAuthority:'dashboard_dataset',
 rateRole:'working_reference_rate',companyRateEquivalence:'assumed_pending_user_confirmation',
 companyRateVerified:false,officialReferenceVerified:false,localCloseRequired:false,
 referenceDateMeaning:'stored_dataset_date',articlePriceRole:'supplementary_context_only',
})
export const SHARED_REFERENCE_WRITING_GUIDE=Object.freeze([
 '대표 숫자·변화율·차트·발행 판단은 대시보드와 같은 고정 기준환율 스냅샷을 사용한다.',
 '회사 기준환율과의 동일성은 사용자 확인 전 작업 가정이다. 공식 회사 환율 또는 현지 종가로 단정하지 않는다.',
 '기준일은 저장 데이터 날짜다. 확인되지 않은 현지 거래일·관측시각·산정 기간을 만들지 않는다.',
 '뉴스 설명은 근거가 지지하는 시장 거래일·기간에 귀속한다. 기준환율 전체 변화의 직접 원인으로 자동 연결하지 않는다.',
 '종가·장중 가격은 필요한 설명의 보조 자료다. 없다고 기본 가격을 바꾸지 않으며, 있으면 출처·가격 종류·시점을 별도로 표시한다.',
])
export const REPORT_CURRENCIES=Object.freeze(['BRL','MXN','COP','PEN','CLP','ARS'])
// Publication policy has its own version: changing cadence must not rewrite a
// frozen price snapshot or imply that archived reports used the new policy.
export const REPORT_CADENCE_POLICY_VERSION='six-currency-cadence/3'
export const COUNTRY_REPORT_PROFILES=Object.freeze(Object.fromEntries(REPORT_CURRENCIES.map(currency=>[currency,Object.freeze({
 currency,marketTimeZone:MARKET_ZONES[currency],unit:`${currency}_per_USD`,
 // Calendar identity does not imply that its holidays or a close have been verified.
 holidayCalendarStatus:'not_bound_to_dataset',
 sourceRegistry:'docs/2.0/six-currency-explanation-sources-20261027.json',
 indicatorDefinitionPolicy:'series_unit_period_adjustment_and_revision_required',
 priceAuthority:'dashboard_dataset',articlePriceRole:'context_only',referencePolicyVersion:REPORT_REFERENCE_POLICY.version,
 cadencePolicyVersion:REPORT_CADENCE_POLICY_VERSION,
 cumulativeThresholdPct:2,
 periodicPolicy:'first_monday_on_or_after_report_base_date_plus_14_days',
})])))
export const COMMON_REPORT_REQUIREMENTS=Object.freeze([
 'shared_price_snapshot','price_quality','reference_rate_basis','evidence_period_and_scope',
 'claim_support','source_use_and_attribution','consumer_context_separate','independent_publication_approval',
])
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const stamp=v=>typeof v==='string'&&validDate(v.slice(0,10))&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))
const positive=v=>Number.isFinite(v)&&v>0
const project=row=>row?Object.fromEntries(['currency','date','rateType','value','status','source','imputationMethod'].map(k=>[k,row[k]??null])):null

export function readDashboardPriceLineage(dataset,row) {
 const unknown=reason=>({status:'unverified',reason,provider:null,providerUpdatedAt:null,providerTimestampLocal:null,providerDate:null,
  dateMeaning:null,priceKind:null,providerTimeZone:null,transport:null,capturedAt:null,responseSha256:null,observedAt:null,localSessionDate:null})
 const book=dataset.priceProvenance
 if(!row||!book)return unknown('source_record_missing')
 if(book.version!=='fx-price-provenance/1')return unknown('source_record_version_unsupported')
 if(row.source!=='API'||row.imputationMethod!=='NONE')return unknown('imputed_or_non_api_price')
 const entry=book.quotesByDate?.[row.date]?.[row.currency],source=book.sources?.[entry?.sourceId]
 if(!entry)return unknown('source_record_missing')
 if(!positive(row.value)||entry?.value!==row.value||!source)return unknown('source_record_price_mismatch')
 if(source.origin!=='response')return unknown('cached_or_injected_source_unverified')
 const providers=['frankfurter_v1','exchange_rate_api','open_er_api','currency_api','alpha_vantage']
 const kinds=['conversion_reference','provider_daily_close']
 const meanings=['utc_update_date','collection_date_fallback','provider_payload_date','provider_series_date','requested_snapshot_date']
 let endpoint
 try{endpoint=new URL(source.endpoint)}catch{return unknown('source_record_invalid')}
 const endpoints=['https://api.frankfurter.dev/v1','https://api.frankfurter.app/',
  'https://v6.exchangerate-api.com/v6','https://open.er-api.com/v6',
  'https://latest.currency-api.pages.dev/v1/currencies','https://www.alphavantage.co/query']
 const snapshotEndpoint=/^https:\/\/cdn\.jsdelivr\.net\/npm\/@fawazahmed0\/currency-api@\d{4}-\d{2}-\d{2}\/v1\/currencies\/usd\.json$/
 const providerHosts={frankfurter_v1:['api.frankfurter.dev','api.frankfurter.app'],exchange_rate_api:['v6.exchangerate-api.com'],
  open_er_api:['open.er-api.com'],currency_api:['latest.currency-api.pages.dev','cdn.jsdelivr.net'],alpha_vantage:['www.alphavantage.co']}
 if(!providers.includes(source.provider)||!kinds.includes(source.priceKind)||!meanings.includes(source.dateMeaning)
  ||!stamp(source.capturedAt)||Date.parse(source.capturedAt)>Date.parse(dataset.fetchedAt)
  ||source.providerUpdatedAt!==null&&(!stamp(source.providerUpdatedAt)||Date.parse(source.providerUpdatedAt)>Date.parse(source.capturedAt))
  ||source.providerDate!==null&&!validDate(source.providerDate)
  ||source.providerTimestampLocal!=null&&(typeof source.providerTimestampLocal!=='string'||!/^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(source.providerTimestampLocal))
  ||source.observedAt!==null||source.localSessionDate!==null
  ||source.providerTimeZone!==null&&(typeof source.providerTimeZone!=='string'||source.providerTimeZone.length>80)
  ||source.transport!=null&&!['direct','corsproxy','allorigins','unknown'].includes(source.transport)
  ||source.digestMeaning!=='parsed_json'||!/^[a-f0-9]{64}$/.test(source.responseSha256??'')
  ||!providerHosts[source.provider]?.includes(endpoint.hostname)
  ||(source.provider==='alpha_vantage')!==(source.priceKind==='provider_daily_close')
  ||endpoint.search||endpoint.hash||!endpoints.includes(endpoint.href)&&!snapshotEndpoint.test(endpoint.href))return unknown('source_record_invalid')
 if(source.providerTimeZone!==null){try{new Intl.DateTimeFormat('en',{timeZone:source.providerTimeZone})}catch{return unknown('source_record_invalid')}}
 return {status:'recorded',reason:'provider_recorded_market_session_unverified',provider:source.provider,
  providerUpdatedAt:source.providerUpdatedAt,providerDate:source.providerDate,dateMeaning:source.dateMeaning,
  providerTimestampLocal:source.providerTimestampLocal??null,
  priceKind:source.priceKind,providerTimeZone:source.providerTimeZone,capturedAt:source.capturedAt,
  transport:source.transport??'unknown',
  responseSha256:source.responseSha256,observedAt:null,localSessionDate:null}
}

export function buildSharedDashboardPriceSnapshot({dataset,currency,asOf,calendar}) {
 if(!REPORT_CURRENCIES.includes(currency)||!validDate(dataset?.baseDate)||!Array.isArray(dataset.dailyRates)
  ||!stamp(asOf)||dataset.baseDate>asOf.slice(0,10))throw new Error('shared_dashboard_dataset_required')
 const all=dataset.dailyRates.filter(r=>r.currency===currency&&r.rateType==='LOCAL_PER_USD')
 if(all.some(r=>!validDate(r.date)))throw new Error('invalid_stored_price_date')
 const current=getDashboardDaily(all,currency,dataset.baseDate),previous=getDashboardPreviousDaily(all,currency,dataset.baseDate)
 const change=getDashboardDailyChange(current,previous),holds=[]
 const currentOrigin=referenceRowOrigin(all,current),previousOrigin=referenceRowOrigin(all,previous)
 const lineage={current:readDashboardPriceLineage(dataset,currentOrigin??current),previous:readDashboardPriceLineage(dataset,previousOrigin??previous)}
 const dataBinding=hash({baseDate:dataset.baseDate,fetchedAt:dataset.fetchedAt??null,
  dataVersion:dataset.dataVersion??null,rows:all.map(project),lineage})
 // Preserve first-row selection exactly as the dashboard does. Reject duplicates
 // for analysis rather than silently picking a different quote or merging prices.
 const counts=new Map();for(const r of all)counts.set(r.date,(counts.get(r.date)??0)+1)
 if([...counts.values()].some(n=>n>1))holds.push('duplicate_stored_price_dates')
 for(const [name,row] of [['current',current],['previous',previous]]) {
  if(!row||!positive(row.value)||row.status!=='ok')holds.push(`${name}_price_missing_or_invalid`)
  else if(!referenceRowOrigin(all,row))holds.push(`${name}_price_imputed_or_unknown`)
 }
 if(!stamp(dataset.fetchedAt)||Date.parse(dataset.fetchedAt)>Date.parse(asOf))holds.push('dataset_collection_time_unverified')
 // A separately confirmed expected reference date can cover a weekend/holiday;
 // it never clears a missing, duplicate, imputed or inconsistent provider row.
 const expectedCurrent=calendar?.status==='confirmed'&&calendar.expectedReferenceDate===dataset.baseDate
  &&current?.date===dataset.baseDate
 if(dataset.baseDate<asOf.slice(0,10)&&!expectedCurrent)holds.push('older_saved_dataset_not_current_market')
 const series=all.filter(r=>r.date<=dataset.baseDate).map(project).sort((a,b)=>a.date.localeCompare(b.date))
 // Recorded response metadata is not a certification of a local market close.
 const recorded=lineage.current.status==='recorded'
 const basis={required:false,provider:lineage.current.provider,localSessionDate:null,observedAt:null,priceKind:lineage.current.priceKind,
  status:'unverified',reason:recorded?'provider_recorded_market_session_unverified':'stored_rows_do_not_record_provider_session_or_price_kind'}
 // Absent legacy provenance is disclosed, not promoted to a local close or a
 // new universal blocker. Present but inconsistent provenance still blocks.
 const invalidReasons=['source_record_invalid','source_record_price_mismatch','source_record_version_unsupported']
 const referenceHolds=Object.entries(lineage).filter(([,source])=>invalidReasons.includes(source.reason))
  .map(([name,source])=>`${name}_${source.reason}`)
 const referenceWarnings=Object.entries(lineage).filter(([,source])=>source.status!=='recorded')
  .map(([name,source])=>`${name}_${source.reason}`)
 if(lineage.current.provider&&lineage.previous.provider&&lineage.current.provider!==lineage.previous.provider)
  referenceWarnings.push('provider_changed_between_reference_values')
 const referenceBasis={...REPORT_REFERENCE_POLICY,status:referenceHolds.length?'hold':'pass',
  reason:referenceHolds.length?'inconsistent_source_record':'user_authorized_reference_rate_working_assumption',
  verificationStatus:'working_assumption',holds:referenceHolds,warnings:referenceWarnings}
 return {
  ruleVersion:SHARED_REPORT_RULE_VERSION,currency,unit:`${currency}_per_USD`,dataBinding,
  baseDate:dataset.baseDate,fetchedAt:dataset.fetchedAt??null,dataVersion:dataset.dataVersion??null,
  current:project(current),previous:project(previous),
  ...(current?.imputationMethod==='FFILL'||previous?.imputationMethod==='FFILL'?{carryForward:{
   version:'dashboard-carry-forward/1',currentOrigin:project(currentOrigin),previousOrigin:project(previousOrigin),
   meaning:'same_dashboard_value_not_new_market_observation',holidayConfirmed:false}}:{}),
  changePct:Number.isFinite(change)?change*100:null,
  direction:!Number.isFinite(change)?'unknown':change>0?'local_currency_weaker':change<0?'local_currency_stronger':'unchanged',
  label:'대시보드 기준환율 · 데이터 기준일',dateMeaning:'stored_dataset_date',
  numericStatus:holds.length?'hold':'pass',numericHolds:holds,basis,referenceBasis,lineage,series,
  snapshotId:hash({ruleVersion:SHARED_REPORT_RULE_VERSION,currency,dataBinding,referencePolicy:REPORT_REFERENCE_POLICY}),
  articleCanReplacePrice:false,productionSnapshotVerified:false,
 }
}

export function assessSharedReportContract({snapshot,legacyResult}) {
 const checks=COMMON_REPORT_REQUIREMENTS.map(id=>({id,status:'unverified',reason:'review_required_for_new_shared_price_basis'}))
 const set=(id,status,reason)=>Object.assign(checks.find(c=>c.id===id),{status,reason})
 set('shared_price_snapshot','pass','same_selector_and_calculation_as_dashboard')
 set('price_quality',snapshot.numericStatus,snapshot.numericHolds.join(',')||'stored_values_valid')
 set('reference_rate_basis',snapshot.referenceBasis.status,snapshot.referenceBasis.reason)
 set('evidence_period_and_scope','unverified','market_commentary_requires_its_own_period_and_claim_binding_not_a_mandatory_close')
 set('consumer_context_separate','unverified',legacyResult?.consumer??'no_saved_review')
 set('independent_publication_approval','hold','new_snapshot_does_not_inherit_prior_approval')
 return {ruleVersion:SHARED_REPORT_RULE_VERSION,referencePolicyVersion:REPORT_REFERENCE_POLICY.version,checks,
  companyRateEquivalence:REPORT_REFERENCE_POLICY.companyRateEquivalence,localCloseRequired:false,
  materialState:legacyResult?.status??'not_replayed',writingEligibility:'hold',
  contentQuality:'not_evaluated_for_new_snapshot',publicationApproval:'not_approved',
  holds:checks.filter(c=>c.status!=='pass').map(c=>c.id),
  // Partial material readiness is not an executable prompt or API request.
  request:null,paidCallAuthorized:false,publicationApproved:false}
}
