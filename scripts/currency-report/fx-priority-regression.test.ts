import {expect,it,vi} from 'vitest'
import fs from 'node:fs'
import {originalPipelineFixture} from './original-news-pipeline-fixture.js'
import {inspectExtractedNews,prepareOriginalNewsCase,runOriginalNewsCase} from './original-news-pipeline.js'
import {inspectEventDateEvidence} from './news-event-date.js'
import {runtimeFixture,syntheticRuntimeTransport,memoryRuntimeStore,runtimeTestEnv} from './runtime-fixture.js'
import {prepareRuntimeReview,assessRuntimeReview,runCurrencyRuntime,preflightRuntimeReview} from './runtime.js'
import {encodeReviewInput,decodeReviewInput} from './review-transport.js'
import {writerProfile,applyReviewWriterPolicy} from './writer-policy.js'
import {fingerprint} from './research-harness.js'
import {admitRuntimeNotes} from './runtime-note-material.js'
import {assertIndependentNoteText} from './material-processing.js'

it('carries publication and institutional views through both comparisons without inventing a named expert',async()=>{
 for(const kind of ['institutional_view','publication_view']){
  const f=await originalPipelineFixture(),c=structuredClone(f.candidate)
  c.claims[1]={...c.claims[1],kind,person:'',organization:kind==='publication_view'?new URL(f.url).hostname:'Banco Ejemplo'}
  const before=fingerprint(f)
  const result=await runOriginalNewsCase({...f,extract:async r=>({requestHash:r.requestHash,output:c}),
   compare:async r=>({requestHash:r.requestHash,output:f.comparison})})
  expect(result.status).toBe('source_card_prepared')
  expect(result.receipt.notes[1].attribution).toEqual({type:kind==='publication_view'?'publication':'institution',person:'',organization:c.claims[1].organization})
  expect(result.assessment.localCauseSupport).toBe(true)
  const material=admitRuntimeNotes({collection:f.collection,card:f.card,reviewed:result,asOf:'2026-11-01T03:00:00Z',
   registry:JSON.parse(fs.readFileSync('docs/2.0/material-processing-rules.json','utf8'))})
  expect(material.materials[0].record.claimRoles['claim-n1']).toBe('attributed_fx_explanation')
  const copied=structuredClone(result.evidence.evidence[0])
  copied.newsNotes.notes[1].text=f.collection.originals[0].blocks[1].text
  expect(()=>assertIndependentNoteText(f.collection.originals[0],copied)).toThrow('authored_note_contains_original_prose')
  expect(fingerprint(f)).toBe(before)
  const plan=prepareOriginalNewsCase(f),invented=structuredClone(c);invented.claims[1].organization='Unrelated publisher'
  expect(()=>inspectExtractedNews(plan.job,invented)).toThrow('extraction_attribution_not_in_original')
  const falseFact=structuredClone(c);falseFact.claims[1]={...falseFact.claims[1],kind:'fact',person:'',organization:'',causalScope:'none'}
  expect(()=>inspectExtractedNews(plan.job,falseFact)).toThrow('explicit_local_explanation_required')
 }
})

it('requires a cited event-relative expression and local publication calendar without guessing a missing session',()=>{
 const job={time:{publicationDate:'2026-10-30'},blocks:[{text:'El dólar cerró este viernes con presión local.'},{text:'Ontem houve procura por dólares.'}]}
 const c={eventDate:'2026-10-30',eventDateEvidence:{basis:'relative',quote:job.blocks[0].text,blockPositions:[0],relation:'same_day'}}
 expect(inspectEventDateEvidence(job,c).status).toBe('relative_date_requires_comparison')
 expect(inspectEventDateEvidence(job,{eventDate:'2026-10-29',eventDateEvidence:{basis:'relative',quote:job.blocks[1].text,blockPositions:[1],relation:'previous_day'}}).status).toBe('relative_date_requires_comparison')
 expect(()=>inspectEventDateEvidence(job,{...c,eventDate:'2026-10-31'})).toThrow('relative_event_date_mismatch')
 expect(()=>inspectEventDateEvidence({...job,time:{publicationDate:'2026-10-29'}},c)).toThrow('relative_event_date_ambiguous')
 expect(()=>inspectEventDateEvidence(job,{...c,eventDateEvidence:{...c.eventDateEvidence,quote:'hoy'}})).toThrow('event_date_source_span_required')
 expect(()=>inspectEventDateEvidence(job,{eventDate:'',eventDateEvidence:{basis:'unknown',quote:'',blockPositions:[],relation:'none'}})).toThrow('event_date_unverified')
 for(const phrase of ['El dólar sigue escalando esta mañana','O dólar sobe nesta manhã']){
  const morning={...job,blocks:[{text:phrase}]},candidate={...c,eventDateEvidence:{...c.eventDateEvidence,quote:phrase}}
  expect(inspectEventDateEvidence(morning,candidate).status).toBe('relative_date_requires_comparison')
 }
 const future={...job,blocks:[{text:'El dólar podría subir mañana'}]}
 expect(()=>inspectEventDateEvidence(future,{...c,eventDateEvidence:{...c.eventDateEvidence,quote:future.blocks[0].text}})).toThrow('relative_event_date_ambiguous')
 const explicit={...job,blocks:[{text:'El dólar cerró el 30 de octubre de 2026.'}]}
 const dated={...c,eventDateEvidence:{...c.eventDateEvidence,basis:'explicit',quote:explicit.blocks[0].text}}
 const saved=structuredClone(dated)
 expect(inspectEventDateEvidence(explicit,dated).status).toBe('explicit_date_requires_comparison')
 expect(dated).toEqual(saved)
 expect(()=>inspectEventDateEvidence({...explicit,time:{publicationDate:'2026-10-31'}},dated)).toThrow('event_date_evidence_mismatch')
 expect(inspectEventDateEvidence({...explicit,time:{publicationDate:'2026-10-31'}},{...dated,eventDateEvidence:{...dated.eventDateEvidence,relation:'previous_day'}}).status).toBe('explicit_date_requires_comparison')
 expect(()=>inspectEventDateEvidence(explicit,{...dated,eventDate:'2026-10-29'})).toThrow('explicit_event_date_not_supported')
})

it('records execution-owned reviewer identity while preserving the returned body and enforcing FX coverage above style',async()=>{
 const f=runtimeFixture(),t=syntheticRuntimeTransport(f.task),before=structuredClone(t.reviewOutput),store=memoryRuntimeStore()
 const request=prepareRuntimeReview(f.task,t.compiled)
 expect(request.localSchema.properties.review.required).not.toContain('reviewer')
 const result=await runCurrencyRuntime({...f,store,env:runtimeTestEnv,...t})
 expect(result.status).toBe('pending_admin_review')
 expect(store.drafts[0].validation.reviewerIdentity).toEqual({model:f.task.plan.body.model,route:request.profile.route})
 expect(store.drafts[0].validation.review).not.toHaveProperty('reviewer')
 expect(t.reviewOutput).toEqual(before)
 const bad=structuredClone(before);bad.review.writingCoverage.shared_fx_priority.status='refine'
 expect(assessRuntimeReview(t.compiled,bad).validation.contentReview).toBe('unverified')
 const weak=structuredClone(before);weak.scores.cause=3
 expect(assessRuntimeReview(t.compiled,weak).validation.contentReview).toBe('unverified')
 const short=structuredClone(before);short.review.reviewer='Sol'
 expect(assessRuntimeReview(t.compiled,short).validation.contentReview).toBe('passed')
})

it('uses lossless review references and a price-derived ceiling, and stops oversized evidence before any paid dispatch',async()=>{
 const f=runtimeFixture(),t=syntheticRuntimeTransport(f.task)
 const encoded=encodeReviewInput(t.compiled.claimReview)
 expect(decodeReviewInput(encoded)).toEqual(t.compiled.claimReview)
 const profile=writerProfile()
 expect(profile.inputTokens).toBe(67232);expect(profile.perCallUsd).toBe(.25)
 const small=prepareRuntimeReview(f.task,t.compiled)
 expect(small.maximumUsd).toBeLessThanOrEqual(.25)
 const tooBig=structuredClone(small.body);tooBig.messages[0].content+='X'.repeat(profile.inputTokens)
 expect(applyReviewWriterPolicy(tooBig).status).toBe('request_budget_hold')
 // Prepared fixture is resealed with a large existing evidence condition;
 // this is a software double, not a new grant of semantic evidence support.
 const h=structuredClone(f.handoff),c=h.materialConnection
 for(const row of Object.values(c.sections).flat())row.countercontext='가'.repeat(24000)
 delete c.binding;c.binding=fingerprint(c)
 const {prepareRuntimeTask}=await import('./runtime.js')
 const task=prepareRuntimeTask({...f,handoff:h})
 // If the writer itself cannot fit, it is already held without invocation.
 if(task.status==='held')expect(task.modelCalls).toBe(0)
 else {
  expect(preflightRuntimeReview(task).status).toBe('hold')
  const send=vi.fn(),store=memoryRuntimeStore(),preflight=vi.fn()
  expect(await runCurrencyRuntime({...f,task,store,env:runtimeTestEnv,send,preflight})).toMatchObject({status:'review_input_preflight_hold',modelCalls:0})
  expect(send).not.toHaveBeenCalled();expect(preflight).not.toHaveBeenCalled();expect(store.jobs).toEqual([])
 }
})
