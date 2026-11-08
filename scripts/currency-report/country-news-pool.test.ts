import fs from 'node:fs'
import {describe,it,expect,vi} from 'vitest'
import {bindSelectedOriginalReview} from './selected-source-collection.js'
import {prepareSelectedNewsReview,SELECTED_NEWS_REVIEW_VERSION} from './selected-news-review.js'
import {reviewSelectedNewsMaterial} from './selected-material-review.js'
import {materialRoleBinding} from './country-material-preparation.js'
import {sourceUseBinding} from './source-use.js'
import {buildSharedDashboardPriceSnapshot} from './shared-price-contract.js'
import {reconnectReferenceMaterials} from './reference-materials.js'
import {prepareCountryNewsPool,matchNewsPublicationPrecision} from './country-news-pool.js'
import {fingerprint} from './research-harness.js'
import {sourceSelectionFixture} from './research-source-selection-fixtures.js'
import {compileResearchSourceCatalog,planResearchSourceSelection,countryNewsCollectionSources} from './research-source-selection.js'

const sourcePlan=JSON.parse(fs.readFileSync('docs/2.0/six-currency-explanation-sources-20261027.json','utf8'))
const sourceRegister=JSON.parse(fs.readFileSync('docs/2.0/six-currency-source-register-20261027.json','utf8'))
const asOf='2026-10-29T02:00:00Z',publishedAt='2026-10-27T15:00:00Z',collectedAt='2026-10-28T01:00:00Z'
const judgment={origin:'agent',status:'checked',reason:'Synthetic recorded judgment for software boundaries, not historical source or model quality.'}
function bundle(id='emol',sourceId='clp-existing-four-outlets',url='https://www.emol.com/noticias/Economia/2026/10/27/1234/test.html',body='RAW_SYNTHETIC_MARKET'){
 const record={kind:'article',url,sha256:fingerprint(body),collectedAt,metadata:{publishedAt},
  blocks:[{kind:'paragraph',text:body},{kind:'paragraph',text:body+' attributed synthetic source discussion'}]}
 const {original,review:card}=bindSelectedOriginalReview({request:{sourceId,period:'2026-10-27'},record,
  adapter:'reviewed_news_notes',requestIds:['synthetic-request'],currency:'CLP',asOf,
  targets:[{needId:'market',requestedPeriod:'2026-10-27'}]})
 const collection={version:'selected-source-collection/1',currency:'CLP',baseDate:'2026-10-28',asOf,
  originals:[original],reviewQueue:[card],outcomes:[{sourceId,status:'collected_pending_review'}]}
 const notes=[{id:'n0',kind:'fact',text:'Synthetic observed market direction belongs to the stated local session.',attribution:null,reportedPrice:null},
  {id:'n1',kind:'attributed_view',text:'Synthetic analyst attributes the local currency movement to a stated source condition.',
   attribution:{person:'Synthetic analyst',organization:'Synthetic institution'},reportedPrice:null}]
 const receipt={cardBinding:card.binding,checkedChecks:card.requiredChecks,
  source:{id:`news-test-${id}`,country:'CLP',publisher:`Synthetic ${id}`,author:'Synthetic author',url,publishedAt,collectedAt,
   publicationDisplay:'Synthetic timestamp, not real historical availability',eventDate:'2026-10-27'},notes,
  review:{...judgment,supportingContentChecked:true,contentAccess:'publisher_page',independentlyWorded:true,
   notTranslation:true,notArticleSubstitute:true,checkedOn:'2026-10-29'},
  supportingReferences:notes.map((n,index)=>({noteId:n.id,blockPositions:[index],reason:judgment.reason})),
  scopeDraft:{passageIds:['n0','n1'],scope:{subject:'CLP',metric:'market_quote',unit:'local_per_USD',comparison:'previous_session'},
   admittedClaims:notes.map(n=>({id:n.id,kind:n.kind==='fact'?'source_fact':'source_interpretation',text:n.text,passageIds:[n.id]})),
   allowedUse:'Use only the synthetic stated scope and attribution.',countercontext:'Synthetic facts do not prove causal contribution.',
   excludedExpansions:[],coverageGaps:[],crossSourceClaims:[]},scopeReview:judgment}
 const checked=reviewSelectedNewsMaterial({collection,card,receipt}),e=checked.evidence[0]
 const roleRecord={evidenceId:e.id,claimRoles:{n0:'market_observation',n1:'attributed_fx_explanation'},sessionDate:'2026-10-27',
  priceBasis:'Synthetic intraday article observation, separate from the shared reference.',review:judgment,
  provenance:{mode:'saved_capture',locator:'Synthetic saved original only, not a production source.'}}
 const input={currency:'CLP',baseDate:'2026-10-28',asOf,packet:{currency:'CLP',baseDate:'2026-10-28',observedDate:'2026-10-27',
  evidence:checked.evidence,evidenceScopeCards:checked.evidenceScopeCards},materials:[{record:roleRecord,binding:materialRoleBinding(e,roleRecord)}],
  sourceUse:{evaluatedOn:'2026-10-29',reviews:[{version:'source-use/1',resourceId:e.id,resourceBinding:sourceUseBinding(e),
   terms:{url,version:'synthetic-note-use/1',reviewedOn:'2026-10-29'},scope:'Synthetic authored-note use, not raw content permission.',review:judgment,conditions:[],
   uses:Object.fromEntries(['local_analysis','external_model','public_display'].map(use=>[use,{status:use==='public_display'?'pending':'allowed',
    reason:'Synthetic software test, not a permission or publication judgment.',conditionIds:[]}]))}]}}
 const job=prepareSelectedNewsReview({collection,card}),response={version:SELECTED_NEWS_REVIEW_VERSION,jobBinding:job.binding,
  decision:'propose_notes',reason:judgment.reason,assessment:{role:'market_explanation',eventDate:'2026-10-27',priceKind:'intraday',
   observedAt:null,causeSupport:'reported_link',supportingBlockPositions:[0,1],reason:judgment.reason},
  receipt,claimChecks:notes.map((n,index)=>({noteId:n.id,allSubclaimsSupported:true,blockPositions:[index],reason:judgment.reason}))}
 return {collection,newsResponses:[{cardBinding:card.binding,response}],materialInputs:[{cardBinding:card.binding,input}],receipts:[]}
}
function fixture(){
 const base=bundle(),dataset={baseDate:'2026-10-28',fetchedAt:'2026-10-28T02:00:00Z',dailyRates:[27,28].map(day=>({
  date:`2026-10-${day}`,currency:'CLP',rateType:'LOCAL_PER_USD',value:day===27?100:99,status:'ok',source:'API',imputationMethod:'NONE'}))}
 const snapshot=buildSharedDashboardPriceSnapshot({dataset,currency:'CLP',asOf:'2026-10-28T12:00:00Z'})
 const materialConnection=reconnectReferenceMaterials({input:base.materialInputs[0].input,kind:'country_materials',snapshot,
  commentaryDate:'2026-10-27',asOf})
 return {handoff:{version:'six-currency-preparation/2',materialConnection,reportPriceSnapshot:snapshot,request:null,
  paidCallAuthorized:false,publicationApproved:false},sourcePlan,sourceRegister,asOf,batches:[base]}
}
const secondary=()=>bundle('biobio','clp-biobio','https://www.biobiochile.cl/noticias/economia/actualidad-economica/2026/10/27/test.shtml','RAW_SYNTHETIC_SECONDARY')

describe('Country news pool into shared material preparation',()=>{
 it('matches a verified date-only note at its existing local-day precision without inventing time or accepting a different local day',()=>{
  const note={publishedAt:'2026-10-27',sourceVersion:{support:'verified_saved_original'}}
  for(const currency of ['BRL','MXN','COP','PEN','CLP','ARS']){
   expect(matchNewsPublicationPrecision(note,'2026-10-27T15:00:00Z',currency)).toBe('same_local_day_at_existing_note_precision')
   expect(matchNewsPublicationPrecision(note,'2026-10-27T01:00:00Z',currency)).toBeNull()
  }
  expect(matchNewsPublicationPrecision({...note,sourceVersion:{support:'not_reverified'}},'2026-10-27T15:00:00Z','BRL')).toBeNull()
  expect(matchNewsPublicationPrecision({publishedAt:'2026-10-27T15:00:00Z'},'2026-10-27','BRL')).toBeNull()
  expect(note.publishedAt).toBe('2026-10-27')
 })
 it('collects all enabled country news routes from the shared catalog rather than requiring a selected newspaper',()=>{
  const catalog=compileResearchSourceCatalog(sourcePlan,sourceRegister)
  for(const currency of ['BRL','MXN','COP','PEN','CLP','ARS']){
   const selection=planResearchSourceSelection({input:sourceSelectionFixture(currency,{purpose:'fx_explanation',metric:'market_quote',period:'2026-10-27'}),sourcePlan,sourceRegister})
   const ids=countryNewsCollectionSources(selection,catalog)
   expect(new Set(ids).size).toBe(ids.length)
   expect(ids.every(id=>catalog.sources.some(s=>s.id===id&&s.kind==='news'&&s.currency===currency&&s.discovery?.mode!=='excluded'))).toBe(true)
   if(currency==='CLP')expect(ids).toEqual(['clp-existing-four-outlets','clp-biobio','clp-cooperativa'])
  }
 })
 it('connects a reviewed added publisher through existing original, note, role and use checks without a privileged newspaper or raw body in the handoff',()=>{
  const data=fixture();data.batches.push(secondary());const before=structuredClone(data)
  const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('forbidden'))
  try{const out=prepareCountryNewsPool(data)
   expect(out.summary.connectedNewEvidenceIds).toEqual(['news-test-biobio'])
   expect(out.handoff.materialConnection.sections.attributed_fx_explanation).toHaveLength(2)
   expect(out.handoff.materialConnection.holds).toEqual([])
   expect(out.summary.sources.find(s=>s.sourceId==='clp-df').collectionState).toBe('excluded_from_automatic_collection')
   expect(out.summary.attributions).toHaveLength(1)
   expect(out.summary.attributions[0].evidenceIds).toEqual(['news-test-emol','news-test-biobio'])
   expect(JSON.stringify(out)).not.toContain('RAW_SYNTHETIC_')
   expect(out.handoff.reportPriceSnapshot).toEqual(data.handoff.reportPriceSnapshot)
   expect(out.handoff.materialConnection.contentReview.status).toBe('pending_independent_shared_context_review')
   expect(out.summary).toMatchObject({manualUserTasks:[],modelCalls:0,newPaidCostUsd:0,originalProcessingPermissionGranted:false,publicationApproved:false})
   expect(out.handoff).toMatchObject({request:null,paidCallAuthorized:false,publicationApproved:false})
   expect(data).toEqual(before);expect(network).not.toHaveBeenCalled()
  }finally{network.mockRestore()}
 })
 it('keeps missing semantic review, missing role/use review and source failures distinct while a different qualified publisher remains usable',()=>{
  const data=fixture(),pending=secondary();pending.newsResponses=[]
  data.batches.push(pending,{collection:null} as never)
  const out=prepareCountryNewsPool(data)
  expect(out.summary.sources.find(s=>s.sourceId==='clp-biobio').articles[0]).toMatchObject({status:'pending_content_review',reviewState:'automatic_review_unavailable'})
  expect(out.summary.batchFailures).toHaveLength(1);expect(out.summary.materialStatus).toBe('materials_prepared_for_content_review')
  const roles=secondary();roles.materialInputs=[]
  expect(prepareCountryNewsPool({...fixture(),batches:[roles]}).summary.sources.find(s=>s.sourceId==='clp-biobio').articles[0].status)
   .toBe('pending_role_and_note_use_review')
  const scope=secondary();scope.materialInputs[0].input.sourceUse.reviews[0].uses.external_model.status='pending'
  expect(prepareCountryNewsPool({...fixture(),batches:[scope]}).summary.sources.find(s=>s.sourceId==='clp-biobio').articles[0].status).toBe('pending_note_use_review')
 })
 it('rejects a stale review or mismatched writer evidence and will not promote a global or price-only assessment to a local cause',()=>{
  const stale=secondary();stale.newsResponses[0].response.jobBinding='0'.repeat(64)
  expect(prepareCountryNewsPool({...fixture(),batches:[stale]}).summary.sources.find(s=>s.sourceId==='clp-biobio').articles[0].reviewState).toBe('review_result_invalid')
  const altered=secondary();altered.materialInputs[0].input.packet.evidence[0].summary+=' altered'
  expect(prepareCountryNewsPool({...fixture(),batches:[altered]}).summary.sources.find(s=>s.sourceId==='clp-biobio').articles[0].reason)
   .toBe('reviewed_news_material_binding_mismatch')
  const global=secondary();Object.assign(global.newsResponses[0].response.assessment,{role:'global_context',causeSupport:'no_reported_link'})
  expect(prepareCountryNewsPool({...fixture(),batches:[global]}).summary.sources.find(s=>s.sourceId==='clp-biobio').articles[0].reason)
   .toBe('news_review_role_promotion_forbidden')
 })
 it('records an assessed nonmatch or insufficient source as a decision rather than silently requeuing it for another paid review',()=>{
  const negative=secondary(),response=negative.newsResponses[0].response
  Object.assign(response,{decision:'no_relevant_support',receipt:null,claimChecks:[],reason:'The synthetic article covers a different requested role, not the selected local explanation.'})
  Object.assign(response.assessment,{role:'price_only',causeSupport:'no_reported_link'})
  const result=prepareCountryNewsPool({...fixture(),batches:[negative]})
  expect(result.summary.sources.find(s=>s.sourceId==='clp-biobio').articles[0].status).toBe('not_selected_for_requested_role')
  expect(result.summary.pendingContentReviewArticles).toBe(0)
  response.decision='insufficient_information'
  const insufficient=prepareCountryNewsPool({...fixture(),batches:[negative]})
  expect(insufficient.summary.insufficientSupportArticles).toBe(1)
  expect(insufficient.summary.sources.find(s=>s.sourceId==='clp-biobio').articles[0].status).toBe('insufficient_original_support')
  expect(insufficient.handoff.materialConnection.sections.attributed_fx_explanation).toHaveLength(1)
 })
 it('holds an inconsistent publisher revision time and detects explicit syndication credit without altering the stored original',()=>{
  const b=bundle('biobio','clp-biobio',secondary().collection.originals[0].url,'Con información de Bloomberg')
  const original=b.collection.originals[0],record={...original}
  delete record.id;delete record.sourceId;delete record.requestIds
  record.metadata={...record.metadata,modifiedAt:'2026-10-27T14:00:00Z'}
  const rebound=bindSelectedOriginalReview({request:{sourceId:original.sourceId,period:'2026-10-27'},record,
   requestIds:original.requestIds,adapter:'reviewed_news_notes',targets:b.collection.reviewQueue[0].targets,currency:'CLP',asOf})
  b.collection.originals=[rebound.original];b.collection.reviewQueue=[rebound.review];b.newsResponses=[];b.materialInputs=[]
  const before=structuredClone(b),out=prepareCountryNewsPool({...fixture(),batches:[b]})
  expect(out.summary.sources.find(s=>s.sourceId==='clp-biobio').articles[0]).toMatchObject({
   status:'material_held',reason:'publisher_revision_time_conflict',observedCreditedOrigins:['Bloomberg']})
  expect(out.handoff.materialConnection.sections.market_observation).toHaveLength(1)
  expect(b).toEqual(before)
 })
 it('does not carry a different source edition into old notes, and isolates conflicting editions from the other publisher',()=>{
  const data=fixture(),changed=bundle();changed.collection.originals[0].blocks[0].text+=' changed without rebinding'
  expect(prepareCountryNewsPool({...data,batches:[changed]}).summary.sources.find(s=>s.sourceId==='clp-existing-four-outlets').articles[0].reviewState)
   .toBe('invalid_original_binding')
  const first=bundle(),second=bundle('emol-new','clp-existing-four-outlets',first.collection.originals[0].url,'RAW_SYNTHETIC_REVISION')
  const out=prepareCountryNewsPool({...fixture(),batches:[first,second,secondary()]})
  expect(out.summary.sources.find(s=>s.sourceId==='clp-existing-four-outlets').articles.every(r=>r.status==='revision_conflict')).toBe(true)
  expect(out.handoff.materialConnection.sections.market_observation.map(r=>r.evidenceId)).toEqual(['news-test-biobio'])
  expect(out.summary.removed.some(r=>r.evidenceId==='news-test-emol')).toBe(true)
  expect(out.handoff.materialConnection.holds).toEqual([])
 })
 it('holds all genuinely different-session material instead of changing its event day or treating a publication date as the session',()=>{
  const data=fixture(),newSource=secondary(),m=newSource.materialInputs[0].input
  m.packet.observedDate='2026-10-26';m.materials[0].record.sessionDate='2026-10-26'
  m.materials[0].binding=materialRoleBinding(m.packet.evidence[0],m.materials[0].record)
  const out=prepareCountryNewsPool({...data,batches:[newSource]})
  expect(out.summary.connectedNewEvidenceIds).toEqual([])
  expect(out.summary.sources.find(s=>s.sourceId==='clp-biobio').articles[0].status).toBe('material_held')
  expect(out.handoff.materialConnection.commentaryDate).toBe('2026-10-27')
 })
 it('does not count an identical syndicated body twice, even when the publisher and URL differ',()=>{
  const data=fixture(),duplicate=bundle('biobio','clp-biobio',secondary().collection.originals[0].url)
  data.batches.push(duplicate)
  const out=prepareCountryNewsPool(data)
  expect(out.summary.sources.find(s=>s.sourceId==='clp-biobio').articles[0].status).toBe('duplicate_original')
  expect(out.handoff.materialConnection.sections.market_observation).toHaveLength(1)
 })
 it('separates changed HTML capture hashes from unchanged body/publication editions without reusing a new unbound review',()=>{
  const first=bundle(),second=structuredClone(first)
  const {sourceId,requestIds}=second.collection.originals[0],record={...second.collection.originals[0]}
  delete record.id;delete record.sourceId;delete record.requestIds
  record.sha256=fingerprint('different page scripts, identical article text');record.collectedAt='2026-10-28T02:00:00Z'
  const rebound=bindSelectedOriginalReview({request:{sourceId,period:'2026-10-27'},record,requestIds,
   adapter:'reviewed_news_notes',targets:first.collection.reviewQueue[0].targets,currency:'CLP',asOf})
  second.collection.originals=[rebound.original];second.collection.reviewQueue=[rebound.review]
  second.newsResponses=[];second.materialInputs=[]
  const out=prepareCountryNewsPool({...fixture(),batches:[first,second]})
  expect(out.summary.sources.find(s=>s.sourceId===sourceId).articles.some(r=>r.status==='revision_conflict')).toBe(false)
  expect(out.handoff.materialConnection.sections.attributed_fx_explanation).toHaveLength(1)
  expect(out.summary.sources.find(s=>s.sourceId===sourceId).articles[1].reviewState).toBe('automatic_review_unavailable')
 })
 it('holds writing when all local causes are unavailable, without asking the user to approve articles or filling the gap with statistics',()=>{
  const data=fixture(),register=structuredClone(sourceRegister),route=register.newsRoutes.find(s=>s.id==='clp-existing-four-outlets')
  route.discovery={tier:'supplemental',mode:'excluded',domains:['www.emol.com'],terms:['dolar'],reason:'Synthetic unavailability for software fallback verification only.'}
  const pending=secondary();pending.newsResponses=[]
  const out=prepareCountryNewsPool({...data,sourceRegister:register,batches:[pending]})
  expect(out.handoff.materialConnection.sections.attributed_fx_explanation).toEqual([])
  expect(out.handoff.materialConnection.holds).toContain('selected_session_attributed_fx_explanation_missing')
  expect(out.summary.manualUserTasks).toEqual([]);expect(out.handoff.request).toBeNull()
 })
})
