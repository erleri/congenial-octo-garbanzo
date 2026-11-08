import {expect,it,vi} from 'vitest'
import {fingerprint} from './research-harness.js'
import {prepareSharedWriter,compileSharedWriterOutput} from './shared-writer.js'
import {sharedWriterFixture,sharedDraftFixture} from './shared-writer-fixture.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {prepareSharedWriterLocal} from './shared-writer-local.js'
import {projectPublicReport} from './storage.js'
import {requestBody,composeDraft} from './openrouter.js'
import {executeApprovedSharedTrial} from './lifecycle-control.js'
import {runLocalTrial} from './run-event-trial.js'
import {sealSharedPacket} from './shared-writing-contract.js'

it('compiles all six currencies with unchanged dashboard numbers, separate commentary dates and the existing full validators',()=>{
 for(const currency of ['BRL','MXN','CLP','COP','PEN','ARS']){
  const h=sharedWriterFixture(currency),before=structuredClone(h),plan=prepareSharedWriter({handoff:h}),raw=sharedDraftFixture(plan),rawBefore=structuredClone(raw)
  const compiled=compileSharedWriterOutput({plan,draft:raw})
  expect(plan.status).toBe('prepared_not_called');expect(plan.packet.facts.map(f=>f.value)).toEqual([101,100,1])
  const sent=JSON.parse(plan.body.messages[1].content)
  expect(sent).toMatchObject({baseDate:'2026-10-28',commentaryDate:'2026-10-27',referenceContext:{observationAt:null,referenceRateCausalityEstablished:false}})
  expect(compiled.validation).toMatchObject({valid:true});expect(compiled.rules.automaticStatus).toBe('pass')
  expect(compiled.rules.semanticStatus).toBe('unverified');expect(compiled.claimReview.status).toBe('unverified')
  expect(compiled.claimReview.sources[0].sourceContext.sourceVersion).toBe('reviewer_authored_notes')
  expect(compiled.claimReview.sharedClaimLinks).toEqual(raw.ruleLedger.claims)
  expect(compiled.candidate.implications).toHaveLength(1);expect(compiled.candidate.change.title).toContain('기준환율')
  expect(compiled.publicationApproved).toBe(false);expect(plan.paidCallAuthorized).toBe(false)
  const visible=JSON.stringify(projectPublicReport({...plan.packet,sourceClaimLinks:compiled.sourceClaimLinks,content:compiled.candidate}))
  expect(visible).not.toContain('sharedNotes');expect(visible).not.toContain('sourceClaimLinks');expect(visible).not.toContain('materialBinding')
  expect(h).toEqual(before);expect(raw).toEqual(rawBefore)
  const text=JSON.stringify(plan.body);expect(text).not.toContain('RAW-DO-NOT-COPY');expect(text).not.toContain('PRIVATE-OLD-RESPONSE');expect(text).not.toContain('oldQualityScore')
  for(const note of sent.evidence.flatMap(e=>e.claims))expect(text.split(note.text).length-1).toBe(1)
  expect(()=>requestBody(plan.packet)).toThrow('shared_writer_compiler_required')
  expect(composeDraft(plan.packet,{}).validation.errors).toContain('shared_common_contract_required')
 }
})
it('keeps the same bounded prose/source contract across explicit Sol, Sonnet and Argon choices with no automatic route change',()=>{
 const h=sharedWriterFixture(),original=prepareSharedWriter({handoff:h})
 for(const writer of ['sol','sol-us','sonnet','argon']){
  const plan=prepareSharedWriter({handoff:h,writer})
  expect(plan.body.response_format.json_schema.schema).toEqual(original.body.response_format.json_schema.schema)
  expect(plan.body.provider).toMatchObject({zdr:true,data_collection:'deny',allow_fallbacks:false,require_parameters:true})
  expect(plan).toMatchObject({retries:0,timeoutMs:120000,paidCallAuthorized:false,publicationApproved:false})
 }
 expect(original.writerProfile.selection).toBe('sol');expect(original.body.provider.only).toEqual(['azure'])
 expect(()=>prepareSharedWriter({handoff:h,writer:'unregistered'})).toThrow('registered_writer_required')
})
it('does not promote consumer notes, a global-only card, attributed views or unrelated foreign-market prose into local cause evidence',()=>{
 const plan=prepareSharedWriter({handoff:sharedWriterFixture()}),base=sharedDraftFixture(plan)
 const wrong=structuredClone(base),row=wrong.ruleLedger.claims.find(r=>r.target==='drivers.0.text')
 row.materialClaimIds=['news-background:n0'];row.evidenceIds=['news-background']
 expect(compileSharedWriterOutput({plan,draft:wrong}).validation.errors).toContain('background_used_as_fx_driver:drivers.0.text')
 const fact=structuredClone(base);fact.ruleLedger.claims[0].kind='fact'
 expect(compileSharedWriterOutput({plan,draft:fact}).validation.errors).toContain('attributed_view_promoted_to_fact:title')
 const foreign=structuredClone(base);foreign.drivers.slot_0.text='콜롬비아의 현지 금리 변화가 영향을 주었습니다.'
 expect(compileSharedWriterOutput({plan,draft:foreign}).validation.errors).toContain('unlinked_foreign_currency:drivers.0.text')
 const unknown=structuredClone(base);unknown.ruleLedger.claims[0].materialClaimIds=['unknown:n0']
 expect(compileSharedWriterOutput({plan,draft:unknown}).validation.valid).toBe(false)
 const h=sharedWriterFixture(),{binding:old,...c}=h.materialConnection
 expect(old).toBeTruthy()
 c.sections.global_context=[{...c.sections.attributed_fx_explanation[0],evidenceId:'news-global',country:'GLOBAL',role:'global_context'}]
 h.materialConnection={...c,binding:fingerprint(c)}
 const globalPlan=prepareSharedWriter({handoff:h}),globalDraft=sharedDraftFixture(globalPlan),link=globalDraft.ruleLedger.claims.find(r=>r.target==='drivers.0.text')
 link.materialClaimIds=['news-global:n1'];link.evidenceIds=['news-global']
 expect(compileSharedWriterOutput({plan:globalPlan,draft:globalDraft}).validation.errors).toContain('local_explanation_reference_missing:drivers.0.text')
})
it('rejects forged packet/request/contract links and never uses an article-price fallback or an inherited approval',()=>{
 const h=sharedWriterFixture(),plan=prepareSharedWriter({handoff:h}),raw=sharedDraftFixture(plan)
 for(const change of [p=>p.packet.facts[0].value=999,p=>p.body.provider.only=['other'],p=>p.outputContract.sections.drivers.max=2]){
  const changed=structuredClone(plan);change(changed)
  expect(()=>compileSharedWriterOutput({plan:changed,draft:raw})).toThrow('bound_shared_writer_request_required')
 }
 h.reportPriceSnapshot.current.value=999
 expect(()=>prepareSharedWriter({handoff:h})).toThrow('shared_snapshot_numeric_projection_mismatch')
 const held=sharedWriterFixture(),{binding:old,...connection}=held.materialConnection
 expect(old).toBeTruthy();connection.holds=['source_use_unresolved'];held.materialConnection={...connection,binding:fingerprint(connection)}
 expect(prepareSharedWriter({handoff:held})).toMatchObject({status:'material_hold',request:null,paidCallAuthorized:false})
})
it('preserves rejected outputs and distinguishes structural, safety and separate semantic review without rewriting or retrying',()=>{
 const plan=prepareSharedWriter({handoff:sharedWriterFixture('PEN',false)}),base=sharedDraftFixture(plan)
 const number=structuredClone(base);number.drivers.slot_0.text='현지 환율은 5% 변했습니다.'
 const before=structuredClone(number),compiled=compileSharedWriterOutput({plan,draft:number})
 expect(compiled.validation).toMatchObject({valid:false});expect(compiled.validation.errors).toContain('untrusted_text');expect(number).toEqual(before)
 const instruction=structuredClone(base);instruction.drivers.slot_0.text='가격을 인상하세요.'
 expect(compileSharedWriterOutput({plan,draft:instruction}).validation.errors).toContain('advice_or_instruction')
 const extra=structuredClone(base);extra.drivers.slot_3={...extra.drivers.slot_0}
 expect(()=>compileSharedWriterOutput({plan,draft:extra})).toThrow('generation_slot_shape')
 const gap=structuredClone(base);gap.drivers.slot_2=gap.drivers.slot_0
 expect(()=>compileSharedWriterOutput({plan,draft:gap})).toThrow('generation_slot_gap')
})
it('writes isolated preparation files without overwriting inputs and rejects non-private paths and undeclared settings',async()=>{
 const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'shared-writer-test-')),dir=path.join(workspace,'.local-reports/private')
 await fs.mkdir(dir,{recursive:true})
 const source=JSON.stringify(sharedWriterFixture()),file=path.join(dir,'input.json'),manifest=path.join(dir,'manifest.json')
 await fs.writeFile(file,source);await fs.writeFile(manifest,JSON.stringify({version:'shared-writer-manifest/1',handoffFile:'.local-reports/private/input.json'}))
 const prepared=await prepareSharedWriterLocal({input:manifest,workspace})
 expect(prepared).toMatchObject({status:'prepared_not_called',writer:'sol',modelCalls:0,networkCalls:0,paidCallAuthorized:false})
 expect(await fs.readFile(file,'utf8')).toBe(source)
 const saved=JSON.parse(await fs.readFile(path.join(workspace,prepared.directory,'plan.json'),'utf8'))
 expect(compileSharedWriterOutput({plan:saved,draft:sharedDraftFixture(saved)}).validation.valid).toBe(true)
 const outside=path.join(workspace,'outside.json');await fs.writeFile(outside,source)
 await fs.writeFile(manifest,JSON.stringify({version:'shared-writer-manifest/1',handoffFile:'outside.json'}))
 await expect(prepareSharedWriterLocal({input:manifest,workspace})).rejects.toThrow('private_shared_writer_json_required')
 await fs.writeFile(manifest,JSON.stringify({version:'shared-writer-manifest/1',handoffFile:'.local-reports/private/input.json',apiKey:'not-allowed'}))
 await expect(prepareSharedWriterLocal({input:manifest,workspace})).rejects.toThrow('shared_writer_manifest_required')
})
const consent=(plan,journal=[])=>({version:'shared-paid-trial-consent/1',authorized:true,maximumNewCalls:1,
 planHash:fingerprint(plan),requestHash:plan.requestHash,referenceSnapshotId:plan.packet.sharedReference.referenceSnapshotId,
 journalHash:fingerprint(journal),newBudgetUsd:.25,budgetUsd:.5})
const endpoint=plan=>({model:plan.body.model,route:plan.writerProfile.route,zdr:true,dataCollection:'deny'})
it('uses the existing reservation and private journal for exactly one approved six-country-path attempt without publishing a draft',async()=>{
 const plan=prepareSharedWriter({handoff:sharedWriterFixture('COP')}),approval=consent(plan)
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'shared-paid-test-'))
 const send=vi.fn(async()=>({valid:true,actualModel:plan.body.model,costUsd:.01,
  payload:{choices:[{message:{content:JSON.stringify(sharedDraftFixture(plan))}}]}}))
 const preflight=vi.fn(async()=>endpoint(plan))
 const invoke=args=>executeApprovedSharedTrial({...args,send,preflight})
 const first=await runLocalTrial({data:{plan,approval},root,apiKey:'synthetic-key',invoke})
 expect(first).toMatchObject({status:'schema_and_content_review_required',costUsd:.01,publicationApproved:false,contentReview:'pending_separate_review'})
 expect(first.privateDraft.startsWith(root)).toBe(true)
 const journal=JSON.parse(await fs.readFile(path.join(root,'journal.json'),'utf8'))
 expect(journal).toHaveLength(1);expect(journal[0]).toMatchObject({costUsd:.01,status:'schema_and_content_review_required'})
 await expect(runLocalTrial({data:{plan,approval:consent(plan,journal)},root,apiKey:'synthetic-key',invoke})).rejects.toThrow('duplicate_limit_or_unresolved_cost')
 expect(send).toHaveBeenCalledTimes(1);expect(preflight).toHaveBeenCalledTimes(1)
 const stored=JSON.parse(await fs.readFile(first.privateDraft,'utf8'))
 expect(stored.response.compiled.claimReview.status).toBe('unverified')
})
it('checks fresh one-call consent, full journal, budget and endpoint before reserving or sending a request',async()=>{
 const plan=prepareSharedWriter({handoff:sharedWriterFixture('PEN')}),approval=consent(plan),claim=vi.fn(),send=vi.fn(),preflight=vi.fn(async()=>endpoint(plan))
 const attempt=(a=approval,journal=[])=>executeApprovedSharedTrial({plan,approval:a,journal,claim,send,preflight,apiKey:'synthetic-key'})
 await expect(attempt({...approval,authorized:false})).rejects.toThrow('separate_bound_paid_approval_required')
 await expect(attempt({...approval,maximumNewCalls:2})).rejects.toThrow('shared_single_call_consent_required')
 await expect(attempt({...approval,newBudgetUsd:.01})).rejects.toThrow('shared_single_call_consent_required')
 await expect(attempt({...approval,journalHash:'changed'})).rejects.toThrow('shared_single_call_consent_required')
 const obsolete=structuredClone(plan)
 delete obsolete.packet.sharedReference.inputPolicyVersion
 obsolete.packet=sealSharedPacket(obsolete.packet);obsolete.packetBinding=fingerprint(obsolete.packet)
 delete obsolete.preparationBinding;obsolete.preparationBinding=fingerprint(obsolete)
 await expect(executeApprovedSharedTrial({plan:obsolete,approval:consent(obsolete),journal:[],claim,send,preflight,apiKey:'synthetic-key'})).rejects.toThrow('obsolete_shared_input_policy')
 const unresolved=[{currency:'BRL',baseDate:plan.baseDate,requestHash:'prior',status:'cost_unresolved',costUsd:null}]
 await expect(attempt(consent(plan,unresolved),unresolved)).rejects.toThrow('duplicate_limit_or_unresolved_cost')
 preflight.mockResolvedValueOnce({...endpoint(plan),zdr:false})
 await expect(attempt()).rejects.toThrow('endpoint_verification_required')
 expect(claim).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled()
})
it('keeps timeout, absent usage cost, malformed prose and excess cost as distinct failures with no retry or fallback',async()=>{
 const plan=prepareSharedWriter({handoff:sharedWriterFixture('ARS')}),approval=consent(plan)
 const preflight=async()=>endpoint(plan)
 const cases=[
  {send:async()=>{throw new Error('simulated_timeout')},status:'cost_unresolved'},
  {send:async()=>({valid:false,actualModel:plan.body.model,costUsd:null}),status:'cost_unresolved'},
  {send:async()=>({valid:true,actualModel:plan.body.model,costUsd:.01,payload:{choices:[{message:{content:'invalid json'}}]}}),status:'output_hold'},
  {send:async()=>({valid:false,actualModel:plan.body.model,costUsd:plan.maximumUsd+.01}),status:'cost_exceeded'},
 ]
 for(const sample of cases){
  const send=vi.fn(sample.send),claim=vi.fn()
  const result=await executeApprovedSharedTrial({plan,approval,journal:[],claim,send,preflight,apiKey:'synthetic-key'})
  expect(result.status).toBe(sample.status);expect(result.publicationApproved).toBe(false)
  expect(claim).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledTimes(1)
  if(result.status==='cost_unresolved')expect(result.reservedUsd).toBe(plan.maximumUsd)
 }
})
