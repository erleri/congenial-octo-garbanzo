import {expect,it,vi} from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {BOUNDED_RETEST_VERSION,WRITER_RETEST_VERSION,boundedRetestAuthorized,verifyBoundedRetestFiles} from './bounded-retest-consent.js'
import {executeEventTrial} from './lifecycle-control.js'
import {runLocalTrial} from './run-event-trial.js'
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const bytesHash=(v:string)=>createHash('sha256').update(v).digest('hex')
function fixture(){
  const journal=Array.from({length:3},(_,i)=>({currency:'CLP',baseDate:'2026-09-10',requestHash:`old-${i}`,retestOf:i?`old-${i-1}`:null,status:'output_hold',reservedUsd:0,costUsd:.02}))
  const body={model:'anthropic/claude-sonnet-5.5',max_tokens:8192,messages:[],reasoning:{effort:'medium'},provider:{only:['google-vertex/global'],require_parameters:true,zdr:true,data_collection:'deny',allow_fallbacks:false}}
  const packet={currency:'CLP',baseDate:'2026-09-10'},dossier={cards:[]}
  const basePlan={purpose:'fx_explanation',status:'prepared_not_called',currency:packet.currency,baseDate:packet.baseDate,packetHash:hash(packet),requestHash:hash(body),body,maximumUsd:.14,retestOf:'old-2',timeoutMs:120000,retries:0}
  const scope={version:BOUNDED_RETEST_VERSION,requestHash:basePlan.requestHash,journalHash:hash(journal),extraCalls:1,maximumCalls:4,proposalFile:'.local-reports/private/proposal.json',proposalSha256:'0'.repeat(64)}
  const plan={...basePlan,boundedRetest:scope}
  const approval={authorized:true,origin:'human',planHash:hash(plan),extraTrialAuthorized:true,maximumNewCalls:1,retestAuthorized:true,previousRequestHashes:journal.map(r=>r.requestHash),newBudgetUsd:.14,budgetUsd:.2}
  return {packet,dossier,basePlan,plan,approval,journal}
}

it('binds a separately approved fifth writer-contract call to all four costed failures and cannot permit a sixth', async () => {
  const a = fixture()
  a.journal.push({ ...a.journal[2], requestHash: 'old-3', retestOf: 'old-2' })
  a.plan.retestOf = 'old-3'
  Object.assign(a.plan, { outputContract: { writingContractVersion: 'writer-links/1' } })
  Object.assign(a.plan.boundedRetest, { version: WRITER_RETEST_VERSION, maximumCalls: 5, journalHash: hash(a.journal) })
  Object.assign(a.approval, { maximumCallsAfterThisTrial: 5, planHash: hash(a.plan), budgetUsd: a.journal.reduce((n, r) => n + r.costUsd, 0) + .14, previousRequestHashes: a.journal.map(r => r.requestHash) })
  expect(boundedRetestAuthorized(a.plan, a.approval, a.journal)).toBe(true)
  expect(boundedRetestAuthorized(a.plan, { ...a.approval, maximumCallsAfterThisTrial: 4 }, a.journal)).toBe(false)
  const invoke = vi.fn(async () => ({ valid: true, actualModel: a.plan.body.model, costUsd: .03 }))
  const preflight = vi.fn(async () => ({ model: a.plan.body.model, route: 'google-vertex/global', zdr: true, dataCollection: 'deny' }))
  await executeEventTrial({ ...a, claim: vi.fn(), invoke, preflight })
  expect(invoke).toHaveBeenCalledTimes(1)
  a.journal.push({ ...a.journal[3], requestHash: a.plan.requestHash, retestOf: 'old-3' })
  await expect(executeEventTrial({ ...a, claim: vi.fn(), invoke, preflight })).rejects.toThrow('bounded_retest_consent_required')
  expect(invoke).toHaveBeenCalledTimes(1)
})

it('permits only the expressly bound fourth request while leaving default limits, cost holds and fifth-call blocking intact',async()=>{
  const a=fixture(),invoke=vi.fn(async()=>({valid:true,actualModel:a.plan.body.model,costUsd:.03})),claim=vi.fn(),preflight=vi.fn(async()=>({model:a.plan.body.model,route:'google-vertex/global',zdr:true,dataCollection:'deny'}))
  const before=structuredClone(a.journal)
  expect(boundedRetestAuthorized(a.plan,a.approval,a.journal)).toBe(true)
  for(const change of [
    {approval:{...a.approval,extraTrialAuthorized:false}},
    {approval:{...a.approval,maximumNewCalls:2}},
    {approval:{...a.approval,previousRequestHashes:['old-2']}},
    {journal:a.journal.map((r,i)=>i===2?{...r,costUsd:null,status:'cost_unresolved'}:r)},
    {journal:a.journal.map((r,i)=>i===1?{...r,retestOf:'unrelated'}:r)},
    {journal:[...a.journal,{...a.journal[2],requestHash:a.plan.requestHash}]},
  ]){
    const changed={...a,...change}
    expect(boundedRetestAuthorized(changed.plan,changed.approval,changed.journal)).toBe(false)
    await expect(executeEventTrial({...changed,invoke,claim,preflight})).rejects.toThrow('bounded_retest_consent_required')
  }
  const ordinary={...a.basePlan},consent={...a.approval,planHash:hash(ordinary)}
  await expect(executeEventTrial({...a,plan:ordinary,approval:consent,invoke,claim,preflight})).rejects.toThrow('duplicate_limit_or_unresolved_cost')
  expect(invoke).not.toHaveBeenCalled();expect(preflight).not.toHaveBeenCalled()
  expect(await executeEventTrial({...a,invoke,claim,preflight})).toMatchObject({status:'schema_and_content_review_required',costUsd:.03})
  expect(invoke).toHaveBeenCalledTimes(1);expect(claim).toHaveBeenCalledTimes(1)
  expect(a.journal).toEqual(before)
})

it('verifies the complete prior journal, preserved drafts and packet binding before a local transport can run',async()=>{
  const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'latamfx-bounded-retest-')),root=path.join(workspace,'.local-reports/private/campaign')
  await fs.mkdir(root,{recursive:true});await fs.mkdir(path.join(workspace,'.local-reports/reviewable'))
  const a=fixture(),preserved:Record<string,{file:string,sha256:string}>={}
  const originals={previousJournal:a.journal,previousInput:{plan:{requestHash:'old-2'}},previousDraft:{title:'original AI draft'},baselineReport:{id:'manual-original'}}
  for(const[key,value]of Object.entries(originals)){
    const file=key==='previousJournal'?'.local-reports/private/campaign/journal.json':`.local-reports/private/${key}.json`,text=JSON.stringify(value)
    await fs.writeFile(path.join(workspace,file),text);preserved[key]={file,sha256:bytesHash(text)}
  }
  const proposal={version:BOUNDED_RETEST_VERSION,basePlanHash:hash(a.basePlan),packetHash:hash(a.packet),dossierHash:hash(a.dossier),requestHash:a.plan.requestHash,journalHash:hash(a.journal),newBudgetUsd:.14,extraCalls:1,maximumCalls:4,baselineReportId:'manual-original',preserved}
  const text=JSON.stringify(proposal)
  await fs.writeFile(path.join(workspace,a.plan.boundedRetest.proposalFile),text)
  a.plan.boundedRetest.proposalSha256=bytesHash(text);a.approval.planHash=hash(a.plan)
  await expect(verifyBoundedRetestFiles({data:a,journal:a.journal,root})).resolves.toBeUndefined()
  const invoke=vi.fn()
  await fs.writeFile(path.join(workspace,preserved.previousDraft.file),'{}')
  await expect(runLocalTrial({data:a,root,apiKey:'test-key',invoke})).rejects.toThrow('bounded_retest_artifact_changed')
  expect(invoke).not.toHaveBeenCalled()
  expect(JSON.parse(await fs.readFile(path.join(root,'journal.json'),'utf8'))).toEqual(a.journal)
  const changed={...a,packet:{...a.packet,baseDate:'2026-09-11'}}
  await expect(verifyBoundedRetestFiles({data:changed,journal:a.journal,root})).rejects.toThrow('bounded_retest_proposal_changed')
})
