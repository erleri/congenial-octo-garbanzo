// Explicit, bound source labels for a local writer handoff. These labels do not
// grant source-use permission or prove that a public page has rendered them.
import {sourceUseBinding} from './source-use.js'

export const SOURCE_ATTRIBUTION_VERSION='source-attribution/1'
export const ATTRIBUTION_FIELDS=Object.freeze(['sourceUrl','publisher','publishedAt','referencePeriod','attribution','transformation'])
const safeText=(s,max)=>typeof s==='string'&&s.trim().length>0&&s.length<=max
const unsafe=v=>/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|bearer\s+\S+|<[^>]+>|ignore\s+(previous|all)|system\s*prompt|지시.*무시|[?&](?:token|apikey|api_key)=/i.test(JSON.stringify(v))

export function projectSourceAttributions(resources,notes=[]) {
 if(!Array.isArray(resources)||!Array.isArray(notes)||notes.length>61
  ||new Set(notes.map(n=>n?.resourceId)).size!==notes.length||unsafe(notes))throw new Error('invalid_source_attributions')
 return notes.map(n=>{
  const e=resources.find(e=>e.id===n?.resourceId)
  if(!e||n.version!==SOURCE_ATTRIBUTION_VERSION||n.resourceBinding!==sourceUseBinding(e)
   ||Object.keys(n).some(k=>!['version','resourceId','resourceBinding',...ATTRIBUTION_FIELDS].includes(k))
   ||n.sourceUrl!==e.url||n.publisher!==(e.publisher??e.source)
   ||n.publishedAt!==(e.publishedAt??null)||n.referencePeriod!==(e.period??null)
   ||!safeText(n.attribution,480)||!safeText(n.transformation,480))throw new Error('source_attribution_binding_required')
  // Only the text that will actually accompany this handoff is projected.
  return {resourceId:e.id,resourceBinding:n.resourceBinding,...Object.fromEntries(ATTRIBUTION_FIELDS.map(k=>[k,n[k]]))}
 })
}

// Produce a new review copy. Existing allowed/pending/denied scope decisions are
// preserved; exact-text delivery checks are additional conditions, not permits.
export function connectSourceAttributionConditions({resources,sourceUse,attributionNotes}) {
 const rows=projectSourceAttributions(resources,attributionNotes)
 if(!rows.length||rows.length!==resources.length||!Array.isArray(sourceUse?.reviews))throw new Error('complete_source_attributions_required')
 const next=structuredClone(sourceUse)
 next.attributionNotes=structuredClone(attributionNotes)
 for(const row of rows) {
  const r=next.reviews.find(r=>r.resourceId===row.resourceId)
  if(!r||r.resourceBinding!==row.resourceBinding||!Array.isArray(r.conditions))throw new Error('bound_source_use_review_required')
  for(const field of ATTRIBUTION_FIELDS.filter(field=>row[field]!=null)) {
   const conditionId=`delivery-${field}`,prior=r.conditions.find(c=>c.id===conditionId)
   const delivery={field,equals:row[field],uses:['external_model','public_display']}
   if(prior&&(prior.status!=='satisfied'||JSON.stringify(prior.delivery)!==JSON.stringify(delivery)))throw new Error('source_attribution_condition_conflict')
   if(!prior)r.conditions.push({id:conditionId,text:`집필 인계와 공개 표시에서 검토된 ${field} 값을 보존한다.`,status:'satisfied',delivery})
   for(const use of delivery.uses) {
    if(!r.uses?.[use]||!Array.isArray(r.uses[use].conditionIds))throw new Error('bound_source_use_review_required')
    r.uses[use].conditionIds=[...new Set([...r.uses[use].conditionIds,conditionId])]
   }
  }
 }
 return next
}
