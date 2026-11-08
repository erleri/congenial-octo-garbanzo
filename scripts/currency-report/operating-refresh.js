// A failed or incomplete lookup is not evidence that an earlier source changed.
// Only positively observed editions can supersede a frozen country input.
import {fingerprint} from './research-harness.js'
import {operatingMaterialHash,reuseOperatingSources} from './operating-source-cache.js'

const originalEdition=o=>fingerprint({sourceId:o.sourceId,url:o.url,body:o.blocks??o.observations??o.sha256,
 metadata:o.metadata??null,originHints:o.originHints??null})
const statisticEdition=s=>fingerprint({seriesId:s.seriesId,definitionId:s.definitionId,definitionVersion:s.definitionVersion,
 period:s.period,value:s.value,scope:s.scope,release:{url:s.release.url,sha256:s.release.editionHash??s.release.sha256,publishedOn:s.release.publishedOn}})

// Discovery keeps its full pool; only the frozen manuscript's news dependencies
// can invalidate its remaining work. Official/reference gates remain separate.
function scopedNews(country,materialEditions) {
 if(materialEditions===undefined)return country
 if(!Array.isArray(materialEditions)||materialEditions.some(e=>typeof e?.url!=='string'))throw Error('runtime_input_material_editions_required')
 const used=new Set(materialEditions.map(e=>e.url)),collection=country.collection
 const originals=collection.originals.filter(o=>used.has(o.url)),ids=new Set(originals.map(o=>o.id))
 const reviewQueue=collection.reviewQueue.filter(c=>ids.has(c.originalId)),cards=new Set(reviewQueue.map(c=>c.binding))
 return {...country,collection:{...collection,originals,reviewQueue,
  reviewRevalidations:(collection.reviewRevalidations??[]).filter(r=>cards.has(r.cardBinding))}}
}

// Frozen evidence bytes remain immutable; permission to reuse an old judgment
// is checked against the current service-owned review history. Once staged,
// only sources actually connected to that manuscript can invalidate its resume.
export function frozenSourceReviewHolds(country,cache,rulesBinding,{materialEditions}={}) {
 const collection=scopedNews(country,materialEditions).collection
 const current=reuseOperatingSources(collection,cache,rulesBinding)
 const holds=current.collection.reviewRevalidations.flatMap(r=>['conflict','revalidation_required'].includes(r.reason)
  ?[`source_review_${r.reason}`]:[])
 for(const review of current.savedSourceReviews)if(review.heldStatus)holds.push(review.heldStatus)
 return [...new Set(holds)]
}

export function observedMaterialChange(old,fresh) {
 const originals=new Set(old.collection.originals.map(originalEdition))
 if(fresh.collection.originals.some(o=>!originals.has(originalEdition(o))))return true
 const statistics=new Set((old.officialBackground?.admission?.admitted??[]).map(statisticEdition))
 if((fresh.officialBackground?.admission?.admitted??[]).some(s=>!statistics.has(statisticEdition(s))))return true
 const prior=new Set((old.collection.reviewRevalidations??[]).map(r=>fingerprint(r)))
 return (fresh.collection.reviewRevalidations??[]).some(r=>!prior.has(fingerprint(r)))
}

export function classifyCountryRefresh(old,fresh,{referenceChanged=false,referenceUsable=true,materialEditions}={}) {
 if(!fresh||fresh.acquisitionError)return 'frozen_source_refresh_wait'
 if(!referenceUsable)return 'frozen_reference_refresh_wait'
 if(referenceChanged)return 'frozen_country_reference_superseded'
 old=scopedNews(old,materialEditions);fresh=scopedNews(fresh,materialEditions)
 if(operatingMaterialHash(old)===operatingMaterialHash(fresh))return null
 return observedMaterialChange(old,fresh)?'frozen_country_material_superseded':'frozen_source_refresh_wait'
}
