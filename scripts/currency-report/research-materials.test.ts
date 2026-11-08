import {afterEach,describe,expect,it,vi} from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {syntheticCase} from './rule-fixtures.js'
import {packetBinding} from './rules.js'
import {evidenceBinding,HARNESS_VERSION} from './research-harness.js'
import {bindEvidenceScope} from './evidence-scope.js'
import {createSourceContext} from './source-context.js'
import {chileConsumptionScopes} from './chile-consumption-scopes.js'
import {inspectSourceUses,sourceUseBinding,SOURCE_USE_VERSION} from './source-use.js'
import {prepareResearchMaterials,priceUseResource} from './research-materials.js'
import {reviewMaterialsLocal} from './research-materials-local.js'

// All claims and use decisions below are synthetic contract fixtures, not real
// market facts, permissions or report-quality samples.
const review={origin:'agent',status:'checked',reason:'Synthetic scope judgment for this integration test only.'}
function evidence(id:string,scope:Record<string,string>,period:string) {
  const e={id,country:'CLP',period,title:'Synthetic material; not actual market evidence',source:'Synthetic official source',
    url:`https://www.ine.gob.cl/synthetic/${id}`,publishedAt:'2026-10-20T10:00:00Z',eventDate:'2026-10-23',
    collectedAt:'2026-10-26T10:00:00Z',review:{originalVerified:true,reuse:'unverified'},
    provenance:{attribution:'Synthetic author',license:'Synthetic test licence',licenseUrl:'https://example.org/synthetic',transformation:'Synthetic translation',
      receiptHash:'synthetic-private-receipt',reviewerName:'Synthetic private reviewer'},
    sourceContext:createSourceContext({blocks:[{kind:'paragraph',text:'Synthetic limited interpretation. This is not an actual source statement.'}],selected:[0]})}
  const card=bindEvidenceScope(e,{passageIds:['p0'],scope,
    admittedClaims:[{id:'synthetic-claim',kind:'source_interpretation',text:'Synthetic scope claim for testing this handoff boundary.',passageIds:['p0']}],
    allowedUse:'Only the synthetic scope, not direct causality.',countercontext:'The synthetic interpretation is not a real economic conclusion.',
    excludedExpansions:['No company results or causal certainty.'],coverageGaps:[],crossSourceClaims:[]},review)
  return {e,card}
}
function useRecord(resource: {id:string}) {
  return {version:SOURCE_USE_VERSION,resourceId:resource.id,resourceBinding:sourceUseBinding(resource),
    terms:{url:'https://example.org/synthetic-terms',version:'synthetic-test-only/1',reviewedOn:'2026-10-27'},
    scope:'Synthetic resource use judgment; does not grant actual permission.',review,
    conditions:[{id:'public-display',text:'Synthetic publication conditions have not yet been implemented.',status:'pending'}],
    uses:{local_analysis:{status:'allowed',reason:'Synthetic local analysis is allowed in this fixture.',conditionIds:[]},
      external_model:{status:'allowed',reason:'Synthetic external input condition is recorded in this fixture.',conditionIds:[]},
      public_display:{status:'allowed',reason:'Synthetic publication still requires its display condition.',conditionIds:['public-display']}}}
}
function fixture() {
  const packet={...syntheticCase('CLP').packet,baseDate:'2026-10-26',observedDate:'2026-10-23',evidence:[] as ReturnType<typeof evidence>['e'][],evidenceScopeCards:[] as ReturnType<typeof evidence>['card'][]}
  const m=evidence('synthetic-market',{subject:'Synthetic market context',metric:'market',unit:'qualitative',comparison:'not_applicable'},'2026-10-23')
  m.e.publishedAt='2026-10-23T12:00:00Z'
  // The fixture's changed publication requires a new scope binding.
  const {review:r,...draft}=m.card;m.card=bindEvidenceScope(m.e,draft,r)
  packet.evidence=[m.e];packet.evidenceScopeCards=[m.card]
  const dossier={version:HARNESS_VERSION,packetHash:packetBinding(packet),cards:['market','local','global','counter'].map(q=>({
    id:`synthetic-${q}`,questionId:q,evidenceId:m.e.id,evidenceHash:evidenceBinding(m.e),passageIds:['p0'],
    statement:'Synthetic source-attributed interpretation for integration testing.',allowedUse:'Synthetic context only; never direct causality.',
    limit:'No real-world company or causal conclusion.',kind:'attributed_interpretation',attribution:'Synthetic analyst',
    eventKey:'synthetic-event',independenceKey:'synthetic-source',relation:q==='counter'?'qualifies':'supports',timeScope:'earlier_context',review}))}
  const prepared={version:'publisher-admission/1',packet,dossier}
  const registry=chileConsumptionScopes(),definitions=[registry.pay,...registry.retailRegistry.definitions.slice(0,2)]
  const entries=definitions.map(d=>evidence(`synthetic-${d.id}`,d.scope,'2026-08'))
  const monthlyBundles=[[entries[0]],entries.slice(1)].map(rows=>({
    version:'chile-monthly-evidence/1',evidence:rows.map(x=>x.e),evidenceScopeCards:rows.map(x=>x.card),sourceReview:'explicit_reviewer_checked'}))
  const resources=[priceUseResource(packet),m.e,...monthlyBundles.flatMap(b=>b.evidence)]
  return {prepared,monthlyBundles,sourceUse:{evaluatedOn:'2026-10-27',reviews:resources.map(useRecord)},
    asOf:'2026-10-26T23:59:59Z',consumerPeriod:'2026-08'}
}
afterEach(()=>vi.unstubAllGlobals())

describe('Source-use and collection handoff responsibilities',()=>{
  it('separates model input, denied use, unresolved display conditions and a missing scoped review',()=>{
    const resource={id:'synthetic-resource',value:1},r=useRecord(resource)
    r.uses.local_analysis.status='denied'
    const result=inspectSourceUses({resources:[resource,{id:'unreviewed-resource'}],reviews:[r],evaluatedOn:'2026-10-27'})
    expect(result.items[0].uses).toMatchObject({external_model:{status:'allowed'},local_analysis:{status:'denied'},
      public_display:{status:'pending',pendingConditionIds:['public-display']}})
    expect(result.items[1].uses.external_model.reason).toBe('source_use_review_missing')
    expect(result.meaningVerified).toBe(false)
  })
  it('invalidates a changed source binding and rejects ambiguous or dangling use records',()=>{
    const resource={id:'synthetic-resource',value:1},r=useRecord(resource)
    const run=(resources=[resource],reviews=[r])=>inspectSourceUses({resources,reviews,evaluatedOn:'2026-10-27'})
    expect(run([{...resource,value:2}]).items[0]).toMatchObject({reviewStatus:'binding_changed',uses:{external_model:{status:'pending'}}})
    expect(()=>run([resource],[r,r])).toThrow('invalid_source_use_input')
    const broken=structuredClone(r);broken.uses.external_model.conditionIds=['missing-condition']
    expect(()=>run([resource],[broken])).toThrow('invalid_source_use_review')
    const future=structuredClone(r);future.terms.reviewedOn='2026-10-28'
    expect(()=>run([resource],[future])).toThrow('invalid_source_use_review')
  })
  it('reuses reviewed monthly scopes without rewriting old reuse flags or granting writing approval',()=>{
    const x=fixture(),before=structuredClone(x),network=vi.fn(()=>{throw new Error('network forbidden')})
    vi.stubGlobal('fetch',network)
    const r=prepareResearchMaterials(x)
    expect(r.materialStatus).toBe('ready_for_content_review')
    expect(r.consumerNeeds.questions.filter(q=>!q.required).map(q=>[q.id,q.status])).toEqual([['consumption','available'],['category','available']])
    expect(r.contentReviewMaterials).toHaveLength(4)
    expect(r.questions.find(q=>q.id==='consumer')).toMatchObject({status:'usable_for_content_review',period:'2026-08',latestness:'not_assessed'})
    expect(r.items.every(i=>i.sourceUse.public_display.status==='pending')).toBe(true)
    expect(r.writingEligibility.eligible).toBe(false)
    expect(r.publicationApproved).toBe(false)
    expect(x).toEqual(before);expect(network).not.toHaveBeenCalled()
    expect(JSON.stringify(r.contentReviewMaterials)).not.toMatch(/receiptHash|reviewerName|resourceBinding/)
  })
  it('keeps usable statistics when media transfer is unresolved and does not schedule duplicate searches',()=>{
    const x=fixture();x.sourceUse.reviews.find(r=>r.resourceId==='synthetic-market')!.uses.external_model.status='pending'
    const r=prepareResearchMaterials(x)
    expect(r.materialStatus).toBe('incomplete')
    expect(r.questions.filter(q=>q.required).every(q=>q.status==='material_review_required')).toBe(true)
    expect(r.contentReviewMaterials.map(m=>m.id)).not.toContain('synthetic-market')
    expect(r.contentReviewMaterials).toHaveLength(3)
    expect(r.consumerNeeds.questions.filter(q=>!q.required).every(q=>q.status==='available')).toBe(true)
    const missing=fixture();missing.sourceUse.reviews=missing.sourceUse.reviews.filter(r=>r.resourceId==='official-price')
    const pending=prepareResearchMaterials(missing)
    expect(pending.contentReviewMaterials).toEqual([])
    expect(pending.consumerNeeds.questions.filter(q=>!q.required).map(q=>q.action)).toEqual(['review_inventory','review_inventory'])
    expect(pending.consumerNeeds.discoveryRequests).toEqual([])
  })
  it('does not let a renewed use review override a later revision or pretend an unreviewed month is ready',()=>{
    const x=fixture(),e=x.monthlyBundles[0].evidence[0]
    Object.assign(e,{modifiedAt:'2026-10-27T10:00:00Z'})
    x.sourceUse.reviews.find(r=>r.resourceId===e.id)!.resourceBinding=sourceUseBinding(e)
    const r=prepareResearchMaterials(x)
    expect(r.items.find(i=>i.evidenceId===e.id)).toMatchObject({temporalIssue:'historical_version_unverified',usableForContentReview:false})
    expect(r.consumerNeeds.questions.find(q=>q.id==='consumption').status).toBe('research_needed')
    const next=prepareResearchMaterials({...fixture(),consumerPeriod:'2026-09'})
    expect(next.consumerNeeds.questions.filter(q=>!q.required).every(q=>q.action==='define_scope')).toBe(true)
  })
  it('writes each saved-input run privately and refuses files outside the private root',async()=>{
    const x=fixture(),workspace=await fs.mkdtemp(path.join(os.tmpdir(),'materials-test-'))
    const root=path.join(workspace,'.local-reports','private');await fs.mkdir(root,{recursive:true})
    const input=path.join(root,'input.json'),monthly=path.join(root,'monthly.json'),uses=path.join(root,'uses.json')
    await fs.writeFile(input,JSON.stringify(x.prepared));await fs.writeFile(monthly,JSON.stringify({version:'chile-monthly-review-run/1',bundles:x.monthlyBundles}))
    await fs.writeFile(uses,JSON.stringify(x.sourceUse))
    const args={workspace,input,monthly,uses,asOf:x.asOf,period:x.consumerPeriod},first=await reviewMaterialsLocal(args),second=await reviewMaterialsLocal(args)
    expect(first.file).not.toBe(second.file)
    const saved=JSON.parse(await fs.readFile(path.join(workspace,first.file),'utf8'))
    expect(saved).toMatchObject({version:'research-materials/1',networkCalls:0,modelCalls:0,publicationApproved:false})
    await expect(reviewMaterialsLocal({...args,input:path.join(workspace,'outside.json')})).rejects.toThrow()
    const outside=path.join(workspace,'outside.json');await fs.writeFile(outside,JSON.stringify(x.prepared))
    await expect(reviewMaterialsLocal({...args,input:outside})).rejects.toThrow('private_material_input_required')
  })
})
