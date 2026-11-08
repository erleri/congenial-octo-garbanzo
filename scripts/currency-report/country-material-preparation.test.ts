import {describe,it,expect,vi} from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createReviewedNewsEvidence} from './reviewed-news-notes.js'
import {bindEvidenceScope} from './evidence-scope.js'
import {sourceUseBinding} from './source-use.js'
import {prepareCountryMaterials,materialRoleBinding} from './country-material-preparation.js'
import {prepareCountryMaterialsLocal} from './country-material-preparation-local.mjs'
import {materialSelectionBinding} from './material-selection.js'

// Synthetic boundary fixtures. Saved country evidence is replayed separately;
// these tests are not historical examples or report-quality samples.
function input(currency='COP',suffix='source') {
 const review={origin:'agent',status:'checked',reason:'Synthetic test judgment of source attribution and comparison, not real research.'}
 const e=createReviewedNewsEvidence({id:`news-synthetic-${suffix}`,country:currency,publisher:'Synthetic publisher',author:'Synthetic author',
  url:`https://example.org/${suffix}`,publishedAt:'2026-10-26T18:00:00Z',publicationDisplay:'Synthetic 26 October',eventDate:'2026-10-26',collectedAt:'2026-10-27T01:00:00Z'},
  [{id:'n0',kind:'fact',text:'합성 시장 관측은 지정한 현물 기준에 한정한다.',attribution:null,reportedPrice:null},
   {id:'n1',kind:'attributed_view',text:'합성 전문가의 시장 설명이며 공식 원인 확정이 아니다.',attribution:{person:'Synthetic analyst',organization:'Synthetic institution'},reportedPrice:null}],
  {...review,supportingContentChecked:true,contentAccess:'publisher_page',independentlyWorded:true,notTranslation:true,notArticleSubstitute:true,checkedOn:'2026-10-28'})
 const scope=bindEvidenceScope(e,{passageIds:['n0','n1'],scope:{subject:currency,metric:'spot_market',unit:'local_per_USD',comparison:'source_observation'},
  admittedClaims:[{id:'market',kind:'source_fact',text:e.newsNotes.notes[0].text,passageIds:['n0']},{id:'driver',kind:'source_interpretation',text:e.newsNotes.notes[1].text,passageIds:['n1']}],
  allowedUse:'검토된 합성 사실과 귀속 견해의 범위만 사용한다.',countercontext:'합성 비교이며 실제 역사 자료로 사용하지 않는다.',excludedExpansions:[],coverageGaps:[],crossSourceClaims:[]},review)
 const record={evidenceId:e.id,claimRoles:{market:'market_observation',driver:'attributed_fx_explanation'},sessionDate:'2026-10-26',review,
  provenance:{mode:'saved_capture',locator:'Synthetic original capture identity, not a real report source.'},priceBasis:'Synthetic same-session spot market quote, separate from TRM.'}
 const judgment={version:'source-use/1',resourceId:e.id,resourceBinding:sourceUseBinding(e),terms:{url:e.url,version:'synthetic/1',reviewedOn:'2026-10-28'},
  scope:'합성 검증 자료만 사용하며 실제 사이트의 이용 허가가 아니다.',review,conditions:[],
  uses:Object.fromEntries(['local_analysis','external_model','public_display'].map(k=>[k,{status:k==='public_display'?'pending':'allowed',reason:'합성 범위의 검증 판단이며 실제 게시나 유료 호출 승인은 아니다.',conditionIds:[]}]))}
 return {currency,baseDate:'2026-10-28',asOf:'2026-10-28T01:00:00Z',packet:{currency,baseDate:'2026-10-28',observedDate:'2026-10-26',evidence:[e],evidenceScopeCards:[scope]},
  materials:[{record,binding:materialRoleBinding(e,record)}],sourceUse:{evaluatedOn:'2026-10-28',reviews:[judgment]},attempts:[]}
}
function roleChange(value:ReturnType<typeof input>,change:(record:ReturnType<typeof input>['materials'][number]['record']&{bodyAvailableAt?:string;historicalAvailability?:string})=>void) {
 change(value.materials[0].record)
 value.materials[0].binding=materialRoleBinding(value.packet.evidence[0],value.materials[0].record)
 return value
}
describe('Country materials handoff boundaries',()=>{
 it.each(['BRL','COP','PEN','ARS','CLP','MXN'])('prepares %s without treating source presence as verified price, new publication or a paid request',currency=>{
  const value=input(currency),before=structuredClone(value),spy=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('forbidden'))
  try {
   const result=prepareCountryMaterials(value)
   expect(result.sections.market_observation[0].sessionDate).toBe('2026-10-26')
   expect(result.sections.attributed_fx_explanation[0].attributions[0].attribution.person).toBe('Synthetic analyst')
   expect(result.holds).toContain('verified_price_pair_and_fx_cause_review_required')
   expect(result).toMatchObject({request:null,publicationDecision:null,publicationApproved:false,paidCallAuthorized:false,modelCalls:0,networkCalls:0,newPaidCostUsd:0})
   expect(spy).not.toHaveBeenCalled();expect(value).toEqual(before)
  }finally{spy.mockRestore()}
 })
 it('keeps global context distinct from an explanation of the local currency',()=>{
  const value=roleChange(input(),r=>{r.claimRoles.driver='global_context'})
  const result=prepareCountryMaterials(value)
  expect(result.sections.global_context).toHaveLength(1)
  expect(result.holds).toContain('attributed_currency_explanation_missing')
 })
 it('does not promote a factual price comparison into an attributed cause',()=>{
  const value=roleChange(input(),r=>{r.claimRoles.market='attributed_fx_explanation'})
  expect(prepareCountryMaterials(value).outcomes[0].holds).toContain('explicit_attributed_connection_required')
 })
 it('holds a revised close unavailable by the cutoff rather than borrowing the initial publication time',()=>{
  const value=roleChange(input(),r=>{r.bodyAvailableAt='2026-10-28T02:00:00Z'})
  expect(prepareCountryMaterials(value).outcomes[0].holds).toContain('body_version_after_cutoff')
 })
 it('does not reuse an adjacent trading session or an unknown historical body as the case session',()=>{
  const value=roleChange(input(),r=>{r.sessionDate='2026-10-23';r.historicalAvailability='unverified'})
  expect(prepareCountryMaterials(value).outcomes[0].holds).toEqual(['market_session_mismatch','historical_body_availability_unverified'])
 })
 it('retains source-use uncertainty even when source and content checks pass',()=>{
  const value=input();value.sourceUse.reviews[0].uses.external_model.status='pending'
  const result=prepareCountryMaterials(value)
  expect(result.holds).toContain('external_source_use_pending:news-synthetic-source')
  expect(result.outcomes[0].publicDisplay).toBe('pending')
 })
 it('includes the bound credit in the actual country handoff and holds it if the credit is omitted',()=>{
  const value=input(),e=value.packet.evidence[0],r=value.sourceUse.reviews[0]
  const n={version:'source-attribution/1',resourceId:e.id,resourceBinding:sourceUseBinding(e),sourceUrl:e.url,publisher:e.publisher,
   publishedAt:e.publishedAt,referencePeriod:e.period,attribution:'Source: Synthetic publisher; Synthetic analyst, Synthetic institution.',transformation:'Synthetic independently worded note; source article not reproduced.'}
  const sourceUse={...value.sourceUse,attributionNotes:[n],reviews:[{...r,conditions:[{id:'credit',text:'Preserve this source credit in the generated handoff.',status:'satisfied',delivery:{field:'attribution',equals:n.attribution,uses:['external_model','public_display']}}],
   uses:{...r.uses,external_model:{...r.uses.external_model,conditionIds:['credit']}}}]}
  const result=prepareCountryMaterials({...value,sourceUse})
  expect(result.externalSourceAttributions[0].attribution).toBe(n.attribution)
  expect(result.outcomes[0]).toMatchObject({externalModel:'allowed',publicDisplay:'pending'})
  expect(prepareCountryMaterials({...value,sourceUse:{...sourceUse,attributionNotes:[]}}).holds).toContain('external_source_use_pending:news-synthetic-source')
 })
 it('requires re-review of changed content or roles, not a prior binding',()=>{
  const value=input();value.materials[0].record.claimRoles.driver='global_context'
  expect(()=>prepareCountryMaterials(value)).toThrow('unreviewed_country_material_role')
  const tampered=input();tampered.packet.evidence[0].summary='기존 검토 내용 대신 새 설명을 삽입한 변경이다.'
  expect(()=>prepareCountryMaterials(tampered)).toThrow('stale')
 })
 it('rejects a different country cause packet before it can inherit a successful review',()=>{
  const value=input()
  expect(()=>prepareCountryMaterials({...value,causeContext:{packet:{...value.packet,currency:'CLP'}}})).toThrow('country_cause_context_mismatch')
 })
 it('rejects credentials or prompt instructions inside acquisition errors instead of copying them into the handoff',()=>{
  const value=input()
  expect(()=>prepareCountryMaterials({...value,attempts:[{sourceId:'example',status:'access_failed',reason:'https://example.org/?token=synthetic-secret'}]})).toThrow('unsafe_material_record')
 })
 it('stores a new private handoff twice without overwriting the first, and refuses input from outside private storage',async()=>{
  const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'country-material-test-'))
  if(path.dirname(workspace)!==os.tmpdir()||!path.basename(workspace).startsWith('country-material-test-'))throw new Error('unsafe_test_cleanup')
  try {
   const privateRoot=path.join(workspace,'.local-reports','private');await fs.mkdir(privateRoot,{recursive:true})
   const file=path.join(privateRoot,'input.json');await fs.writeFile(file,JSON.stringify(input()))
   const first=await prepareCountryMaterialsLocal({workspace,input:file}),bytes=await fs.readFile(path.join(first.directory,'prepared.json'),'utf8')
   const second=await prepareCountryMaterialsLocal({workspace,input:file})
   expect(first.directory).not.toBe(second.directory);expect(await fs.readFile(path.join(first.directory,'prepared.json'),'utf8')).toBe(bytes)
   const publicInput=path.join(workspace,'public.json');await fs.copyFile(file,publicInput)
   await expect(prepareCountryMaterialsLocal({workspace,input:publicInput})).rejects.toThrow('private_material_input_required')
  }finally{await fs.rm(workspace,{recursive:true,force:true})}
 })
})

function selectionFixture() {
 const core=input('BRL'),bg=roleChange(input('BRL','background'),r=>{
  r.claimRoles.market='consumer_background';r.claimRoles.driver='consumer_background'
 })
 bg.sourceUse.reviews[0].uses.external_model.status='pending'
 return {...core,packet:{...core.packet,evidence:[...core.packet.evidence,...bg.packet.evidence],
  evidenceScopeCards:[...core.packet.evidenceScopeCards,...bg.packet.evidenceScopeCards]},
  materials:[...core.materials,...bg.materials],sourceUse:{...core.sourceUse,reviews:[...core.sourceUse.reviews,...bg.sourceUse.reviews]}}
}
function selectionFor(value:ReturnType<typeof selectionFixture>) {
 return {version:'material-selection/1',inputBinding:materialSelectionBinding(value),
  review:{origin:'agent',status:'checked',reason:'합성 입력의 독립 소비 배경을 제외하는 검토이며 실제 발행 승인이 아니다.'},
  decisions:value.packet.evidence.map((e,i)=>({evidenceId:e.id,requirement:i?'optional':'required',action:i?'exclude':'include',
   reason:i?'합성 소비 배경은 이번 환율 설명의 필수 근거가 아니므로 제외한다.':'가격과 원인 설명을 담은 핵심 자료는 그대로 보존한다.'}))}
}
describe('Explicit material selection safety',()=>{
 it('excludes independent pending background, preserving core, original and mandatory review holds',()=>{
  const value=selectionFixture(),before=structuredClone(value),selection=selectionFor(value)
  const baseline=prepareCountryMaterials(value),result=prepareCountryMaterials({...value,selection})
  expect(baseline.holds).toContain('external_source_use_pending:news-synthetic-background')
  expect(result.holds).not.toContain('external_source_use_pending:news-synthetic-background')
  expect(result.holds).toContain('selected_packet_content_review_required')
  expect(result.holds).toContain('verified_price_pair_and_fx_cause_review_required')
  expect(result.sections.market_observation).toEqual(baseline.sections.market_observation)
  expect(JSON.stringify(result.sections)).not.toContain('news-synthetic-background')
  expect(result.externalSourceAttributions.some(n=>n.resourceId==='news-synthetic-background')).toBe(false)
  expect(result).toMatchObject({request:null,publicationApproved:false,modelCalls:0})
  expect(value).toEqual(before)
 })
 it('refuses a stale decision or a missing source decision rather than guessing optional status',()=>{
  const value=selectionFixture(),selection=selectionFor(value)
  expect(()=>prepareCountryMaterials({...value,selection:{...selection,inputBinding:'0'.repeat(64)}})).toThrow('bound_material_selection')
  expect(()=>prepareCountryMaterials({...value,selection:{...selection,decisions:selection.decisions.slice(1)}})).toThrow('bound_material_selection')
 })
 it('cannot exclude market evidence by merely labeling it optional',()=>{
  const value=selectionFixture(),selection=selectionFor(value)
  selection.decisions[0]={...selection.decisions[0],requirement:'optional',action:'exclude'}
  expect(()=>prepareCountryMaterials({...value,selection})).toThrow('required_material_cannot_be_excluded')
 })
 it('preserves a mixed counterargument even if other claims in that source are background',()=>{
  const value=selectionFixture(),m=value.materials[1],e=value.packet.evidence[1]
  m.record.claimRoles.driver='countercontext';m.binding=materialRoleBinding(e,m.record)
  expect(()=>prepareCountryMaterials({...value,selection:selectionFor(value)})).toThrow('required_material_cannot_be_excluded')
 })
 it('blocks exclusion of evidence needed by a retained cross-source relationship',()=>{
  const value=selectionFixture(),e=value.packet.evidence[0],card=value.packet.evidenceScopeCards[0]
  value.packet.evidenceScopeCards[0]=bindEvidenceScope(e,{...card,crossSourceClaims:[{subject:'합성 핵심 관계는 두 자료의 비교를 함께 요구한다.',requiredEvidenceIds:value.packet.evidence.map(e=>e.id)}]},card.review)
  expect(()=>prepareCountryMaterials({...value,selection:selectionFor(value)})).toThrow('excluded_material_still_required_by_claim')
 })
 it('validates even an excluded original rather than hiding an invalid source binding',()=>{
  const value=selectionFixture();value.materials[1].binding='0'.repeat(64)
  expect(()=>prepareCountryMaterials({...value,selection:selectionFor(value)})).toThrow('unreviewed_country_material_role')
 })
 it('requires explicit projection support for rich packets instead of leaking a background fact',()=>{
  const value={...selectionFixture(),packet:{...selectionFixture().packet,facts:[{id:'retail',value:3}]}}
  expect(()=>prepareCountryMaterials({...value,selection:selectionFor(value)})).toThrow('material_selection_requires_preparation_packet')
 })
 it('does not add a content-review hold for an all-included decision',()=>{
  const value=selectionFixture(),selection=selectionFor(value)
  selection.decisions=selection.decisions.map(d=>({...d,action:'include'}))
  const result=prepareCountryMaterials({...value,selection})
  expect(result.holds).toEqual(prepareCountryMaterials(value).holds)
  expect(result.materialSelection.contentReviewRequired).toBe(false)
 })
})
