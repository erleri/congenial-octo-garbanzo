// Reuse the existing registered statistic collectors. These are pending data,
// never news-cause claims or automatically approved economic interpretations.
import {planResearchSourceSelection,compileResearchSourceCatalog} from './research-source-selection.js'
import {collectSelectedResearch} from './selected-source-collection.js'
import {INEGI_REPORT_INDICATORS} from './inegi-report-indicators.js'
import {reviewOfficialStatistics} from './official-statistic-admission.js'
import {officialCountryProfiles} from './official-country-statistics.js'
import {officialBackgroundCoverage} from './official-background-coverage.js'
export async function acquireOfficialBackground({snapshot,asOf,sourcePlan,sourceRegister,mode='saved',captures=[],fetchImpl,
 checkpoint=async()=>{},now=()=>new Date().toISOString(),inegiCaptures=[],pdfCaptures=[],officialDocuments=[],officialTerms,countryOfficialInputs}) {
 const catalog=compileResearchSourceCatalog(sourcePlan,sourceRegister),country=catalog.countries.find(c=>c.currency===snapshot.currency)
 const official=country.officialRefs.map(id=>catalog.sources.find(s=>s.id===id))
 const registered=countryOfficialInputs?officialCountryProfiles().filter(p=>p.currency===snapshot.currency):[]
 const metrics=[{metric:'retail',roles:['retail_volume','retail_statistics','retail_and_appliance_survey']},
  {metric:'consumer_prices',roles:['consumer_statistics']},
  {metric:'consumer_credit',roles:['consumer_finance']},
  {metric:'policy_target_rate',roles:['policy_context']},
  {metric:'real_pay',roles:['real_pay']},
  {metric:'economic_activity',roles:['economic_activity_background']}].filter(m=>official.some(s=>m.roles.includes(s.role)&&!registered.some(p=>p.sourceId===s.id))
   ||snapshot.currency==='MXN'&&INEGI_REPORT_INDICATORS.some(d=>d.scope.metric===m.metric))
 const periods=Array.from({length:4},(_,i)=>new Date(Date.UTC(Number(asOf.slice(0,4)),Number(asOf.slice(5,7))-1-i,1)).toISOString().slice(0,7))
 const collections=[],states=[]
 for(const profile of registered)states.push({metric:profile.scope.metric,comparison:profile.scope.comparison,
  status:'registered_country_input_pending_admission',profileId:profile.id,
  sourceStates:[{sourceId:profile.sourceId,status:'registered_input_reused_without_duplicate_fetch'}],writingEligible:false})
 for(const m of metrics){
  // Source-defined units are a collection target, not an admitted scope. Exact
  // unit, release date, revision and use review are still mandatory afterwards.
  const definitions=snapshot.currency==='MXN'?INEGI_REPORT_INDICATORS.filter(d=>d.scope.metric===m.metric):[]
  const scopes=definitions.length?definitions.flatMap(d=>[d.scope,...(d.derivedScopes??[])]):[
   {subject:'national_total',metric:m.metric,unit:'source_defined_pending_scope_review',comparison:'source_defined_pending_scope_review'}]
  for(const scope of scopes){
  const purpose=m.metric==='policy_target_rate'?'policy_update':'economic_update'
  const questions=purpose==='policy_update'?['policy_release','policy_scope']:['economic_release','economic_scope']
  const requirements=Object.fromEntries(questions.map(id=>[id,periods.map((period,i)=>({id:`official-period-${i}`,period,scope}))]))
  const input={packet:{currency:snapshot.currency,baseDate:asOf.slice(0,10),purpose,evidence:[],evidenceScopeCards:[]},
   purpose,asOf,topics:[],requirements}
  try{
   const selection=planResearchSourceSelection({input,sourcePlan,sourceRegister})
   const requestIds=selection.sourceRequests.filter(r=>official.some(s=>s.id===r.sourceId)&&!registered.some(p=>p.sourceId===r.sourceId)).map(r=>r.requestId)
   const collection=await collectSelectedResearch({input,sourcePlan,sourceRegister,requestIds,mode,captures,inegiCaptures,pdfCaptures,fetchImpl,
    maxNetworkRequests:2,fairSourceBudgets:true,checkpoint,now})
   collections.push(collection)
   states.push({metric:m.metric,comparison:scope.comparison,status:collection.originals.length?'collected_pending_statistic_scope_release_and_use_review':'not_collected',
    sourceStates:collection.outcomes.map(o=>({sourceId:o.sourceId,status:o.status,reason:o.reason??null})),writingEligible:false})
  }catch{states.push({metric:m.metric,status:'official_collection_failed',writingEligible:false})}
  }
 }
 const completedAt=mode==='live'&&Date.parse(now())>Date.parse(asOf)?now():asOf
 const admission=reviewOfficialStatistics({currency:snapshot.currency,collections,documents:officialDocuments,terms:officialTerms,countryInputs:countryOfficialInputs,asOf:completedAt})
 for(const state of states.filter(s=>s.profileId)){
  state.numericBackgroundEligible=admission.admitted.some(s=>s.profileId===state.profileId)
  state.status=state.numericBackgroundEligible?'registered_numeric_background_prepared_pending_manuscript_review':'registered_statistic_held'
  state.reasons=admission.rows.filter(r=>r.profileId===state.profileId&&r.reason).map(r=>r.reason)
 }
 // These proof bytes stay in the service-only frozen batch, never the public
 // supply summary, writer packet or review prompt. Keep originals auditable.
 const captureProofs={...(countryOfficialInputs?{country:countryOfficialInputs}:{}),documents:officialDocuments.map(d=>({url:d.url,sha256:d.sha256,collectedAt:d.collectedAt,
  rawBase64:d.rawBase64,extraction:d.extraction})),terms:officialTerms?{
   url:officialTerms.url,sha256:officialTerms.sha256,collectedAt:officialTerms.collectedAt,text:officialTerms.text}:null}
 return {collections,states,admission,registeredSourceIds:snapshot.currency==='MXN'?['mxn-consumer']:registered.map(p=>p.sourceId),
  coverage:officialBackgroundCoverage(admission),captureProofs,networkCalls:collections.reduce((n,c)=>n+c.networkCalls,0),
  status:admission.admitted.length?'official_numeric_background_prepared':collections.some(c=>c.originals.length)?'official_material_pending_review':'official_background_unavailable',
  admissionStatus:admission.status,publicationApproved:false}
}
