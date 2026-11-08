import {expect,it} from 'vitest'
import {inspectEventDateEvidence} from './news-event-date.js'
import {comparisonContext} from './comparison-context.js'
import {operatingCheckpoint} from './operating-checkpoint.js'
import {operatingResultState} from './operating-result.js'
import {inspectNewsPreselection} from './news-preselection.js'
import {sourceContinuation} from './research-continuation.js'

it('separates checked date/context locators from direct support without allowing unread conditions or support by union',()=>{
 const job={blocks:[{text:'Esta mañana el mercado abrió.'},{text:'El precio fue observado a media mañana.'},{text:'Solo si se mantiene una condición.'}]}
 const claim={kind:'fact',blockPositions:[0,1]}
 const review={verdict:'supported',allSubclaimsSupported:true,attributionMatches:true,scopeMatches:true,conditionsPreserved:true,blockPositions:[1],conditionBlockPositions:[]}
 expect(comparisonContext(claim,review,job,{basis:'relative',blockPositions:[0]}).retained).toEqual([0,1])
 expect(()=>comparisonContext(claim,{...review,contextBlockPositions:[]},job,{basis:'relative',blockPositions:[0]})).toThrow()
 const conditional={...claim,blockPositions:[1,2]}
 expect(()=>comparisonContext(conditional,review,job)).toThrow('comparison_dropped_candidate_context')
 expect(comparisonContext(conditional,{...review,contextBlockPositions:[1,2]},job).retained).toEqual([1,2])
 expect(()=>comparisonContext(conditional,{...review,contextBlockPositions:[1,2],conditionsPreserved:false},job)).toThrow()
 expect(()=>comparisonContext(conditional,{...review,contextBlockPositions:[1,2],scopeMatches:false},job)).toThrow()
})

it('checks complete weekday/day expressions against the publisher calendar, not just a date substring',()=>{
 // Synthetic variations of the saved BRL syntax, not new historical evidence.
 const cases=[['Nesta sexta-feira (30)','2026-10-30','2026-10-30',true],
  ['Este viernes (30)','2026-10-30','2026-10-30',true],
  ['Nesta sexta-feira (29)','2026-10-30','2026-10-30',false],
  ['Nesta quinta-feira (30)','2026-10-30','2026-10-30',false],
  ['Nesta sexta-feira (30)','2026-11-02','2026-10-30',false],
  ['Na eleição passada, nesta sexta-feira (30)','2026-10-30','2026-10-30',false],
  ['Nesta sexta-feira (30)','2026-10-30','2025-10-30',false]]
 for(const [quote,anchor,date,pass] of cases){
  const job={time:{publicationDate:anchor},blocks:[{text:quote}]}
  const candidate={eventDate:date,eventDateEvidence:{basis:'explicit',quote,blockPositions:[0],relation:'none'}}
  if(pass)expect(inspectEventDateEvidence(job,candidate).status).toBe('explicit_date_requires_comparison')
  else expect(()=>inspectEventDateEvidence(job,candidate)).toThrow()
 }
 const quote='Nesta sexta-feira (29)'
 expect(()=>inspectEventDateEvidence({time:{publicationDate:'2026-10-30'},blocks:[{text:quote}]},
  {eventDate:'2026-10-30',eventDateEvidence:{basis:'relative',quote,blockPositions:[0],relation:'same_day'}})).toThrow('relative_event_date_mismatch')
})

it('retains the named introduction for a checked continuing quote without losing conditions or changing reviewer output',()=>{
 const job={blocks:[{text:'María Pérez, de Banco Ejemplo, explicó la demanda.'},
  {text:'Agregó que mientras la demanda siga elevada, habría presión.'},{text:'Otro experto explicó otra causa.'}]}
 const claim={kind:'attributed_view',person:'María Pérez',organization:'Banco Ejemplo',blockPositions:[0,1]}
 const review={verdict:'supported',allSubclaimsSupported:true,attributionMatches:true,scopeMatches:true,conditionsPreserved:true,
  blockPositions:[1],conditionBlockPositions:[1]}
 const before=structuredClone(review)
 expect(comparisonContext(claim,review,job)).toEqual({direct:[1],retained:[0,1],retainedIntroduction:[0]})
 expect(review).toEqual(before)
 for(const changed of [{...review,conditionsPreserved:false},{...review,attributionMatches:false},
  {...review,blockPositions:[0],conditionBlockPositions:[]},{...review,blockPositions:[2],conditionBlockPositions:[]}])
  expect(()=>comparisonContext(claim,changed,job)).toThrow('comparison_dropped_candidate_context')
 expect(()=>comparisonContext(claim,review,{blocks:[job.blocks[0],job.blocks[2]]})).toThrow('comparison_dropped_candidate_context')
})

it('summarizes six-country oversized diagnostics while preserving accounting, resume and fatal error classification',()=>{
 const rows=['BRL','MXN','COP','PEN','CLP','ARS'].map(currency=>({currency,status:'writing_input_hold',
  sourceHolds:['selected_session_attributed_fx_explanation_missing'],modelCalls:4,confirmedUsd:0.04,
  continuation:{action:'resume_saved_stages',resumeExact:true,issues:Array.from({length:20},()=>({action:'find_other_evidence'}))},
  sourceIssues:Array.from({length:40},()=>({status:'held',reason:'가'.repeat(600)}))}))
 rows[5].continuation.issues[19]={action:'await_pipeline_repair'}
 const result={status:'completed_with_country_results',rows,modelCalls:24,confirmedUsd:.24,costUsd:.24,unknownCost:false,
  collectionResults:rows.map(r=>({currency:r.currency,status:'collected',candidates:4,lookupFailures:[{reason:'failed'}]})),publicationApproved:false}
 const before=structuredClone(result),summary=operatingCheckpoint(result,'a'.repeat(64))
 expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThan(24000)
 expect(operatingResultState(summary)).toEqual(operatingResultState(result))
 expect(summary).toMatchObject({modelCalls:24,costUsd:.24,unknownCost:false,checkpointOutcome:{kind:'action_required'}})
 expect(summary.rows.every(r=>r.continuation.resumeExact)).toBe(true)
 expect(result).toEqual(before)
 const unknown={...result,status:'operating_execution_hold',modelCalls:null,costUsd:null,unknownCost:true}
 expect(operatingCheckpoint(unknown,'b'.repeat(64))).toMatchObject({modelCalls:null,costUsd:null,unknownCost:true})
})

it('routes known stale market stories and non-economic sections away from paid review but retains current revisions and background',()=>{
 const card={targets:[{requestedPeriod:'2026-10-30',requestedScope:{comparison:'source_reported_session'}}]}
 const original={url:'https://example.org/mercados/dolar',metadata:{publishedAt:'2026-10-21T20:00:00Z'}}
 expect(inspectNewsPreselection(original,card,'MXN').reason).toBe('publication_before_session_window')
 expect(inspectNewsPreselection({...original,metadata:{...original.metadata,modifiedAt:'2026-10-30T20:00:00Z'}},card,'MXN').status).toBe('requires_content_review')
 expect(inspectNewsPreselection(original,{targets:[{requestedPeriod:'2026-08',requestedScope:{comparison:'year_on_year'}}]},'MXN').status).toBe('requires_content_review')
 expect(inspectNewsPreselection({...original,url:'https://example.org/deportes/dolar'},card,'ARS').reason).toBe('non_economic_section')
 expect(inspectNewsPreselection({...original,metadata:{}},card,'MXN').status).toBe('requires_content_review')
 expect(sourceContinuation({reason:'held_extraction_has_claims'})).toMatchObject({category:'output',automaticRetry:false})
 expect(sourceContinuation({reason:'publication_before_session_window'})).toMatchObject({category:'period',action:'find_period_matched_evidence'})
})
