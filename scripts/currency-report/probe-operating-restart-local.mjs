// Three independent psql processes against a completed disposable upgrade.
// Commits synthetic checkpoints to prove persistence beyond a transaction or
// in-memory fixture. No HTTP, keys, real response IDs or model transport.
import fs from 'node:fs/promises'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {parseArgs} from 'node:util'
import {randomBytes} from 'node:crypto'

const {values}=parseArgs({options:{rehearsal:{type:'string'}}})
if(!values.rehearsal)throw Error('completed_private_rehearsal_required')
const parent=await fs.realpath('.local-reports/private/operating-readiness-20261103')
const directory=await fs.realpath(values.rehearsal)
if(path.dirname(directory)!==parent)throw Error('private_rehearsal_required')
const prior=JSON.parse(await fs.readFile(path.join(directory,'result.json'),'utf8'))
const db=prior.database,container='supabase_db_latamfx-1x-staging'
if(prior.status!=='local_upgrade_rehearsal_passed'||!/^latamfx_release_20261103_[a-f0-9]{12}$/.test(db))throw Error('disposable_upgraded_database_required')
const docker=process.env.FX_LOCAL_DOCKER??'docker'
const command=(args,input)=>{
 const r=spawnSync(docker,args,{input,encoding:'utf8',timeout:30000,maxBuffer:4000000,windowsHide:true})
 if(r.status!==0)throw Error('local_restart_probe_failed: '+(r.stderr??'').slice(-1000))
 return r.stdout
}
const ports=JSON.parse(command(['inspect','--format','{{json .NetworkSettings.Ports}}',container]))
if(!ports['5432/tcp']?.some(p=>p.HostPort==='55322'))throw Error('fixed_local_container_required')
const sql=text=>command(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],text)
const nonce=randomBytes(32).toString('hex'),owner='dc000000-0000-0000-0000-000000000003'
const batch=nonce,caseKey=nonce.split('').reverse().join(''),task=nonce.slice(32)+nonce.slice(0,32)
const payload=JSON.stringify({synthetic:true,marker:'reconnect_같은_체크포인트',exactRequestHash:nonce})
const frozen={...JSON.parse(payload),serializedOperatingPayload:payload}
const policy={version:'report-operating-policy/1',binding:nonce,configurationTrust:'server_owned_never_article_or_model_input',
 publication:'separate_active_admin_review',state:'operator_configured',writer:'sol',externalTransmissionAuthorization:'approved_by_operator',
 recurringBudgetAuthorization:'approved_by_operator',authorizationReference:'SYNTHETIC_RESTART_ONLY',destination:{
 endpoint:'https://openrouter.ai/api/v1/chat/completions',model:'openai/gpt-6.1-sol',provider:'azure',zdr:true,dataCollection:'deny',
 retries:0,fallback:false,rawPublicDisplay:false},limits:{batchUsd:.2,monthlyUsd:1,perCallUsd:.1,maxCalls:12}}
const q=value=>"'"+String(value).replaceAll("'","''")+"'"
const jobId=`(select id from app_private.currency_report_runtime_jobs where task_key='${task}')`
const revision=`(select max(revision) from app_private.currency_report_operating_policies)`
const controlRevision='(select revision from app_private.currency_report_runtime_control where singleton)'
const context=JSON.stringify({writer:'sol',operatingBatchKey:batch,operatingOwner:owner,operatingCaseKey:caseKey,testOnly:true})
let complete=false
try{
 // Process 1 persists an actual in-flight state, then exits without receiving
 // a response. This is a simulated dispatch; no transport exists in this file.
 sql(`begin;
  select public.configure_currency_report_operating_policy(${q(JSON.stringify(policy))}::jsonb,coalesce(${revision},0));
  update app_private.currency_report_runtime_control set enabled=true,review_enabled=true,writer='sol',monthly_limit_nano=1000000000;
  set local role service_role;
  select public.claim_currency_report_operating_batch('${batch}','${owner}',${revision},${q(JSON.stringify(frozen))}::jsonb,200000000,12);
  select public.claim_currency_report_operating_case('${batch}','${owner}','${caseKey}','${caseKey}','MXN','${nonce}');
  select public.reserve_currency_report_runtime('${task}','MXN','2094-03-02','writer','${nonce}',${q(context)}::jsonb,90000000,${controlRevision});
  select public.begin_currency_report_runtime(${jobId},'${nonce}');
  select public.checkpoint_currency_report_runtime(${jobId},'{"responseId":"gen-SYNTHETIC-RECONNECT","phase":"headers"}');
  select public.checkpoint_currency_report_operating_batch('${batch}','${owner}','cost_unresolved','{"synthetic":true}');
  commit;`)
 // Process 2 has no local manifest or previous process memory.
 const observed=JSON.parse(sql(`set role service_role;
  select jsonb_build_object('job',public.load_currency_report_runtime_job('${task}'),
   'batch',public.load_currency_report_operating_batch('${batch}'),
   'blocked',public.claim_currency_report_operating_batch('${caseKey}','${owner}',${revision},'{}',200000000,12));`))
 if(observed.job.state!=='calling'||observed.job.cost_state!=='unknown'||observed.job.reserved_nano!==90000000
  ||observed.batch.payload.serializedOperatingPayload!==payload||observed.blocked.reason!=='unresolved_or_inflight_call')throw Error('restart_must_preserve_cost_and_frozen_input')
 sql(`begin; set local role service_role;
  select public.receive_currency_report_runtime(${jobId},'{"valid":true,"synthetic":true}',null);
  select public.reconcile_currency_report_runtime_cost(${jobId},'gen-SYNTHETIC-RECONNECT',0,
   '{"source":"generation.total_cost","responseId":"gen-SYNTHETIC-RECONNECT","costNano":"0"}');
  select public.claim_currency_report_operating_batch('${batch}','${owner}',${revision},${q(JSON.stringify(frozen))}::jsonb,200000000,12);
  select public.claim_currency_report_operating_case('${batch}','${owner}','${caseKey}','${caseKey}','MXN','${nonce}');
  select public.reserve_currency_report_runtime('${task}','MXN','2094-03-02','writer','${nonce}',${q(context)}::jsonb,90000000,${controlRevision});
  select public.finish_currency_report_operating_case('${batch}','${owner}','${caseKey}','held','{"status":"synthetic_completed_not_a_report"}');
  select public.checkpoint_currency_report_operating_batch('${batch}','${owner}','completed','{"synthetic":true}');
  commit;`)
 // Process 3 proves the same identity was reused after reconnecting again.
 const final=JSON.parse(sql(`select jsonb_build_object('jobs',(select count(*) from app_private.currency_report_runtime_jobs where task_key='${task}'),
  'state',(select state from app_private.currency_report_operating_batches where batch_key='${batch}'),
  'cost',(select actual_nano from app_private.currency_report_runtime_jobs where task_key='${task}'),
  'unknown',(select cost_state from app_private.currency_report_runtime_jobs where task_key='${task}'));`))
 if(final.jobs!==1||final.state!=='completed'||final.cost!==0||final.unknown!=='confirmed')throw Error('restart_must_not_duplicate_jobs')
 complete=true
}finally{
 // The test DB remains inspectable, but can never dispatch after this probe.
 sql('update app_private.currency_report_runtime_control set enabled=false,review_enabled=false,monthly_limit_nano=0;')
 await fs.writeFile(path.join(directory,'restart-probe-'+Date.now()+'.json'),JSON.stringify({passed:complete,synthetic:true,
  independentProcesses:3,committedCheckpoints:true,frozenInputPreserved:complete,unknownCostBlockedNewWork:complete,
  duplicateJobs:complete?0:null,controlsDisabled:true,actualModelCalls:0,paidUsd:0,productionWrites:0},null,2),{flag:'wx'})
}
console.log(JSON.stringify({status:'committed_restart_probe_passed',database:db,independentProcesses:3,actualModelCalls:0,productionWrites:0}))
