// Offline replay only: no keys, fetch, model calls, public report writes or DB.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { bindEvidenceScope, EVIDENCE_SCOPE_VERSION } from './evidence-scope.js'
import { ECONOMIC_VERSION, economicPacketBinding, economicUpdateRequest, composeEconomicUpdate } from './economic-update.js'
import { prepareClaimReview, assessClaimReview, CLAIM_REVIEW_VERSION } from './claim-review.js'
import { prepareEventTrial } from './lifecycle-control.js'

const hash = value => createHash('sha256').update(value).digest('hex')
const privateRoot = '.local-reports/private'
const locations = {
  input: privateRoot + '/economic-retest-20261011-LkSpVT/trial-input.json',
  dossier: privateRoot + '/economic-retest-20261011-LkSpVT/dossier.json',
  decision: privateRoot + '/economic-retest-20261011-LkSpVT/decision.json',
  originals: privateRoot + '/economic-preparation-20261011-cO10nw/originals.json',
  first: privateRoot + '/event-trials/run-ISVhpA/result.json',
  firstReview: privateRoot + '/event-trials/run-ISVhpA/content-review.json',
  second: privateRoot + '/event-trials/run-zWbrLw/result.json',
  secondReview: privateRoot + '/event-trials/run-zWbrLw/content-review.json',
  firstReport: '.local-reports/reviewable/CLP-2026-10-09-1791713181820.json',
  secondReport: '.local-reports/reviewable/CLP-2026-10-09-1791714027340.json',
}

function adjudication(prepared, previous, trial) {
  // Explicit saved-source judgments; no keyword classifier or model self-score.
  const fixes = trial === 2 ? {
    3: {support:'limited',issue:'claim_scope',decision:'rewrite',reason:'주도라는 소제목도 비교 집합의 선도 기여를 암시한다. 확보한 원문은 강조한 분류까지만 지지한다.'},
    4: {support:'unverified',issue:'verification_gap',decision:'keep',reason:'수치와 양의 기여는 확인했지만 가장 큰 두 분류의 전체 순위표를 확보하지 못했다. 거짓으로 확정하지 않고 순위 확인을 보류한다.'},
    5: {support:'limited',issue:'claim_scope',decision:'rewrite',reason:'IPC 분류 기여에서 실제 생활 부담의 상대적 크기로 넓혔다. 지수 기여로 한정해야 한다.'},
  } : {11:{support:'unsupported',issue:'claim_scope',decision:'rewrite',reason:'이번 입력에는 판매 자료가 없지만 현실의 통계 부재나 미발표를 확인하지 않았다. 입력 범위로 한정한다.'}}
  const claims = prepared.claims.map(c => {
    const old = previous.claims.find(r => r.quote === c.quote)
    if (!old) return {id:c.id,claimHash:c.claimHash,support:'unverified',issue:'verification_gap',decision:'keep',reason:'코드가 표시하는 가격 사실은 이 경제 원문 대조의 대상이 아니다. 기존 가격 계산 검증과 분리한다.',anchors:[],applicationIds:[],
      subclaims:[{quote:c.quote,support:'unverified',reason:'가격 사실과 경제 발표 원문을 별도 검증하므로 이 검토에서 의미 승인하지 않는다.',anchors:[],applicationIds:[]}]}
    const finding = fixes[old.index] ?? {support:'supported',issue:old.reason.includes('추상적')||old.reason.includes('문체')?'style':'none',decision:old.reason.includes('추상적')||old.reason.includes('문체')?'refine':'keep',reason:old.reason}
    const anchors = old.sourcePassages.flatMap(ref => {
      const split = ref.lastIndexOf(':'), evidenceId = ref.slice(0,split), passageId = ref.slice(split+1)
      if (!c.evidenceIds.includes(evidenceId)) return []
      const source = prepared.sources.find(s => s.id === evidenceId), context = source?.sourceContext
      const passage = context?.passages.find(p => p.id === passageId)
      assert.ok(passage, 'saved source passage missing')
      return [{evidenceId,passageId,passageHash:context.passageHash,quote:passage.text.slice(0,460)}]
    })
    return {id:c.id,claimHash:c.claimHash,...finding,anchors,applicationIds:[],subclaims:[{quote:c.quote,support:finding.support,reason:finding.reason,anchors,applicationIds:[]}]}
  })
  return {version:CLAIM_REVIEW_VERSION,binding:prepared.binding,origin:'agent',reviewer:'Codex saved source scope adjudication 2026-10-11',claims}
}

async function main() {
  if (process.argv.length !== 2) throw new Error('offline_replay_accepts_no_arguments')
  const before = Object.fromEntries(await Promise.all(Object.entries(locations).map(async ([key,file])=>[key,await fs.readFile(file)])))
  const data = Object.fromEntries(Object.entries(before).map(([key,bytes])=>[key,JSON.parse(bytes)]))
  const proposal = JSON.parse(await fs.readFile('docs/2.0/economic-evidence-card-proposal.json','utf8'))
  const packet = structuredClone(data.input.packet)
  const scopeCards = []
  for (const card of proposal.cards) {
    const evidence = packet.evidence.find(e=>e.id===card.evidenceId)
    const original = data.originals.find(o=>o.sha256===card.sourceDocumentHash)
    assert.ok(original && evidence)
    const source = await fs.readFile(path.join(privateRoot,'source-review-2026-10-11',original.file))
    assert.equal(hash(source),card.sourceDocumentHash)
    assert.equal(hash(JSON.stringify(original.blocks)),evidence.sourceContext.bodyHash)
    scopeCards.push(bindEvidenceScope(evidence,card,{origin:'agent',status:'checked',reason:'보존된 원문의 단위·기간·주장 범위를 오프라인 대조한 검토다.'}))
  }
  const dossier = {version:ECONOMIC_VERSION,packetHash:economicPacketBinding(packet),scopeCards,
    cards:data.dossier.cards.map(old=>{
      const card = scopeCards.find(c=>c.evidenceId===old.evidenceId)
      return {...old,newInformation:card.admittedClaims[0].text,allowedUse:card.allowedUse,countercontext:card.countercontext,
        review:{origin:'agent',status:'checked',reason:'보존된 원문과 새 범위 카드의 기간·단위·제외 주장을 재검토했다.'}}
    })}
  const decision = data.decision.decision ?? data.decision
  const request = economicUpdateRequest(packet,dossier,decision), plan = prepareEventTrial({packet,dossier,decision})
  assert.equal(request.status,'prepared_not_called')
  assert.equal(plan.paidCallAuthorized,false)
  assert.ok(plan.maximumUsd<=.25)
  assert.ok(!JSON.stringify(request.request).includes('실제 내구재 수요 자료는 없다'))
  assert.equal(economicUpdateRequest(packet,data.dossier,decision).request,null,'old dossier may not start a new request')

  const replays = [data.first,data.second].map((result,i)=>{
    const draft = JSON.parse(result.response.payload?.choices?.[0]?.message?.content ?? result.response.partialText)
    const composed = composeEconomicUpdate(packet,draft,{scopeCards})
    const oldReview = i===0?data.firstReview:data.secondReview
    // Legacy malformed output remains malformed. Read preserved assembled prose
    // separately; do not normalize its old targets or label it newly generated.
    const content = composed.content ?? result.response.compiled.content
    const prepared = composed.claimReview ?? prepareClaimReview(packet,content,{scopeCards,claimLedger:draft.claims,purpose:'economic_update'})
    const review = adjudication(prepared,oldReview,i+1), assessment = assessClaimReview(prepared,review)
    return {trial:i+1,originalCostUsd:result.costUsd,automaticErrors:composed.errors,
      prepared,review,assessment,newModelCalls:0,publicationApproved:false}
  })
  assert.ok(replays[1].assessment.requiredCorrections.includes('drivers.0.title:0'))
  assert.ok(replays[1].assessment.requiredCorrections.includes('drivers.0.text:1'))
  assert.ok(replays[1].assessment.verificationPending.includes('drivers.0.text:0'))
  assert.ok(replays[1].assessment.errors.includes('drivers.2.text:1:block_source_missing'))
  assert.ok(replays[0].assessment.requiredCorrections.includes('watch.0.text:1'))

  const raw = JSON.parse(data.second.response.partialText), referenceRepair = structuredClone(raw)
  referenceRepair.drivers[2].evidenceIds.push('ine-cl-ipc-september')
  const repaired = composeEconomicUpdate(packet,referenceRepair,{scopeCards})
  assert.deepEqual(repaired.errors,[])
  const repairedReview = adjudication(repaired.claimReview,data.secondReview,2)
  const repairedAssessment = assessClaimReview(repaired.claimReview,repairedReview)
  assert.deepEqual(repairedAssessment.errors,[])
  assert.ok(repairedAssessment.requiredCorrections.includes('drivers.0.title:0'))
  assert.ok(repairedAssessment.verificationPending.includes('drivers.0.text:0'))

  // Positive contrast: explicit local editing example, not a model response or
  // replacement report. Reuse the same passages and review with narrowed claims.
  const narrowed = structuredClone(referenceRepair)
  narrowed.drivers[0].title = '식품·교통 가격 상승'
  narrowed.drivers[0].text = '이번 물가 발표에서는 {{ipc_monthly}}, {{ipc_annual}}로 나타났다. 식품·교통 가격 상승이 IPC 상승에 기여했다.'
  const targets = [
    ['drivers.0.title',narrowed.drivers[0].title],
    ['drivers.0.text','이번 물가 발표에서는 {{ipc_monthly}}, {{ipc_annual}}로 나타났다.'],
    ['drivers.0.text','식품·교통 가격 상승이 IPC 상승에 기여했다.'],
  ]
  narrowed.claims = narrowed.claims.filter(c=>!c.target.startsWith('drivers.0.'))
  narrowed.claims.push(...targets.map(([target,quote])=>({target,quote,evidenceIds:['ine-cl-ipc-september']})))
  const contrast = composeEconomicUpdate(packet,narrowed,{scopeCards})
  assert.deepEqual(contrast.errors,[])
  const p = contrast.claimReview, manuscriptReview = adjudication(p,data.secondReview,2)
  for (const c of p.claims.filter(c=>c.target.startsWith('drivers.0.'))) {
    const row = manuscriptReview.claims.find(r=>r.id===c.id), source = p.sources.find(s=>s.id==='ine-cl-ipc-september')
    const passage = source.sourceContext.passages.find(p=>p.id=== (c.id==='drivers.0.text:0'?'p0':'p2'))
    const anchors = [{evidenceId:source.id,passageId:passage.id,passageHash:source.sourceContext.passageHash,quote:passage.text}]
    Object.assign(row,{support:'supported',issue:'none',decision:'keep',reason:'원문에서 확인한 분류 가격 상승과 IPC에 대한 양의 기여로 범위를 좁힌 편집 대조 예시다.',anchors,
      subclaims:[{quote:c.quote,support:'supported',reason:'대상·비교 범위를 원문 안에 유지한 문장을 직접 대조했다.',anchors,applicationIds:[]}]})
  }
  const contrastAssessment = assessClaimReview(p,manuscriptReview)
  assert.deepEqual(contrastAssessment.errors,[])
  assert.deepEqual(contrastAssessment.requiredCorrections,[])
  assert.ok(contrastAssessment.verificationPending.every(id=>id.startsWith('change.')))
  assert.equal(contrastAssessment.rows.find(r=>r.id==='drivers.1.title:0').disposition,'no_issue','same-index offset remains supported')

  for (const [key,file] of Object.entries(locations)) assert.equal(hash(await fs.readFile(file)),hash(before[key]),'historical artifact changed')
  const root = path.join(privateRoot,'economic-scope-replays')
  await fs.mkdir(root,{recursive:true})
  const output = await fs.mkdtemp(path.join(root,'run-'))
  const write = (file,value)=>fs.writeFile(path.join(output,file),JSON.stringify(value,null,2),{flag:'wx'})
  const summary = {version:EVIDENCE_SCOPE_VERSION,mode:'offline_saved_source_review',output,modelCalls:0,newCostUsd:0,
    oldCostUsd:data.first.costUsd+data.second.costUsd,sourceCount:2,savedDrafts:2,
    preparedRequestStatus:plan.status,paidCallAuthorized:false,unapprovedRequestMaximumUsd:plan.maximumUsd,
    referenceRepair:{origin:'agent_reference_only_example',automaticStatus:repaired.valid?'pass':'hold',semanticStatus:repairedAssessment.status,publicationApproved:false},
    narrowedContrast:{origin:'agent_editorial_example',automaticStatus:'pass',requiredCorrections:[],sourceJudgment:'supported_for_economic_prose',priceFactReview:'outside_this_economic_review',publicationApproved:false},
    historicalFiles:Object.fromEntries(Object.entries(before).map(([key,value])=>[key,hash(value)])),publicationApproved:false}
  await write('prepared-input.json',{packet,dossier,decision,plan}) // No approval copied into the new input.
  await write('evaluation.json',{summary,replays,referenceRepair:{prepared:repaired.claimReview,review:repairedReview,assessment:repairedAssessment},
    narrowedContrast:{content:contrast.content,prepared:p,review:manuscriptReview,assessment:contrastAssessment}})
  await write('summary.json',summary)
  console.log(JSON.stringify(summary,null,2))
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
