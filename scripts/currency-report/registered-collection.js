import {registeredNewsSourceForUrl} from './research-source-selection.js'
import {validateSelectedReviewCard} from './selected-source-collection.js'
import {fingerprint} from './research-harness.js'

// Isolate before novelty, correction detection, model preparation and writing.
// A known host under a different source ID is a binding mismatch, not a new outlet.
export function isolateUnregisteredArticles(collection,catalog) {
 const excluded=[],ids=new Set()
 for(const card of collection.reviewQueue){
  const {original}=validateSelectedReviewCard(collection,card)
  if(card.materialKind!=='article')continue
  const source=registeredNewsSourceForUrl({catalog,currency:collection.currency,url:original.url})
  const admissionMatches=!source?.admission||original.sourceAdmission?.binding===fingerprint(source.admission)
   &&original.sha256===(original.sourceAdmission.actualCaptureHash??source.admission.captureHash)&&original.sourceAdmission.scopes.analyze&&original.sourceAdmission.scopes.publishNotes
  if(!source||source.id!==card.sourceId||source.discovery?.mode==='excluded'||!admissionMatches){
   ids.add(original.id);excluded.push({cardBinding:card.binding,status:!source?'source_outside_registered_scope':'source_registration_mismatch',maximumUsd:0})
  }
 }
 return {excluded,collection:{...structuredClone(collection),originals:collection.originals.filter(o=>!ids.has(o.id)),
  reviewQueue:collection.reviewQueue.filter(c=>!ids.has(c.originalId))}}
}
