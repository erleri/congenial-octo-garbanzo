// Offline audit of an immutable operating batch and its actual responses.
// No credentials, database, acquisition transport or model adapter is loaded.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {createHash} from 'node:crypto'
import {inspectExtractedNews,completeOriginalNewsReview,prepareOriginalNewsCase} from './original-news-pipeline.js'
import {applyMaterialProcessing} from './material-processing.js'
import {admitRuntimeNotes} from './runtime-note-material.js'
import {supplyRuntimeInput,runtimeResearchDates} from './runtime-supply.js'
import {preflightRuntimeReview} from './runtime.js'
import {buildSharedDashboardPriceSnapshot} from './shared-price-contract.js'
import {NEWS_EVENT_DATE_VERSION} from './news-event-date.js'
import {researchFeedback,countryContinuation} from './research-continuation.js'

const {values}=parseArgs({options:{input:{type:'string'}},strict:true})
const privateRoot=await fs.realpath('.local-reports/private')
const root=await fs.realpath(values.input??'')
const relative=path.relative(privateRoot,root)
if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('private_saved_batch_required')
const read=p=>fs.readFile(p,'utf8').then(JSON.parse)
const names=['jobs.json','frozen-batch.json','execution-result.json','closeout.json']
const hashes=async()=>Object.fromEntries(await Promise.all(names.map(async name=>[name,createHash('sha256').update(await fs.readFile(path.join(root,name))).digest('hex')])))
const before=await hashes(),jobs=await read(path.join(root,'jobs.json')),batch=await read(path.join(root,'frozen-batch.json'))
const frozen=JSON.parse(batch.payload.serializedOperatingPayload)
const [registry,rules,sourcePlan,sourceRegister]=await Promise.all(['original-news-source-policy-20261028.json','material-processing-rules.json',
 'six-currency-explanation-sources-20261027.json','six-currency-source-register-20261027.json'].map(name=>read('docs/2.0/'+name)))
const output=await fs.mkdtemp(path.join(privateRoot,'source-readiness-'))
const save=(name,value)=>fs.writeFile(path.join(output,name),JSON.stringify(value,null,2),{flag:'wx'})
const decode=j=>JSON.parse(j.response.payload.choices[0].message.content)
const ready=new Map(),rows=[],prospectivePlans=[]
const classify=(status,reason)=>status==='notes_ready_for_material_validation'?'reviewed_card'
 :status==='comparison_unavailable'?'independent_comparison_not_performed'
 :reason==='extraction_event_outside_research_window'?'outside_original_research_scope'
 :reason==='original_event_date_not_supported'?'event_subject_not_supported'
 :reason==='event_date_unverified'?'date_not_established'
 :['insufficient_information','unrelated'].includes(status)?'content_gap_or_irrelevant':'review_hold'

for(const job of jobs.filter(j=>j.purpose==='original_source_review'&&j.stage==='writer')){
 const plan=frozen.prepared.sourcePlans.find(p=>p.binding===job.planBinding)
 const country=frozen.prepared.privateCountries.find(c=>c.currency===job.currency)
 if(!plan||!country)throw Error('saved_source_plan_missing')
 const collection=country.collection,card=collection.reviewQueue.find(c=>c.binding===plan.cardBinding)
 const sourceUse=applyMaterialProcessing({collection,legacyRegistry:registry,rules,evaluatedOn:frozen.prepared.asOf.slice(0,10)})
 const candidate=decode(job),comparison=jobs.find(j=>j.parentId===job.id)
 const snapshot=buildSharedDashboardPriceSnapshot({dataset:frozen.dataset,currency:job.currency,asOf:frozen.prepared.asOf,calendar:country.calendar})
 const window=runtimeResearchDates(snapshot,frozen.prepared.asOf)
 const newPlan=prepareOriginalNewsCase({collection,card,sourceUse})
 prospectivePlans.push(newPlan)
 // This is a diagnostic of the broader *future* search scope only. It cannot
 // create a receipt, rebind a paid plan or promote any saved candidate.
 let scopeProbe
 try{scopeProbe=inspectExtractedNews({...plan.job,time:{...plan.job.time,requestedDates:window.dates}},candidate).status}
 catch(error){scopeProbe=error.message}
 let outcome
 try{
  const inspected=inspectExtractedNews(plan.job,candidate)
  if(inspected.status!=='candidate_requires_original_comparison')outcome={status:inspected.status}
  else if(!comparison?.response?.valid)outcome={status:'comparison_unavailable'}
  else{
   const reviewed=completeOriginalNewsReview({collection,card,sourceUse,plan,candidate,comparison:decode(comparison),checkedOn:frozen.prepared.asOf.slice(0,10)})
   if(reviewed.status!=='source_card_prepared')outcome={status:reviewed.status,reason:reviewed.reason,limitations:reviewed.limitations}
   else{
    const material=admitRuntimeNotes({collection,card,reviewed,asOf:frozen.prepared.asOf,registry:rules})
    if(material){
     if(!ready.has(job.currency))ready.set(job.currency,{receipts:[],materialInputs:[]})
     ready.get(job.currency).receipts.push(reviewed.receipt)
     ready.get(job.currency).materialInputs.push({cardBinding:card.binding,input:material})
    }
    outcome={status:material?'notes_ready_for_material_validation':'note_use_or_role_hold',role:reviewed.assessment.role,
     limitations:decode(comparison).limitations,materialClaims:material?.packet.evidenceScopeCards[0].admittedClaims.length??0}
   }
  }
 }catch(error){outcome={status:'hold',reason:error.message}}
 rows.push({currency:job.currency,jobId:job.id,sourceUrl:plan.job.url,eventDate:candidate.eventDate,priceKind:candidate.priceKind,
  publicationDate:plan.job.time.publicationDate,originalRequestedDates:plan.job.time.requestedDates,
  outcome:{...outcome,category:classify(outcome.status,outcome.reason)},prospectiveScope:{dates:window.dates,diagnostic:scopeProbe,approval:false},
  futureInput:{version:newPlan.version,binding:newPlan.binding,status:newPlan.status,holds:newPlan.holds},originalPlanVersion:plan.version})
}
const preparedCountries=[]
for(const country of frozen.prepared.privateCountries){
 const review=ready.get(country.currency)??{receipts:[],materialInputs:[]}
 const result=await supplyRuntimeInput({dataset:frozen.dataset,currency:country.currency,asOf:frozen.prepared.asOf,
  calendar:country.calendar,commentaryTarget:country.commentaryTarget,publications:[],handoff:country.handoff,
  claimTypingReview:country.claimTypingReview,eventCandidateIds:country.eventCandidateIds??[],sourcePlan,sourceRegister,processingRules:rules,
  acquire:async()=>({collection:country.collection,officialBackground:country.officialBackground,networkCalls:0}),
  review:async()=>({...review,modelCalls:0,newPaidCostUsd:0,status:'stored_response_revalidation_only'}),
  store:{stage:async()=> 'offline_memory_only',check:async()=>{}}})
 let reviewPreflight=null
 if(result.task){
  reviewPreflight=preflightRuntimeReview(result.task)
  await save(country.currency+'-writer-input.json',{task:result.task,paidCallAuthorized:false,storedInDatabase:false,
   meaning:'offline_input_only_not_manuscript_or_publication'})
 }
 preparedCountries.push({currency:country.currency,status:result.status,holds:result.holds,referenceDate:result.baseDate,
  commentaryTarget:result.commentaryTarget,reviewedSources:review.receipts.length,
  continuation:countryContinuation({status:result.status,holds:result.holds,
   sourceIssues:rows.filter(r=>r.currency===country.currency&&r.outcome.status!=='notes_ready_for_material_validation').map(r=>r.outcome)}),
  discoveryFeedback:researchFeedback(rows.filter(r=>r.currency===country.currency&&r.outcome.status!=='notes_ready_for_material_validation')
   .map(r=>({original:{url:r.sourceUrl},review:{heldStatus:r.outcome.status,holds:[r.outcome.reason??r.outcome.status]}}))),
  writerMaximumUsd:result.writerMaximumUsd??null,reviewPreflight,actualWritingCalls:0,storedInDatabase:false})
}
const after=await hashes()
if(JSON.stringify(before)!==JSON.stringify(after))throw Error('saved_trial_records_changed')
await save('prospective-source-plans.json',{plans:prospectivePlans,paidCallAuthorized:false,
 note:'Current instructions on unchanged saved collections. Old responses are not relabeled as generated under these new prompts.'})
const result={version:'source-readiness-replay/1',ruleVersion:NEWS_EVENT_DATE_VERSION,input:relative,output:path.relative(process.cwd(),output),
 evidenceKind:'saved_real_responses_not_synthetic',rows,preparedCountries,inputHashes:before,oldResponsesPreserved:true,
 networkCalls:0,modelCalls:0,newPaidCostUsd:0,publicationApproved:false,productionWrites:0}
await save('result.json',result)
console.log(JSON.stringify({output:result.output,preparedCountries,rows:rows.map(r=>({currency:r.currency,eventDate:r.eventDate,...r.outcome,prospectiveScope:r.prospectiveScope})),
 oldResponsesPreserved:true,modelCalls:0,newPaidCostUsd:0}))
