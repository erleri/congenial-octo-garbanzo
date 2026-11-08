import {describe,it,expect,vi} from 'vitest'
import {createReviewedNewsEvidence} from './reviewed-news-notes.js'
import {bindEvidenceScope} from './evidence-scope.js'
import {sourceUseBinding} from './source-use.js'
import {materialRoleBinding} from './country-material-preparation.js'
import {connectSourceAttributionConditions} from './source-attributions.js'
import {createSourceContext} from './source-context.js'
import {buildSharedDashboardPriceSnapshot} from './shared-price-contract.js'
import {reconnectReferenceMaterials,applyReferenceMaterialReview,REFERENCE_MATERIAL_REVIEW_VERSION} from './reference-materials.js'
import {MATERIAL_SELECTION_VERSION,REFERENCE_MATERIAL_SELECTION_VERSION,materialSelectionBinding,selectReferenceMaterialConnection} from './material-selection.js'
import {fingerprint} from './research-harness.js'

// Synthetic projection boundaries; these are not researched country examples.
function fixture(currency='COP',consumerPeriod='2026-08'){
 const review={origin:'agent',status:'checked',reason:'합성 검증의 명시적 역할 판단이며 실제 자료의 독립 내용 검토가 아니다.'}
 const entries=[['market','2026-10-26'],['consumer','2026-10-15']].map(([name,date])=>{
  const e=createReviewedNewsEvidence({id:`news-synthetic-${name}`,country:currency,publisher:'Synthetic publisher',author:'Synthetic author',
   url:`https://example.org/${name}`,publishedAt:date,eventDate:date,collectedAt:'2026-10-27T01:00:00Z',publicationDisplay:date},
   name==='market'?[{id:'n0',kind:'fact',text:'합성 현물시장 관측은 해당 거래일과 기사 가격 기준의 기록이다.',attribution:null,reportedPrice:null},
    {id:'n1',kind:'attributed_view',text:'합성 분석가는 국제 조건이 현지 통화에 미친 경로를 해석했다.',
     attribution:{person:'Synthetic analyst',organization:'Synthetic institution'},reportedPrice:null}]
   :[{id:'n0',kind:'fact',text:'합성 팔월 소매 지표는 당일 환율 원인이나 회사 판매가 아니다.',attribution:null,reportedPrice:null}],
   {...review,supportingContentChecked:true,independentlyWorded:true,notTranslation:true,notArticleSubstitute:true,contentAccess:'publisher_page',checkedOn:'2026-10-28'})
  const notes=e.newsNotes.notes
  if(name==='consumer'){
   Object.assign(e,{period:consumerPeriod,eventDate:null,sourceContext:createSourceContext({
    blocks:[{kind:'paragraph',text:notes[0].text}],selected:[0]})})
   delete e.newsNotes
  }
  const card=bindEvidenceScope(e,{passageIds:notes.map(n=>name==='consumer'?'p0':n.id),scope:{subject:currency,metric:name,
   unit:name==='consumer'?'percent':'local_per_USD',comparison:'synthetic_source_scope'},
   admittedClaims:notes.map(n=>({id:n.id,kind:n.kind==='fact'?'source_fact':'source_interpretation',text:n.text,passageIds:[name==='consumer'?'p0':n.id]})),
   allowedUse:'합성 자료의 명시적 설명 범위로만 사용한다.',countercontext:'합성 지표와 실제 시장의 인과는 별개다.',excludedExpansions:[],coverageGaps:[],crossSourceClaims:[]},review)
  const record={evidenceId:e.id,claimRoles:name==='market'?{n0:'market_observation',n1:'attributed_fx_explanation'}:{n0:'consumer_background'},
   sessionDate:'2026-10-26',priceBasis:'Synthetic article spot basis, separate from shared reference.',review,
   provenance:{mode:'saved_capture',locator:'Synthetic saved identity; not a real original or source.'}}
  const use={version:'source-use/1',resourceId:e.id,resourceBinding:sourceUseBinding(e),terms:{url:e.url,version:'synthetic/1',reviewedOn:'2026-10-28'},
   scope:'합성 용도 판단이며 실제 출판사의 허가가 아니다.',review,conditions:[],
   uses:Object.fromEntries(['local_analysis','external_model','public_display'].map(k=>[k,{status:k==='public_display'?'pending':'allowed',
    reason:'합성 로컬 검증 용도이며 새 원고나 운영 게시 승인이 아니다.',conditionIds:[]}]))}
  return {e,card,material:{record,binding:materialRoleBinding(e,record)},use}
 })
 const input={currency,baseDate:'2026-10-28',asOf:'2026-10-28T12:00:00Z',
  packet:{currency,baseDate:'2026-10-28',observedDate:'2026-10-26',evidence:entries.map(x=>x.e),evidenceScopeCards:entries.map(x=>x.card)},
  materials:entries.map(x=>x.material),sourceUse:{evaluatedOn:'2026-10-28',reviews:entries.map(x=>x.use)}}
 const dataset={baseDate:'2026-10-28',fetchedAt:'2026-10-28T05:00:00Z',dailyRates:[27,28].map(day=>({currency,
  date:`2026-10-${day}`,rateType:'LOCAL_PER_USD',value:day===27?100:102,status:'ok',source:'API',imputationMethod:'NONE'}))}
 return {input,kind:'country_materials',snapshot:buildSharedDashboardPriceSnapshot({dataset,currency,asOf:input.asOf}),
  commentaryDate:'2026-10-26',asOf:input.asOf}
}

function preparationReview(connection){
 const rows=[...Object.values(connection.sections).flat(),...connection.archive,...connection.held]
 const sources=[...new Map(rows.map(r=>[r.evidenceId,r])).values()]
 const review={origin:'agent',status:'checked',reason:'합성 저장 자료에 대한 준비 판단이다. 실제 원문·모델 품질·게시 승인을 뜻하지 않는다.'}
 return {version:REFERENCE_MATERIAL_REVIEW_VERSION,contextBinding:connection.binding,
  review:{...review,checkedOn:'2026-10-28'},selection:{version:MATERIAL_SELECTION_VERSION,
   inputBinding:materialSelectionBinding(connection),review,decisions:sources.map(s=>({evidenceId:s.evidenceId,
    requirement:s.role==='consumer_background'?'optional':'required',action:'include',reason:'합성 자료의 범위를 보존해 다음 로컬 검토 사본에 포함한다.'}))},
  roleChanges:[],claimContexts:[],sourceVersions:sources.map(s=>({evidenceId:s.evidenceId,evidenceBinding:s.evidenceBinding,
   publishedAt:s.publishedAt,collectedAt:s.collectedAt,modifiedAt:null,support:'verified_saved_original'}))}
}

function seal(connection){delete connection.binding;connection.binding=fingerprint(connection);return connection}
// These are source-scoped synthetic graphs over the validated projection, not
// claims about an actual publisher, country or original-content permission.
function copyMarket(connection,id){
 for(const role of ['market_observation','attributed_fx_explanation']){
  const row=structuredClone(connection.sections[role][0]);row.evidenceId=id;row.sourceUrl=`https://example.org/${id}`
  connection.sections[role].push(row)
 }
 connection.sourceUseSummary.push({...structuredClone(connection.sourceUseSummary[0]),resourceId:id})
 connection.externalSourceAttributions.push({resourceId:id,sourceUrl:`https://example.org/${id}`})
 return seal(connection)
}
function selectV2(connection,ids){
 const review=preparationReview(connection);review.selection.version=REFERENCE_MATERIAL_SELECTION_VERSION
 for(const decision of review.selection.decisions)if(ids.includes(decision.evidenceId))
  Object.assign(decision,{requirement:'optional',action:'exclude'})
 return review
}

describe('Shared reference material reconnection',()=>{
 it('selects a redundant market source through the same v2 contract in all countries, removing its delivery paths and approvals',()=>{
  for(const currency of ['BRL','MXN','COP','PEN','CLP','ARS']){
   const base=copyMarket(reconnectReferenceMaterials(fixture(currency)),'news-optional'),id='news-optional'
   const row=base.sections.market_observation.find(r=>r.evidenceId===id)
   base.archive.push({...structuredClone(row),reason:'historical_synthetic'})
   base.held.push({...structuredClone(row),holds:['synthetic_optional_source_failed']})
   base.contentReview={status:'approved',publicationApproved:true}
   base.preparationReview={oldApproval:true};base.publicationApproved=true;base.paidCallAuthorized=true;base.request={mustNotSurvive:true}
   seal(base);const before=structuredClone(base),review=selectV2(base,[id])
   const next=applyReferenceMaterialReview(base,review)
   expect(Object.values(next.sections).flat().map(r=>r.evidenceId)).not.toContain(id)
   expect([...next.archive,...next.held]).toEqual([])
   expect(next.sourceUseSummary.some(r=>r.resourceId===id)).toBe(false)
   expect(next.externalSourceAttributions.some(r=>r.resourceId===id)).toBe(false)
   expect(next.holds).toEqual([])
   expect(next.contentReview).toMatchObject({status:'pending_independent_shared_context_review',publicationApproved:false})
   expect(next.preparationReview.selection).toMatchObject({version:REFERENCE_MATERIAL_SELECTION_VERSION,
    priorReviewReusable:false,scope:'reviewed_claim_projection_only',originalProcessingPermissionGranted:false})
   expect(next).toMatchObject({request:null,paidCallAuthorized:false,publicationApproved:false})
   expect(next.referenceSnapshotId).toBe(base.referenceSnapshotId)
   expect(next.binding).not.toBe(base.binding);expect(base).toEqual(before)
  }
 })
 it('removes transitive source dependencies to a fixed point, including cycles, and holds the loss of an explicitly required source',()=>{
  const base=copyMarket(copyMarket(reconnectReferenceMaterials(fixture()),'news-dependent'),'news-final')
  const dependencies={'news-synthetic-consumer':['news-dependent'],'news-dependent':['news-synthetic-consumer'],
   'news-final':['news-dependent']}
  for(const row of Object.values(base.sections).flat())if(dependencies[row.evidenceId])row.crossSourceClaims=[{
   subject:'Synthetic scoped dependency, not an original-source claim.',requiredEvidenceIds:dependencies[row.evidenceId]}]
  seal(base);const review=selectV2(base,['news-synthetic-consumer'])
  review.selection.decisions.find(d=>d.evidenceId==='news-dependent').requirement='optional'
  const next=applyReferenceMaterialReview(base,review)
  expect(new Set(Object.values(next.sections).flat().map(r=>r.evidenceId))).toEqual(new Set(['news-synthetic-market']))
  expect(next.preparationReview.selection.excluded.map(r=>r.evidenceId)).toEqual(['news-synthetic-consumer','news-dependent','news-final'])
  expect(next.holds).toEqual(['required_material_dependency_removed:news-final'])
  expect(next.status).toBe('materials_connected_with_gaps')
  expect(JSON.stringify(next.sections)).not.toContain('news-dependent')
  expect(next.publicationApproved).toBe(false)
 })
 it('holds missing essential roles after v2 removal; archived, held, global and consumer material cannot replace a current local cause',()=>{
  const base=reconnectReferenceMaterials(fixture()),cause=structuredClone(base.sections.attributed_fx_explanation[0])
  base.archive.push({...cause,evidenceId:'archived-cause',reason:'different_session'})
  base.held.push({...cause,evidenceId:'unverified-cause',holds:['support_not_reverified_from_saved_original']})
  base.sections.global_context.push({...cause,role:'global_context',evidenceId:'global-only'})
  seal(base);const review=selectV2(base,['news-synthetic-market']),next=applyReferenceMaterialReview(base,review)
  expect(next.holds).toEqual(['selected_session_market_observation_missing','selected_session_attributed_fx_explanation_missing',
   'selected_material_holds_require_resolution'])
  expect(next.sections.consumer_background).toHaveLength(1);expect(next.sections.global_context).toHaveLength(1)
  const empty=selectReferenceMaterialConnection(base,selectV2(base,review.selection.decisions.map(d=>d.evidenceId)).selection).connection
  expect(Object.values(empty.sections).flat()).toEqual([])
  expect(empty.holds).toContain('selected_session_attributed_fx_explanation_missing')
 })
 it('preserves unrelated blockers and source-use scope, requires the exact binding and refuses an explicit required-source exclusion',()=>{
  const base=reconnectReferenceMaterials(fixture())
  base.holds.push('shared_reference_price_held','independent_content_review_unresolved')
  base.sections.attributed_fx_explanation[0].sourceUses.external_model.status='pending'
  seal(base);const review=selectV2(base,['news-synthetic-consumer']),next=applyReferenceMaterialReview(base,review)
  expect(next.holds).toEqual(['independent_content_review_unresolved','external_source_use_pending:news-synthetic-market','shared_reference_price_held'])
  expect(next.sections.attributed_fx_explanation[0].sourceUses.public_display.status).toBe('pending')
  const required=structuredClone(review);required.selection.decisions[1].requirement='required'
  expect(()=>applyReferenceMaterialReview(base,required)).toThrow('bound_material_selection_required')
  const changed=structuredClone(base);changed.sections.market_observation[0].text+=' not bound'
  const selection={...review.selection,inputBinding:materialSelectionBinding(changed)}
  expect(()=>selectReferenceMaterialConnection(changed,selection)).toThrow('bound_reference_material_connection_required')
 })
 it('applies the same role and reference rules to all six currencies without copying old numbers, approvals or raw bodies',()=>{
  const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('forbidden'))
  try{for(const currency of ['BRL','MXN','COP','PEN','CLP','ARS']){
   const data=fixture(currency),before=structuredClone(data)
   Object.assign(data.input,{approval:{authorized:true,budgetUsd:999},privateResponse:'RAW-MODEL-DO-NOT-COPY'})
   const result=reconnectReferenceMaterials(data)
   expect(result).toMatchObject({status:'materials_prepared_for_content_review',referenceDate:'2026-10-28',commentaryDate:'2026-10-26',
    sourceCaseSessionDate:'2026-10-26',referenceRateCausalityEstablished:false,request:null,paidCallAuthorized:false,publicationApproved:false})
   expect(result.sections.attributed_fx_explanation[0].attributions[0].person).toBe('Synthetic analyst')
   expect(result.contentReview.status).toBe('pending_independent_shared_context_review')
   expect(JSON.stringify(result)).not.toContain('RAW-MODEL-DO-NOT-COPY')
   expect(result).not.toHaveProperty('packet');expect(result).not.toHaveProperty('facts')
   expect(data.input.packet).toEqual(before.input.packet);expect(data.snapshot).toEqual(before.snapshot)
  }expect(network).not.toHaveBeenCalled()}finally{network.mockRestore()}
 })
 it('archives a different news session while preserving earlier consumer publication, reference month and separate price kind',()=>{
  const data=fixture();data.commentaryDate='2026-10-27'
  const result=reconnectReferenceMaterials(data)
  expect(result.archive).toHaveLength(2)
  expect(result.archive[0]).toMatchObject({eventDate:'2026-10-26',sourceSessionDate:'2026-10-26'})
  expect(result.sections.consumer_background[0]).toMatchObject({publishedAt:'2026-10-15',referencePeriod:'2026-08',eventDate:null,
   sourceSessionDate:null,roleReviewSessionDate:'2026-10-26'})
  expect(result.sections.attributed_fx_explanation).toHaveLength(0)
  expect(result.holds).toContain('selected_session_attributed_fx_explanation_missing')
  expect(reconnectReferenceMaterials(fixture('CLP','2026-Q3')).sections.consumer_background[0].referencePeriod).toBe('2026-Q3')
 })
 it('keeps external-use uncertainty and public-use decisions distinct from local analysis',()=>{
  const data=fixture();data.input.sourceUse.reviews[1].uses.external_model.status='pending'
  const result=reconnectReferenceMaterials(data)
  expect(result.sections.consumer_background).toHaveLength(1)
  expect(result.holds).toContain('external_source_use_pending:news-synthetic-consumer')
  expect(result.sections.market_observation[0].sourceUses.public_display.status).toBe('pending')
  expect(result.publicationApproved).toBe(false)
 })
 it('rechecks exact attribution delivery rather than inheriting an allowed use with the credit missing',()=>{
  const data=fixture(),resources=data.input.packet.evidence
  const notes=resources.map(e=>({version:'source-attribution/1',resourceId:e.id,resourceBinding:sourceUseBinding(e),
   sourceUrl:e.url,publisher:e.publisher,publishedAt:e.publishedAt,referencePeriod:e.period,
   attribution:'Source: Synthetic publisher and Synthetic analyst.',transformation:'Independently authored synthetic facts and attributed views.'}))
  data.input.sourceUse=connectSourceAttributionConditions({resources,sourceUse:data.input.sourceUse,attributionNotes:notes})
  expect(reconnectReferenceMaterials(data).status).toBe('materials_prepared_for_content_review')
  data.input.sourceUse.attributionNotes=[]
  expect(reconnectReferenceMaterials(data).holds).toContain('external_source_use_pending:news-synthetic-market')
 })
 it('does not turn a consumer fact or global context into a local attributed cause',()=>{
  const data=fixture(),m=data.input.materials[0],e=data.input.packet.evidence[0]
  m.record.claimRoles.n1='global_context';m.binding=materialRoleBinding(e,m.record)
  const result=reconnectReferenceMaterials(data)
  expect(result.sections.global_context).toHaveLength(1)
  expect(result.holds).toContain('selected_session_attributed_fx_explanation_missing')
  const bad=fixture();bad.input.materials[0].record.claimRoles.n0='attributed_fx_explanation'
  bad.input.materials[0].binding=materialRoleBinding(bad.input.packet.evidence[0],bad.input.materials[0].record)
  expect(reconnectReferenceMaterials(bad).held.some(c=>c.holds.includes('explicit_attributed_connection_required'))).toBe(true)
 })
 it('rejects stale role bindings and keeps data unavailable by the cutoff out of current sections',()=>{
  const data=fixture();data.input.materials[0].record.claimRoles.n1='consumer_background'
  expect(()=>reconnectReferenceMaterials(data)).toThrow('unreviewed_country_material_role')
  const future=fixture(),m=future.input.materials[0]
  Object.assign(m.record,{bodyAvailableAt:'2026-10-28T13:00:00Z'});m.binding=materialRoleBinding(future.input.packet.evidence[0],m.record)
  const result=reconnectReferenceMaterials(future)
  expect(result.sections.market_observation).toHaveLength(0)
  expect(result.held).toHaveLength(2)
  expect(result.held.every(c=>c.holds.includes('body_version_after_cutoff'))).toBe(true)
 })
 it('requires an explicit valid commentary day instead of manufacturing the prior market day from the stored date',()=>{
  const data=fixture()
  for(const commentaryDate of [undefined,'2026-10-29','yesterday'])expect(()=>reconnectReferenceMaterials({...data,commentaryDate})).toThrow('shared_material_context_required')
 })
 it('omits optional background from every projected delivery path but refuses to omit a required cause or dependency',()=>{
  const data=fixture();data.input.sourceUse.reviews[1].uses.external_model.status='pending'
  const base=reconnectReferenceMaterials(data),before=structuredClone(base),review=preparationReview(base)
  review.selection.decisions[1].action='exclude';review.sourceVersions[1].support='not_reverified'
  const next=applyReferenceMaterialReview(base,review)
  expect(next.sections.consumer_background).toEqual([])
  expect(next.sections.attributed_fx_explanation).toHaveLength(1)
  expect(next.holds).not.toContain('external_source_use_pending:news-synthetic-consumer')
  expect(next.sourceUseSummary.some(r=>r.resourceId==='news-synthetic-consumer')).toBe(false)
  expect(JSON.stringify(next.sections)).not.toContain('합성 팔월 소매')
  expect(next.preparationReview.selection.excluded[0].evidenceId).toBe('news-synthetic-consumer')
  expect(next.contentReview.status).toBe('pending_independent_shared_context_review')
  expect(next.request).toBe(null);expect(next.publicationApproved).toBe(false);expect(base).toEqual(before)
  const illegal=preparationReview(base);Object.assign(illegal.selection.decisions[0],{requirement:'optional',action:'exclude'})
  expect(()=>applyReferenceMaterialReview(base,illegal)).toThrow('required_material_cannot_be_excluded')
  const linked=fixture(),card=linked.input.packet.evidenceScopeCards[0]
  const rebound=bindEvidenceScope(linked.input.packet.evidence[0],{...card,
   crossSourceClaims:[{subject:'합성 소비 자료를 필요로 하는 관계를 제거하지 않아야 한다.',requiredEvidenceIds:['news-synthetic-market','news-synthetic-consumer']}]},card.review)
  linked.input.packet.evidenceScopeCards[0]=rebound
  const withDependency=reconnectReferenceMaterials(linked),dependent=preparationReview(withDependency)
  dependent.selection.decisions[1].action='exclude'
  expect(()=>applyReferenceMaterialReview(withDependency,dependent)).toThrow('excluded_material_still_required_by_claim')
 })
 it('reclassifies a reviewed schedule conservatively without promoting background or an archived session into a market cause',()=>{
  const data=fixture(),record=data.input.materials[0]
  record.record.claimRoles.n0='countercontext';record.binding=materialRoleBinding(data.input.packet.evidence[0],record.record)
  const base=reconnectReferenceMaterials(data),review=preparationReview(base)
  review.roleChanges.push({evidenceId:'news-synthetic-market',claimId:'n0',fromRole:'countercontext',toRole:'watch_context',
   reason:'합성 항목은 아직 열리지 않은 일정이므로 시장 해석을 반박하는 근거로 분류하지 않는다.'})
  const next=applyReferenceMaterialReview(base,review)
  expect(next.sections.countercontext).toEqual([])
  expect(next.sections.watch_context[0]).toMatchObject({role:'watch_context',sourceSessionDate:null,roleReviewSessionDate:'2026-10-26'})
  const promotion=preparationReview(base)
  promotion.roleChanges.push({...review.roleChanges[0],toRole:'attributed_fx_explanation'})
  expect(()=>applyReferenceMaterialReview(base,promotion)).toThrow('reference_material_role_change_invalid')
  const old=reconnectReferenceMaterials({...data,commentaryDate:'2026-10-27'}),oldReview=preparationReview(old)
  oldReview.roleChanges=review.roleChanges
  expect(()=>applyReferenceMaterialReview(old,oldReview)).toThrow('reference_material_role_change_invalid')
 })
 it('binds source editions and explanation periods to the unchanged input and holds retained unverifiable bodies',()=>{
  const base=reconnectReferenceMaterials(fixture()),review=preparationReview(base)
  review.sourceVersions[0].modifiedAt='2026-10-26T23:30:00Z'
  review.claimContexts.push({evidenceId:'news-synthetic-market',claimId:'n1',periodMeaning:'recent_period',observationWindow:'recent_period',
   constraint:'최근 기간의 해설이며 당일 장중 관측 한 번의 기여도로 축소하지 않는다.'})
  const next=applyReferenceMaterialReview(base,review)
  expect(next.sections.attributed_fx_explanation[0]).toMatchObject({eventDate:'2026-10-26',referencePeriod:'2026-10-26',
   writingContext:{periodMeaning:'recent_period'},sourceVersion:{modifiedAt:'2026-10-26T23:30:00Z',
    bodyAvailableBy:'2026-10-27T01:00:00Z',availabilityBasis:'known_by_collection_not_first_publication'}})
  const stale={...review,contextBinding:'0'.repeat(64)}
  expect(()=>applyReferenceMaterialReview(base,stale)).toThrow('bound_reference_material_review_required')
  const future=structuredClone(review);future.sourceVersions[0].modifiedAt='2026-10-28T13:00:00Z'
  expect(()=>applyReferenceMaterialReview(base,future)).toThrow('reference_material_version_invalid')
  const failed=preparationReview(base);failed.sourceVersions[0].support='not_reverified'
  const held=applyReferenceMaterialReview(base,failed)
  expect(held.sections.attributed_fx_explanation).toEqual([])
  expect(held.held.every(c=>c.holds.includes('support_not_reverified_from_saved_original'))).toBe(true)
  expect(held.holds).toContain('selected_session_attributed_fx_explanation_missing')
 })
})
