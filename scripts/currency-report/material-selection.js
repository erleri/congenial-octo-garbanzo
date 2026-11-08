// Legacy background selection and opt-in selection of shared reviewed sources.
// Existing bound writer contexts are immutable: they must be reviewed anew.
import {fingerprint} from './research-harness.js'
import {referenceMaterialHolds} from './reference-material-state.js'

export const MATERIAL_SELECTION_VERSION='material-selection/1'
// New opt-in contract applies only to the reviewed shared claim projection.
export const REFERENCE_MATERIAL_SELECTION_VERSION='material-selection/2'
export const materialSelectionBinding=input=>fingerprint(input)
const reason=v=>typeof v==='string'&&v.trim().length>=10&&v.length<=480
const safe=v=>!/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|bearer\s+\S+|<[^>]+>|-----BEGIN .*PRIVATE KEY|ignore\s+(previous|all)|system\s*prompt|지시.*무시|[?&](?:token|apikey|api_key)=/i.test(JSON.stringify(v))

function validateSelection(resources,selection,inputBinding,versions=[MATERIAL_SELECTION_VERSION]) {
 if(!versions.includes(selection?.version)||selection.inputBinding!==inputBinding
  ||!['agent','human'].includes(selection.review?.origin)||selection.review.status!=='checked'||!reason(selection.review.reason)
  ||!Array.isArray(selection.decisions)||selection.decisions.length!==resources.length
  ||new Set(selection.decisions.map(d=>d?.evidenceId)).size!==resources.length||!safe(selection)
  ||selection.decisions.some(d=>!resources.some(e=>e.id===d?.evidenceId)||!['required','optional'].includes(d.requirement)
   ||!['include','exclude'].includes(d.action)||!reason(d.reason)||d.action==='exclude'&&d.requirement!=='optional'))
  throw new Error('bound_material_selection_required')
}

export function selectCountryMaterialInput(input,selection) {
 const resources=input.packet.evidence
 validateSelection(resources,selection,materialSelectionBinding(input))
 const excluded=selection.decisions.filter(d=>d.action==='exclude').map(d=>d.evidenceId)
 if(!excluded.length)return {input:structuredClone(input),record:{version:MATERIAL_SELECTION_VERSION,
  originalInputBinding:selection.inputBinding,selectedInputBinding:selection.inputBinding,excluded:[],contentReviewRequired:false}}
 // Projection of rich writer packets needs explicit dependency support. Never
 // silently retain an excluded fact in marketData, facts, prose or a dossier.
 if(input.causeContext||Object.keys(input.packet).some(k=>!['currency','baseDate','observedDate','evidence','evidenceScopeCards'].includes(k))
  ||Object.keys(input).some(k=>!['currency','baseDate','asOf','packet','materials','sourceUse','attempts','priceInput','writer'].includes(k)))
  throw new Error('material_selection_requires_preparation_packet')
 for(const id of excluded) {
  const m=input.materials.find(m=>m.record.evidenceId===id)
  if(!m||!Object.values(m.record.claimRoles).length||Object.values(m.record.claimRoles).some(r=>!['consumer_background','policy_background'].includes(r))
   ||input.priceInput?.articleReview?.evidenceId===id)throw new Error('required_material_cannot_be_excluded')
 }
 const retained=e=>!excluded.includes(e.id)
 const keep=id=>!excluded.includes(id)
 const retainedCards=input.packet.evidenceScopeCards.filter(c=>keep(c.evidenceId))
 if(retainedCards.some(c=>c.crossSourceClaims?.some(r=>r.requiredEvidenceIds.some(id=>!keep(id)))))
  throw new Error('excluded_material_still_required_by_claim')
 if(!input.packet.evidence.some(retained))throw new Error('material_selection_empty')
 const next=structuredClone(input)
 next.packet.evidence=next.packet.evidence.filter(retained)
 next.packet.evidenceScopeCards=next.packet.evidenceScopeCards.filter(c=>keep(c.evidenceId))
 next.materials=next.materials.filter(m=>keep(m.record.evidenceId))
 next.sourceUse.reviews=next.sourceUse.reviews.filter(r=>keep(r.resourceId))
 if(next.sourceUse.attributionNotes)next.sourceUse.attributionNotes=next.sourceUse.attributionNotes.filter(n=>keep(n.resourceId))
 // Old acquisition attempts stay in the immutable original. The selected
 // handoff must not carry an omitted source's prose via its attempt reasons.
 next.attempts=[]
 const rejected=resources.filter(e=>!keep(e.id))
 const serialized=JSON.stringify(next)
 if(rejected.some(e=>serialized.includes(e.id)||serialized.includes(e.url)))throw new Error('excluded_material_reference_remains')
 return {input:next,record:{version:MATERIAL_SELECTION_VERSION,originalInputBinding:selection.inputBinding,
  selectedInputBinding:materialSelectionBinding(next),excluded:selection.decisions.filter(d=>d.action==='exclude').map(d=>({evidenceId:d.evidenceId,reason:d.reason})),
  contentReviewRequired:true,priorReviewReusable:false,publicationApproved:false}}
}

// Select from the already validated shared projection, never edit a rich old
// writer packet or inherit its old approvals. The original stays immutable.
export function selectReferenceMaterialConnection(connection,selection) {
 const rows=[...Object.values(connection.sections).flat(),...connection.archive,...connection.held]
 const ids=[...new Set(rows.map(r=>r.evidenceId))]
 validateSelection(ids.map(id=>({id})),selection,materialSelectionBinding(connection),
  [MATERIAL_SELECTION_VERSION,REFERENCE_MATERIAL_SELECTION_VERSION])
 const cascading=selection.version===REFERENCE_MATERIAL_SELECTION_VERSION
 const {binding,...bound}=connection
 if(cascading&&(connection.version!=='reference-materials/2'||fingerprint(bound)!==binding))
  throw new Error('bound_reference_material_connection_required')
 const omitted=selection.decisions.filter(d=>d.action==='exclude'),excluded=new Set(omitted.map(d=>d.evidenceId))
 for(const id of excluded)if(!cascading&&rows.filter(r=>r.evidenceId===id).some(r=>!['consumer_background','policy_background','watch_context'].includes(r.role)))
  throw new Error('required_material_cannot_be_excluded')
 // The saved dependency contract is source-scoped, not claim-scoped. Remove
 // the entire dependent source conservatively, including its other claims.
 const dependencies=[]
 if(cascading){
  let changed=true
  while(changed){
   changed=false
   for(const id of ids){
    if(excluded.has(id))continue
    const requiredEvidenceIds=[...new Set(rows.filter(r=>r.evidenceId===id).flatMap(r=>
     r.crossSourceClaims.flatMap(c=>c.requiredEvidenceIds)).filter(id=>excluded.has(id)))]
    if(!requiredEvidenceIds.length)continue
    excluded.add(id);changed=true
    dependencies.push({evidenceId:id,requiredEvidenceIds,reason:'excluded_source_dependency',
     requirement:selection.decisions.find(d=>d.evidenceId===id).requirement})
   }
  }
 }
 const keep=r=>!excluded.has(r.evidenceId)
 if(rows.filter(keep).some(r=>r.crossSourceClaims.some(c=>c.requiredEvidenceIds.some(id=>excluded.has(id)))))
  throw new Error('excluded_material_still_required_by_claim')
 if(!cascading&&!rows.some(keep))throw new Error('material_selection_empty')
 const next=structuredClone(connection)
 next.sections=Object.fromEntries(Object.entries(next.sections).map(([role,items])=>[role,items.filter(keep)]))
 next.archive=next.archive.filter(keep);next.held=next.held.filter(keep)
 next.sourceUseSummary=next.sourceUseSummary.filter(r=>!excluded.has(r.resourceId))
 next.externalSourceAttributions=next.externalSourceAttributions.filter(r=>!excluded.has(r.resourceId))
 const removals=[...omitted.map(({evidenceId,reason})=>({evidenceId,reason})),...dependencies]
 next.excluded=[...next.excluded,...removals]
 if(cascading){
  next.holds=referenceMaterialHolds({sections:next.sections,held:next.held,
   priceHeld:connection.holds.includes('shared_reference_price_held'),priorHolds:[...connection.holds,
    ...dependencies.filter(d=>d.requirement==='required').map(d=>`required_material_dependency_removed:${d.evidenceId}`)]})
  next.status=next.holds.length?'materials_connected_with_gaps':'materials_prepared_for_content_review'
  delete next.preparationReview
  next.contentReview={status:'pending_independent_shared_context_review',
   savedSupport:'bound_existing_reviews_revalidated_not_new_independent_judgment',publicationApproved:false}
  next.request=null;next.paidCallAuthorized=false;next.publicationApproved=false
  delete next.binding;next.binding=fingerprint(next)
 }
 return {connection:next,record:{version:selection.version,originalInputBinding:selection.inputBinding,
  excluded:removals,contentReviewRequired:cascading||omitted.length>0,priorReviewReusable:false,publicationApproved:false,
  ...(cascading?{scope:'reviewed_claim_projection_only',originalProcessingPermissionGranted:false}:{} )}}
}
