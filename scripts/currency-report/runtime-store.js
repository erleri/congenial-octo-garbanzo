// Node-only service adapter. No credentials are read at import or returned.
import {createClient} from '@supabase/supabase-js'
import {assertLocalApi} from './local-db.js'
import {fingerprint} from './research-harness.js'

const canonical=value=>JSON.stringify(sort(value))
function sort(value){return Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])])):value}
function ordered(value,field) {
 if(!value||typeof value[field]!=='string')throw Error('runtime_exact_bytes_missing')
 const copy={...value};delete copy[field]
 let parsed
 try{parsed=JSON.parse(value[field])}catch{throw Error('runtime_exact_json_invalid')}
 if(canonical(copy)!==canonical(parsed))throw Error('runtime_stored_projection_changed')
 return parsed
}
const preserveOrder=(value,field)=>({...value,[field]:JSON.stringify(value)})

// Only confirmed availability errors on these reads may pause exact work.
// SQL permissions/schema errors and unknown exceptions require repair. Keep
// provider messages/details out of execution records and never retry here.
const validityReads=new Set(['currency_report_operating_source_cache','load_currency_report_runtime_input'])
const temporaryCodes=new Set(['PGRST001','PGRST002','PGRST003','08000','08001','08003','08006','53300','57P01','57P02','57P03'])
class RuntimeStoreError extends Error {
 constructor(operation,error,status){
  super(`runtime_store_${operation}_failed`)
  this.operation=operation
  this.temporary=temporaryCodes.has(error?.code)||!error?.code&&(
   [502,503,504].includes(status)||status===0&&/^(?:TypeError: fetch failed|AbortError:|TimeoutError:)/.test(error?.message??''))
 }
}
export const isTemporaryRuntimeReadError=error=>error instanceof RuntimeStoreError&&error.temporary&&validityReads.has(error.operation)

export function assertRuntimeDestination(url,mode,env={}) {
 if(mode==='local')return assertLocalApi(url)
 const u=new URL(url)
 if(mode!=='workflow'||env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='erleri/congenial-octo-garbanzo'
  ||u.protocol!=='https:'||!/^\w+\.supabase\.co$/.test(u.hostname)||u.port||u.pathname!=='/'||u.username||u.password||u.search||u.hash)
  throw Error('explicit_runtime_destination_required')
 return u.origin
}
export function createRuntimeStore({url,key,mode,env={},client}) {
 if(!key)throw Error('runtime_service_key_required')
 const endpoint=assertRuntimeDestination(url,mode,env)
 const db=client??createClient(endpoint,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
 const rpc=async(name,args)=>{
  const {data,error,status}=await db.rpc(name,args).abortSignal(AbortSignal.timeout(15000))
  if(error)throw new RuntimeStoreError(name,error,status)
  return data
 }
 return {
  environment:mode,
  control:()=>rpc('currency_report_runtime_control'),
  operatingPolicy:async()=>{
   const value=await rpc('currency_report_operating_policy')
   return value?.policy?.serializedOperatingPolicy?{...value,policy:ordered(value.policy,'serializedOperatingPolicy')}:value
  },
  sourceCache:async(currency,rules)=>{
   const rows=await rpc('currency_report_operating_source_cache',{p_currency:currency,p_rules:rules})
   return rows.map(r=>ordered(r,'serializedSourceReview'))
  },
  saveSourceReview:record=>rpc('save_currency_report_operating_source_review',{p_record:preserveOrder(record,'serializedSourceReview')}),
  officialInput:async(currency,definitions,asOf)=>{
   const text=await rpc('load_currency_report_official_input',{p_currency:currency,p_definitions:definitions,p_as_of:asOf})
   return text?JSON.parse(text):null
  },
  saveOfficialInput:record=>rpc('save_currency_report_official_input',{p_record_json:JSON.stringify(record)}),
  recordCorrections:r=>rpc('record_currency_report_corrections',{p_currency:r.currency,p_checked_at:r.checkedAt,p_candidates:r.candidates,p_coverage:r.coverage}),
  configureOperatingPolicy:(policy,revision)=>rpc('configure_currency_report_operating_policy',{p_policy:preserveOrder(policy,'serializedOperatingPolicy'),p_expected_revision:revision}),
  operatingBatch:key=>rpc('load_currency_report_operating_batch',{p_batch_key:key}),
  pendingBatches:revision=>rpc('pending_currency_report_operating_batches',{p_revision:revision}),
  supersedeBatch:r=>rpc('supersede_currency_report_operating_batch',{p_batch_key:r.key,p_revision:r.revision,p_reason:r.reason}),
  recoverableCalls:()=>rpc('currency_report_operating_recoverable_calls'),
  costEscrow:id=>rpc('currency_report_terminal_cost_escrow',{p_id:id}),
  escrowTerminalCost:(id,authorization)=>rpc('escrow_currency_report_terminal_failure',{p_id:id,p_authorization:authorization}),
  releaseUnsent:id=>rpc('release_currency_report_operating_unsent',{p_id:id}),
  supplyCheck:r=>rpc('record_currency_report_supply_check',{p_key:r.key,p_currency:r.currency,p_checked_at:r.checkedAt,p_result:r.result}),
  claimBatch:r=>rpc('claim_currency_report_operating_batch',{p_batch_key:r.key,p_owner:r.owner,p_revision:r.revision,
   p_payload:preserveOrder(r.payload,'serializedOperatingPayload'),p_budget_nano:r.budgetNano,p_max_calls:r.maxCalls}),
  batchCheckpoint:r=>rpc('checkpoint_currency_report_operating_batch',{p_batch_key:r.key,p_owner:r.owner,p_state:r.state,p_result:r.result}),
  claimCase:r=>rpc('claim_currency_report_operating_case',{p_batch_key:r.batchKey,p_owner:r.owner,p_case_key:r.key,
   p_case_id:r.caseId,p_currency:r.currency,p_material_hash:r.materialHash}),
  finishCase:r=>rpc('finish_currency_report_operating_case',{p_batch_key:r.batchKey,p_owner:r.owner,p_case_key:r.key,p_state:r.state,p_result:r.result}),
  job:async key=>{
   const j=await rpc('load_currency_report_runtime_job',{p_task_key:key})
   return j?{...j,context:ordered(j.context,'serializedRuntimeContext'),
    response:j.response?ordered(j.response,'serializedRuntimeResponse'):null}:null
  },
  stage:task=>rpc('stage_currency_report_runtime_input',{p_task:preserveOrder(task,'serializedRuntimeInput')}),
  input:async(currency,snapshotId)=>{const value=await rpc('load_currency_report_runtime_input',{p_currency:currency,p_snapshot_id:snapshotId});return value?ordered(value,'serializedRuntimeInput'):null},
  history:currency=>rpc('currency_report_runtime_history',{p_currency:currency}),
  check:r=>rpc('record_currency_report_runtime_check',{p_check_key:r.key,p_currency:r.currency,p_checked_at:r.checkedAt,p_result:r.result}),
  reserve:r=>rpc('reserve_currency_report_runtime',{p_task_key:r.taskKey,p_currency:r.currency,p_date:r.baseDate,p_stage:r.stage,
   p_request_hash:r.requestHash,p_context:preserveOrder(r.context,'serializedRuntimeContext'),p_reserved_nano:r.reservedNano,p_revision:r.revision,p_parent_id:r.parentId}),
  begin:(id,hash)=>rpc('begin_currency_report_runtime',{p_id:id,p_request_hash:hash}),
  checkpoint:(id,checkpoint)=>rpc('checkpoint_currency_report_runtime',{p_id:id,p_checkpoint:checkpoint}),
  receive:(id,response,actual)=>rpc('receive_currency_report_runtime',{p_id:id,p_response:preserveOrder(response,'serializedRuntimeResponse'),p_actual_nano:actual}),
  reconcile:(id,responseId,actual,receipt)=>rpc('reconcile_currency_report_runtime_cost',{p_id:id,p_response_id:responseId,p_actual_nano:actual,p_receipt:receipt}),
  finish:(id,candidate,validation,cost)=>rpc('finish_currency_report_runtime',{p_id:id,p_candidate:candidate,p_validation:validation,p_cost:cost}),
 }
}
export const restoreOperatingPayload=value=>ordered(value,'serializedOperatingPayload')
// Only actual published records can move the anchor. A legacy non-historical
// publication without its fixed snapshot blocks bootstrap instead of guessing.
export function runtimePublications(rows,currency) {
 if(!Array.isArray(rows)||rows.length>1000)throw Error('runtime_history_required')
 return rows.flatMap(row=>{
  const report=row.report
  if(report?.testOnly===true||report?.historicalReview===true)return []
  const task=row.runtimeContext?ordered(row.runtimeContext,'serializedRuntimeContext').task:null
  if(!task?.snapshot||task.currency!==currency||report?.currency!==currency
   ||report.id==null||row.baseDate!==task.baseDate)throw Error('published_anchor_snapshot_unavailable')
  return [{id:report.id,currency,publishedAt:row.publishedAt,kind:['periodic','initial'].includes(task.purpose)?'periodic':task.purpose==='policy'?'policy':'market',
   state:'published',origin:'published_record',stored:true,approved:true,priceReviewed:true,historical:false,editorialOnly:false,withdrawn:false,
   snapshot:structuredClone(task.snapshot),report:structuredClone(report),materialEditions:structuredClone(task.materialEditions??[])}]
 })
}
export function assertStagedRuntimeInput(task) {
 const {binding,...body}=task??{}
 if(!binding||binding!==fingerprint(body)||task.status!=='prepared'||task.publicationApproved!==false)throw Error('runtime_input_binding_required')
 return task
}
