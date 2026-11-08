import {describe,it,expect,vi} from 'vitest'
import {createReviewedNewsEvidence,projectReviewedNewsNotes} from './reviewed-news-notes.js'
import {prepareNewsNotesInput} from './news-notes-input.js'
import {prepareEventTrial,executeApprovedEventTrial} from './lifecycle-control.js'
import {requestBody} from './openrouter.js'
import {inspectDossier} from './research-harness.js'
import {buildPacket,validateContent} from './core.js'
import {assessEvidencePacket} from './evidence-quality.js'
import {projectEvidenceScopes} from './evidence-scope.js'
import Ajv from 'ajv'
import {projectFxWritingBackground,fxBackgroundClaimIssues} from './fx-writing-background.js'
import {projectFxWritingFocus,fxWritingCoverageRequirements} from './fx-writing-focus.js'
import {assembleReportContent,draftSchemaForPacket} from './openrouter.js'
import {generationWire} from './generation-wire.js'
import {bundleFromSavedNotes} from './replay-fx-writing-local.js'

// Synthetic boundary fixtures, not a historical source or AI-quality sample.
function fixture() {
  const packet=buildPacket({baseDate:'2026-09-11',dailyRates:['02','03','04','07','08','09','10'].map((d,i)=>({
    currency:'CLP',rateType:'LOCAL_PER_USD',date:`2026-09-${d}`,value:200+i,source:'API',imputationMethod:'NONE',
  }))},'CLP','2026-09-11')
  packet.assessment.publishDecision={eligible:false,reason:'official_price_local_review_only'}
  packet.marketData={...packet.marketData,reportPriceBasis:{provider:'Synthetic statistical source',seriesId:'F073.TCO.PRE.Z.D',
    priceKind:'official_transaction_weighted_average',dateBasis:'underlying_local_transaction_day',timeZone:'America/Santiago',
    methodology:{sha256:'a'.repeat(64)},observations:[{localSessionDate:'2026-09-09',effectiveDate:'2026-09-10',value:205},
      {localSessionDate:'2026-09-10',effectiveDate:'2026-09-11',value:206}].map(o=>({...o,provider:'Synthetic statistical source',seriesId:'F073.TCO.PRE.Z.D',priceKind:'official_transaction_weighted_average'}))}}
  const review={origin:'agent',status:'checked',reason:'Synthetic reviewer judgment for note projection tests.',
    supportingContentChecked:true,contentAccess:'publisher_attributed_excerpt',independentlyWorded:true,notTranslation:true,notArticleSubstitute:true,checkedOn:'2026-10-27'}
  const useReview={terms:{url:'https://example.org/terms',version:'synthetic/1',reviewedOn:'2026-10-27'},
    scope:'Synthetic authored notes only, not an article licence.',review:{origin:'agent',status:'checked',reason:review.reason},conditions:[],
    uses:Object.fromEntries(['local_analysis','external_model','public_display'].map(k=>[k,{status:k==='public_display'?'pending':'allowed',reason:'Synthetic scope judgment for boundary tests only.',conditionIds:[]}]))}
  const source={id:'news-synthetic',country:'CLP',publisher:'Synthetic publisher',author:'Synthetic author',
    url:'https://example.org/market',publishedAt:'2026-09-10',publicationDisplay:'Date only; publication time unknown',eventDate:'2026-09-10',collectedAt:'2026-10-27T00:00:00Z'}
  const notes=['market','local','global','counter'].map((q,i)=>({id:`n${i}`,kind:q==='market'?'fact':'attributed_view',
    text:`Synthetic reviewer-authored ${q} note with limited scope and independently worded explanation.`,
    attribution:q==='market'?null:{person:'Analyst A',organization:'Synthetic firm'},
    reportedPrice:q==='market'?{previous:210,current:212,delta:2,unit:'CLP_per_USD',basis:'reported_market_close',observedAt:null}:null}))
  const claims=['market','local','global','counter'].map((q,i)=>({noteId:`n${i}`,questionId:q,role:q==='market'?'market':q==='counter'?'counter':'driver',
    eventKey:`synthetic-${q}`,independenceKey:'synthetic-voice',relation:q==='counter'?'qualifies':'supports',supported:true,
    review:{origin:'agent',status:'checked',reason:`Synthetic ${q} scope independently checked for this fixture.`}}))
  const bundle={version:'news-notes-case/2',checkedOn:'2026-10-27',sessionDate:'2026-09-10',reportDate:'2026-09-11',
    entries:[{source,notes,review,useReview,claims}],priceUseReview:structuredClone(useReview),
    contentReview:{origin:'agent',status:'checked',reason:review.reason,counterevidenceChecked:true,
      counterevidenceReason:'Synthetic qualification was explicitly inspected.',newExplanationValue:true,newExplanationReason:'A synthetic new explanatory connection, not a market judgment.'}}
  return {packet,bundle}
}

// Optional business input is a reviewed consumer-only source, never a watch
// card relabeled as consumer evidence merely to fill a missing section.
function businessFixture() {
 const x=fixture(),entry=structuredClone(x.bundle.entries[0])
 entry.source.id='news-synthetic-consumer'
 entry.notes=[{id:'n0',kind:'fact',text:'합성 기관은 이전 분기의 소비 지표 흐름이 약했다고 평가했다.',attribution:null,reportedPrice:null}]
 entry.claims=[{...entry.claims[0],noteId:'n0',questionId:'consumer',role:'background',eventKey:'synthetic-consumption-quarter'}]
 x.bundle.entries.push(entry)
 Object.assign(x.bundle,{consumerBackground:[{evidenceId:entry.source.id,noteIds:['n0'],referencePeriod:'2026-Q2',
  review:{origin:'agent',status:'checked',reason:'합성 소비 자료의 대상 분기와 허용 범위를 확인하는 테스트 판단이다.'}}]})
 return x
}

describe('reviewed business and current-market handoff',()=>{
 it('keeps an earlier consumer release and its period in the shared writer without relabeling it as a current driver',()=>{
  const x=businessFixture(),entry=x.bundle.entries.at(-1)
  entry.source.eventDate='2026-09-01';entry.source.publishedAt='2026-09-01'
  x.packet.marketData.reportPriceBasis.asOf='2026-10-27T01:00:00Z'
  const before=structuredClone(x),d=prepareNewsNotesInput(x.packet,x.bundle),plan=prepareEventTrial(d)
  expect(d.assessment.holds).toEqual([])
  expect(d.packet.evidence.at(-1).eventDate).toBe('2026-09-01')
  expect(projectFxWritingBackground(d.packet).reviewedNotes[0]).toMatchObject({referencePeriod:'2026-Q2',publishedAt:'2026-09-01'})
  expect(d.packet.evidenceScopeCards.at(-1).scope.unit).not.toContain('/USD')
  expect(d.packet.evidenceScopeCards.at(-1).coverageGaps[0].subject).not.toContain('환율 기여도')
  expect(d.assessment.driverClaimIds).not.toContain('news-synthetic-consumer-n0')
  expect(plan.outputContract.sections.implications).toEqual({min:0,max:2})
  expect(plan.paidCallAuthorized).toBe(false);expect(x).toEqual(before)
 })
 it.each(['unselected','mixed_driver','after_cutoff','future_release'])(
  'holds %s earlier consumer material at the shared handoff',fault=>{
   const x=businessFixture(),entry=x.bundle.entries.at(-1)
   entry.source.eventDate='2026-09-01';entry.source.publishedAt='2026-09-01'
   x.packet.marketData.reportPriceBasis.asOf='2026-10-27T01:00:00Z'
   if(fault==='unselected')delete x.bundle.consumerBackground
   if(fault==='mixed_driver')entry.claims[0].role='driver'
   if(fault==='after_cutoff')entry.source.collectedAt='2026-10-27T02:00:00Z'
   if(fault==='future_release')entry.source.eventDate='2026-09-12'
   expect(()=>prepareNewsNotesInput(x.packet,x.bundle)).toThrow('news_notes_session_mismatch')
  })
 it('opens the real output slots and preserves period/source metadata, without changing the input or granting approval',()=>{
  const x=businessFixture(),before=structuredClone(x),d=prepareNewsNotesInput(x.packet,x.bundle),plan=prepareEventTrial(d)
  const sent=JSON.parse(plan.body.messages[1].content),background=projectFxWritingBackground(d.packet)
  expect(d.assessment.holds).toEqual([])
  expect(background.reviewedNotes[0]).toMatchObject({referencePeriod:'2026-Q2',passageIds:['n0']})
  expect(sent.researchBrief.questionResolution[0]).toMatchObject({status:'reviewed_background_available'})
  expect(plan.outputContract.sections.implications).toEqual({min:0,max:2})
  expect(sent.codeOwnedSections).not.toContain('implications')
  expect(fxWritingCoverageRequirements(d.packet)[0]).toMatchObject({status:'unverified',referencePeriods:['2026-Q2']})
  const block={title:'이전 분기 소비 흐름',text:'해당 기관은 이전 분기 소비 지표의 약한 흐름을 평가했다.',kind:'fact',evidenceIds:['news-synthetic-consumer']}
  const draft={title:'기관의 소비 평가와 시장 해석',summary:'출처별 대상과 의미를 구분한다.',drivers:[{...block,evidenceIds:['news-synthetic']}],implications:[block],watch:[{...block,evidenceIds:['news-synthetic']}]}
  const schema=draftSchemaForPacket(d.packet),validate=new Ajv().compile(schema)
  expect(validate(draft)).toBe(true)
  const wire=generationWire(draftSchemaForPacket(d.packet,true,true,true),'openai/gpt-6.1-sol')
  expect(wire.contract.sections.implications.max).toBe(2)
  const content=assembleReportContent(d.packet,draft,true)
  expect(content.implications[0]).toMatchObject({...block,factIds:[]})
  expect(content.limitations[0]).toContain('대상 2026-Q2')
  expect(d.packet.limitations.every(t=>content.limitations.some(line=>line.includes(t)))).toBe(true)
  expect(validateContent(content,d.packet).valid).toBe(true)
  const invented=structuredClone(content);invented.limitations[0]=invented.limitations[0].replace('2026-Q2','2026-Q1')
  expect(validateContent(invented,d.packet).errors).toContain('untrusted_text')
  expect(fxBackgroundClaimIssues(d.packet,draft)).toEqual([])
  expect(fxBackgroundClaimIssues(d.packet,{...draft,drivers:[block]})).toEqual(['background_used_as_fx_driver:0'])
  expect(fxBackgroundClaimIssues(d.packet,{...draft,implications:[{...block,evidenceIds:['news-synthetic']}]})).toEqual(['unreviewed_business_background:0'])
  expect(plan.paidCallAuthorized).toBe(false);expect(plan.publicationApproved).toBe(false)
  expect(x).toEqual(before)
 })
 it.each(['missing_period','future_period','watch_only','unsupported','mixed_roles'])(
  'refuses %s consumer admission instead of populating the business section',fault=>{
   const x=businessFixture(),selection=x.bundle.consumerBackground[0],entry=x.bundle.entries.at(-1)
   if(fault==='missing_period')delete selection.referencePeriod
   if(fault==='future_period')selection.referencePeriod='2027-Q1'
   if(fault==='watch_only')entry.claims[0].questionId='watch'
   if(fault==='unsupported')entry.claims[0].supported=false
   if(fault==='mixed_roles')entry.claims[0].role='driver'
   expect(()=>prepareNewsNotesInput(x.packet,x.bundle)).toThrow(/consumer_notes|invalid_news_note_claim/)
  })
 it('binds the selected same-session observation and projects it to writing and review, not to a causal verdict',()=>{
  const x=fixture()
  Object.assign(x.bundle,{marketFocus:[{cardId:'news-synthetic-n2',topic:'global_dollar',priceTiming:'intraday',
   review:{origin:'agent',status:'checked',reason:'합성 당일 달러 관측의 집필 우선순위를 확인하는 경계 시험이다.'}}]})
  const d=prepareNewsNotesInput(x.packet,x.bundle),plan=prepareEventTrial(d),sent=JSON.parse(plan.body.messages[1].content)
  expect(sent.writingFocus.observations[0]).toMatchObject({passageIds:['n2'],priceTiming:'intraday'})
  expect(plan.body.messages[0].content).toContain('이전 배경을 그 뒤에')
  expect(fxWritingCoverageRequirements(d.packet)[0]).toMatchObject({id:'same_session_dollar_connection',status:'unverified'})
  const changed=structuredClone(d.packet);changed.fxWritingFocus.rows[0].priceTiming='close'
  expect(()=>projectFxWritingFocus(changed)).toThrow('binding')
  const scope=structuredClone(d.packet);scope.evidenceScopeCards[0].scope.comparison='different session'
  expect(()=>projectFxWritingFocus(scope)).toThrow('source_changed')
  const duplicate=structuredClone(x);duplicate.bundle.marketFocus.push(duplicate.bundle.marketFocus[0])
  expect(()=>prepareNewsNotesInput(duplicate.packet,duplicate.bundle)).toThrow('duplicate_market_focus')
  const wrong=structuredClone(x);wrong.bundle.marketFocus[0].cardId='news-synthetic-n1'
  expect(()=>prepareNewsNotesInput(wrong.packet,wrong.bundle)).toThrow('same_session_focus')
 })
 it('round-trips saved legacy note inputs through the same checks and leaves business unavailable without reviewed material',()=>{
  const x=fixture(),original=prepareNewsNotesInput(x.packet,x.bundle),before=structuredClone(original)
  const base=structuredClone(original.packet);base.evidence=[];base.evidenceScopeCards=[]
  const rebuilt=prepareNewsNotesInput(base,bundleFromSavedNotes(original))
  expect(rebuilt).toEqual(original)
  expect(prepareEventTrial(rebuilt).outputContract.sections.implications.max).toBe(0)
  expect(original).toEqual(before)
 })
 it('keeps source-use and period/scope integrity checks active when consumer output becomes available',()=>{
  const x=businessFixture();x.bundle.entries.at(-1).useReview.uses.external_model.status='pending'
  const data=prepareNewsNotesInput(x.packet,x.bundle)
  expect(data.assessment.holds.some(h=>h.includes('source_use:news-synthetic-consumer:external_model'))).toBe(true)
  expect(prepareEventTrial(data)).toMatchObject({status:'fx_cause_input_hold',paidCallAuthorized:false})
  const good=businessFixture(),packet=prepareNewsNotesInput(good.packet,good.bundle).packet
  packet.fxWritingBackground.reviewedNotes[0].referencePeriod='2026-Q1'
  expect(()=>projectFxWritingBackground(packet)).toThrow('binding')
 })
})

describe('reviewer-authored news notes input boundary',()=>{
  it('keeps a latest-session preparation distinct from historical replay and subsequent policy background out of FX drivers',()=>{
    const x=fixture(),original=structuredClone(x)
    const policy={...structuredClone(x.bundle.entries[0]),source:{...x.bundle.entries[0].source,id:'news-synthetic-policy'},
      notes:[{id:'n0',kind:'fact',text:'The synthetic authority described an unchanged policy and weak previous-quarter demand.',attribution:null,reportedPrice:null}],
      claims:[{...x.bundle.entries[0].claims[0],noteId:'n0',questionId:'watch',role:'background',eventKey:'synthetic-policy'}]}
    const data=prepareNewsNotesInput(x.packet,{...x.bundle,historicalCase:false,entries:[...x.bundle.entries,policy]})
    expect(data.historicalReplay).toBe(false)
    expect(data.decision.events[0].id).toBe('latest-reviewed-news-notes')
    expect(data.assessment.holds).toEqual([])
    expect(data.assessment.businessBackground).toContainEqual({id:'news-synthetic-policy-n0',evidenceId:'news-synthetic-policy',role:'background_only'})
    expect(data.assessment.driverClaimIds).not.toContain('news-synthetic-policy-n0')
    const plan=prepareEventTrial(data),sent=JSON.parse(plan.body.messages[1].content)
    expect(sent.fxExplanation.businessBackground).toEqual(data.assessment.businessBackground)
    policy.claims[0].role='driver'
    expect(()=>prepareNewsNotesInput(x.packet,{...x.bundle,entries:[...x.bundle.entries,policy]})).toThrow('invalid_news_note_claim')
    expect(x).toEqual(original)
  })
  it('keeps authored notes and citation separate from originals through the existing writer without spending or mutating sources',async()=>{
    const x=fixture(),before=structuredClone(x),network=vi.fn(()=>{throw Error('unexpected_network')});vi.stubGlobal('fetch',network)
    const data=prepareNewsNotesInput(x.packet,x.bundle),plan=prepareEventTrial(data),input=JSON.parse(plan.body.messages[1].content)
    expect(plan.status).toBe('prepared_not_called')
    expect(plan.body).not.toHaveProperty('temperature')
    expect(data.assessment.holds).toEqual([])
    expect(data.packet.assessment).toEqual(assessEvidencePacket(data.packet))
    expect(data.packet.assessment.publishDecision).toEqual({eligible:false,reason:'no_material_change'})
    expect(input.promptVersion).toBe('currency-input/12')
    expect(plan.body.model).toBe('openai/gpt-6.1-sol')
    expect(input.scopeProjection).toBe('notes-reference/2')
    expect(input.scopeCards[0].admittedClaims[1]).toEqual({id:'news-synthetic-n1',kind:'source_interpretation',passageIds:['n1']})
    const expanded=input.scopeCards.map((card:{scopeRuleId:string})=>{
      const {scopeRuleId,...rest}=card
      return {...rest,...input.scopeRuleSets.find((r:{id:string})=>r.id===scopeRuleId).value}
    })
    const expected=projectEvidenceScopes(data.packet).map(card=>({...card,admittedClaims:card.admittedClaims.map(({id,kind,passageIds})=>({id,kind,passageIds}))}))
    expect(expanded).toEqual(expected)
    for(const card of input.researchBrief.outline.flatMap((row:{cards:unknown[]})=>row.cards)){
      const original=data.dossier.cards.find(c=>c.id===card.id)!
      expect(input.researchBrief.cardUseRules.find((r:{id:string})=>r.id===card.useRuleId).value).toEqual({allowedUse:original.allowedUse,limit:original.limit})
    }
    expect(input.researchBrief.outline.find((row:{questionId:string})=>row.questionId==='local').cards[0].passageIds).toEqual(['n1'])
    expect(input.evidence[0].sourceContext).toMatchObject({sourceVersion:'reviewer_authored_notes',citation:{author:'Synthetic author'}})
    expect(input.evidence[0].sourceContext.passages[1]).toMatchObject({kind:'reviewer_attributed_view',attribution:{person:'Analyst A',organization:'Synthetic firm'}})
    expect(JSON.stringify(input)).not.toMatch(/current_page_not_archived|bodyHash|supportingContentChecked|independentlyWorded/)
    expect(input.fxExplanation.priceMovement.current).toBe(206)
    expect(input.evidence[0].sourceContext.passages[0].reportedPrice.current).toBe(212)
    expect(plan.paidCallAuthorized).toBe(false);expect(plan.publicationApproved).toBe(false)
    await expect(executeApprovedEventTrial({...data,plan,journal:[],claim:vi.fn()})).rejects.toThrow('separate_bound_paid_approval_required')
    expect(network).not.toHaveBeenCalled();expect(x).toEqual(before)
  })
  it('rejects an adjacent original or replaced summary even when a valid notes capsule is present',()=>{
    const x=fixture(),entry=x.bundle.entries[0],e=createReviewedNewsEvidence(entry.source,entry.notes,entry.review)
    expect(projectReviewedNewsNotes(e).sourceVersion).toBe('reviewer_authored_notes')
    expect(()=>projectReviewedNewsNotes({...e,sourceContext:{passages:[{text:'Original article body must never accompany these notes.'}]}})).toThrow('unreviewed_or_stale_news_notes')
    expect(()=>projectReviewedNewsNotes({...e,summary:'Replaced summary from an adjacent original.'})).toThrow('unreviewed_or_stale_news_notes')
  })
  it('does not merge distinct card rules while factoring repeated note scopes',()=>{
    const x=fixture(),data=prepareNewsNotesInput(x.packet,x.bundle)
    const card=data.dossier.cards.find(c=>c.questionId==='global')!
    card.limit='이 카드에만 적용하는 별도 조건을 빠뜨리지 않는다.'
    const sent=JSON.parse(requestBody(data.packet,'openrouter/free','strict',data.dossier).messages[1].content)
    expect(sent.researchBrief.cardUseRules).toHaveLength(2)
    const projected=sent.researchBrief.outline.flatMap((row:{cards:{id:string,useRuleId:string}[]})=>row.cards).find((c:{id:string})=>c.id===card.id)
    expect(sent.researchBrief.cardUseRules.find((r:{id:string})=>r.id===projected.useRuleId).value.limit).toBe('이 카드에만 적용하는 별도 조건을 빠뜨리지 않는다.')
  })
  it('requires checking the supporting content and independent wording, while allowing an attributed excerpt rather than a complete original',()=>{
    const {bundle}=fixture(),e=bundle.entries[0]
    expect(()=>createReviewedNewsEvidence(e.source,e.notes,{...e.review,supportingContentChecked:false})).toThrow('invalid_news_notes')
    expect(()=>createReviewedNewsEvidence(e.source,e.notes,{...e.review,notTranslation:false})).toThrow('invalid_news_notes')
    expect(()=>createReviewedNewsEvidence(e.source,e.notes,{...e.review,contentAccess:'title_only'})).toThrow('invalid_news_notes')
  })
  it('blocks missing or stale expert attribution instead of converting it into an unqualified fact',()=>{
    const {bundle}=fixture(),entry=bundle.entries[0],notes=structuredClone(entry.notes);notes[1].attribution=null
    expect(()=>createReviewedNewsEvidence(entry.source,notes,entry.review)).toThrow('news_note_attribution_required')
    const evidence=createReviewedNewsEvidence(entry.source,entry.notes,entry.review)
    evidence.newsNotes.notes[1].attribution.person='Different analyst'
    expect(()=>projectReviewedNewsNotes(evidence)).toThrow('unreviewed_or_stale_news_notes')
  })
  it('checks reported-price arithmetic while retaining an unknown observation time',()=>{
    const {bundle}=fixture(),entry=bundle.entries[0],notes=structuredClone(entry.notes);notes[0].reportedPrice!.delta=3
    expect(()=>createReviewedNewsEvidence(entry.source,notes,entry.review)).toThrow('invalid_news_note_price_basis')
  })
  it('rejects a dossier assertion that differs from its reviewed note, even after rebinding the dossier to the unchanged packet',()=>{
    const x=fixture(),data=prepareNewsNotesInput(x.packet,x.bundle)
    data.dossier.cards[1].statement='A new unreviewed causal assertion was appended to the dossier.'
    expect(inspectDossier(data.packet,data.dossier).rejected).toContainEqual({id:'news-synthetic-n1',reason:'news_note_claim_mismatch'})
  })
  it('honours a pending use decision for notes rather than auto-approving them because no article text is included',()=>{
    const x=fixture();x.bundle.entries[0].useReview.uses.external_model.status='pending'
    const data=prepareNewsNotesInput(x.packet,x.bundle)
    expect(data.assessment.holds).toContain('source_use:news-synthetic:external_model')
    expect(prepareEventTrial(data).status).toBe('fx_cause_input_hold')
  })
  it('refuses an original-text neighbour in the notes-only writer entry point',()=>{
    const x=fixture(),data=prepareNewsNotesInput(x.packet,x.bundle)
    data.packet.evidence.push({...data.packet.evidence[0],id:'unreviewed-original',newsNotes:undefined})
    expect(()=>requestBody(data.packet,'openrouter/free')).toThrow('mixed_article_and_news_notes_input')
  })
})
