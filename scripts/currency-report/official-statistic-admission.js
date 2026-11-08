// Deterministic numeric admission, not a new human/model semantic verdict.
// Definitions and use policy are server-owned; fetched text cannot approve itself.
import {createHash} from 'node:crypto'
import {fingerprint} from './research-harness.js'
import {validDate} from './core.js'
import {validateSelectedReviewCard} from './selected-source-collection.js'
import {INEGI_REPORT_INDICATORS,INEGI_DEFINITION_VERSION,inegiDefinitionId,inegiScopeMatches} from './inegi-report-indicators.js'
import {referenceMaterialHolds} from './reference-material-state.js'
import {researchSourceTimeIssue} from './research-needs.js'
import {reviewCountryOfficialInputs} from './official-country-statistics.js'
import {prepareOfficialPublication} from './official-publication.js'
import {officialBackgroundCoverage} from './official-background-coverage.js'

export const OFFICIAL_ADMISSION_VERSION='official-statistic-admission/1'
// Reuses the recorded 2026-10-28 numeric-use review, not an AI licence claim.
export const INEGI_NUMERIC_USE=Object.freeze({url:'https://www.inegi.org.mx/inegi/terminos.html',
 sha256:'97e97599169f75f455877e85edffcf941d512f56c5c00197ebfec783d802c67a',reviewedOn:'2026-10-28',
 scope:'numeric_metadata_and_code_authored_facts_only',local_analysis:'allowed',external_model:'allowed',public_display:'pending'})
const hash=v=>createHash('sha256').update(v).digest('hex')
const stamp=v=>typeof v==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))
const months=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const monthPattern=months.join('|')
const seal=value=>({...value,binding:fingerprint(value)})
const safeUrl=url=>{try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='www.inegi.org.mx'&&!u.search&&!u.hash&&!u.username&&!u.password&&!u.port}catch{return false}}

// The PDF supplies product, publication day and target month only. API values
// retain current-vintage provenance; PDF table cells are never guessed from text.
export function inspectInegiRelease(document,asOf) {
 const raw=Buffer.from(document?.rawBase64??'','base64'),x=document?.extraction
 if(!safeUrl(document?.url)||!stamp(document.collectedAt)||Date.parse(document.collectedAt)>Date.parse(asOf)
  ||raw.length>2_000_000||raw.length<10||!raw.subarray(0,5).equals(Buffer.from('%PDF-'))||!raw.subarray(-2048).includes(Buffer.from('%%EOF'))
  ||document.sha256!==hash(raw)||x?.version!=='monthly-pdf-text/1'||x.sha256!==document.sha256||x.bytes!==raw.length
  ||!Array.isArray(x.pages)||!x.pages.length||x.pages.length>24||!x.pages.every((p,i)=>p.page===i+1&&typeof p.text==='string'&&p.text.length<=40000&&p.textHash===hash(p.text)))
  throw Error('official_release_extraction_binding_required')
 const header=x.pages[0].text.normalize('NFC').replace(/\s+/gu,' ').trim()
 const product=/\/emec\/emec\d{4}_\d{2}\.pdf$/.test(document.url)?'emec':/\/inpc\/inpc_2q\d{4}_\d{2}\.pdf$/.test(document.url)?'inpc':null
 const name=product==='emec'?/ENCUESTA MENSUAL SOBRE EMPRESAS COMERCIALES \(EMEC\)/:/ÍNDICE NACIONAL DE PRECIOS AL CONSUMIDOR \(INPC\)/
 const date=new RegExp(`^(?:BOLETÍN DE INDICADOR \\d+/\\d+ )?.*?${product==='emec'?'INDICADORES DE EMPRESAS COMERCIALES':'\\(INPC\\)'} (\\d{1,2}) de (${monthPattern}) de (\\d{4}) Página 1/`,'u').exec(header)
 if(!product||!name.test(header)||!date)throw Error('official_release_header_changed')
 const publishedOn=`${date[3]}-${String(months.indexOf(date[2])+1).padStart(2,'0')}-${date[1].padStart(2,'0')}`
 const targetPattern=product==='emec'?`[Ee]n (${monthPattern}) de (\\d{4}), (?:a tasa mensual|los ingresos)`
  :`En (${monthPattern}) de (\\d{4}), el INPC presentó`
 const periods=[...new Set([...header.matchAll(new RegExp(targetPattern,'gu'))].map(m=>`${m[2]}-${String(months.indexOf(m[1])+1).padStart(2,'0')}`))]
 // Only registered product lead sentences establish the period. Comparisons,
 // next-publication dates and filenames cannot fill or override this field.
 const period=periods.length===1?periods[0]:null,fileMonth=/([0-9]{4})_([0-9]{2})\.pdf$/.exec(document.url)
 if(!validDate(publishedOn)||!period||`${period}-01`>publishedOn||publishedOn>document.collectedAt.slice(0,10)
  ||publishedOn>asOf.slice(0,10)||`${fileMonth?.[1]}-${fileMonth?.[2]}`!==publishedOn.slice(0,7))
  throw Error('official_release_time_or_period_unverified')
 const issue=researchSourceTimeIssue({publishedAt:publishedOn,collectedAt:document.collectedAt},asOf)
 if(issue)throw Error(`official_release_${issue}`)
 return {product,period,publishedOn,publicationPrecision:'day',publicationTime:null,url:document.url,sha256:document.sha256,
  collectedAt:document.collectedAt,extractionHash:fingerprint(x),method:'registered_header_parser_not_pdf_numeric_or_visual_review'}
}

export function reviewOfficialStatistics({currency,collections=[],documents=[],terms,countryInputs,asOf}) {
 if(!stamp(asOf)||!Array.isArray(collections)||collections.length>8||!Array.isArray(documents)||documents.length>8)throw Error('official_admission_input_required')
 const country=reviewCountryOfficialInputs({currency,inputs:countryInputs,asOf})
 const rows=[...country.rows],candidates=[...country.candidates],releases=[]
 for(const d of documents)try{releases.push(inspectInegiRelease(d,asOf))}catch(e){rows.push({status:'release_hold',reason:e.message})}
 const termsReady=terms?.url===INEGI_NUMERIC_USE.url&&typeof terms.text==='string'&&Buffer.byteLength(terms.text)<=200000
  &&hash(terms.text)===INEGI_NUMERIC_USE.sha256&&terms.sha256===INEGI_NUMERIC_USE.sha256
  &&stamp(terms.collectedAt)&&Date.parse(terms.collectedAt)<=Date.parse(asOf)&&INEGI_NUMERIC_USE.reviewedOn<=asOf.slice(0,10)
 for(const collection of collections)for(const card of collection.reviewQueue??[]){
  const row={sourceId:card.sourceId,cardBinding:card.binding,status:'held',reason:null}
  rows.push(row)
  try{
   if(collection.currency!==currency)throw Error('official_country_mismatch')
   const {original:o}=validateSelectedReviewCard(collection,card)
   if(currency!=='MXN'&&country.candidates.some(c=>c.sourceId===o.sourceId)){
    row.status='handled_by_registered_country_profile';continue
   }
   if(o.kind!=='statistic'||o.sourceId!=='mxn-consumer'||currency!=='MXN')throw Error(o.kind==='official_pdf'?'official_pdf_numeric_parser_required':'official_definition_release_use_profile_required')
   const def=INEGI_REPORT_INDICATORS.find(d=>d.indicatorId===o.seriesId)
   if(!def||o.definitionVersion!==INEGI_DEFINITION_VERSION||o.definitionId!==inegiDefinitionId(def)||!inegiScopeMatches(o.scope,def)
    ||o.unit!==o.scope.unit||o.metadata?.definitionId!==o.definitionId)throw Error('official_definition_mismatch')
   if(!stamp(o.collectedAt)||Date.parse(o.collectedAt)>Date.parse(asOf))
    throw Error('official_capture_time_or_binding_invalid')
   const period=o.requestedPeriod,observations=o.observations.filter(r=>r.period===period)
   row.period=period;row.seriesId=o.seriesId
   const latestPeriod=o.observations.map(r=>r.period).sort().at(-1)
   if(observations.length===0&&/^\d{4}-(0[1-9]|1[0-2])$/.test(period??'')&&latestPeriod&&period>latestPeriod){
    row.status='requested_period_not_in_captured_series';row.latestCapturedPeriod=latestPeriod;continue
   }
   if(period===latestPeriod&&observations.length===1&&!Number.isFinite(observations[0].value))row.latestObservationMissing=true
   if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period??'')||!card.targets.some(t=>t.requestedPeriod===period&&fingerprint(t.requestedScope)===fingerprint(o.scope))
    ||observations.length!==1||!Number.isFinite(observations[0].value))throw Error('official_period_or_value_missing')
   const age=(Number(asOf.slice(0,4))-Number(period.slice(0,4)))*12+Number(asOf.slice(5,7))-Number(period.slice(5,7))
   if(age<0||age>3)throw Error('official_background_outside_collection_window')
   const observation=observations[0],product=def.scope.metric==='retail'?'emec':'inpc'
   const matching=releases.filter(r=>r.product===product&&r.period===period)
   if(!matching.length)throw Error('official_release_missing_not_provider_update')
   if(new Set(matching.map(r=>r.sha256)).size!==1)throw Error('official_release_revision_unresolved')
   if(!termsReady)throw Error('official_numeric_use_terms_missing_or_changed')
   if(o.metadata.derived===true&&(!Number.isFinite(observation.indexValue)||!(observation.baseValue>0)
    ||observation.basePeriod!==`${Number(period.slice(0,4))-1}${period.slice(4)}`
    ||Math.abs(observation.value-100*(observation.indexValue/observation.baseValue-1))>1e-9))throw Error('official_derived_value_mismatch')
   const release=matching[0],key=`${o.seriesId}:${period}:${o.scope.comparison}`
   candidates.push({key,sourceId:o.sourceId,seriesId:o.seriesId,definitionId:o.definitionId,definitionVersion:o.definitionVersion,
    scope:structuredClone(o.scope),period,value:observation.value,label:def.label,collectedAt:o.collectedAt,sourceUrl:o.url,
    release,originalBinding:fingerprint(o),cardBinding:card.binding,derived:o.metadata.derived===true,
    providerUpdateDisplay:o.metadata.lastUpdateDisplay??null,archivedAsOfRelease:false,
    observationStatusCode:observation.statusCode??null,
    baseObservationStatusCode:o.metadata.derived===true?o.observations.find(r=>r.period===observation.basePeriod)?.statusCode??null:null})
   row.status='numeric_candidate';row.key=key
  }catch(e){row.reason=/^[a-z0-9_]+$/.test(e.message)?e.message:'official_statistic_validation_failed'}
 }
 const admitted=[]
 for(const key of new Set(candidates.map(r=>r.key))){
  const values=candidates.filter(r=>r.key===key)
  if(new Set(values.map(r=>r.value)).size>1){rows.push({status:'held',key,reason:'official_current_vintage_conflict'});continue}
  const latest=[...values].sort((a,b)=>Date.parse(b.collectedAt)-Date.parse(a.collectedAt))[0]
  if(rows.some(r=>r.seriesId===latest.seriesId&&r.latestObservationMissing&&r.period>latest.period)){
   rows.push({status:'held',key,reason:'official_latest_observation_missing_not_replaced_with_older_month'});continue
  }
  // Keep latest verified target month per series/comparison, not every month.
  if(candidates.some(r=>r.seriesId===latest.seriesId&&r.scope.comparison===latest.scope.comparison&&r.period>latest.period))continue
  admitted.push(latest)
 }
 if(!rows.length)rows.push({status:'not_collected',reason:'official_originals_unavailable_not_verified_absence'})
 for(const row of rows)if(row.reason&&row.period&&admitted.some(s=>s.seriesId===row.seriesId&&s.period>row.period)){
  row.diagnosticReason=row.reason;row.reason=null;row.status='older_requested_period_not_used'
 }
 const body={version:OFFICIAL_ADMISSION_VERSION,currency,asOf,rows,admitted,
  status:admitted.length?'numeric_background_ready_for_manuscript_review':'official_background_held',
  automaticChecks:'definition_period_release_revision_terms_numeric_integrity',semanticReview:'not_performed',
  directCauseAllowed:false,publicationApproved:false,modelCalls:0,newPaidCostUsd:0}
 return seal(body)
}

export function attachOfficialBackground(handoff,admission) {
 const c=handoff.materialConnection,{binding,...body}=c,{binding:aBinding,...a}=admission??{}
 if(binding!==fingerprint(body)||admission?.version!==OFFICIAL_ADMISSION_VERSION||aBinding!==fingerprint(a)
  ||admission.currency!==c.currency||Date.parse(admission.asOf)>Date.parse(c.asOf))throw Error('bound_official_admission_required')
 const next=structuredClone(handoff),n=next.materialConnection
 // Rebuild only this adapter's numeric rows. Failed fresh checks cannot leave
 // a previously accepted same-series fact masquerading as newly verified.
 n.sections.consumer_background=n.sections.consumer_background.filter(r=>!r.officialStatistic)
 const existing=Object.values(n.sections).flat(),capacity=Math.max(0,8-new Set(existing.map(r=>r.evidenceId)).size)
 const selected=admission.admitted.slice(0,capacity)
 for(const s of selected){
  const evidenceId=`stat-auto-${fingerprint(s).slice(0,24)}`,factId=`official_${s.seriesId}_${s.scope.comparison}`
  const direction=s.value>0?'높아졌다':s.value<0?'낮아졌다':'같았다',publisher=s.publisher??'INEGI'
  const comparator=s.scope.comparison==='month_over_month'?'전월':'전년 동월'
  const text=s.scope.comparison==='level'?s.scope.unit==='index'?'전국 소매업의 실질 매출 수준을 나타내는 지수다.':`${s.subjectLabel}의 해당 대상 월 관측 수준이다.`
   :`${s.subjectLabel??(s.scope.metric==='retail'?'전국 소매업 실질 매출':'전체 소비자물가')}은 ${comparator}보다 ${direction}.`
  const unit=s.scope.unit==='index'?'(2018=100)':s.scope.unit==='percent_effective_annual'?'% (유효 연율)':'%'
  const label=!s.profileId&&s.scope.metric==='retail'&&s.scope.comparison==='year_over_year'?`${s.label.replace(/ 지수$/u,'')} · 전년 동월 대비`:s.label
  const adjustment=s.scope.adjustment==='seasonally_adjusted'?'계절조정':'비계절조정'
  const fact={id:factId,value:s.value,label:`${s.period} · ${label} · ${Number(s.value.toFixed(2))}${unit} · ${adjustment}${s.provisional===true?' · 잠정':''}`}
  const policy=s.usePolicy??INEGI_NUMERIC_USE
  const transformation=s.usePolicy?.transformation??'수치 정리·계산·해석: LATAM FX. INEGI의 공식 견해나 보증이 아닙니다.'
  const sourceCredit={resourceId:evidenceId,publisher,sourceUrl:s.sourceUrl,publishedAt:s.release.publishedOn,referencePeriod:s.period,
   attribution:s.usePolicy?.credit??`Fuente: INEGI. ${s.label}.`,transformation}
  const publication=prepareOfficialPublication({statistic:s,credit:sourceCredit,currency:c.currency})
  n.sections.consumer_background.push({evidenceId,claimId:'numeric-background',role:'consumer_background',kind:'source_fact',text,country:c.currency,
   publisher,sourceUrl:s.sourceUrl,publishedAt:s.release.publishedOn,collectedAt:s.collectedAt,eventDate:null,referencePeriod:s.period,
   sourcePeriod:s.period,sourceSessionDate:null,roleReviewSessionDate:null,bodyAvailableAt:s.collectedAt,articlePriceBasis:{unit:s.scope.unit,comparison:s.scope.comparison},
   scope:s.scope,allowedUse:'정의된 지표·상품·채널과 대상 월의 소비·금융 배경 설명에만 사용한다.',countercontext:'당일 환율 원인·가전·TV·회사 판매로 확대하지 않는다.',
   excludedExpansions:['fx_cause','company_sales','cross_period_arithmetic'],coverageGaps:[],crossSourceClaims:[],passageIds:['p0'],attributions:[],
   sourceUses:Object.fromEntries(['local_analysis','external_model','public_display'].map(use=>[use,{status:use==='public_display'&&publication?'allowed':policy[use],
    reason:use==='public_display'&&publication?'registered_numeric_conditions_delivered_by_code_not_content_or_publication_approval':'registered_numeric_use_policy_conditions_preserved'}])),
   sourceCredit,evidenceBinding:s.originalBinding,scopeBinding:fingerprint(s.scope),savedSupport:'registered_numeric_definition_and_deterministic_checks_not_human_review',
   referenceRateCausalityEstablished:false,writingContext:{periodMeaning:'indicator_period',observationWindow:'not_applicable',
    constraint:'확인한 대상 월의 수집 통계 판본이다. 발표 당시의 값·오늘 소비·당일 환율 원인으로 바꾸지 않는다.'},
   sourceVersion:{publishedAt:s.release.publishedOn,modifiedAt:null,bodyAvailableBy:s.collectedAt,support:'registered_statistic_integrity_checks',
    availabilityBasis:s.availability?.basis??'current_series_not_archived_release_values'},
   officialStatistic:{version:OFFICIAL_ADMISSION_VERSION,fact,seriesId:s.seriesId,definitionVersion:s.definitionVersion,definitionId:s.definitionId,scope:structuredClone(s.scope),
    releaseUrl:s.release.url,publicationTime:null,releaseHash:s.release.sha256,editionHash:s.release.editionHash??s.release.sha256,currentSnapshotAt:s.collectedAt,archivedAsOfRelease:false,
    observationStatus:{code:s.observationStatusCode??null,baseCode:s.baseObservationStatusCode??null,meaning:'source_code_preserved_not_interpreted_as_final_or_provisional'},
    ...(s.availability?{availability:s.availability}:{}),
    provisional:s.provisional??null,calculation:s.calculation??null,
    ...(publication?{publication}:{}),
    providerUpdateMeaning:'provider_update_label_not_publication_timestamp',usePolicyVersion:s.usePolicy?fingerprint(s.usePolicy):INEGI_NUMERIC_USE.sha256}})
 }
 n.officialBackground={version:OFFICIAL_ADMISSION_VERSION,admissionBinding:aBinding,status:admission.status,admitted:selected.length,
  omittedBySourceBudget:admission.admitted.length-selected.length,checks:admission.rows,coverage:officialBackgroundCoverage({...admission,admitted:selected}),semanticReview:'pending_manuscript_review',publicationApproved:false}
 n.holds=referenceMaterialHolds({sections:n.sections,held:n.held,priorHolds:n.holds,priceHeld:n.holds.includes('shared_reference_price_held')})
 delete n.binding;n.binding=fingerprint(n)
 return next
}
