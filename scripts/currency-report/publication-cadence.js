// Local research decisions only. A trigger cannot generate, approve or publish.
import {validDate} from './core.js'
import {fingerprint} from './research-harness.js'
import {COUNTRY_REPORT_PROFILES,REPORT_REFERENCE_POLICY,SHARED_REPORT_RULE_VERSION,REPORT_CADENCE_POLICY_VERSION} from './shared-price-contract.js'
import {referenceRowOrigin} from './dashboard-reference-state.js'

export const PUBLICATION_CADENCE_VERSION='publication-cadence/2'
const stamp=s=>typeof s==='string'&&validDate(s.slice(0,10))&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s)&&Number.isFinite(Date.parse(s))
const id=s=>typeof s==='string'&&/^[a-zA-Z0-9:_-]{1,120}$/.test(s)
const add=(s,n)=>new Date(Date.parse(s+'T00:00:00Z')+n*86400000).toISOString().slice(0,10)
export function koreaDate(instant){
 if(!stamp(instant))throw Error('explicit_cadence_timestamp_required')
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant)).map(p=>[p.type,p.value]))
 return `${p.year}-${p.month}-${p.day}`
}
export function periodicDueDate(publishedAt){
 const eligible=add(koreaDate(publishedAt),14),weekday=new Date(eligible+'T00:00:00Z').getUTCDay()
 return add(eligible,(1-weekday+7)%7)
}
const calendarFreshness=(s,expected)=>validDate(expected)&&s?.current?.date===expected&&s.numericStatus==='hold'
 &&Array.isArray(s.numericHolds)&&s.numericHolds.length===1&&s.numericHolds[0]==='older_saved_dataset_not_current_market'
const cleanPoint=(s,expected=null)=>s?.current&&validDate(s.current.date)&&Number.isFinite(s.current.value)&&s.current.value>0
 &&s.current.rateType==='LOCAL_PER_USD'&&!!referenceRowOrigin(s.series??[],s.current)
 &&(s.numericStatus==='pass'||calendarFreshness(s,expected))&&s.referenceBasis?.status==='pass'
 &&s.referenceBasis.version===REPORT_REFERENCE_POLICY.version&&s.ruleVersion===SHARED_REPORT_RULE_VERSION
const anchorShape=r=>r&&id(r.id)&&COUNTRY_REPORT_PROFILES[r.currency]&&stamp(r.publishedAt)
 &&['market','periodic','policy','correction'].includes(r.kind)&&['published','pending','failed','rejected'].includes(r.state)
 &&['published_record','simulated'].includes(r.origin)
 &&['stored','approved','priceReviewed','historical','editorialOnly','withdrawn'].every(k=>typeof r[k]==='boolean')

export function evaluatePublicationCadence({snapshot,asOf,publications=[],calendar=null,previousChecks=[],openCase=null,
 eventCandidateIds=[],correctionReportIds=[],proposalThresholdPct=null,mode='local'}){
 const currency=snapshot?.currency,profile=COUNTRY_REPORT_PROFILES[currency]
 if(!profile||!stamp(asOf)||!['local','saved_replay'].includes(mode)||!Array.isArray(publications)||publications.length>1000
  ||publications.some(r=>!anchorShape(r))||new Set(publications.map(r=>r.id)).size!==publications.length
  ||!Array.isArray(previousChecks)||previousChecks.length>1000||previousChecks.some(s=>!/^[a-f0-9]{64}$/.test(s))
  ||[eventCandidateIds,correctionReportIds].some(a=>!Array.isArray(a)||a.length>32||a.some(s=>!id(s))||new Set(a).size!==a.length)
  ||mode==='local'&&publications.some(r=>r.origin==='simulated'))throw Error('invalid_cadence_input')
 if(proposalThresholdPct!==null&&(profile.cumulativeThresholdPct!==null||mode!=='saved_replay'
  ||![1,2,3,4,5].includes(proposalThresholdPct)))throw Error('cadence_proposal_replay_only')
 const before=fingerprint({snapshot,publications,calendar,openCase})
 const date=koreaDate(asOf),policyStatus=profile.cumulativeThresholdPct!==null?'confirmed'
  :proposalThresholdPct!==null?'proposal_replay_only':'decision_pending'
 const threshold=profile.cumulativeThresholdPct??proposalThresholdPct
 const candidates=publications.filter(r=>r.currency===currency&&r.state==='published'&&r.approved&&r.stored&&r.priceReviewed
  &&!r.historical&&!r.editorialOnly&&!r.withdrawn&&['market','periodic'].includes(r.kind)
  &&Date.parse(r.publishedAt)<=Date.parse(asOf)&&cleanPoint(r.snapshot)&&r.snapshot.currency===currency
  &&r.snapshot.current.date<=koreaDate(r.publishedAt))
 candidates.sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)||a.id.localeCompare(b.id))
 const anchor=candidates[0]??null
 const due=anchor&&threshold!==null?periodicDueDate(anchor.publishedAt):null
 const dataHolds=[],comparisonHolds=[],comparisonDetails=[]
 const expected=calendar?.status==='confirmed'?calendar.expectedReferenceDate:null
 if(!cleanPoint(snapshot,expected)||snapshot.current.date>date)dataHolds.push('current_reference_invalid_or_imputed')
 if(!calendar||calendar.status!=='confirmed'||!validDate(calendar.expectedReferenceDate)||calendar.expectedReferenceDate>date)
  dataHolds.push('expected_reference_date_unverified')
 else if(snapshot.current?.date!==calendar.expectedReferenceDate)dataHolds.push('expected_reference_not_available')
 let cumulativePct=null
 if(anchor&&!dataHolds.length){
  const old=anchor.snapshot
  if(snapshot.unit!==old.unit||snapshot.dateMeaning!==old.dateMeaning||snapshot.referenceBasis.version!==old.referenceBasis.version
   ||snapshot.ruleVersion!==old.ruleVersion)comparisonHolds.push('reference_definition_changed')
  const oldProvider=old.lineage?.current?.provider,currentProvider=snapshot.lineage?.current?.provider
  if(oldProvider&&currentProvider&&oldProvider!==currentProvider)comparisonHolds.push('reference_provider_changed')
  const points=snapshot.series?.filter(r=>r.date===old.current.date&&r.currency===currency&&r.rateType==='LOCAL_PER_USD')??[]
  if(points.length!==1||!referenceRowOrigin(snapshot.series??[],points[0]))
   comparisonHolds.push('anchor_revision_check_unavailable')
  else if(points[0].value!==old.current.value){
   comparisonHolds.push('anchor_value_revised')
   comparisonDetails.push({reason:'anchor_value_revised',date:old.current.date,publishedValue:old.current.value,
    currentHistoryValue:points[0].value,publishedProvider:oldProvider??null,currentProvider:currentProvider??null,
    resolution:'compare_original_source_records_no_automatic_rebase'})
  }
  if(!comparisonHolds.length)cumulativePct=(snapshot.current.value/old.current.value-1)*100
 }
 const correctionIds=correctionReportIds.filter(key=>publications.some(r=>r.id===key&&r.currency===currency
  &&r.state==='published'&&r.approved&&r.stored&&Date.parse(r.publishedAt)<=Date.parse(asOf)))
 const triggers=[]
 if(correctionIds.length)triggers.push('correction')
 if(!anchor)triggers.push('bootstrap')
 if(threshold!==null&&cumulativePct!==null&&Math.abs(cumulativePct)>=threshold)triggers.push('cumulative')
 if(due&&date>=due)triggers.push('periodic')
 if(eventCandidateIds.length)triggers.push('event_research')
 const caseId=fingerprint({version:PUBLICATION_CADENCE_VERSION,policyVersion:REPORT_CADENCE_POLICY_VERSION,currency,anchorId:anchor?.id??null,policyStatus,threshold})
 if(openCase&&(!id(openCase.id)||openCase.caseId!==caseId||!['research','evidence_wait','review_pending','failed'].includes(openCase.state)))
  throw Error('cadence_open_case_mismatch')
 const checkId=fingerprint({caseId,date,snapshotBinding:fingerprint(snapshot),calendar,correctionIds,eventCandidateIds})
 const duplicateCheck=previousChecks.includes(checkId),hasPriceHold=dataHolds.length>0||comparisonHolds.length>0
 const status=duplicateCheck?'duplicate_check':correctionIds.length?'correction_required':policyStatus==='decision_pending'?'policy_pending'
  :hasPriceHold?'data_wait':!triggers.length?'no_active_trigger':openCase?'existing_case_update':'research_candidate'
 const result={version:PUBLICATION_CADENCE_VERSION,policyVersion:REPORT_CADENCE_POLICY_VERSION,currency,checkedOnKst:date,policyStatus,thresholdPct:threshold,
  anchorId:anchor?.id??null,anchorObservedDate:anchor?.snapshot.current.date??null,periodicDueDate:due,cumulativePct,
  direction:cumulativePct===null?'unverified':cumulativePct>0?'local_currency_weaker':cumulativePct<0?'local_currency_stronger':'unchanged',
  status,triggers,caseId,checkId,duplicateCheck,dataHolds,comparisonHolds,comparisonDetails,correctionReportIds:correctionIds,
  researchAllowed:!duplicateCheck&&(correctionIds.length>0||eventCandidateIds.length>0||!hasPriceHold&&policyStatus!=='decision_pending'&&triggers.length>0),
  triggerIsEvidence:false,paidCallAuthorized:false,publicationApproved:false,resetPublicationAnchor:false,
  calendarMeaning:'expected_stored_reference_date_not_certified_local_close',
  calendarFreshnessAccepted:calendarFreshness(snapshot,expected),modelCalls:0,networkCalls:0}
 if(before!==fingerprint({snapshot,publications,calendar,openCase}))throw Error('cadence_input_mutated')
 return result
}
