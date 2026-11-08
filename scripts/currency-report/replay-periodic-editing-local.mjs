// Re-evaluate stored prose and prepare new guidance only. No model, credential
// loader, collection, app registration, content replacement or publication.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PERIODIC_EDITING_CASES, periodicSnippetContent } from './periodic-editing-cases.js'
import { PERIODIC_WRITING_VERSION, PERIODIC_SHARED_SCOPE_NOTE, inspectPeriodicProse } from './periodic-editing.js'
import { preparePeriodicCheck } from './periodic-check.js'
import { requestBody, composeDraft } from './openrouter.js'
import { decodeGenerationOutput } from './generation-wire.js'
import { inspectEditorial } from './editorial.js'
import { assessClaimReview, claimReviewContract } from './claim-review.js'

globalThis.fetch = () => { throw new Error('offline_periodic_editing_replay_only') }
const trial='.local-reports/private/periodic-sol-trial-20261027'
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'))
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const digest=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
 const f=path.join(dir,e.name);return e.isDirectory()?walk(f):[f.replaceAll('\\','/')]
})
const before=read(trial+'/preservation.json')
for(const f of [...walk(trial),...walk('.local-reports/reviewable'),
 'artifacts/clp-periodic-sol-20261027-a.html','artifacts/clp-periodic-sol-20261027-a-desktop.png',
 'artifacts/clp-periodic-sol-20261027-a-mobile.png','docs/2.0/periodic-report-samples-20261027.json'])before[f]=digest(f)
assert.ok(Object.entries(before).every(([f,h])=>digest(f)===h))
const out=fs.mkdtempSync('.local-reports/private/periodic-editing-replay-20261027-')
fs.writeFileSync(out+'/preservation-before.json',JSON.stringify(before,null,2))
const old=read(trial+'/compiled.json'),approved=read(trial+'/approved-input.json'),raw=read(trial+'/raw-draft.json')
const sourceInput=read('.local-reports/private/periodic-check-replay-20261027-S6KgZV/normal-preparation-input.json')
const oldReview=read(trial+'/content-review.json')
const oldProse={title:old.candidate.title,summary:old.candidate.summary,drivers:old.candidate.drivers,implications:old.candidate.implications,watch:old.candidate.watch}
const checks=PERIODIC_EDITING_CASES.map(row=>{
 if(row.origin==='saved_sol_quote')assert.ok(JSON.stringify(oldProse).includes(row.text),`saved_quote_mismatch:${row.id}`)
 const content=periodicSnippetContent(row),previous=hash(content),inspection=inspectPeriodicProse(content)
 assert.deepEqual(inspection.signals.map(s=>s.code).sort(),[...row.codes].sort(),row.id)
 assert.equal(hash(content),previous)
 assert.deepEqual(inspectEditorial(content,{periodic:true}).blockers,[])
 return {...row,signals:inspection.signals,check:'matched_expected_style_signal_only',semanticSupport:'not_evaluated',publicationApproved:false}
})
const actualInspection=inspectEditorial(old.candidate,{periodic:true})
for(const warning of ['periodic:title_process_needs_review','periodic:process_prose_needs_review',
 'periodic:scope_prose_needs_relocation','periodic:repeated_scope_caveats'])assert.ok(actualInspection.warnings.includes(warning))
assert.deepEqual(actualInspection.blockers,[])
const prepared=preparePeriodicCheck(sourceInput)
assert.equal(prepared.status,'ready_for_local_draft')
const packet=prepared.packet,body=requestBody(packet,'openrouter/free')
const input=JSON.parse(body.messages[1].content)
assert.equal(input.periodicCheck.writingVersion,PERIODIC_WRITING_VERSION)
assert.equal(input.periodicCheck.sharedScopeNote,PERIODIC_SHARED_SCOPE_NOTE)
assert.ok(!body.messages[0].content.includes('normal_check는 기존 설명 항목을 이번 근거에서도 다룰 수 있다는 뜻'))
assert.equal(input.writingExamples,undefined)
const decoded=decodeGenerationOutput(raw,approved.plan.outputContract)
const replay=composeDraft(packet,decoded,true,true)
assert.equal(replay.validation.valid,true)
assert.equal(replay.rules.automaticStatus,'pass')
assert.equal(replay.rules.semanticStatus,'unverified')
assert.deepEqual({title:replay.candidate.title,summary:replay.candidate.summary,drivers:replay.candidate.drivers,
 implications:replay.candidate.implications,watch:replay.candidate.watch},oldProse)
const limits=replay.candidate.limitations.join(' ')
for(const t of sourceInput.packet.limitations)assert.ok(limits.includes(t))
assert.equal(limits.split(PERIODIC_SHARED_SCOPE_NOTE).length,2)
assert.notEqual(replay.claimReview.binding,old.claimReview.binding)
assert.equal(assessClaimReview(replay.claimReview,oldReview.review).status,'unverified')
assert.ok(claimReviewContract(replay.claimReview).messages[0].content.includes(PERIODIC_WRITING_VERSION))
const scenarios=[]
for(const scenario of ['normal','update','partial']) {
 const data=structuredClone(sourceInput)
 if(scenario==='update')data.previous.topics=data.previous.topics.slice(0,1)
 if(scenario==='partial')data.topics=data.topics.filter(t=>t.id==='rates')
 const p=preparePeriodicCheck(data).packet,request=requestBody(p,'openrouter/free'),sent=JSON.parse(request.messages[1].content)
 assert.equal(sent.periodicCheck.writingVersion,PERIODIC_WRITING_VERSION)
 scenarios.push({scenario:p.periodicCheck.scenario,readerTask:sent.periodicCheck.readerTask,
   writingVersion:sent.periodicCheck.writingVersion,selectedTopicIds:sent.periodicCheck.selectedTopicIds})
}
fs.writeFileSync(out+'/writer-input.json',JSON.stringify({input,instructions:body.messages[0].content,
 schema:body.response_format.json_schema.schema,paidCallAuthorized:false,publicationApproved:false},null,2))
fs.writeFileSync(out+'/actual-manuscript-reevaluation.json',JSON.stringify({policyVersion:PERIODIC_WRITING_VERSION,
 source:trial+'/compiled.json',oldAutomaticWarnings:old.editorial.warnings,newInspection:actualInspection,
 newClaimReview:replay.claimReview,oldReviewReusable:false,modelProseChanged:false,
 codeOwnedLimitations:replay.candidate.limitations,oldScoresPreserved:true,newQualityScore:null},null,2))
fs.writeFileSync(out+'/cases.json',JSON.stringify(checks,null,2))
const intact=Object.entries(before).every(([f,h])=>digest(f)===h)
assert.ok(intact)
const result={version:'periodic-editing-replay/1',policyVersion:PERIODIC_WRITING_VERSION,
 actualSavedTrial:'Sol normal periodic 2026-09-10',savedFailureSnippets:checks.filter(c=>c.origin==='saved_sol_quote'&&c.codes.length).length,
 savedInformativeSnippets:checks.filter(c=>c.origin==='saved_sol_quote'&&!c.codes.length).length,
 syntheticStyleContrasts:checks.filter(c=>c.origin==='synthetic_style_contrast').length,
 actualOriginalWarnings:old.editorial.warnings,newActualWarnings:actualInspection.warnings,
 scenarios,automaticStatus:replay.rules.automaticStatus,contentReview:'unverified',
 originalFilesUnchanged:intact,protectedFiles:Object.keys(before).length,modelProseChanged:false,oldScoresPreserved:true,
 modelCalls:0,externalCalls:0,newApiCostUsd:0,productionChanges:false,publicationApproved:false,
 limitation:'저장 원고의 문제와 정상 대조 문장의 검사·새 지침 연결을 검증했다. 새 AI 생성 품질 향상을 입증한 시험은 아니다.'}
fs.writeFileSync(out+'/result.json',JSON.stringify(result,null,2))
console.log(JSON.stringify({output:out,...result},null,2))
