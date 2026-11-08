// Preparation only: fixed public metadata GETs, no key reads or generation POST.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { prepareEventTrial, eventTrialEndpointPreflight, executeEventTrial } from './lifecycle-control.js'

const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fileHash = bytes => createHash('sha256').update(bytes).digest('hex')
const privateRoot = '.local-reports/private'
const files = {
  input: privateRoot+'/economic-scoped-trial-3-Je1ZbM/trial-input.json',
  journal: privateRoot+'/event-trials/journal.json',
  baseline: privateRoot+'/event-trials/run-cv5X5k/result.json',
  review: privateRoot+'/event-trials/run-cv5X5k/content-review-detailed.json',
  report: '.local-reports/reviewable/CLP-2026-10-09-1791718402206.json',
  comparison: '.local-reports/reviewable/clp-rules-comparison.json',
  ipc: privateRoot+'/source-review-2026-10-11/cl-ipc-followup.html',
  wage: privateRoot+'/source-review-2026-10-11/cl-wage-followup.html',
}
let stage = 'saved_inputs'

async function main() {
  if (process.argv.length !== 2) throw new Error('comparison_preparation_accepts_no_arguments')
  const before = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key,file])=>[key,await fs.readFile(file)])))
  const input = JSON.parse(before.input), journal = JSON.parse(before.journal)
  const baseline = JSON.parse(before.baseline), review = JSON.parse(before.review), report = JSON.parse(before.report)
  assert.equal(journal.length,3,'expected three preserved attempts')
  assert.ok(journal.every(r=>r.currency==='CLP'&&r.baseDate==='2026-10-09'&&Number.isFinite(r.costUsd)&&r.costUsd>=0&&r.reservedUsd===0))
  assert.equal(journal.at(-1).requestHash,input.plan.requestHash)
  assert.equal(journal.at(-1).costUsd,baseline.costUsd)
  assert.equal(review.assessment.status,'needs_revision')
  assert.ok(review.assessment.requiredCorrections.length>0)
  assert.equal(report.status,'rejected')
  assert.equal(fileHash(before.ipc),'85e015e8a3bcb1a249e6364eb5887c77bbe3c13869e3f2d0bef066c8f87a9464')
  assert.equal(fileHash(before.wage),'5da4fc0731de1bfc6062848cfb29ebf0d521e1f746aedcc14c6adf0172bdad05')
  const {packet,dossier,decision} = input
  const plan = prepareEventTrial({packet,dossier,decision})
  assert.equal(plan.status,'prepared_not_called')
  assert.ok(!journal.some(r=>r.requestHash===plan.requestHash),'do not repeat an old request')
  assert.equal(plan.editorialPlan.version,'economic-editorial/1')
  assert.deepEqual(plan.editorialPlan.watchCandidates,[])
  plan.retestOf = journal.at(-1).requestHash
  const checkedMetadata = []
  const fetchMetadata = async url => {
    assert.ok(['https://openrouter.ai/api/v1/models/anthropic/claude-sonnet-5.5/endpoints','https://openrouter.ai/api/v1/endpoints/zdr'].includes(url))
    const response = await fetch(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000)})
    const bytes = await response.arrayBuffer()
    const data = Buffer.from(bytes)
    checkedMetadata.push({url,status:response.status,sha256:fileHash(data),data:JSON.parse(data.toString('utf8'))})
    return new Response(data,{status:response.status,headers:{'content-type':'application/json'}})
  }
  stage = 'public_endpoint_preflight'
  const preflight = await eventTrialEndpointPreflight(plan.body,fetchMetadata)
  assert.equal(preflight.modelCalls,0)
  const previousUsd = Number(journal.reduce((total,r)=>total+r.costUsd,0).toFixed(9))
  const proposedNewBudgetUsd = Math.ceil(plan.maximumUsd*100)/100
  const proposedTotalBudgetUsd = Number((previousUsd+proposedNewBudgetUsd).toFixed(9))
  assert.ok(proposedNewBudgetUsd<=.25)
  // Prove an apparently budgeted fourth attempt cannot spend through the old
  // runner. This fake consent is never saved as an authorized approval.
  stage = 'existing_call_limit_verification'
  let calls = 0
  const cannotRun = async()=>{calls++;throw new Error('unexpected_external_attempt')}
  await assert.rejects(executeEventTrial({plan,journal,
    approval:{authorized:true,planHash:fingerprint(plan),budgetUsd:proposedTotalBudgetUsd,newBudgetUsd:proposedNewBudgetUsd,
      retestAuthorized:true,previousRequestHashes:journal.map(r=>r.requestHash)},
    claim:cannotRun,invoke:cannotRun,preflight:cannotRun}),/duplicate_limit_or_unresolved_cost/)
  assert.equal(calls,0)
  const criteria = [
    {id:'new_information',requirement:'새 사실·구성·대조가 본문을 이끈다. 제목 재진술로 문단을 채우지 않는다.'},
    {id:'repeated_caveats',requirement:'공통 한계를 여러 문단에 반복하지 않는다. 설명을 바꾸는 조건은 해당 문장에 유지한다.',method:'manual_sentence_review_not_regex_ratio'},
    {id:'counterevidence',requirement:'보험·금융의 반대 기여와 실질보수의 물가 조정 정의가 남아 있다.'},
    {id:'period_scope',requirement:'별도 대상 월을 유지하고 차감·같은 달 합산으로 확대하지 않는다. 별도 맥락 비교까지 금지하지 않는다.'},
    {id:'watch',requirement:'검토 후보가 없으므로 watch는 빈 배열이다.'},
    {id:'all_claims',requirement:'제목·요약·본문의 모든 주장이 원문으로 지지되고 수치·순위·가계 부담·판매로 확대되지 않는다.'},
    {id:'quality',requirement:'기존 5개 항목 평균 4/5 이상·근거 충실도 4/5 이상, 필수 교정과 중대한 오류 0건. 사용자 판단은 별도.'},
  ]
  const preserved = Object.fromEntries(Object.entries(before).map(([key,bytes])=>[key,{file:files[key],sha256:fileHash(bytes)}]))
  for(const [key,file] of Object.entries(files)) assert.equal(fileHash(await fs.readFile(file)),preserved[key].sha256)
  const proposal = {
    version:'economic-editorial-comparison-proposal/1',status:'prepared_approval_and_scoped_execution_extension_required',
    baselineReportId:report.id,baselineRequestHash:input.plan.requestHash,baselineCostUsd:baseline.costUsd,
    previousRequestHashes:journal.map(r=>r.requestHash),journalHash:fileHash(before.journal),preserved,
    packetHash:plan.packetHash,requestHash:plan.requestHash,planHash:fingerprint(plan),criteria,preflight,
    inputBound:plan.inputBound,maxOutputTokens:plan.body.max_tokens,calculatedMaximumUsd:plan.maximumUsd,
    proposedNewBudgetUsd,previousUsd,proposedTotalBudgetUsd,
    requiredConsent:{extraCalls:1,maximumCallsAfterThisComparison:4,newBudgetUsd:proposedNewBudgetUsd,retries:0,fallbacks:false,
      restriction:'Only this bound changed input with all three prior attempts and review preserved. General three-call limit stays unchanged.'},
    executionReady:false,paidCallAuthorized:false,publicationApproved:false,newModelCalls:0,newCostUsd:0,
  }
  stage = 'private_preparation_output'
  const outputRoot=path.join(privateRoot,'economic-comparison-preparations')
  await fs.mkdir(outputRoot,{recursive:true})
  const output=await fs.mkdtemp(path.join(outputRoot,'run-'))
  const write=(name,value)=>fs.writeFile(path.join(output,name),JSON.stringify(value,null,2),{flag:'wx'})
  await write('trial-input.json',{packet,dossier,decision,plan,approval:{authorized:false,planHash:fingerprint(plan),budgetUsd:proposedTotalBudgetUsd,newBudgetUsd:proposedNewBudgetUsd,retestAuthorized:false,previousRequestHashes:proposal.previousRequestHashes}})
  await write('proposal.json',proposal)
  await write('metadata.json',checkedMetadata)
  console.log(JSON.stringify({output,status:proposal.status,model:preflight.model,route:preflight.route,inputBound:plan.inputBound,
    calculatedMaximumUsd:plan.maximumUsd,proposedNewBudgetUsd,previousUsd,proposedTotalBudgetUsd,
    requestHash:plan.requestHash,planHash:proposal.planHash,checkedAt:preflight.checkedAt,zdr:preflight.zdr,
    dataCollection:preflight.dataCollection,structuredOutputVerified:true,historicalFilesUnchanged:Object.keys(files).length,
    oldLimitBlocksFourth:true,executionReady:false,paidCallAuthorized:false,newModelCalls:0,newCostUsd:0},null,2))
}
main().catch(e=>{console.error(JSON.stringify({status:'economic_comparison_preparation_stopped',stage,
  reason:/^[a-z_]+$/.test(e.message)?e.message:e.code??e.cause?.code??e.name,newModelCalls:0}));process.exitCode=1})
