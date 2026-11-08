// Offline only. Never imports the API runner, reads keys or writes public reports.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { economicUpdateRequest, composeEconomicUpdate } from './economic-update.js'

const hash = data => createHash('sha256').update(data).digest('hex')
const root = '.local-reports/private'
const inputs = {
  input: root + '/economic-scoped-trial-3-Je1ZbM/trial-input.json',
  result: root + '/event-trials/run-cv5X5k/result.json',
  review: root + '/event-trials/run-cv5X5k/content-review-detailed.json',
  journal: root + '/event-trials/journal.json',
  comparison: '.local-reports/reviewable/clp-rules-comparison.json',
  ipc: root + '/source-review-2026-10-11/cl-ipc-followup.html',
  wage: root + '/source-review-2026-10-11/cl-wage-followup.html',
  ...Object.fromEntries(['CLP-2026-10-09-1791713181820','CLP-2026-10-09-1791714027340','CLP-2026-10-09-1791718402206'].map(id=>[id,'.local-reports/reviewable/'+id+'.json'])),
  first: root + '/event-trials/run-ISVhpA/result.json',
  second: root + '/event-trials/run-zWbrLw/result.json',
}

async function main() {
  if (process.argv.length !== 2) throw new Error('offline_replay_accepts_no_arguments')
  const bytes = Object.fromEntries(await Promise.all(Object.entries(inputs).map(async ([key,file])=>[key,await fs.readFile(file)])))
  const {packet,dossier,decision} = JSON.parse(bytes.input)
  const result = JSON.parse(bytes.result)
  assert.equal(hash(bytes.ipc),'85e015e8a3bcb1a249e6364eb5887c77bbe3c13869e3f2d0bef066c8f87a9464')
  assert.equal(hash(bytes.wage),'5da4fc0731de1bfc6062848cfb29ebf0d521e1f746aedcc14c6adf0172bdad05')
  const oldDraft = JSON.parse(result.response.payload.choices[0].message.content)
  const prepared = economicUpdateRequest(packet,dossier,decision)
  assert.equal(prepared.status,'prepared_not_called')
  assert.deepEqual(prepared.editorialPlan.watchCandidates,[])
  const oldUnderNewRules = composeEconomicUpdate(packet,oldDraft,prepared)
  assert.deepEqual(oldUnderNewRules.errors,['economic_schema'],'the saved reading rule has no admitted observation candidate')

  const ipc = 'ine-cl-ipc-september', wage = 'ine-cl-real-wage-august'
  // Explicit agent-written counterexample, NOT a generated or approved report.
  const example = {
    title:'식품·교통 가격은 오르고 보험·금융은 전체 상승을 일부 상쇄했다',
    summary:'물가 상승 안에서도 분류별 방향은 엇갈렸다. 별도 임금 발표에서는 물가를 반영해 조정한 실질보수 지수가 증가했다.',
    drivers:[
      {title:'전체 상승률 안의 서로 다른 움직임',text:'{{ipc_monthly}}, {{ipc_annual}}이다. 원문은 식품·교통을 상승 분류로 강조했고, 보험·금융의 음의 기여는 전체 상승을 일부 상쇄했다.',evidenceIds:[ipc]},
      {title:'물가를 반영한 실질보수 지수도 증가',text:'{{real_wage_annual}}이다. 실질보수는 이미 물가 변동을 반영해 조정한 지표로, 이번 발표는 그 조정 이후의 증가를 보여준다.',evidenceIds:[wage]},
    ], watch:[], claims:[] }
  const judgments = [
    ['title',example.title,ipc,['p2','p4'],'상승 분류와 음의 지수 기여를 연결한다. 가계 부담의 실제 감소로 넓히지 않는다.'],
    ['summary','물가 상승 안에서도 분류별 방향은 엇갈렸다.',ipc,['p0','p1'],'전체 상승과 양·음 분류가 함께 확인된다.'],
    ['summary','별도 임금 발표에서는 물가를 반영해 조정한 실질보수 지수가 증가했다.',wage,['p2'],'원문 정의와 연간 증가를 별도 임금 자료로 한정한다.'],
    ['drivers.0.title',example.drivers[0].title,ipc,['p1'],'분류 방향 차이를 뜻하며 순위나 중요도 비교가 아니다.'],
    ['drivers.0.text','{{ipc_monthly}}, {{ipc_annual}}이다.',ipc,['p0'],'고정 facts의 월간·연간 단위와 대상 월을 원문에 대조했다.'],
    ['drivers.0.text','원문은 식품·교통을 상승 분류로 강조했고, 보험·금융의 음의 기여는 전체 상승을 일부 상쇄했다.',ipc,['p2','p4'],'강조는 출처에 귀속하고 상쇄는 같은 IPC 기여에 한정한다. 전체 순위·가구 부담은 주장하지 않는다.'],
    ['drivers.1.title',example.drivers[1].title,wage,['p2'],'물가 조정된 실질보수의 증가만 말한다.'],
    ['drivers.1.text','{{real_wage_annual}}이다.',wage,['p2'],'고정 fact의 연간 비교와 대상 월을 원문에 대조했다.'],
    ['drivers.1.text','실질보수는 이미 물가 변동을 반영해 조정한 지표로, 이번 발표는 그 조정 이후의 증가를 보여준다.',wage,['p2'],'실질보수 정의의 설명이다. 다른 달 CPI 재차감이나 전 가구 구매력·실제 판매 증가는 아니다.'],
  ]
  example.claims = judgments.map(([target,quote,evidenceId])=>({target,quote,evidenceIds:[evidenceId]}))
  const composed = composeEconomicUpdate(packet,example,prepared)
  assert.deepEqual(composed.errors,[])
  assert.equal(composed.claimReview.status,'unverified') // Machine success is not semantic approval.
  assert.equal(composed.publicationApproved,false)
  assert.equal(composed.content.drivers.length,2)
  assert.equal(composed.content.watch.length,0)
  assert.equal(composed.content.limitations.filter(s=>s.includes('지표별 대상 기간')).length,1)
  assert.deepEqual(composed.content.change,result.response.compiled.content.change)
  assert.equal(composed.claimReview.claims.length,judgments.length)
  const sourceReview = judgments.map(([target,quote,evidenceId,passageIds,reason])=>{
    assert.ok(composed.claimReview.claims.some(c=>c.target===target&&c.quote===quote))
    const e = packet.evidence.find(e=>e.id===evidenceId)
    const passages = passageIds.map(id=>{
      const p = e.sourceContext.passages.find(p=>p.id===id)
      assert.ok(p)
      return {id,text:p.text}
    })
    return {target,quote,evidenceId,passages,origin:'agent_manual_source_review',support:'supported_within_stated_scope',reason}
  })
  // Explicit editorial judgments, not regex counts or model self-grading.
  const dispositions = [
    {target:'summary',issue:'직접 비교 불가로 제한 범위를 확대',action:'기간 간 차감·같은 달 합산 금지만 공통 한계로 좁힘'},
    {target:'drivers.0 + drivers.1',issue:'같은 IPC 상승·상쇄 설명을 분리',action:'하나로 합치되 보험·금융의 반대 기여를 본문에 보존'},
    {target:'drivers.1.text',issue:'가계 부담 측정 아님을 반복',action:'지수 기여로 정확히 서술하고 해당 주장 자체를 확대하지 않음'},
    {target:'drivers.2.text',issue:'전 가구 소득·판매 아님을 반복',action:'실질보수 정의와 조정 이후 증가에 한정'},
    {target:'watch',issue:'새 관찰 변수 대신 독해 규칙',action:'검토된 미래 신호가 없으므로 생략; 일정·지표를 창작하지 않음'},
  ]
  const historicalHashes = Object.fromEntries(Object.entries(bytes).map(([key,value])=>[key,hash(value)]))
  for (const [key,file] of Object.entries(inputs)) assert.equal(hash(await fs.readFile(file)),historicalHashes[key])
  const outputRoot = path.join(root,'economic-editorial-replays')
  await fs.mkdir(outputRoot,{recursive:true})
  const output = await fs.mkdtemp(path.join(outputRoot,'run-'))
  const write = (file,value)=>fs.writeFile(path.join(output,file),JSON.stringify(value,null,2),{flag:'wx'})
  const summary = {version:prepared.editorialPlan.version,mode:'offline',output,newModelCalls:0,newCostUsd:0,
    savedDrafts:1,manualExamples:1,syntheticUnitTests:'separate',
    oldReplay:{automatic:'hold',errors:oldUnderNewRules.errors,originalStatusUnchanged:true},
    example:{origin:'agent_editorial_example_not_ai',automatic:'pass',manualSourceJudgments:sourceReview.length,
      agentReview:'supported_within_stated_scope',humanApproved:false,realModelQuality:'unverified'},
    historicalFilesUnchanged:Object.keys(inputs).length,historicalHashes,publicationApproved:false}
  await write('request.json',{request:prepared.request,editorialPlan:prepared.editorialPlan,paidCallAuthorized:false})
  await write('comparison.json',{original:{origin:'actual_saved_ai',draft:oldDraft},example:{origin:'agent_editorial_example_not_ai',draft:example,content:composed.content},dispositions,sourceReview})
  await write('summary.json',summary)
  console.log(JSON.stringify(summary,null,2))
}

main().catch(e=>{console.error(e.message);process.exitCode=1})
