import {afterEach,describe,expect,it,vi} from 'vitest'
import {assessFxCauseInput,fxCauseBinding,verifiedFxMovement,FX_CAUSE_VERSION} from './fx-cause-input.js'
import {prepareEventTrial,executeApprovedEventTrial} from './lifecycle-control.js'
import {createSourceContext} from './source-context.js'
import {packetBinding} from './rules.js'
import {evidenceBinding,HARNESS_VERSION} from './research-harness.js'
import {sourceUseBinding} from './source-use.js'
import {priceUseResource} from './research-materials.js'

type SyntheticEvidence={id:string;country:string;eventDate:string;publishedAt:string;title:string;
  source:string;publisher:string;provenance:string;url:string;review:{originalVerified:boolean;scope:string};
  sourceContext:ReturnType<typeof createSourceContext>}

// Synthetic source and meaning judgments. Not a historical market evaluation.
function fixture() {
  const packet={currency:'CLP',baseDate:'2026-10-16',observedDate:'2026-10-15',observationAt:null,
    facts:[{id:'spot',value:980,label:'Synthetic rate 980'},{id:'day',value:(980/984-1)*100,label:'Synthetic decline'},
      {id:'five',value:0,label:'Synthetic unchanged'},{id:'mtd',value:0,label:'Synthetic unchanged'}],
    series:[{date:'2026-10-14',value:984},{date:'2026-10-15',value:980}],limitations:[],evidence:[] as SyntheticEvidence[],
    marketData:{reportPriceBasis:{provider:'Synthetic BCCh',seriesId:'F073.TCO.PRE.Z.D',
      priceKind:'official_transaction_weighted_average',dateBasis:'underlying_local_transaction_day',timeZone:'America/Santiago',
      methodology:{sha256:'a'.repeat(64)},observations:[
        {localSessionDate:'2026-10-14',effectiveDate:'2026-10-15',value:984},
        {localSessionDate:'2026-10-15',effectiveDate:'2026-10-16',value:980},
      ].map(o=>({...o,provider:'Synthetic BCCh',seriesId:'F073.TCO.PRE.Z.D',priceKind:'official_transaction_weighted_average'}))}}}
  const checked={origin:'agent',status:'checked',reason:'Synthetic local review for boundary tests only.'}
  const cards=['market','local','global','counter'].map((q,i)=>{
    const evidence={id:`source-${q}`,country:'CLP',eventDate:'2026-10-15',publishedAt:'2026-10-15T18:00:00Z',
      title:'Synthetic market passage',source:'Synthetic publisher',publisher:'Synthetic publisher',provenance:'market_reporting',
      url:`https://example.org/${q}`,review:{originalVerified:true,scope:'Synthetic market interpretation only.'},
      sourceContext:createSourceContext({blocks:[{kind:'paragraph',text:'A synthetic source attributed market explanation with qualifying conditions.'}],selected:[0]})}
    packet.evidence.push(evidence)
    return {id:`claim-${q}`,questionId:q,evidenceId:evidence.id,evidenceHash:evidenceBinding(evidence),
      passageIds:['p0'],statement:'A synthetic connected explanation, not an economic observation.',
      allowedUse:'Use for this synthetic test only.',limit:'Do not infer real market causality.',kind:q==='market'?'fact':'attributed_interpretation',
      attribution:q==='market'?null:'Synthetic analyst',eventKey:`synthetic-${i}`,independenceKey:`voice-${i}`,
      relation:'supports',timeScope:'same_day_context',review:checked}
  })
  const dossier={version:HARNESS_VERSION,packetHash:packetBinding(packet),cards}
  const review={version:FX_CAUSE_VERSION,binding:fxCauseBinding(packet,dossier),purpose:'fx_explanation',...checked,
    counterevidenceChecked:true,counterevidenceReason:'Counter pressure is reviewed in the synthetic fixture.',
    newExplanationValue:true,newExplanationReason:'The test connects a new source event with its synthetic currency.',
    claims:cards.map(c=>({cardId:c.id,role:c.questionId==='market'?'market':c.questionId==='counter'?'counter':'driver',
      supported:true,reason:'Synthetic original supports the entire scoped claim.',sessionDate:'2026-10-15',priceConnection:'same_sessions_different_price_basis'}))}
  const sourceUse={evaluatedOn:'2026-10-27',reviews:[priceUseResource(packet),...packet.evidence].map(r=>({
    version:'source-use/1',resourceId:r.id,resourceBinding:sourceUseBinding(r),terms:{url:'https://example.org/terms',version:'synthetic/1',reviewedOn:'2026-10-27'},
    scope:'Synthetic test permission only, not an actual licence.',review:checked,conditions:[],
    uses:Object.fromEntries(['local_analysis','external_model','public_display'].map(k=>[k,{status:k==='public_display'?'pending':'allowed',reason:'Synthetic permission for this contract test only.',conditionIds:[]}]))}))}
  const decision={ruleVersion:'generation-decision/2',status:'draft_candidate',currency:'CLP',price:{observedDate:packet.observedDate},events:[{id:'synthetic-event',binding:'b'.repeat(64),status:'draft_candidate',purpose:'fx_explanation'}]}
  return {packet,dossier,decision,fxCauseInput:{review,sourceUse}}
}
const assess=(x:ReturnType<typeof fixture>)=>assessFxCauseInput({packet:x.packet,dossier:x.dossier,...x.fxCauseInput})
afterEach(()=>vi.unstubAllGlobals())

describe('FX explanation purpose boundary',()=>{
  it('distinguishes effective day and actual session, calculates direction, and rejects the legacy supplier basis',()=>{
    const x=fixture(),m=verifiedFxMovement(x.packet)
    expect(m).toMatchObject({sessionDate:'2026-10-15',effectiveDate:'2026-10-16',direction:'local_stronger',articlePricesInterchangeable:false})
    Reflect.deleteProperty(x.packet.marketData,'reportPriceBasis')
    expect(()=>verifiedFxMovement(x.packet)).toThrow('verified_fx_price_basis_required')
  })
  it('rejects a changed chart or a mixed official price/provider before a source judgment can authorize it',()=>{
    const x=fixture();x.packet.series[1].value=990
    expect(()=>assess(x)).toThrow('fx_price_snapshot_mismatch')
    const y=fixture();y.packet.marketData.reportPriceBasis.observations[0].provider='another provider'
    expect(()=>assess(y)).toThrow('fx_price_snapshot_mismatch')
  })
  it('does not promote correct monthly background into an answer to why FX moved',()=>{
    const x=fixture();x.fxCauseInput.review.claims.forEach(c=>{if(c.role==='driver')c.role='background'})
    const a=assess(x)
    expect(a.holds).toContain('why_fx_moved_missing');expect(a.businessBackground).toHaveLength(2)
    expect(prepareEventTrial(x).status).toBe('fx_cause_input_hold')
  })
  it('requires a supported, attributed connection to the selected session rather than generic facts or old price observations',()=>{
    const x=fixture();x.fxCauseInput.review.claims[1].sessionDate='2026-10-14'
    x.fxCauseInput.review.claims[2].supported=false
    expect(assess(x).holds).toEqual(expect.arrayContaining(['claim_price_period_mismatch:claim-local','claim_support_missing:claim-global','why_fx_moved_missing']))
  })
  it('separates usable local analysis from permission to transmit to the writer, even for an uncited neighbouring source',()=>{
    const x=fixture();x.fxCauseInput.review.claims[3].role='exclude'
    x.fxCauseInput.sourceUse.reviews.at(-1)!.uses.external_model.status='pending'
    const a=assess(x)
    expect(a.contentReadiness).toBe('reviewed_session_explanation_not_proven_causality')
    expect(a.holds).toContain('source_use:source-counter:external_model')
    expect(prepareEventTrial(x).body).toBeUndefined()
  })
  it('requires explicit counterevidence and new explanatory value without forcing an extra paragraph',()=>{
    const x=fixture();x.fxCauseInput.review.counterevidenceChecked=false;x.fxCauseInput.review.newExplanationValue=false
    expect(assess(x).holds).toEqual(expect.arrayContaining(['counterevidence_review_required','new_explanation_value_unverified']))
  })
  it('assembles a purpose-bound existing writer request without network, mutation, economic fallback or publication approval',()=>{
    const x=fixture(),before=structuredClone(x),network=vi.fn(()=>{throw Error('no_network')});vi.stubGlobal('fetch',network)
    const p=prepareEventTrial(x),sent=JSON.parse(p.body.messages[1].content)
    expect(p).toMatchObject({status:'prepared_not_called',purpose:'fx_explanation',retries:0,publicationApproved:false,paidCallAuthorized:false})
    expect(sent.fxExplanation.driverClaimIds).toEqual(['claim-local','claim-global'])
    expect(sent.fxExplanation.priceMovement.direction).toBe('local_stronger')
    expect(p.body.provider).toMatchObject({zdr:true,data_collection:'deny',allow_fallbacks:false})
    expect(network).not.toHaveBeenCalled();expect(x).toEqual(before)
    const {fxCauseInput:_review,...unreviewed}=x
    expect(_review).toBeDefined()
    expect(prepareEventTrial(unreviewed).status).toBe('fx_cause_input_hold')
    x.decision.events[0].purpose='economic_update'
    expect(prepareEventTrial(x).status).toBe('fx_purpose_mismatch')
  })
  it('rechecks the cause review before the concrete transport can access an endpoint or spend',async()=>{
    const x=fixture(),plan=prepareEventTrial(x),network=vi.fn(()=>{throw Error('no_network')});vi.stubGlobal('fetch',network)
    x.fxCauseInput.review.newExplanationValue=false
    await expect(executeApprovedEventTrial({...x,plan,journal:[],claim:vi.fn()})).rejects.toThrow('fx_cause_review_changed_or_held')
    const changed=fixture(),approvedPlan=prepareEventTrial(changed)
    changed.fxCauseInput.review.reason='A different valid review still needs its own bound approval.'
    await expect(executeApprovedEventTrial({...changed,plan:approvedPlan,journal:[],claim:vi.fn()})).rejects.toThrow('fx_cause_review_changed_or_held')
    expect(network).not.toHaveBeenCalled()
  })
})
