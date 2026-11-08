import {fingerprint} from './research-harness.js'
import {operatingResultState} from './operating-result.js'

const codes=values=>[...new Set((values??[]).filter(v=>typeof v==='string'&&/^[a-z0-9_/-]{1,120}$/.test(v)))].slice(0,16)
const scalar=(from,keys)=>Object.fromEntries(keys.filter(k=>from[k]===null||typeof from[k]==='boolean'
 ||typeof from[k]==='number'&&Number.isFinite(from[k])||typeof from[k]==='string'&&from[k].length<=160).map(k=>[k,from[k]]))
const continuation=c=>c?{...scalar(c,['category','action','resumeExact','status']),issues:(c.issues??[]).slice(0,8)
 .map(i=>scalar(i,['category','action','resumeExact','status']))}:undefined

// Full country results are already durable in operating_cases; the immutable
// batch payload preserves input editions. The coordinator still RETURNS the
// full diagnostics. Never duplicate article-level diagnostics in the 64 KB
// batch checkpoint or change the original case/job records to make it fit.
export function operatingCheckpoint(result,batchKey) {
 if(Buffer.byteLength(JSON.stringify(result),'utf8')<24000)return result
 const compact={...scalar(result,['status','reason','modelCalls','costUsd','newPaidCostUsd','confirmedUsd','unknownCost','manualEdits','publicationApproved']),
  version:'operating-checkpoint/1',batchKey,detailDigest:fingerprint(result),checkpointOutcome:operatingResultState(result),
  detailStorage:{countryResults:'app_private.currency_report_operating_cases',
   inputEditions:'app_private.currency_report_operating_batches.payload',lookup:'batch_key',
   collectionDiagnostics:'full_execution_return_digest_only'},
  holds:codes(result.holds),rows:(result.rows??[]).map(r=>({...scalar(r,['currency','status','sourceStatus','purpose','caseId','runId','modelCalls','costUsd','confirmedUsd','newPaidCostUsd','unknownCost']),
   holds:codes([...(r.holds??[]),...(r.sourceHolds??[])]),continuation:continuation(r.continuation),detailDigest:fingerprint(r)})),
  collectionResults:(result.collectionResults??[]).map(r=>({...scalar(r,['currency','status','referenceStatus','candidates']),
   lookupFailures:r.lookupFailures?.length?[{status:'see_execution_diagnostics',count:r.lookupFailures.length}]:[],detailDigest:fingerprint(r)}))}
 // Conservative headroom for PostgreSQL JSONB whitespace/escaping. Fail
 // explicitly on an unexpected shape; do not silently truncate countries.
 if(compact.rows.length>6||compact.collectionResults.length>6||Buffer.byteLength(JSON.stringify(compact),'utf8')>=24000)
  throw Error('operating_checkpoint_summary_capacity_hold')
 return compact
}
