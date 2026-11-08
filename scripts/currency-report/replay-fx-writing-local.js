// Saved-source preparation only: no credentials, fetch, provider or DB imports.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {fingerprint} from './research-harness.js'
import {prepareNewsNotesInput} from './news-notes-input.js'
import {prepareEventTrial} from './lifecycle-control.js'
import {harnessRequest} from './report-harness.js'
import {applyWriterPolicy} from './writer-policy.js'
import {projectFxWritingBackground} from './fx-writing-background.js'
import {fxWritingCoverageRequirements} from './fx-writing-focus.js'
import {selectInegiWritingFacts} from './inegi-writing-context.js'

export function bundleFromSavedNotes(saved) {
 const {packet,dossier,fxCauseInput}=saved
 if(packet.fxWritingBackground||packet.fxWritingFocus)throw new Error('unmodified_saved_news_input_required')
 const judgment=r=>{if(!r)throw new Error('saved_source_use_required')
  const {version:_version,resourceId:_id,resourceBinding:_binding,...rest}=r;return rest}
 const {version:_version,binding:_binding,claims:_claims,purpose:_purpose,...contentReview}=fxCauseInput.review
 return {version:'news-notes-case/2',checkedOn:fxCauseInput.sourceUse.evaluatedOn,
  sessionDate:packet.observedDate,reportDate:packet.baseDate,historicalCase:saved.historicalReplay,
  priceUseReview:judgment(fxCauseInput.sourceUse.reviews.find(r=>r.resourceId==='official-price')),
  contentReview,
  entries:packet.evidence.map(e=>{
   if(!e.newsNotes)throw new Error('saved_authored_notes_required')
   const {binding:_binding,...review}=e.newsNotes.review
   return {source:e.newsNotes.source,notes:e.newsNotes.notes,review,
    useReview:judgment(fxCauseInput.sourceUse.reviews.find(r=>r.resourceId===e.id)),
    claims:e.newsNotes.notes.map(n=>{
     const card=dossier.cards.find(c=>c.evidenceId===e.id&&c.passageIds.length===1&&c.passageIds[0]===n.id)
     const decision=fxCauseInput.review.claims.find(r=>r.cardId===card?.id)
     if(!card||!decision)throw new Error('saved_note_claim_required')
     return {noteId:n.id,questionId:card.questionId,role:decision.role,relation:card.relation,supported:decision.supported,
      eventKey:card.eventKey,independenceKey:card.independenceKey,priceConnection:decision.priceConnection,review:card.review}
    })}
  })}
}
export async function replayFxWritingLocal({input,workspace=process.cwd()}={}) {
 const root=await fs.realpath(workspace),privateRoot=await fs.realpath(path.join(root,'.local-reports/private')),reads=[]
 if(privateRoot!==path.join(root,'.local-reports/private'))throw new Error('private_root_unsafe')
 const read=async(name,preservation=false)=>{
  const file=await fs.realpath(path.resolve(root,name)),rel=path.relative(privateRoot,file),stat=await fs.stat(file)
  const reviewable=preservation?path.relative(await fs.realpath(path.join(root,'.local-reports/reviewable')),file):null
  const inside=relative=>relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)
  if(!(inside(rel)||preservation&&inside(reviewable))||!file.endsWith('.json')||!stat.isFile()||stat.size>8_000_000)
   throw new Error('private_saved_json_required')
  const raw=await fs.readFile(file,'utf8');reads.push({file,raw});return JSON.parse(raw)
 }
 const config=await read(input)
 if(config.version!=='fx-writing-replay/1'||!config.cases?.length||config.cases.length>6)throw new Error('fx_writing_replay_config_required')
 if(config.preserveFiles!==undefined&&(!Array.isArray(config.preserveFiles)||config.preserveFiles.length>20))throw new Error('preservation_list_required')
 for(const file of config.preserveFiles??[])await read(file,true)
 const results=[]
 for(const c of config.cases) {
  const saved=await read(c.inputFile),bundle=bundleFromSavedNotes(saved),price=structuredClone(saved.packet)
  price.evidence=[];price.evidenceScopeCards=[]
  if(c.consumerBackground)bundle.consumerBackground=c.consumerBackground
  if(c.marketFocus)bundle.marketFocus=c.marketFocus
  const originalConsumer=c.consumerReplayFile?(await read(c.consumerReplayFile)).consumer:null
  const consumer=c.consumerFactIds?selectInegiWritingFacts(originalConsumer,c.consumerFactIds):originalConsumer
  const data=prepareNewsNotesInput(price,bundle,{consumer}),plan=prepareEventTrial(data)
  if(data.assessment.holds.length)throw new Error('reviewed_input_hold')
  // Inspect output wiring even if the existing per-call price cap blocks a
  // future run. The held plan stays held; no budget or permission is raised.
  const preview=plan.body?null:applyWriterPolicy(harnessRequest(data.packet,data.dossier).request)
  const body=plan.body??preview?.body
  if(!body)throw new Error('writer_preview_unavailable')
  const sent=JSON.parse(body.messages[1].content),background=projectFxWritingBackground(data.packet)
  results.push({currency:data.packet.currency,data,plan,preview,summary:{currency:data.packet.currency,
   preparationStatus:plan.status,maximumUsd:plan.maximumUsd,
   consumerFactIds:c.consumerFactIds??null,
   ...(preview?{inputBound:plan.inputBound,inputLimit:plan.inputLimit,holdReasons:plan.holdReasons}:{}),
   background:background?'reviewed_background_available':'no_reviewed_business_background',
   backgroundEvidenceIds:background?.evidenceIds??[],
   referencePeriods:background?.consumerContext?.timing.publications.map(p=>p.referencePeriod)??background?.reviewedNotes.map(n=>n.referencePeriod)??[],
   implicationSlots:(plan.outputContract??preview?.outputContract)?.sections?.implications??null,
   consumerResolution:sent.researchBrief.questionResolution??[],writingFocus:sent.writingFocus??null,
   coverageRequirements:fxWritingCoverageRequirements(data.packet),priceUnchanged:fingerprint(data.packet.series)===fingerprint(saved.packet.series),
   generationAuthorized:false,publicationApproved:false,networkCalls:0,modelCalls:0,newApiCostUsd:0}})
 }
 for(const r of reads)if(r.raw!==await fs.readFile(r.file,'utf8'))throw new Error('saved_source_changed')
 const directory=await fs.mkdtemp(path.join(privateRoot,'fx-writing-replay-'))
 for(const r of results){await fs.writeFile(path.join(directory,`${r.currency}-input.json`),JSON.stringify(r.data,null,2),{flag:'wx'})
  await fs.writeFile(path.join(directory,`${r.currency}-plan.json`),JSON.stringify(r.plan,null,2),{flag:'wx'})
  if(r.preview)await fs.writeFile(path.join(directory,`${r.currency}-held-preview.json`),JSON.stringify({...r.preview,paidCallAuthorized:false,publicationApproved:false},null,2),{flag:'wx'})}
 const summary={version:'fx-writing-replay-result/1',directory:path.relative(root,directory),cases:results.map(r=>r.summary),
  sourceBindings:reads.map(r=>({file:path.relative(root,r.file),binding:fingerprint(r.raw)})),
  originalManuscriptsChanged:false,productionChanged:false,networkCalls:0,modelCalls:0,newApiCostUsd:0}
 await fs.writeFile(path.join(directory,'summary.json'),JSON.stringify(summary,null,2),{flag:'wx'})
 return summary
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const {values}=parseArgs({options:{input:{type:'string'}},strict:true})
 replayFxWritingLocal(values).then(r=>console.log(JSON.stringify(r,null,2))).catch(error=>{
  console.error(/^[a-z_:]+$/.test(error.message)?error.message:'fx_writing_replay_failed');process.exitCode=1})
}
