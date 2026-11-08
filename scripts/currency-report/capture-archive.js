// Reuse acquisition bytes only. Current revisions win, and every restored body
// still passes ordinary publication, period, use, extraction and support gates.
import {createHash} from 'node:crypto'
import {registeredNewsSourceForUrl} from './research-source-selection.js'
export function mergeRegisteredCaptureArchive({captures,archive,catalog,currency,asOf,sourceIds}){
 const current=structuredClone(captures),issues=[],added=[],seen=new Set(current.map(c=>c.url))
 for(const c of [...archive].sort((a,b)=>(b.collectedAt??'').localeCompare(a.collectedAt??''))){
  if(seen.has(c.url)||!sourceIds.includes(c.sourceId))continue
  const source=registeredNewsSourceForUrl({catalog,currency,url:c.url})
  if(!source||source.id!==c.sourceId||source.discovery?.mode==='excluded')continue
  if(typeof c.text!=='string'||createHash('sha256').update(c.text).digest('hex')!==c.sha256
   ||!Number.isFinite(Date.parse(c.collectedAt))||Date.parse(c.collectedAt)>Date.parse(asOf)||c.httpStatus<200||c.httpStatus>=300){
   issues.push({url:c.url,reason:'archive_integrity_or_capture_time_hold'});continue
  }
  if(current.length>=32){issues.push({url:c.url,reason:'archive_capacity_not_loaded'});continue}
  current.push(structuredClone(c));seen.add(c.url);added.push({sourceId:c.sourceId,url:c.url,collectedAt:c.collectedAt,
   meaning:'saved_public_capture_not_current_fetch_or_content_approval'})
 }
 return {captures:current,added,issues,modelCalls:0}
}
