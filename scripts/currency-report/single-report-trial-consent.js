// A separately approved one-country trial references the immutable old campaign;
// it neither fabricates passed country reviews nor reopens that campaign's budget.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const bytesHash=v=>createHash('sha256').update(v).digest('hex')
export const SINGLE_REPORT_TRIAL_VERSION='single-report-trial/1'
export function singleReportTrialAuthorized(plan,approval,journal) {
 const s=plan?.singleReportTrial
 return s?.version===SINGLE_REPORT_TRIAL_VERSION&&plan.purpose==='fx_explanation'
  &&['CLP','BRL','MXN'].includes(plan.currency)&&Array.isArray(journal)&&journal.length===0
  &&!plan.retestOf&&!plan.boundedRetest&&!plan.scopedComparison&&!approval?.scopedBatch
  &&s.requestHash===plan.requestHash&&s.maximumNewCalls===1
  &&typeof s.proposalFile==='string'&&/^[a-f0-9]{64}$/.test(s.proposalSha256??'')
  &&approval?.authorized===true&&approval.singleReportTrialAuthorized===true&&approval.maximumNewCalls===1
  &&approval.planHash===hash(plan)&&Number.isFinite(approval.budgetUsd)&&approval.budgetUsd>0&&approval.budgetUsd<=.25
  &&plan.maximumUsd>0&&plan.maximumUsd<=approval.budgetUsd
}
export async function verifySingleReportTrialFiles({data,journal,root}) {
 if(!data.plan?.singleReportTrial)return
 if(!singleReportTrialAuthorized(data.plan,data.approval,journal))throw Error('single_report_trial_consent_required')
 let privateRoot=await fs.realpath(root)
 while(!(path.basename(privateRoot)==='private'&&path.basename(path.dirname(privateRoot))==='.local-reports')) {
  const parent=path.dirname(privateRoot);if(parent===privateRoot)throw Error('private_trial_root_required');privateRoot=parent
 }
 const workspace=path.dirname(path.dirname(privateRoot)),reviewableRoot=await fs.realpath(path.join(workspace,'.local-reports/reviewable'))
 const read=async(entry,privateOnly=true)=>{
  const target=await fs.realpath(path.resolve(workspace,entry.file))
  if(!(target.startsWith(privateRoot+path.sep)||!privateOnly&&target.startsWith(reviewableRoot+path.sep)))throw Error('single_trial_artifact_path')
  const bytes=await fs.readFile(target);if(bytesHash(bytes)!==entry.sha256)throw Error('single_trial_artifact_changed')
  return JSON.parse(bytes)
 }
 const scope=data.plan.singleReportTrial,proposal=await read({file:scope.proposalFile,sha256:scope.proposalSha256})
 const {singleReportTrial:_scope,...basePlan}=data.plan
 if(proposal.version!==SINGLE_REPORT_TRIAL_VERSION||proposal.basePlanHash!==hash(basePlan)||proposal.requestHash!==data.plan.requestHash
  ||proposal.packetHash!==hash(data.packet)||proposal.dossierHash!==hash(data.dossier)||proposal.currency!==data.plan.currency
  ||proposal.baseDate!==data.plan.baseDate||proposal.maximumNewCalls!==1||proposal.proposedBudgetUsd!==data.approval.budgetUsd
  ||JSON.stringify(Object.keys(proposal.preserved??{}).sort())!==JSON.stringify(['baselineReport','parentInput','parentJournal','parentPlan']))
  throw Error('single_trial_proposal_changed')
 const old=Object.fromEntries(await Promise.all(Object.entries(proposal.preserved).map(async([key,entry])=>[key,await read(entry,key!=='baselineReport')])))
 const parent=old.parentJournal.filter(r=>r.currency===data.plan.currency&&r.baseDate===data.plan.baseDate).at(-1)
 const price=p=>({series:p.series,marketData:p.marketData,observedDate:p.observedDate})
 if(!parent||parent.requestHash!==old.parentPlan.requestHash||hash(old.parentPlan.body)!==parent.requestHash
  ||old.parentPlan.packetHash!==hash(old.parentInput.packet)||old.baselineReport.id!==proposal.baselineReportId
  ||old.baselineReport.currency!==data.plan.currency||old.baselineReport.baseDate!==data.plan.baseDate
  ||parent.requestHash===data.plan.requestHash||hash(price(old.parentInput.packet))!==hash(price(data.packet))
  ||old.parentJournal.some(r=>!Number.isFinite(r.costUsd)||r.costUsd<0||Number(r.reservedUsd??0)!==0
   ||!['output_hold','schema_and_content_review_required'].includes(r.status)))throw Error('single_trial_parent_history_changed')
}
