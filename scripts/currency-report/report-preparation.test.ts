import {describe,expect,it,vi,afterEach} from 'vitest'
import {createSourceContext} from './source-context.js'
import {bindEvidenceScope} from './evidence-scope.js'
import {chileConsumptionScopes} from './chile-consumption-scopes.js'
import {sourceUseBinding} from './source-use.js'
import {priceUseResource} from './research-materials.js'
import {prepareLatestReportInput,WRITING_ROLES} from './report-preparation.js'
import {koreanReportCutoff} from './report-preparation-local.js'
import {CLAIM_REVIEW_VERSION,CLAIM_REVIEW_INSTRUCTIONS} from './claim-review.js'

// Synthetic originals and permission judgments; no actual source or report score.
function fixture() {
  const packet={currency:'CLP',baseDate:'2026-10-27',observedDate:'2026-10-26',facts:[{id:'spot',value:990,label:'Synthetic rate 990'}],
    series:[{date:'2026-10-23',value:989},{date:'2026-10-26',value:990}],evidence:[],limitations:[],
    marketData:{reportPriceBasis:{sourceAdapter:'bcch-bde-api/1',provider:'Banco Central de Chile',seriesId:'F073.TCO.PRE.Z.D',
      dateBasis:'underlying_local_transaction_day',priceKind:'official_transaction_weighted_average',timeZone:'America/Santiago',
      methodology:{sha256:'a'.repeat(64)},attribution:{source:'Synthetic attribution'},
      observations:[{localSessionDate:'2026-10-23'},{localSessionDate:'2026-10-26'}]}}}
  const priceInput={version:'bcch-report-input/1',sourceAdapter:'bcch-bde-api/1',sourceSnapshotSha256:'b'.repeat(64),packet}
  const oldPacket=structuredClone(packet);oldPacket.baseDate='2026-10-26'
  const registry=chileConsumptionScopes(),defs=[registry.pay,...registry.retailRegistry.definitions.slice(0,2)]
  const review={origin:'agent',status:'checked',reason:'Synthetic integration scope review; not a market finding.'}
  const rows=defs.map((d,i)=>{
    const pay=i===0,sha=(pay?'c':'d').repeat(64)
    const e={id:d.id,country:'CLP',period:'2026-08',title:'Synthetic monthly original',source:'Synthetic source',
      url:`https://www.ine.gob.cl/docs/default-source/${pay?'sueldos-y-salarios':'actividad-mensual-del-comercio'}/synthetic.pdf`,
      publishedAt:'2026-10-07',eventDate:'2026-10-07',collectedAt:'2026-10-14T10:00:00Z',review:{originalVerified:true,reuse:'unverified'},
      provenance:{pdfHash:sha,attribution:'Synthetic author',license:'Synthetic fixture only',licenseUrl:'https://example.org/synthetic',transformation:'Synthetic adaptation'},
      sourceContext:createSourceContext({blocks:[{kind:'paragraph',text:'A synthetic reviewed statement. No actual economic fact is asserted.'}],selected:[0]})}
    const card=bindEvidenceScope(e,{passageIds:['p0'],scope:d.scope,
      admittedClaims:[{id:'synthetic-claim',kind:'source_fact',text:'A synthetic monthly claim for handoff validation only.',passageIds:['p0']}],
      allowedUse:'Synthetic monthly background only; not an FX cause.',countercontext:'Synthetic background cannot establish sales outcomes.',
      excludedExpansions:['No actual company results.'],coverageGaps:[],crossSourceClaims:[]},review)
    return {e,card}
  })
  const bundles=[[rows[0]],rows.slice(1)].map(rows=>({version:'chile-monthly-evidence/1',sourceReview:'explicit_reviewer_checked',
    identity:{extractionHash:'e'.repeat(64)},evidence:rows.map(r=>r.e),evidenceScopeCards:rows.map(r=>r.card)}))
  const resources=[priceUseResource(oldPacket),...rows.map(r=>r.e)]
  const sourceUse={evaluatedOn:'2026-10-27',reviews:resources.map(r=>({version:'source-use/1',resourceId:r.id,resourceBinding:sourceUseBinding(r),
    terms:{url:'https://example.org/synthetic-terms',version:'synthetic/1',reviewedOn:'2026-10-27'},
    scope:'Synthetic same-source use policy for this test only.',review,conditions:[],uses:{
      local_analysis:{status:'allowed',reason:'Synthetic local analysis allowed for the fixture only.',conditionIds:[]},
      external_model:{status:'allowed',reason:'Synthetic model input allowed for the fixture only.',conditionIds:[]},
      public_display:{status:'pending',reason:'Synthetic public display still needs separate review.',conditionIds:[]}}}))}
  const refresh={version:'chile-monthly-refresh/1',asOf:'2026-10-27',capturedAt:'2026-10-27T02:00:00Z',
    sources:['cl-pay','cl-retail'].map(sourceId=>({sourceId,status:'collected_pending_review',latestPeriod:'2026-08',omittedCandidates:0,
      latestBasis:'registered_index_links_only',indexCollectedAt:'2026-10-27T01:59:00Z'})),
    documents:['cl-pay','cl-retail'].map((sourceId,i)=>({sourceId,period:'2026-08',sha256:(i===0?'c':'d').repeat(64),
      collectedAt:'2026-10-27T02:00:00Z',extraction:{status:'extracted_pending_review',extractionHash:'e'.repeat(64)}}))}
  return {priceInput,previousPrepared:{packet:oldPacket},reviewedMonthly:{version:'chile-monthly-review-run/1',bundles},
    sourceUse,refresh,asOf:'2026-10-27T12:00:00+09:00'}
}
afterEach(()=>vi.unstubAllGlobals())

describe('One-run preparation and pre-writing roles',()=>{
  it('joins fresh selection to unchanged reviewed bytes while preserving original capture and blocking generation',()=>{
    const x=fixture(),before=structuredClone(x),network=vi.fn(()=>{throw new Error('outbound forbidden')})
    vi.stubGlobal('fetch',network)
    const r=prepareLatestReportInput(x)
    expect(r.selection.sources.every(s=>s.status==='reviewed_original_unchanged')).toBe(true)
    expect(r.materials.contentReviewMaterials).toHaveLength(3)
    expect(r.materials.items[0].collectedAt).toBe('2026-10-14T10:00:00Z')
    expect(r.materials.questions.find(q=>q.id==='consumer')!.latestness).toBe('latest_registered_indexes_confirmed')
    expect(r.materials.price.uses.external_model.status).toBe('allowed')
    expect(r.generationRequest).toBeNull();expect(r.publicationApproved).toBe(false)
    expect(r.priceAssessment).toMatchObject({sourceCapture:'validated_projected_snapshot',rollingWindows:'partial'})
    const prompt=r.inputReviewPacket.input
    expect(prompt.evidence).toHaveLength(3);expect(prompt.scopeCards).toHaveLength(3)
    expect(r.writerPlan.model).toBeNull()
    expect(r.writerPlan.request).toBeNull()
    expect(r.writerPlan.automaticPurposeFallback).toBe(false)
    expect(x).toEqual(before);expect(network).not.toHaveBeenCalled()
  })
  it.each([
    ['new month',(x:ReturnType<typeof fixture>)=>{x.refresh.sources[0].latestPeriod='2026-09';x.refresh.documents[0].period='2026-09'},'new_period_or_revised_original'],
    ['revised PDF',(x:ReturnType<typeof fixture>)=>{x.refresh.documents[0].sha256='f'.repeat(64)},'new_period_or_revised_original'],
    ['extraction failure',(x:ReturnType<typeof fixture>)=>{x.refresh.documents[0].extraction.status='extraction_failed'},'latest_extraction_failed'],
    ['changed extractor output',(x:ReturnType<typeof fixture>)=>{x.refresh.documents[0].extraction.extractionHash='f'.repeat(64)},'extraction_identity_changed'],
  ])('holds %s without copying an old review onto a new source',(_label,change,reason)=>{
    const x=fixture();change(x)
    const r=prepareLatestReportInput(x)
    expect(r.selection.sources.find(s=>s.sourceId==='cl-pay')!.reason).toBe(reason)
    expect(r.materials.contentReviewMaterials).toHaveLength(2)
    expect(r.materials.contentReviewMaterials.some(e=>e.id==='cl-ir-real')).toBe(false)
    expect(r.status).toBe('hold_before_generation')
  })
  it('keeps differing newest periods distinct and refuses silently falling back to an older common month',()=>{
    const x=fixture();x.refresh.sources[0].latestPeriod='2026-09';x.refresh.documents[0].period='2026-09'
    const r=prepareLatestReportInput(x)
    expect(r.selection).toMatchObject({alignment:'different_latest_periods',comparisonPeriod:null})
    expect(r.holds).toContain('different_latest_periods')
    expect(r.materials.consumerNeeds).toBeNull()
  })
  it('requires adjudication of multiple versions and retains a source failure as failure',()=>{
    const x=fixture();x.refresh.documents.push({...x.refresh.documents[0],sha256:'f'.repeat(64)})
    expect(prepareLatestReportInput(x).selection.sources.find(s=>s.sourceId==='cl-pay')!.reason).toBe('multiple_latest_versions')
    const y=fixture();Object.assign(y.refresh.sources[0],{status:'index_failed',reason:'transport_or_redirect_error',indexCollectedAt:null})
    expect(prepareLatestReportInput(y).selection.sources.find(s=>s.sourceId==='cl-pay')).toMatchObject({status:'source_unavailable',reason:'transport_or_redirect_error',absenceProven:false})
  })
  it('does not carry a series policy into another methodology or currency scope',()=>{
    const x=fixture();x.priceInput.packet.marketData.reportPriceBasis.methodology.sha256='f'.repeat(64)
    expect(()=>prepareLatestReportInput(x)).toThrow('price_policy_scope_changed')
  })
  it('uses the Korean report day and keeps actual transaction dates and later captures distinct',()=>{
    expect(koreanReportCutoff('2026-10-26T23:32:00Z')).toBe('2026-10-27T08:32:00.000+09:00')
    const x=fixture();x.refresh.sources[0].indexCollectedAt='2026-10-27T05:00:00Z'
    expect(prepareLatestReportInput(x).selection.sources.find(s=>s.sourceId==='cl-pay')!.reason).toBe('index_capture_time_unverified')
    expect(()=>koreanReportCutoff('invalid')).toThrow('invalid_preparation_clock')
  })
  it('ties the role split to the existing reviewer and separates mandatory corrections from style',()=>{
    const r=prepareLatestReportInput(fixture())
    expect(r.reviewerPlan.contract).toBe(CLAIM_REVIEW_VERSION)
    expect(r.reviewerPlan.instructions).toBe(CLAIM_REVIEW_INSTRUCTIONS)
    expect(WRITING_ROLES.reviewer.requiredCorrections).toContain('observation_time')
    expect(WRITING_ROLES.reviewer.editorialRefinements).toContain('supported_but_abstract_title')
    expect(r.reviewerPlan.automaticRewriteAuthorized).toBe(false)
    expect(r.holds).toContain('new_information_value_not_reviewed')
  })
})
