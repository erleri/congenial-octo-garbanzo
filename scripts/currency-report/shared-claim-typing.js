// A bound local review may conservatively label a fact as an attributed view.
// It cannot change its prose, role, period, permission, or source membership.
import {validNewsAttribution} from './news-attribution.js'
import {fingerprint} from './research-harness.js'
export const SHARED_CLAIM_TYPING_VERSION='shared-claim-typing/1'
export function applySharedClaimTyping(handoff,review) {
 if(review===undefined)return handoff
 const c=handoff?.materialConnection,{binding,...bound}=c??{}
 const safe=v=>!/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|bearer\s+\S+|<[^>]+>|ignore\s+(previous|all)|system\s*prompt|지시.*무시/i.test(JSON.stringify(v))
 const keys=(v,allowed)=>v&&Object.keys(v).every(k=>allowed.includes(k))
 const reason=v=>typeof v==='string'&&v.trim().length>=10&&v.length<=480
 if(!binding||fingerprint(bound)!==binding||review.version!==SHARED_CLAIM_TYPING_VERSION||review.connectionBinding!==binding
  ||!keys(review,['version','connectionBinding','origin','reason','changes'])||!['agent','human'].includes(review.origin)
  ||!reason(review.reason)||!safe(review)||!Array.isArray(review.changes)||!review.changes.length||review.changes.length>24)
  throw new Error('bound_shared_claim_typing_required')
 const next=structuredClone(handoff),seen=new Set()
 for(const r of review.changes){
  const n=Object.values(next.materialConnection.sections).flat().find(n=>n.evidenceId===r.evidenceId&&n.claimId===r.claimId)
  const id=`${r.evidenceId}:${r.claimId}`
  if(!n||seen.has(id)||!keys(r,['evidenceId','claimId','claimBinding','fromKind','toKind','attributions','reason'])
   ||r.claimBinding!==fingerprint(n)||r.fromKind!==n.kind||r.fromKind!=='source_fact'||r.toKind!=='source_interpretation'
   ||!reason(r.reason)||!Array.isArray(n.passageIds)||!Array.isArray(r.attributions)||!r.attributions.length||r.attributions.length>6
   ||r.attributions.some(a=>!keys(a,['passageId','person','organization','type'])||!n.passageIds.includes(a.passageId)
    ||!validNewsAttribution(Object.fromEntries(Object.entries(a).filter(([k])=>k!=='passageId')))))
   throw new Error('conservative_shared_claim_typing_required')
  seen.add(id);n.kind=r.toKind;n.attributions=structuredClone(r.attributions)
 }
 const connection=next.materialConnection;delete connection.binding
 connection.claimTypingReview={version:review.version,reviewBinding:fingerprint(review),originalBinding:binding,
  status:'representation_corrected_not_new_original_or_publication_approval'}
 connection.binding=fingerprint(connection)
 return next
}
