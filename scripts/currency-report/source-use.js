// Explicit, local reviewer judgments. Bindings prove identity, not permission,
// legal correctness, reviewer authentication or semantic support.
import {fingerprint} from './research-harness.js'
import {unsafeSourceText} from './source-text-safety.js'

export const SOURCE_USE_VERSION='source-use/1'
export const SOURCE_USES=Object.freeze(['local_analysis','external_model','public_display'])
const day=v=>typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v
const text=v=>typeof v==='string' && v.trim().length>=10 && v.length<=480
const id=v=>typeof v==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v)
const safe=v=>!unsafeSourceText(JSON.stringify(v))
const url=v=>{try {const u=new URL(v);return u.protocol==='https:' && !u.username && !u.password && !u.port && !u.hash} catch{return false}}
export const sourceUseBinding=resource=>fingerprint(resource)

const deliveryFields=['sourceUrl','publisher','publishedAt','referencePeriod','attribution','transformation']
// Publisher, supplied authors/title/notices and licence links must fit without
// dropping mandatory credit. Other fields and aggregate request limits stay bounded.
export const sourceDeliveryLimit=field=>field==='attribution'?4096:480
export function inspectSourceUses({resources,reviews,evaluatedOn,renderings={}}) {
  if(!day(evaluatedOn) || !Array.isArray(resources) || resources.length>61 || resources.some(r=>!id(r?.id))
    || new Set(resources.map(r=>r.id)).size!==resources.length || !Array.isArray(reviews) || reviews.length>61
    || new Set(reviews.map(r=>r?.resourceId)).size!==reviews.length || !safe({resources,reviews})
    || Buffer.byteLength(JSON.stringify({resources,reviews}))>5_000_000) throw new Error('invalid_source_use_input')
  if(!renderings||typeof renderings!=='object'||Array.isArray(renderings)||!safe(renderings)
    ||Object.keys(renderings).some(use=>!SOURCE_USES.includes(use))
    ||Object.values(renderings).some(rows=>!Array.isArray(rows)||rows.length>61
      ||new Set(rows.map(row=>row?.resourceId)).size!==rows.length
      ||rows.some(row=>!id(row?.resourceId)||!resources.some(e=>e.id===row.resourceId)
        ||!/^[a-f0-9]{64}$/.test(row.resourceBinding??'')
        ||Object.keys(row).some(k=>!['resourceId','resourceBinding',...deliveryFields].includes(k))
        ||deliveryFields.some(k=>row[k]!=null&&(typeof row[k]!=='string'||row[k].length>sourceDeliveryLimit(k)))))
    ||Buffer.byteLength(JSON.stringify(renderings))>250_000)throw new Error('invalid_source_use_renderings')
  for(const r of reviews) {
    if(r?.version!==SOURCE_USE_VERSION || !resources.some(e=>e.id===r.resourceId)
      || !/^[a-f0-9]{64}$/.test(r.resourceBinding??'') || !url(r.terms?.url)
      || typeof r.terms.version!=='string' || !r.terms.version.trim() || r.terms.version.length>120
      || !day(r.terms.reviewedOn) || r.terms.reviewedOn>evaluatedOn || !text(r.scope)
      || !['agent','human'].includes(r.review?.origin) || r.review.status!=='checked' || !text(r.review.reason)
      || !Array.isArray(r.conditions) || r.conditions.length>12 || new Set(r.conditions.map(c=>c?.id)).size!==r.conditions.length
      || r.conditions.some(c=>!id(c?.id) || !text(c.text) || !['satisfied','pending'].includes(c.status))
      || r.conditions.some(c=>c.delivery!==undefined&&(!c.delivery||Object.keys(c.delivery).sort().join(',')!=='equals,field,uses'
        ||!deliveryFields.includes(c.delivery.field)||typeof c.delivery.equals!=='string'||!c.delivery.equals.trim()||c.delivery.equals.length>sourceDeliveryLimit(c.delivery.field)
        ||!Array.isArray(c.delivery.uses)||!c.delivery.uses.length||c.delivery.uses.length>3
        ||new Set(c.delivery.uses).size!==c.delivery.uses.length||c.delivery.uses.some(use=>!SOURCE_USES.includes(use))))
      || !r.uses || Object.keys(r.uses).length!==SOURCE_USES.length
      || SOURCE_USES.some(use=>!['allowed','pending','denied'].includes(r.uses[use]?.status)
        || !text(r.uses[use].reason) || !Array.isArray(r.uses[use].conditionIds)
        || new Set(r.uses[use].conditionIds).size!==r.uses[use].conditionIds.length
        || r.uses[use].conditionIds.some(cid=>!r.conditions.some(c=>c.id===cid)))) throw new Error('invalid_source_use_review')
  }
  return {version:SOURCE_USE_VERSION,evaluatedOn,items:resources.map(resource=>{
    const r=reviews.find(r=>r.resourceId===resource.id),bound=r?.resourceBinding===sourceUseBinding(resource)
    return {resourceId:resource.id,reviewStatus:!r?'missing':bound?'recorded_judgment':'binding_changed',
      // Project results only; reviewer information and arbitrary policy fields stay private.
      uses:Object.fromEntries(SOURCE_USES.map(use=>{
        const rendered=renderings[use]?.find(row=>row.resourceId===resource.id&&row.resourceBinding===sourceUseBinding(resource))
        // A typed delivery requirement owns its uses. Forgetting the redundant
        // conditionIds reference must not silently remove that requirement.
        const required=bound?[...new Set([...r.uses[use].conditionIds,...r.conditions.filter(c=>c.delivery?.uses.includes(use)).map(c=>c.id)])]:[]
        const pending=required.filter(cid=>{
          const c=r.conditions.find(c=>c.id===cid)
          return c.status!=='satisfied'||c.delivery&&rendered?.[c.delivery.field]!==c.delivery.equals
        })
        const status=!bound?'pending':r.uses[use].status==='allowed'&&pending.length?'pending':r.uses[use].status
        return [use,{status,reason:!r?'source_use_review_missing':!bound?'source_use_binding_changed'
          :status==='denied'?'source_use_denied':pending.length?'source_use_conditions_pending'
            :status==='pending'?'source_use_scope_pending':'source_use_recorded_for_scope',pendingConditionIds:pending}]
      }))}
  }),publicationApproved:false,meaningVerified:false}
}
