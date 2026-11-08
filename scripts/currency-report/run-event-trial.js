// Explicit approved local trial only. No DB, mail, workflow, deployment or model fallback.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parse } from 'dotenv'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { executeApprovedEventTrial,executeApprovedSharedTrial } from './lifecycle-control.js'
import {SHARED_WRITING_VERSION} from './shared-writing-contract.js'
import { validDate } from './core.js'
import { saveReport } from './storage.js'
import { verifyScopedComparisonFiles } from './economic-comparison-consent.js'
import { verifyBoundedRetestFiles } from './bounded-retest-consent.js'
import {verifySingleReportTrialFiles} from './single-report-trial-consent.js'
import {readDataBundle,writeDataBundle,dataHash} from './data-ledger.js'
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export async function runLocalTrial({ data, root, apiKey, invoke }) {
  const shared=data.plan?.version===SHARED_WRITING_VERSION
  if(data.storageReceipt){
    const stored=await readDataBundle(data.storageReceipt.id)
    if(stored.receipt.manifestHash!==data.storageReceipt.manifestHash||dataHash(stored.resources.plan)!==dataHash(data.plan))throw Error('writer_storage_binding_changed')
  }
  if (!(shared?['BRL','CLP','MXN','COP','PEN','ARS']:['BRL','CLP','MXN']).includes(data.plan?.currency) || !validDate(data.plan?.baseDate)
    || data.approval?.authorized!==true || data.approval.planHash!==hash(data.plan)) throw new Error('bound_paid_approval_required')
  await fs.mkdir(root,{recursive:true})
  let lock
  try {lock=await fs.open(path.join(root,'campaign.lock'),'wx')} catch {throw new Error('trial_already_running_or_interrupted')}
  const journalFile=path.join(root,'journal.json')
  let claimed=false, journal=[]
  try {
    try {journal=JSON.parse(await fs.readFile(journalFile,'utf8'))} catch(e){if(e.code!=='ENOENT') throw e}
    await verifyScopedComparisonFiles({data,journal,root})
    await verifyBoundedRetestFiles({data,journal,root})
    await verifySingleReportTrialFiles({data,journal,root})
    const output=await fs.mkdtemp(path.join(root,'run-'))
    let sequence=0
    const result=await (invoke??(shared?executeApprovedSharedTrial:executeApprovedEventTrial))({ ...data, journal, apiKey, trialRoot: root,
      claim: async record=>{
        // Persist reservation before a call; an interrupted run blocks the campaign.
        const reservation={...record,events:data.plan.events??[],retestOf:(shared?data.approval.retestOf:data.plan.retestOf)??null,status:'cost_unresolved',costUsd:null,claimedAt:new Date().toISOString()}
        journal.push(reservation)
        await fs.writeFile(journalFile,JSON.stringify(journal,null,2))
        await fs.writeFile(path.join(root,`${record.currency}-${record.baseDate}-${record.requestHash}.claim.json`),JSON.stringify(reservation),{flag:'wx'})
        claimed=true
      },
      checkpoint: async value=>{
        if(apiKey && JSON.stringify(value).includes(apiKey)) throw new Error('credential_in_checkpoint')
        await fs.writeFile(path.join(output,`checkpoint-${sequence++}.json`),JSON.stringify(value),{flag:'wx'})
      },
    })
    if(apiKey&&JSON.stringify(result).includes(apiKey))throw Error('credential_in_result')
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2),{flag:'wx'})
    const storageReceipt=await writeDataBundle({id:path.basename(output)+'-'+data.plan.currency,kind:'writer_result',currency:data.plan.currency,
      resources:[{id:'input',kind:'writer_input',value:data},{id:'result',kind:'writer_response',value:result}],
      edges:[{from:'input',to:'result',role:'generation'}],parents:data.storageReceipt?[data.storageReceipt]:[],protection:['pending_review_dependency',...(result.costUsd==null?['unresolved_cost']:[])],costState:result.costUsd==null?'unknown':'confirmed'})
    await fs.writeFile(path.join(output,'storage-receipt.json'),JSON.stringify(storageReceipt),{flag:'wx'})
    if(claimed) {
      journal[journal.length-1]={...journal.at(-1),status:result.status,costUsd:result.costUsd??null,reservedUsd:result.reservedUsd??0}
      await fs.writeFile(journalFile,JSON.stringify(journal,null,2))
    }
    const compiled=result.response?.compiled
    if(shared)return {output,status:result.status,costUsd:result.costUsd,reservedUsd:result.reservedUsd,
      privateDraft:compiled?path.join(output,'result.json'):null,contentReview:'pending_separate_review',publicationApproved:false}
    if(result.status==='schema_and_content_review_required' && compiled) {
      const p=data.packet, content=compiled.content??compiled.candidate, id=`${p.currency}-${p.baseDate}-${Date.now()}`
      await saveReport({id,schemaVersion:'currency-report/1',currency:p.currency,baseDate:p.baseDate,observedDate:p.observedDate,
        observationAt:p.observationAt,marketData:p.marketData,facts:p.facts,series:p.series,evidence:p.evidence,
        limitations:p.limitations,content,purpose:data.plan.purpose??'fx_explanation',generationMode:'ai_enhanced',status:'pending_review',publishedAt:null})
      return {output,status:result.status,reportId:id,costUsd:result.costUsd,reservedUsd:result.reservedUsd,publicationApproved:false}
    }
    return {output,status:result.status,costUsd:result.costUsd,reservedUsd:result.reservedUsd,publicationApproved:false}
  } finally {await lock.close(); await fs.unlink(path.join(root,'campaign.lock'))}
}
async function main() {
  if(process.env.FX_REPORT_ENABLED==='false'){console.log(JSON.stringify({status:'disabled',modelCalls:0,costUsd:0}));return}
  const {values}=parseArgs({options:{input:{type:'string'}},strict:true})
  const privateRoot=await fs.realpath('.local-reports/private'), target=await fs.realpath(values.input)
  if(!target.startsWith(privateRoot+path.sep)||path.extname(target)!=='.json') throw new Error('private_trial_input_required')
  const data=JSON.parse(await fs.readFile(target,'utf8'))
  if(data.plan?.version===SHARED_WRITING_VERSION&&!data.storageReceipt)throw Error('shared_writer_storage_receipt_required')
  if(data.approval?.authorized!==true || data.approval.planHash!==hash(data.plan)) throw new Error('bound_paid_approval_required')
  const apiKey=parse(await fs.readFile('.env.report.local','utf8')).OPENROUTER_API_KEY
  if(!apiKey) throw new Error('missing_local_key')
  console.log(JSON.stringify(await runLocalTrial({data,root:path.join(privateRoot,data.plan.version===SHARED_WRITING_VERSION?'shared-reference-trials':'event-trials'),apiKey})))
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href) main().catch(e=>{console.error(/^[a-z_]+$/.test(e.message)?e.message:'local_trial_stopped');process.exitCode=1})
