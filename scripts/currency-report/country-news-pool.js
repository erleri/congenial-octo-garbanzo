// Source-neutral assembly over the existing catalog, original-bound reviews and
// shared material projection. No transport, credentials, writer or publication.
import {fingerprint} from './research-harness.js'
import {compileResearchSourceCatalog,registeredNewsSourceForUrl} from './research-source-selection.js'
import {prepareSelectedReviewBatch} from './selected-review-batch.js'
import {validateSelectedReviewCard} from './selected-source-collection.js'
import {reconnectReferenceMaterials} from './reference-materials.js'
import {selectReferenceMaterialConnection,REFERENCE_MATERIAL_SELECTION_VERSION,materialSelectionBinding} from './material-selection.js'
import {validDate} from './core.js'
import {marketCalendarDate} from './market-calendar.js'
import {articleOriginHints} from './news-publisher-access.js'

export const COUNTRY_NEWS_POOL_VERSION='country-news-pool/1'
// Partition assembly work, not article text. Original-backed receipts bind to
// each unchanged card/original; legacy model responses bind to a full job and
// must never be silently rebound by partitioning their collection.
export function partitionReviewedNewsBatch(batch){
 if(batch.collection.reviewQueue.length<=24)return [batch]
 if(batch.newsResponses?.length)throw Error('saved_response_partition_requires_exact_collection')
 const groups=[]
 for(let index=0;index<batch.collection.reviewQueue.length;index+=24){
  const reviewQueue=batch.collection.reviewQueue.slice(index,index+24),bindings=new Set(reviewQueue.map(c=>c.binding)),ids=new Set(reviewQueue.map(c=>c.originalId))
  groups.push({...batch,collection:{...batch.collection,reviewQueue,originals:batch.collection.originals.filter(o=>ids.has(o.id))},
   receipts:(batch.receipts??[]).filter(r=>bindings.has(r.cardBinding)),
   materialInputs:(batch.materialInputs??[]).filter(r=>bindings.has(r.cardBinding))})
 }
 return groups
}
const stamp=v=>typeof v==='string'&&validDate(v.slice(0,10))&&/(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))
const rows=c=>[...Object.values(c.sections).flat(),...c.archive,...c.held]
const seal=c=>{delete c.binding;c.binding=fingerprint(c);return c}
const failure=e=>/^[a-z0-9_]+$/.test(e?.message??'')?e.message:'news_pool_validation_failed'
const canonical=value=>{const u=new URL(value);u.hash='';for(const key of [...u.searchParams.keys()])
 if(/^utm_|^(fbclid|gclid)$/i.test(key))u.searchParams.delete(key);return u.href}

// A saved date-only note may refer to an already verified original carrying a
// precise timestamp. Keep the note's precision; never manufacture its time.
export function matchNewsPublicationPrecision(item,publishedAt,currency) {
 if(item.publishedAt===publishedAt)return 'exact_recorded_precision'
 if(validDate(item.publishedAt)&&stamp(publishedAt)&&item.sourceVersion?.support==='verified_saved_original'
  &&marketCalendarDate(publishedAt,currency)===item.publishedAt)return 'same_local_day_at_existing_note_precision'
 return null
}

export function prepareCountryNewsPool({handoff,sourcePlan,sourceRegister,batches=[],asOf}) {
 const connection=handoff?.materialConnection,snapshot=handoff?.reportPriceSnapshot
 const {binding,...bound}=connection??{}
 if(connection?.version!=='reference-materials/2'||fingerprint(bound)!==binding
  ||snapshot?.snapshotId!==connection.referenceSnapshotId||snapshot.currency!==connection.currency
  ||!stamp(asOf)||Date.parse(asOf)<Date.parse(connection.asOf)||!Array.isArray(batches)||batches.length>16)
  throw new Error('bound_country_news_pool_context_required')
 const before=fingerprint({handoff,sourcePlan,sourceRegister,batches})
 const catalog=compileResearchSourceCatalog(sourcePlan,sourceRegister)
 const country=catalog.countries.find(c=>c.currency===connection.currency)
 const sources=country.newsRefs.map(id=>catalog.sources.find(s=>s.id===id))
 const sourceFor=url=>registeredNewsSourceForUrl({catalog,currency:connection.currency,url})
 const sourceStates=sources.map(s=>({sourceId:s.id,
  collectionState:s.discovery?.mode==='excluded'?'excluded_from_automatic_collection':'not_attempted',
  reason:s.discovery?.mode==='excluded'?s.discovery.reason:null,attempts:[],articles:[],acceptedEvidenceIds:[]}))
 const selected=structuredClone(connection);selected.asOf=asOf
 const omissions=new Map(),articles=[],candidates=[],batchFailures=[]
 for(const item of rows(selected)){
  const s=sourceFor(item.sourceUrl)
  if(s?.discovery?.mode==='excluded')omissions.set(item.evidenceId,'Current catalog excludes this automatic source; do not retain its dependent claims.')
  else if(!s&&item.evidenceId.startsWith('news-'))omissions.set(item.evidenceId,'The current catalog cannot identify a unique registered route for this news material.')
  else if(s){const state=sourceStates.find(r=>r.sourceId===s.id);state.acceptedEvidenceIds.push(item.evidenceId)}
 }
 for(let index=0;index<batches.length;index++){
  const batch=batches[index]
  try{
   const c=batch.collection
   if(c?.currency!==connection.currency||!Array.isArray(c.reviewQueue)||c.reviewQueue.length>24
    ||!Array.isArray(batch.materialInputs??[])||(batch.materialInputs??[]).length>24)
    throw new Error('country_news_batch_context_mismatch')
   const result=prepareSelectedReviewBatch({collection:c,receipts:batch.receipts??[],newsResponses:batch.newsResponses??[]})
   const materialInputs=batch.materialInputs??[]
   if(new Set(materialInputs.map(m=>m.cardBinding)).size!==materialInputs.length
    ||materialInputs.some(m=>!c.reviewQueue.some(q=>q.binding===m.cardBinding)))throw new Error('bound_news_material_inputs_required')
   for(const outcome of result.collectionOutcomes){
    const state=sourceStates.find(s=>s.sourceId===outcome.sourceId)
    if(state&&state.collectionState!=='excluded_from_automatic_collection'){
     state.attempts.push({...outcome,collectionHash:result.collectionHash})
     state.publisherAttempts=[...new Map([...(state.publisherAttempts??[]),...c.outcomes.filter(o=>o.sourceId===outcome.sourceId)
      .flatMap(o=>o.publisherAttempts??[]).map(p=>({sourceId:p.sourceId,status:p.status,reason:p.reason??null}))]
      .map(p=>[JSON.stringify(p),p])).values()]
     state.collectionStates=[...new Set([...(state.collectionStates??[]),outcome.status])]
     if(c.mode==='live'&&stamp(c.startedAt)&&(!state.lastLiveAttemptAt||c.startedAt>=state.lastLiveAttemptAt)){
      state.collectionState=outcome.status;state.lastLiveAttemptAt=c.startedAt
     }else if(!state.lastLiveAttemptAt&&outcome.status!=='not_attempted')state.collectionState=outcome.status
    }
   }
   for(const card of c.reviewQueue.filter(c=>c.materialKind==='article')){
    const original=c.originals.find(o=>o.id===card.originalId),state=sourceStates.find(s=>s.sourceId===card.sourceId)
    const r={sourceId:card.sourceId,originalId:card.originalId,cardBinding:card.binding,
     collectionHash:result.collectionHash,url:original?.url??null,rawSha256:original?.sha256??null,
     publishedAt:original?.metadata?.publishedAt??null,collectedAt:original?.collectedAt??null,
     reviewState:result.items.find(r=>r.cardBinding===card.binding)?.status??'review_missing',
     status:'pending_content_review',reason:null,publicationApproved:false,originalBindingValid:false}
    articles.push(r);state?.articles.push(r)
    try{
     validateSelectedReviewCard(c,card)
     if(!state||sourceFor(original.url)?.id!==card.sourceId)throw new Error('unregistered_or_ambiguous_news_source')
     if(state.collectionState==='excluded_from_automatic_collection')throw new Error('source_excluded_by_current_catalog')
     if(!stamp(original.collectedAt)||Date.parse(original.collectedAt)>Date.parse(asOf))throw new Error('news_original_after_cutoff')
     if(!/^[a-f0-9]{64}$/.test(original.sha256??''))throw new Error('news_original_capture_hash_required')
     r.originalBindingValid=true
     r.observedCreditedOrigins=articleOriginHints(original.url,original.blocks).creditedOrigins
     r.contentIdentity=fingerprint({blocks:original.blocks,publishedAt:original.metadata?.publishedAt??null,modifiedAt:original.metadata?.modifiedAt??null})
     const modified=original.metadata?.modifiedAt,published=original.metadata?.publishedAt
     if(modified&&(!stamp(modified)||stamp(published)&&Date.parse(modified)<Date.parse(published)
      ||Date.parse(modified)>Date.parse(original.collectedAt)))throw new Error('publisher_revision_time_conflict')
     const checked=result.items.find(i=>i.cardBinding===card.binding)
     if(['no_relevant_support','insufficient_information'].includes(checked?.status)){
      r.status=checked.status==='no_relevant_support'?'not_selected_for_requested_role':'insufficient_original_support'
      r.reason=checked.reason
      for(const item of rows(selected).filter(row=>canonical(row.sourceUrl)===canonical(original.url)
       &&['market_observation','attributed_fx_explanation'].includes(row.role)&&row.sourceSessionDate===connection.commentaryDate))
       omissions.set(item.evidenceId,'A bound new review conflicts with the connected market role; omit this source pending adjudication.')
      continue
     }
     if(!['review_judgment_recorded','review_receipt_verified'].includes(checked?.status)){
      r.reason=checked?.reason??'original_bound_content_review_missing';continue
     }
     const material=materialInputs.find(m=>m.cardBinding===card.binding)?.input
     if(!material){r.status='pending_role_and_note_use_review';r.reason='bound_material_roles_and_note_use_required';continue}
     const evidence=checked.evidence?.evidence,scopes=checked.evidence?.evidenceScopeCards
     if(evidence?.length!==1||material.packet?.evidence?.length!==1
      ||fingerprint(material.packet.evidence)!==fingerprint(evidence)
      ||fingerprint(material.packet.evidenceScopeCards)!==fingerprint(scopes)
      ||evidence[0].url!==original.url||evidence[0].collectedAt!==original.collectedAt
      ||evidence[0].publishedAt!==original.metadata.publishedAt)
      throw new Error('reviewed_news_material_binding_mismatch')
     if(checked.assessment){
      const roles=material.materials.flatMap(m=>Object.values(m.record.claimRoles))
      if(checked.assessment.role!=='market_explanation'&&roles.includes('attributed_fx_explanation')
       ||checked.assessment.role==='global_context'&&roles.includes('market_observation'))
       throw new Error('news_review_role_promotion_forbidden')
     }
     const projection=reconnectReferenceMaterials({input:material,kind:'country_materials',snapshot,
      commentaryDate:connection.commentaryDate,commentaryPeriod:connection.commentaryPeriod,asOf})
     const active=Object.values(projection.sections).flat()
     if(!active.length||projection.held.length){r.status='material_held';r.reason=projection.held[0]?.holds[0]??'different_session_not_current';continue}
     if(active.some(row=>row.sourceUses.external_model.status!=='allowed')){
      r.status='pending_note_use_review';r.reason='authored_notes_external_use_not_allowed';continue
     }
     r.status='reviewed_material_candidate';r.evidenceId=evidence[0].id
     candidates.push({projection,record:r,original})
    }catch(error){r.status='material_held';r.reason=failure(error)}
   }
  }catch(error){batchFailures.push({index,reason:failure(error),status:'batch_invalid_others_continued'})}
 }
 // Conflicting editions are not resolved by manifest order or successful old
 // notes. A new explicit edition review is needed for that URL alone.
 const urls=new Map()
 for(const r of articles.filter(r=>r.originalBindingValid&&r.url&&r.rawSha256)){
  const url=canonical(r.url);if(!urls.has(url))urls.set(url,new Set());urls.get(url).add(r.contentIdentity)
 }
 for(const item of rows(selected)){
  const editions=articles.filter(r=>r.originalBindingValid&&r.url&&canonical(r.url)===canonical(item.sourceUrl))
  if(!editions.length)continue
  const exact=editions.find(r=>r.collectedAt===item.collectedAt&&matchNewsPublicationPrecision(item,r.publishedAt,connection.currency)
   &&(!item.originalCapture||item.originalCapture.rawSha256===r.rawSha256))
  if(exact)item.originalCapture={rawSha256:exact.rawSha256,contentIdentity:exact.contentIdentity,originalId:exact.originalId,cardBinding:exact.cardBinding,
   publicationMatch:matchNewsPublicationPrecision(item,exact.publishedAt,connection.currency)}
  if(item.originalCapture){
   const url=canonical(item.sourceUrl)
   if(item.originalCapture.contentIdentity)urls.get(url)?.add(item.originalCapture.contentIdentity)
   else if(!exact)omissions.set(item.evidenceId,'The prior capture has no content-edition binding; a newer page cannot inherit its review.')
   for(const edition of editions.filter(r=>r.contentIdentity===item.originalCapture.contentIdentity)){
    if(edition.status==='pending_content_review'){
     edition.status='existing_notes_reused';edition.reason='bound_existing_notes_reused_not_new_original_semantic_review'
    }
   }
  }else omissions.set(item.evidenceId,'A different original capture cannot inherit the old note review without an exact edition binding.')
 }
 for(const [url,hashes] of urls)if(hashes.size>1){
  for(const item of rows(selected).filter(r=>canonical(r.sourceUrl)===url))omissions.set(item.evidenceId,'Conflicting original editions require an explicit source version review.')
  for(const r of articles.filter(r=>r.url&&canonical(r.url)===url)){r.status='revision_conflict';r.reason='explicit_capture_version_required'}
 }
 const admitted=new Set(),bodyIdentities=new Map()
 for(const batch of batches)for(const original of batch.collection?.originals??[]){
  const linked=rows(selected).some(row=>!omissions.has(row.evidenceId)&&row.originalCapture?.originalId===original.id)
  if(linked)bodyIdentities.set(fingerprint(original.blocks.map(b=>b.text.normalize('NFKC').replace(/\s+/g,' ').trim())),original.id)
 }
 const priority=c=>c.projection.sections.attributed_fx_explanation.length?0:c.projection.sections.market_observation.length?1:2
 candidates.sort((a,b)=>priority(a)-priority(b)||canonical(a.original.url).localeCompare(canonical(b.original.url)))
 for(const {projection,record,original} of candidates){
  if(record.status==='revision_conflict')continue
  const identity=fingerprint(original.blocks.map(b=>b.text.normalize('NFKC').replace(/\s+/g,' ').trim()))
  if(bodyIdentities.has(identity)&&!rows(selected).some(r=>r.evidenceId===record.evidenceId)){
   record.status='duplicate_original';record.reason='identical_body_not_independent_evidence';continue
  }
  const existing=rows(selected).filter(r=>r.evidenceId===record.evidenceId)
  if(existing.length){
   const identity=items=>items.map(r=>[r.evidenceBinding,r.scopeBinding,r.claimId,r.role,r.text,r.sourceSessionDate])
    .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
   if(fingerprint(identity(existing))!==fingerprint(identity(rows(projection)))){
    record.status='material_held';record.reason='evidence_identity_conflict';continue
   }
   record.status='already_connected';continue
  }
  if(new Set(rows(selected).map(r=>r.evidenceId)).size>=8){record.status='material_held';record.reason='shared_evidence_limit';continue}
  bodyIdentities.set(identity,record.originalId)
  for(const item of rows(projection))item.originalCapture={rawSha256:original.sha256,contentIdentity:record.contentIdentity,
   originalId:original.id,cardBinding:record.cardBinding}
  for(const [role,items] of Object.entries(projection.sections))selected.sections[role].push(...items)
  selected.archive.push(...projection.archive)
  selected.sourceUseSummary.push(...projection.sourceUseSummary)
  selected.externalSourceAttributions.push(...projection.externalSourceAttributions)
  admitted.add(record.evidenceId);record.status='connected_for_content_review'
 }
 // Use the same source-removal/dependency/required-role contract as every
 // other shared handoff. Raw article policies never authorize authored notes.
 seal(selected)
 const ids=[...new Set(rows(selected).map(r=>r.evidenceId))]
 const review={origin:'agent',status:'checked',reason:'Apply current registered routes and exact recorded original/card/role/use bindings; this is not a new semantic or publication approval.'}
 const selection={version:REFERENCE_MATERIAL_SELECTION_VERSION,inputBinding:materialSelectionBinding(selected),review,
  decisions:ids.map(evidenceId=>({evidenceId,requirement:omissions.has(evidenceId)?'optional':'required',
   action:omissions.has(evidenceId)?'exclude':'include',reason:omissions.get(evidenceId)??'Retain the exact reviewed material under the shared date, scope and source-use checks.'}))}
 const output=selectReferenceMaterialConnection(selected,selection)
 output.connection.inputBinding=fingerprint({prior:connection.binding,catalog:catalog.catalogId,batches:batches.map(b=>fingerprint(b)),asOf})
 seal(output.connection)
 const retained=Object.values(output.connection.sections).flat()
 for(const r of articles)if(r.status==='pending_content_review'&&retained.some(item=>
  item.originalCapture?.contentIdentity===r.contentIdentity&&canonical(item.sourceUrl)===canonical(r.url))){
  r.status='existing_notes_reused';r.reason='bound_existing_notes_reused_not_new_original_semantic_review'
 }
 for(const state of sourceStates){
  state.acceptedEvidenceIds=[...new Set(retained.filter(r=>sourceFor(r.sourceUrl)?.id===state.sourceId).map(r=>r.evidenceId))]
  state.reviewStates=[...new Set(state.articles.map(r=>r.reviewState))]
 }
 const attributionGroups=new Map()
 for(const row of retained)for(const attribution of row.attributions){
  const key=fingerprint([attribution.type??'person',attribution.person.normalize('NFKC').toLowerCase(),attribution.organization.normalize('NFKC').toLowerCase()])
  if(!attributionGroups.has(key))attributionGroups.set(key,{person:attribution.person,organization:attribution.organization,evidenceIds:[]})
  attributionGroups.get(key).evidenceIds.push(row.evidenceId)
 }
 const summary={version:COUNTRY_NEWS_POOL_VERSION,currency:connection.currency,asOf,commentaryDate:connection.commentaryDate,
  referenceSnapshotId:snapshot.snapshotId,catalogId:catalog.catalogId,sources:sourceStates,batchFailures,
  referenceSnapshotUse:'fixed_stored_snapshot_not_refreshed_by_news_collection',
  candidateOrder:'reviewed_local_explanation_then_market_observation_then_context_url_tiebreak_not_semantic_importance',
  connectedNewEvidenceIds:[...admitted].filter(id=>retained.some(r=>r.evidenceId===id)),
  removed:output.record.excluded,materialStatus:output.connection.status,holds:output.connection.holds,
  pendingArticles:articles.filter(r=>!['connected_for_content_review','already_connected','duplicate_original','existing_notes_reused'].includes(r.status)).length,
  pendingContentReviewArticles:articles.filter(r=>r.status==='pending_content_review').length,
  assessedNotSelectedArticles:articles.filter(r=>r.status==='not_selected_for_requested_role').length,
  insufficientSupportArticles:articles.filter(r=>r.status==='insufficient_original_support').length,
  attributions:[...attributionGroups.values()].map(r=>({...r,evidenceIds:[...new Set(r.evidenceIds)]})),
  sourceIndependence:'not_inferred_from_publisher_count_or_repeated_analysts',
  newInformationValue:'not_assessed_by_article_or_source_count',
  semanticReview:'recorded_original_bound_judgments_not_new_model_verification',manualUserTasks:[],
  originalProcessingPermissionGranted:false,modelCalls:0,networkCalls:0,newPaidCostUsd:0,publicationApproved:false}
 const next={...structuredClone(handoff),materialConnection:output.connection,newsPool:summary,
  request:null,paidCallAuthorized:false,publicationApproved:false}
 if(next.assessment){next.assessment.materialPreparation=output.connection.status
  // Preserve unrelated writer holds. Assembly is never writer eligibility.
  next.assessment.newsPoolHolds=[...output.connection.holds]
  const checks=next.assessment.checks??[]
  const period=checks.find(c=>c.id==='evidence_period_and_scope'),use=checks.find(c=>c.id==='source_use_and_attribution')
  if(period)period.status=output.connection.sections.market_observation.length&&output.connection.sections.attributed_fx_explanation.length?'pass':'hold'
  if(use)use.status=retained.length&&retained.every(r=>r.sourceUses.external_model.status==='allowed')&&!output.connection.held.length?'pass':'hold'
  next.assessment.holds=[...new Set([...(next.assessment.holds??[]).filter(h=>!checks.some(c=>c.id===h)&&!h.startsWith('news_pool:')),
   ...checks.filter(c=>c.status!=='pass').map(c=>c.id),...output.connection.holds.map(h=>`news_pool:${h}`)])]
 }
 if(before!==fingerprint({handoff,sourcePlan,sourceRegister,batches}))throw new Error('country_news_pool_input_mutated')
 return {handoff:next,summary}
}
