import {expect,it} from 'vitest'
import {buildSharedDashboardPriceSnapshot} from './shared-price-contract.js'
import {fingerprint} from './research-harness.js'
import {prepareSharedWritingBrief} from './shared-writing-brief.js'

// Software-only projected claims, not original-reviewed historical evidence.
function fixture(currency='BRL'){
 const dataset={baseDate:'2026-10-28',fetchedAt:'2026-10-28T02:00:00Z',dailyRates:[27,28].map(day=>({currency,date:`2026-10-${day}`,
  rateType:'LOCAL_PER_USD',value:day===27?100:101,status:'ok',source:'API',imputationMethod:'NONE'}))}
 const snapshot=buildSharedDashboardPriceSnapshot({dataset,currency,asOf:'2026-10-28T12:00:00Z'})
 const base={evidenceId:'news-synthetic',publisher:'Synthetic publisher',sourceUrl:'https://example.org/synthetic',publishedAt:'2026-10-27',
  collectedAt:'2026-10-28T01:00:00Z',referencePeriod:'2026-10-27',sourceSessionDate:'2026-10-27',scope:{subject:currency},
  articlePriceBasis:'Synthetic article quote, not a reference value.',sourceCredit:null,evidenceBinding:'a'.repeat(64),scopeBinding:'b'.repeat(64),
  allowedUse:'Synthetic stated scope only.',countercontext:'Synthetic condition retained.',excludedExpansions:[],coverageGaps:[],crossSourceClaims:[],attributions:[],
  sourceUses:{external_model:{status:'allowed'}},privateOriginalBody:'RAW-DO-NOT-COPY'}
 const connection={version:'reference-materials/2',ruleVersion:snapshot.ruleVersion,currency,referenceSnapshotId:snapshot.snapshotId,
  referenceDate:'2026-10-28',commentaryDate:'2026-10-27',sections:{market_observation:[{...base,role:'market_observation',claimId:'n0',
   kind:'source_fact',text:'Synthetic observed direction.'}],attributed_fx_explanation:[{...base,role:'attributed_fx_explanation',claimId:'n1',
   kind:'source_interpretation',text:'Synthetic attributed explanation.'}]},holds:[],archive:[],held:[]}
 return {materialConnection:{...connection,binding:fingerprint(connection)},reportPriceSnapshot:snapshot,
  priorApproval:{authorized:true},originalResponse:'PRIVATE-OLD-RESPONSE',oldQualityScore:5,request:{mustNotExecute:true}}
}
it('prepares the same shared-basis review contract for six currencies with unique references and no raw body, old score or approval',()=>{
 for(const currency of ['BRL','MXN','COP','PEN','CLP','ARS']){
  const handoff=fixture(currency),before=structuredClone(handoff),brief=prepareSharedWritingBrief({handoff})
  expect(brief.status).toBe('review_brief_prepared_not_executable')
  expect(brief.material.facts.map(f=>f.value)).toEqual([101,100,1])
  expect(new Set(brief.material.claims.map(c=>c.claimId)).size).toBe(2)
  expect(brief.writerProfile.model).toBe('openai/gpt-6.1-sol')
  expect(brief).toMatchObject({request:null,exactTrialBudgetUsd:null,paidCallAuthorized:false,publicationApproved:false,modelCalls:0})
  const text=JSON.stringify(brief);expect(text).not.toContain('RAW-DO-NOT-COPY');expect(text).not.toContain('PRIVATE-OLD-RESPONSE')
  expect(text).not.toContain('oldQualityScore');expect(handoff).toEqual(before)
 }
})
it('keeps material/use/date/price holds separate from having a draft input, without substituting archived material or another price',()=>{
 const handoff=fixture(),connection=handoff.materialConnection
 connection.holds=['unresolved_original_support'];connection.sections.attributed_fx_explanation[0].sourceSessionDate='2026-10-26'
 connection.sections.market_observation[0].sourceUses.external_model.status='pending'
 const {binding:_binding,...bound}=connection;expect(_binding).toBeTruthy();connection.binding=fingerprint(bound)
 const brief=prepareSharedWritingBrief({handoff})
 expect(brief.status).toBe('material_brief_held');expect(brief.material).toBeNull()
 expect(brief.holds).toEqual(['unresolved_original_support','authored_note_use_not_allowed','current_claim_session_mismatch'])
 expect(brief.request).toBeNull()
})
it('rejects a changed price projection or stale material hash instead of falling back to historical article-price requests',()=>{
 const changed=fixture();changed.reportPriceSnapshot.current.value=999
 expect(()=>prepareSharedWritingBrief({handoff:changed})).toThrow('shared_snapshot_numeric_projection_mismatch')
 const stale=fixture();stale.materialConnection.sections.market_observation[0].text+=' changed'
 expect(()=>prepareSharedWritingBrief({handoff:stale})).toThrow('bound_shared_writing_material_required')
})
