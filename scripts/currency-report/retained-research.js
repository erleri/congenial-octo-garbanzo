// A rolling front page is not the whole research window. Retain recently
// captured registered candidates; current use/period/review gates still run.
import {compileResearchSourceCatalog,registeredNewsSourceForUrl} from './research-source-selection.js'
import {effectiveSourceGroups} from './source-review-validity.js'
import {marketCalendarDate} from './market-calendar.js'
import {validDate} from './core.js'
import {ORIGINAL_NEWS_PIPELINE_VERSION} from './original-news-pipeline.js'
export function retainRegisteredResearch({collection,cache,asOf,sourcePlan,sourceRegister}){
 const copy=structuredClone(collection),catalog=compileResearchSourceCatalog(sourcePlan,sourceRegister)
 const dates=copy.reviewQueue.flatMap(c=>c.targets.map(t=>t.requestedPeriod)).filter(validDate).sort()
 if(!dates.length)return copy
 const retained=[],omitted=[]
 const candidates=effectiveSourceGroups(cache).filter(g=>g.record?.sourceKey&&(
  ['usable','revalidation_required'].includes(g.state)&&g.record.review?.receipt
  ||g.state==='held'&&g.record.review?.pipelineVersion!==ORIGINAL_NEWS_PIPELINE_VERSION
    &&!(g.record.review.holds??[]).some(h=>/^(unrelated|insufficient_information|source_use_denied)$/.test(h))))
  .map(g=>g.record).sort((a,b)=>(b.original.metadata?.publishedAt??'').localeCompare(a.original.metadata?.publishedAt??''))
 for(const record of candidates){
  const o=record.original,day=marketCalendarDate(o.metadata?.publishedAt,copy.currency)
  if(o.kind!=='article'||!day||day<dates[0]||day>dates.at(-1)||o.collectedAt>asOf||o.metadata?.publishedAt>asOf)continue
  const source=registeredNewsSourceForUrl({catalog,currency:copy.currency,url:o.url})
  if(!source||source.id!==o.sourceId||source.discovery?.mode==='excluded')continue
  // Never substitute an old body for a currently observed revision.
  if(copy.originals.some(r=>r.url===o.url))continue
  if(retained.length>=8){omitted.push({url:o.url,reason:'retained_candidate_capacity'});continue}
  copy.originals.push(structuredClone(o));copy.reviewQueue.push(structuredClone(record.card))
  retained.push({sourceId:o.sourceId,originalId:o.id,url:o.url,publishedAt:o.metadata.publishedAt,collectedAt:o.collectedAt,
   basis:'saved_registered_candidate_not_new_fetch_or_approval'})
 }
 if(retained.length||omitted.length)copy.retainedResearch={retained,omitted}
 return copy
}
