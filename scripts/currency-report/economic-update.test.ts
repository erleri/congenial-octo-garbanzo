import { describe, expect, it, vi } from 'vitest'
import { ECONOMIC_VERSION, economicPacketBinding, economicUpdateRequest, composeEconomicUpdate } from './economic-update.js'
import { createSourceContext } from './source-context.js'
import { prepareEventTrial, executeApprovedEventTrial } from './lifecycle-control.js'
import { bindEvidenceScope, projectEvidenceScopes } from './evidence-scope.js'
import { bindEconomicWatch, economicLimitations } from './economic-editorial.js'
import { REASONING_POLICY_VERSION, REASONING_WRITER_INSTRUCTIONS } from './reasoning-policy.js'

function input() {
  const packet = { currency: 'CLP', baseDate: '2026-10-09', observedDate: '2026-10-09', facts: [{ id: 'spot', value: 100, label: '1 USD = 100 CLP' }, { id: 'day', value: 1, label: '전 관측일 대비 +1.00%' }], series: [{ date: '2026-10-08', value: 99 }, { date: '2026-10-09', value: 100 }], limitations: ['합성 입력 검증 사례입니다.'], evidence: [{ id: 'ipc', country: 'CLP', title: '공식 물가 발표', publisher: 'INE', url: 'https://www.ine.gob.cl/', publishedAt: '2026-10-08', eventDate: '2026-10-08', period: '2026-09', summary: '식품 물가 상승과 다른 항목 하락을 구분합니다.', provenance: 'official', review: { originalVerified: true, scope: '물가 구성 설명에 한정하며 환율 원인으로 사용하지 않습니다.' }, sourceContext: createSourceContext({ blocks: [{ kind: 'paragraph', text: '식품 물가가 올랐고 다른 항목의 물가는 내려갔다.' }], selected: [0] }) }] }
  const decision = { ruleVersion: 'generation-decision/2', status: 'draft_candidate', currency: 'CLP', price: { observedDate: packet.observedDate }, events: [{ id: 'ipc-release', binding: 'binding', status: 'draft_candidate', purpose: 'economic_update' }] }
  const dossier = { version: ECONOMIC_VERSION, packetHash: economicPacketBinding(packet), cards: [{ evidenceId: 'ipc', eventId: 'ipc-release', eventBinding: 'binding', passageIds: ['p0'], newInformation: '식품과 다른 항목이 서로 다른 방향으로 움직인 새 발표입니다.', allowedUse: '물가 구성의 변화만 설명하며 현재 환율 원인으로 쓰지 않습니다.', countercontext: '다른 항목의 물가 하락도 함께 설명합니다.', review: { origin: 'agent', status: 'checked', reason: '공식 원문 구절과 대상 기간을 별도로 대조한 합성 검토입니다.' } }] }
  const scopedDossier = { ...dossier, scopeCards: [bindEvidenceScope(packet.evidence[0], { ...dossier.cards[0],
    scope: { subject: 'IPC 구성 분류', metric: '품목 가격 변화', unit: 'percent', comparison: '전월 대비' },
    admittedClaims: [{id:'mixed',kind:'source_fact',passageIds:['p0'],text:'식품 물가는 상승하고 다른 항목의 물가는 하락했다.'}],
    excludedExpansions: ['가계별 실제 부담'], coverageGaps: [{subject:'내구재 판매',status:'not_in_packet'}] }, dossier.cards[0].review)] }
  const draft = { title: '물가 구성의 차이가 드러났다', summary: '식품과 다른 항목은 서로 다른 방향으로 움직였다.', drivers: [{ title: '생활물가의 구성을 구분', text: '식품 물가가 올랐지만 다른 항목은 내려갔다.', evidenceIds: ['ipc'] }], watch: [], claims: [] as { target: string; quote: string; evidenceIds: string[] }[] }
  draft.claims = [{ target: 'title', quote: draft.title, evidenceIds: ['ipc'] }, { target: 'summary', quote: draft.summary, evidenceIds: ['ipc'] }, { target: 'drivers.0.title', quote: draft.drivers[0].title, evidenceIds: ['ipc'] }, { target: 'drivers.0.text', quote: draft.drivers[0].text, evidenceIds: ['ipc'] }]
  return { packet, decision, dossier: scopedDossier, draft }
}
describe('non-causal economic brief', () => {
  it('accepts target-only current links and prepares the same immutable economic prose for unverified sentence review', () => {
    const x = input(), before = structuredClone(x.draft)
    const current = { ...x.draft, writingContractVersion: 'writer-links/1',
      claims: x.draft.claims.map(({ target, evidenceIds }) => ({ target, evidenceIds })) }
    const result = composeEconomicUpdate(x.packet, current)
    expect(result.valid).toBe(true)
    expect(result.content).toEqual(composeEconomicUpdate(x.packet, x.draft).content)
    expect(result.claimReview.claims.every(c => c.support === 'unverified')).toBe(true)
    expect(result.publicationApproved).toBe(false)
    expect(x.draft).toEqual(before)
    current.claims[1] = current.claims[0]
    expect(composeEconomicUpdate(x.packet, current).errors).toEqual(['economic_claim_mapping'])
  })
  it('prepares a bounded policy/consumer request despite a missing price observation time', () => {
    const x = input(), plan = prepareEventTrial(x)
    expect(plan.status).toBe('prepared_not_called'); expect(plan.purpose).toBe('economic_update')
    expect(plan.maximumUsd).toBeLessThanOrEqual(.25); expect(plan.paidCallAuthorized).toBe(false)
    expect(plan.body.messages[1].content).not.toContain('reviewer'); expect(plan.body.provider.allow_fallbacks).toBe(false)
    expect(JSON.parse(plan.body.messages[1].content).scopeCards[0].coverageGaps[0].status).toBe('not_in_packet')
    const sent = JSON.parse(plan.body.messages[1].content)
    expect(sent.reasoningPolicyVersion).toBe(REASONING_POLICY_VERSION)
    expect(plan.body.messages[0].content).toContain(REASONING_WRITER_INSTRUCTIONS)
    expect(sent.editorialPlan.storyBeats).toEqual([{evidenceId:'ipc',claimIds:['mixed']}])
    expect(sent.scopeCards[0].admittedClaims[0].text).toBe('식품 물가는 상승하고 다른 항목의 물가는 하락했다.')
    expect(sent.scopeCards[0].countercontext).toBe('다른 항목의 물가 하락도 함께 설명합니다.')
    expect(sent.cards[0]).not.toHaveProperty('allowedUse')
    expect(sent.cards[0]).not.toHaveProperty('countercontext')
    expect(plan.scopeCards).toHaveLength(1)
  })
  it('rejects altered source bindings and unavailable source passages before any request', () => {
    const x = input()
    x.dossier.cards[0].eventBinding = 'old'
    expect(() => economicUpdateRequest(x.packet, x.dossier, x.decision)).toThrow('unreviewed_economic_card')
    x.dossier.cards[0].eventBinding = 'binding'; x.dossier.cards[0].passageIds = ['missing']
    expect(() => economicUpdateRequest(x.packet, x.dossier, x.decision)).toThrow('unreviewed_economic_card')
    x.dossier.packetHash = 'stale'
    expect(economicUpdateRequest(x.packet, x.dossier, x.decision).request).toBeNull()
  })
  it('assembles immutable price facts while leaving semantic review and publication pending', () => {
    const x = input()
    x.packet.facts.push({id:'ipc_monthly',value:.4,label:'9월 IPC 전월 대비 +0.4%'})
    const result = composeEconomicUpdate(x.packet, x.draft)
    expect(result.errors).toEqual([]); expect(result.content.change.factIds).toEqual(['spot', 'day'])
    expect(result.content.change.text).not.toContain('ipc_monthly')
    expect(result.content.implications).toEqual([]); expect(result.claimReview.status).toBe('unverified')
    expect(result.publicationApproved).toBe(false)
    x.draft.claims.pop()
    expect(composeEconomicUpdate(x.packet, x.draft).valid).toBe(false)
  })
  it('holds an economic brief that claims a currency cause or introduces unsupported numbers', () => {
    const x = input()
    x.draft.title = '물가가 페소 하락의 원인이었다'
    expect(composeEconomicUpdate(x.packet, x.draft).errors).toContain('economic_causal_scope')
    x.draft.title = '물가가 99% 올랐다'
    expect(composeEconomicUpdate(x.packet, x.draft).errors).toContain('untrusted_text')
  })
  it('enforces the full local contract after provider simplification: count, length and target syntax', () => {
    const x = input(), plan = prepareEventTrial(x)
    expect(plan.outputContract.sections.drivers).toEqual({min:1,max:3})
    expect(Object.keys(plan.body.response_format.json_schema.schema.properties.drivers.properties)).toEqual(['slot_0','slot_1','slot_2'])
    expect(plan.body.response_format.json_schema.schema.properties.claims.items.properties.target.enum).toContain('drivers.0.text')
    x.draft.claims[2].target = 'drivers[0].title'
    expect(composeEconomicUpdate(x.packet, x.draft).errors).toContain('economic_schema')
    x.draft.claims[2].target = 'drivers.0.title'
    x.draft.drivers.push(...Array.from({length:3},()=>({...x.draft.drivers[0]})))
    expect(composeEconomicUpdate(x.packet, x.draft).errors).toContain('economic_schema')
    x.draft.drivers.splice(1); x.draft.summary = '가'.repeat(261)
    expect(composeEconomicUpdate(x.packet, x.draft).errors).toContain('economic_schema')
  })

  it('keeps a qualified short brief valid but rejects invented watch sections after provider simplification', () => {
    const x = input(), plan = prepareEventTrial(x)
    expect(composeEconomicUpdate(x.packet,x.draft,plan).errors).toEqual([])
    expect(composeEconomicUpdate(x.packet,x.draft,plan).content.drivers[0].text).toContain('다른 항목은 내려갔다')
    const readingRule = {...x.draft,watch:[{title:'자료 읽기',text:'지표는 별도의 관점으로 확인한다.',evidenceIds:['ipc']}]}
    expect(plan.outputContract.sections.watch).toEqual({min:0,max:0})
    expect(plan.body.response_format.json_schema.schema.properties.watch.properties).toEqual({})
    expect(composeEconomicUpdate(x.packet,readingRule,plan).errors).toEqual(['economic_schema'])
    // Saved manuscripts without a new editorial plan retain their historical contract.
    expect(composeEconomicUpdate(x.packet,readingRule).errors).not.toContain('economic_schema')
  })

  it('admits a reviewed future signal, strips its internal ID and refuses stale or invented references', () => {
    const x = input()
    x.packet.evidence[0].sourceContext = createSourceContext({blocks:[{kind:'paragraph',text:'식품 물가는 올랐고 다른 항목은 내려갔다. 다음 발표에서 식품 분류의 월간 변화를 공개할 예정이다.'}],selected:[0]})
    const scope = bindEvidenceScope(x.packet.evidence[0], {...x.dossier.scopeCards[0], admittedClaims:[...x.dossier.scopeCards[0].admittedClaims,
      {id:'next-food',kind:'source_fact',passageIds:['p0'],text:'다음 발표에서는 식품 분류의 월간 변화를 공개할 예정이다.'}]},x.dossier.cards[0].review)
    const dossier = {...x.dossier,scopeCards:[scope],packetHash:economicPacketBinding(x.packet)}
    const projected = projectEvidenceScopes(x.packet,dossier.scopeCards,{required:true})
    const candidates = [{id:'food-next',evidenceId:'ipc',claimIds:['next-food'],signal:'다음 발표의 식품 분류 월간 변화',judgmentPurpose:'식품 분류의 상승 흐름이 이어지는지 구분한다.'}]
    const watchReview = bindEconomicWatch(x.packet,projected,candidates,{origin:'agent',status:'checked',reason:'합성 원문의 다음 발표 항목과 판단 목적을 확인했다.'})
    const plan = prepareEventTrial({...x,dossier:{...dossier,watchReview}})
    const watch = {candidateId:'food-next',title:'다음 식품 분류 변화',text:'다음 발표의 식품 분류 변화로 상승 흐름이 이어지는지 구분한다.',evidenceIds:['ipc']}
    const draft = {...x.draft,watch:[watch],claims:[...x.draft.claims,...(['title','text'] as const).map(k=>({target:'watch.0.'+k,quote:watch[k],evidenceIds:['ipc']}))]}
    const result = composeEconomicUpdate(x.packet,draft,plan)
    expect(result.errors).toEqual([]); expect(result.content.watch[0]).not.toHaveProperty('candidateId')
    expect(result.contentReview).toBe('unverified'); expect(result.publicationApproved).toBe(false)
    expect(composeEconomicUpdate(x.packet,{...draft,watch:[{...watch,candidateId:'invented'}]},plan).errors).toEqual(['economic_schema'])
    const invalid = bindEconomicWatch(x.packet,projected,[{...candidates[0],claimIds:['unreviewed']}],watchReview.review)
    expect(()=>economicUpdateRequest(x.packet,{...dossier,watchReview:invalid},x.decision)).toThrow('economic_watch_source_required')
    watchReview.candidates[0].signal = '수정한 원고를 승인 없이 새 관찰 항목으로 쓴다.'
    expect(()=>economicUpdateRequest(x.packet,{...dossier,watchReview},x.decision)).toThrow('economic_watch_review_required')
  })

  it('blocks a removed or altered editorial contract before endpoint lookup or billing', async () => {
    const x = input(), plan = prepareEventTrial(x), fetchSpy = vi.fn()
    vi.stubGlobal('fetch',fetchSpy)
    try {
      const altered = {...plan,editorialPlan:{...plan.editorialPlan,watchCandidates:[{id:'injected'}]}}
      await expect(executeApprovedEventTrial({plan:altered,packet:x.packet,approval:{},journal:[],claim:vi.fn(),apiKey:'synthetic'})).rejects.toThrow('economic_editorial_binding_required')
      const removed = {...plan,editorialPlan:undefined}
      await expect(executeApprovedEventTrial({plan:removed,packet:x.packet,approval:{},journal:[],claim:vi.fn(),apiKey:'synthetic'})).rejects.toThrow('economic_editorial_binding_required')
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('preserves all common notices once and holds capacity overflow instead of hiding conditions', () => {
    const x = input(), plan = prepareEventTrial(x)
    const packet = {...x.packet,limitations:['주의 하나','주의 둘','주의 셋','주의 넷','주의 하나']}
    expect(economicLimitations(packet,plan.editorialPlan)).toEqual(['주의 하나','주의 둘','주의 셋','주의 넷 이 자료는 경제·소비 환경 업데이트이며 저장 환율 변화의 원인으로 확인된 설명은 아닙니다.'])
    expect(()=>economicLimitations({...packet,limitations:['가'.repeat(481)]},plan.editorialPlan)).toThrow('economic_limitations_overflow')
  })
})
