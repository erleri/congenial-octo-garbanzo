// Service-only immutable cache of registered official inputs. This cache is
// separate from paid batches: free collection must survive an Actions runner.
// Every read reruns current definitions/time/use checks before use.
import {fingerprint} from './research-harness.js'
import {OFFICIAL_COUNTRY_VERSION} from './official-country-statistics.js'
import {INEGI_DEFINITION_VERSION,verifyInegiReportSeries} from './inegi-report-indicators.js'
import {INEGI_NUMERIC_USE} from './official-statistic-admission.js'
import {REPORT_CURRENCIES} from './shared-price-contract.js'
import {OFFICIAL_JSON_ENVELOPE_VERSION} from './official-json-envelope.js'

export const OFFICIAL_CACHE_VERSION='official-input-cache/1'
export const OFFICIAL_CACHE_DEFINITIONS=`${OFFICIAL_COUNTRY_VERSION}|${INEGI_DEFINITION_VERSION}`
// A provider-envelope change must not invalidate unrelated country caches.
export const officialCacheDefinitions=currency=>currency==='PEN'
 ?`${OFFICIAL_CACHE_DEFINITIONS}|${OFFICIAL_JSON_ENVELOPE_VERSION}`:OFFICIAL_CACHE_DEFINITIONS
const currencies=REPORT_CURRENCIES
const seal=value=>({...value,binding:fingerprint(value)})
function frozenInputs(currency,input){
 if(currency!=='MXN'){
  const c=structuredClone(input.countryOfficialInputs)
  if(c?.currency!==currency||c.version!==OFFICIAL_COUNTRY_VERSION||!Array.isArray(c.proofs))throw Error('official_cache_country_inputs_required')
  // Listing pages have no numeric admission role and may contain contact forms.
  c.proofs=c.proofs.filter(p=>!['cl-index','cop-index'].includes(p.id))
  return {countryOfficialInputs:c}
 }
 return {inegiCaptures:structuredClone(input.inegiCaptures??[]),officialDocuments:structuredClone(input.officialDocuments??[]),
  officialTerms:structuredClone(input.officialTerms??null)}
}
function identity(currency,input){
 if(currency!=='MXN')return fingerprint({currency,definitions:officialCacheDefinitions(currency),proofs:input.countryOfficialInputs.proofs.map(p=>({id:p.id,
  // The ARS API date window is a query, not a different source. Exact URL and
  // receipts remain in the record; identical raw bytes do not grow the cache
  // merely because today's end_date changed. Other URL semantics are retained.
  url:p.id==='ars-definition'?`${new URL(p.url).origin}${new URL(p.url).pathname}?ids=${new URL(p.url).searchParams.get('ids')}`:p.url,sha256:p.sha256,
  extraction:p.extraction?fingerprint(p.extraction):null})).sort((a,b)=>a.id.localeCompare(b.id)||a.url.localeCompare(b.url))})
 return fingerprint({currency,definitions:officialCacheDefinitions(currency),series:input.inegiCaptures.map(({checkedAt,networkCalls,...c})=>{void checkedAt;void networkCalls;return c}),
  documents:input.officialDocuments.map(d=>({url:d.url,sha256:d.sha256,extraction:fingerprint(d.extraction)})).sort((a,b)=>a.url.localeCompare(b.url)),
  terms:input.officialTerms?.sha256??null})
}
export function officialCacheRecord({currency,inputs,asOf}){
 if(!currencies.includes(currency)||!Number.isFinite(Date.parse(asOf)))throw Error('official_cache_context_required')
 const frozen=frozenInputs(currency,inputs)
 const times=currency==='MXN'?[...frozen.inegiCaptures.map(c=>c.checkedAt),...frozen.officialDocuments.map(d=>d.collectedAt),frozen.officialTerms?.collectedAt]
  :frozen.countryOfficialInputs.proofs.map(p=>p.collectedAt)
 if(!times.length||times.some(t=>!Number.isFinite(Date.parse(t))||Date.parse(t)>Date.parse(asOf)))throw Error('official_cache_capture_time_invalid')
 const record=seal({version:OFFICIAL_CACHE_VERSION,definitions:officialCacheDefinitions(currency),currency,key:identity(currency,frozen),
  observedAt:[...times].sort((a,b)=>Date.parse(b)-Date.parse(a))[0],inputs:frozen})
 if(Buffer.byteLength(JSON.stringify(record))>16_000_000||/sk-or-|bearer\s+\S+|-----BEGIN .*PRIVATE KEY|[?&](?:token|api_?key)=/i.test(JSON.stringify(record)))throw Error('official_cache_unsafe_or_oversized')
 return record
}
export function assertOfficialCacheRecord(record,currency,asOf){
 const {binding,...body}=record??{}
 if(record?.version!==OFFICIAL_CACHE_VERSION||record.definitions!==officialCacheDefinitions(currency)||record.currency!==currency
  ||binding!==fingerprint(body)||identity(currency,record.inputs)!==record.key||Date.parse(record.observedAt)>Date.parse(asOf))throw Error('official_cache_binding_or_version_invalid')
 const checked=officialCacheRecord({currency,inputs:record.inputs,asOf})
 if(checked.binding!==record.binding)throw Error('official_cache_binding_or_version_invalid')
 return structuredClone(record)
}
export function withOfficialInputCache({loader,store,review,now=()=>new Date().toISOString()}){
 return async args=>{
  let fresh
  try{fresh=await loader(args)}catch{fresh={inputState:'official_input_acquisition_failed',inputNetworkCalls:0,inputIssues:['official_loader_failed']}}
  // Saved replay is explicit and offline. It neither reads nor seeds a server
  // cache, and cannot rebind old captures to a new collection clock.
  if(args.mode!=='live')return fresh
  const asOf=now(),issues=[...(fresh.inputIssues??[])]
  const assess=async inputs=>review({currency:args.currency,inputs,asOf})
  let admitted
  try{admitted=await assess(fresh)}catch{return {...fresh,inputIssues:[...issues,'official_fresh_input_validation_failed'],officialCache:{status:'validation_hold'}}}
  const currentIntegrityProblem=admitted.rows.some(r=>['official_release_revision_unresolved','official_current_vintage_conflict','official_definition_mismatch',
   'official_numeric_crosscheck_conflict','official_original_binding_or_clock_invalid','official_pdf_extraction_binding_required'].includes(r.reason))
   ||fresh.officialTerms&&fresh.officialTerms.sha256!==INEGI_NUMERIC_USE.sha256
   ||(fresh.inegiCaptures??[]).some(c=>c.status==='schema_changed'||c.status==='ok'&&verifyInegiReportSeries(c).status!=='ok')
  if(currentIntegrityProblem&&!admitted.admitted.length)return {...fresh,inputIssues:[...issues,'official_current_definition_edition_or_terms_hold'],
   officialCache:{status:'current_integrity_hold_no_cache_substitution'}}
  if(admitted.admitted.length){
   // An explicit saved fallback is not a fresh capture, but may seed an empty
   // private cache after current definition/age/use validation has passed.
   try{
    const record=officialCacheRecord({currency:args.currency,inputs:fresh,asOf})
    const saved=await store.saveOfficialInput(record)
    return {...fresh,...(saved.status==='capacity_hold'?{inputIssues:[...issues,'official_cache_capacity_hold']}:{}),officialCache:{status:saved.status,key:record.key,bytes:saved.bytes??null,limitBytes:saved.limitBytes??null}}
   }catch{return {...fresh,inputIssues:[...issues,'official_cache_write_failed'],officialCache:{status:'write_failed'}}}
  }
  if(fresh.inputState==='official_inputs_collected')return {...fresh,officialCache:{status:'fresh_statistic_held_no_cache_substitution'}}
  try{
   const stored=await store.officialInput(args.currency,officialCacheDefinitions(args.currency),asOf)
   if(!stored)return {...fresh,officialCache:{status:'not_found'}}
   const cached=assertOfficialCacheRecord(stored,args.currency,asOf),check=await assess(cached.inputs)
   if(!check.admitted.length)return {...fresh,inputIssues:[...issues,'official_cached_input_no_longer_eligible'],officialCache:{status:'expired_or_held',
    holds:check.rows.map(r=>r.reason).filter(Boolean)}}
   return {...cached.inputs,inputNetworkCalls:fresh.inputNetworkCalls??0,inputState:'stored_official_inputs_after_lookup_failure',
    inputIssues:[...new Set([...issues,fresh.inputState,...admitted.rows.map(r=>r.reason)].filter(Boolean))],officialCache:{status:'reused_after_current_review',key:cached.key,observedAt:cached.observedAt}}
  }catch{return {...fresh,inputIssues:[...issues,'official_cache_read_or_validation_failed'],officialCache:{status:'read_or_validation_failed'}}}
 }
}
