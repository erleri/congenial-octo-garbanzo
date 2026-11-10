// Server-owned configuration. Reading/validating this cannot enable a worker,
// authorize a host tool, or convert a one-time trial into recurring spending.
import {fingerprint} from './research-harness.js'
import {matchesOperatingDestination,proposeOperatingPolicy,operatingLimitCeilings} from './operating-batch-plan.js'
import {writerProfile} from './writer-policy.js'
import {REPORT_CURRENCIES} from './shared-price-contract.js'

export function operatingPolicyDraft(config) {
 const proposal=proposeOperatingPolicy(config)
 const body={...proposal,limits:{...proposal.limits,monthlyUsd:0},writer:'sol',
  authorizationReference:null,configuredAt:null}
 delete body.binding
 return {...body,binding:fingerprint(body)}
}
export const runtimeAccountingCapUsd=policy=>policy.state==='trial_configured'
 ?Math.round((policy.limits.batchUsd+(policy.accountingPriorSpendUsd??0))*1e9)/1e9:policy.limits.monthlyUsd
// Build only; never persists, enables, or dispatches. Recurring authorization
// must be supplied explicitly instead of inheriting a past one-time allowance.
export function recurringOperatingPolicy({config,authorizationReference,configuredAt,monthlyUsd,writer,
 batchUsd=7,maxCalls=60,perCallUsd=.25}) {
 if(!Number.isFinite(monthlyUsd)||monthlyUsd<=0||!['sol','sol-us'].includes(writer))throw Error('explicit_recurring_configuration_required')
 const policy=operatingPolicyDraft(config)
 Object.assign(policy,{state:'operator_configured',writer,authorizationReference,configuredAt,
  externalTransmissionAuthorization:'approved_by_operator',recurringBudgetAuthorization:'approved_by_operator'})
 policy.destination={...policy.destination,provider:writerProfile(writer).route,writerProvider:writerProfile(writer).route,reviewProvider:writerProfile(writer).route}
 policy.limits={...policy.limits,batchUsd,monthlyUsd,perCallUsd,maxCalls}
 delete policy.binding;policy.binding=fingerprint(policy)
 return assertOperatingPolicy(policy)
}
// A server configuration for one bound dataset. Creation/validation alone
// cannot install it, activate controls or dispatch any request.
export function oneTimeOperatingPolicy({config,datasetBinding,authorizationReference,configuredAt,expiresAt,budgetUsd=7,maxCalls=60,accountingPriorSpendUsd=0,continuationOfRevision,writer='sol'}) {
 const policy=operatingPolicyDraft(config)
 Object.assign(policy,{state:'trial_configured',budgetScope:'one_time_trial_only',datasetBinding,
  externalTransmissionAuthorization:'approved_by_operator',recurringBudgetAuthorization:'not_authorized',
  trialBudgetAuthorization:'approved_by_operator',authorizationReference,configuredAt,expiresAt})
 policy.limits={...policy.limits,batchUsd:budgetUsd,maxCalls,monthlyUsd:0}
 policy.writer=writer;policy.destination={...policy.destination,writerProvider:writerProfile(writer).route}
 if(accountingPriorSpendUsd!==0)policy.accountingPriorSpendUsd=accountingPriorSpendUsd
 if(continuationOfRevision!==undefined)policy.continuationOfRevision=continuationOfRevision
 delete policy.binding;policy.binding=fingerprint(policy)
 return assertOperatingPolicy(policy)
}
export function assertOperatingPolicy(policy) {
 const {binding,...body}=policy??{},limits=policy?.limits,ceilings=operatingLimitCeilings(policy)
 if(binding!==fingerprint(body)||policy.version!=='report-operating-policy/1'
  ||!matchesOperatingDestination(policy.destination)
  ||!['proposal_not_enabled','operator_configured','trial_configured'].includes(policy.state)
  ||policy.configurationTrust!=='server_owned_never_article_or_model_input'
  ||policy.publication!=='separate_active_admin_review'
  ||policy.budgetScope!==(policy.state==='trial_configured'?'one_time_trial_only':'recurring_service_separate_from_single_trial_approval')
  ||JSON.stringify(policy.currencies)!==JSON.stringify(REPORT_CURRENCIES)
  ||!limits||![limits.batchUsd,limits.monthlyUsd,limits.perCallUsd].every(n=>Number.isFinite(n)&&n>=0)
  ||limits.batchUsd<=0||limits.batchUsd>ceilings.batchUsd||limits.monthlyUsd>1000||limits.perCallUsd<=0||limits.perCallUsd>.25
  ||!Number.isInteger(limits.maxCalls)||limits.maxCalls<12||limits.maxCalls>ceilings.maxCalls||limits.maxReports!==6
  ||!['sol','sol-us'].includes(policy.writer)||writerProfile(policy.writer).model!==policy.destination.model||writerProfile(policy.writer).route!==(policy.destination.writerProvider??'azure')
  ||![policy.sourceCatalogBinding,policy.processingRulesBinding].every(s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s)))
  throw Error('server_operating_policy_invalid')
 if(policy.state==='operator_configured'&&(policy.externalTransmissionAuthorization!=='approved_by_operator'
  ||policy.recurringBudgetAuthorization!=='approved_by_operator'||limits.monthlyUsd<=0
  ||typeof policy.authorizationReference!=='string'||!/^[A-Za-z0-9:_-]{1,180}$/.test(policy.authorizationReference)
  ||!Number.isFinite(Date.parse(policy.configuredAt))))throw Error('explicit_operating_configuration_required')
 if(policy.state==='trial_configured'&&(policy.externalTransmissionAuthorization!=='approved_by_operator'
  ||policy.continuationOfRevision!==undefined&&(!Number.isSafeInteger(policy.continuationOfRevision)||policy.continuationOfRevision<1)
  ||!Number.isFinite(policy.accountingPriorSpendUsd??0)||(policy.accountingPriorSpendUsd??0)<0||(policy.accountingPriorSpendUsd??0)>1000
  ||policy.recurringBudgetAuthorization!=='not_authorized'||policy.trialBudgetAuthorization!=='approved_by_operator'||limits.monthlyUsd!==0
  ||!/^[a-f0-9]{64}$/.test(policy.datasetBinding??'')||!/^[A-Za-z0-9:_-]{1,180}$/.test(policy.authorizationReference??'')
  ||!Number.isFinite(Date.parse(policy.configuredAt))||!Number.isFinite(Date.parse(policy.expiresAt))
  ||Date.parse(policy.expiresAt)<=Date.parse(policy.configuredAt)))throw Error('explicit_one_time_configuration_required')
 return policy
}
export function operatingConfigurationHolds(policy,control) {
 assertOperatingPolicy(policy)
 const holds=[]
 if(!['operator_configured','trial_configured'].includes(policy.state))holds.push('external_processing_configuration_pending')
 if(policy.state!=='trial_configured'&&(policy.recurringBudgetAuthorization!=='approved_by_operator'||policy.limits.monthlyUsd<=0))holds.push('standing_budget_configuration_pending')
 if(!control?.enabled||!control.review_enabled||control.writer!==policy.writer)holds.push('runtime_not_enabled')
 if(Number(control?.monthly_limit_nano)!==Math.round(runtimeAccountingCapUsd(policy)*1e9)
  ||Number(control?.per_call_limit_nano)>Math.round(policy.limits.perCallUsd*1e9))holds.push('runtime_budget_configuration_mismatch')
 return holds
}
