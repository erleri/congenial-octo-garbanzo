import { expect, it, vi } from 'vitest'
import Ajv from 'ajv'
import { currentCase, writerDraft, wireDraft } from './test-support.js'
import { composeDraft, requestBody } from './openrouter.js'
import { generationWire } from './generation-wire.js'
import { compileEventTrialOutput } from './lifecycle-control.js'
import { reviewSentences } from './report-text.js'
import { WRITING_CONTRACT_VERSION } from './writing-contract.js'

it('prepares sentence review from current free and fixed-slot writer contracts without changing prose or granting support', () => {
  const network = vi.fn(() => { throw Error('offline_only') }); vi.stubGlobal('fetch', network)
  try {
    const x = currentCase('CLP'), draft = writerDraft(x), before = structuredClone(draft)
    const request = requestBody(x.packet, 'openrouter/free'), schema = request.response_format.json_schema.schema
    expect(new Ajv().compile(schema)(draft)).toBe(true)
    expect(schema.properties.ruleLedger.properties.claims.items.properties).not.toHaveProperty('quote')
    expect(schema.properties.ruleLedger.properties.claims.items.properties).not.toHaveProperty('transmission')
    expect(request.messages[0].content).not.toContain('모든 문장을 순서대로 quote')
    const free = composeDraft(x.packet, draft, true, true)
    const transport = generationWire(schema, 'anthropic/claude-sonnet-5.5'), slots = structuredClone(draft)
    for (const [field, { max }] of Object.entries(transport.contract.sections) as [string, { max: number }][]) {
      slots[field] = Object.fromEntries(Array.from({ length: max }, (_, i) => [`slot_${i}`, draft[field][i] ?? null]))
    }
    expect(new Ajv().compile(transport.schema)(slots)).toBe(true)
    const paid = compileEventTrialOutput({ plan: { purpose: 'fx_explanation', outputContract: transport.contract }, packet: x.packet, draft: slots })
    expect(paid.candidate).toEqual(free.candidate)
    expect(free.validation.valid).toBe(true)
    expect(free.rules.automaticStatus).toBe('pass')
    expect(free.rules.semanticStatus).toBe('unverified')
    expect(free.rules.publicationApproved).toBe(false)
    expect(free.ruleLedger.assembly).toBe(WRITING_CONTRACT_VERSION)
    expect(free.claimReview.claims.every(c => c.support === 'unverified' && c.referenceStatus === 'candidate_only')).toBe(true)
    expect(free.candidate).toEqual(composeDraft(x.packet, wireDraft(x), true).candidate)
    expect(draft).toEqual(before); expect(network).not.toHaveBeenCalled()
  } finally { vi.unstubAllGlobals() }
})

it('rejects incomplete, extra, inconsistent or invented writer links instead of using report-wide sources to repair them', () => {
  const x = currentCase(), draft = writerDraft(x)
  const missing = structuredClone(draft); missing.ruleLedger.claims.pop()
  expect(composeDraft(x.packet, missing, true).validation.errors).toEqual(['writing_target_coverage'])
  const duplicate = structuredClone(draft); duplicate.ruleLedger.claims[1] = duplicate.ruleLedger.claims[0]
  expect(composeDraft(x.packet, duplicate, true).validation.errors).toEqual(['writing_target_coverage'])
  const mechanism = structuredClone(draft); mechanism.ruleLedger.claims[0].applicationId = 'model-invented'
  expect(composeDraft(x.packet, mechanism, true).validation.errors).toEqual(['writing_mechanism_not_admitted'])
  const mixed = structuredClone(draft); mixed.drivers[0].evidenceIds = []
  expect(composeDraft(x.packet, mixed, true).validation.errors).toEqual(['writing_source_or_kind_mismatch'])
  const old = wireDraft(x)
  expect(composeDraft(x.packet, old, true, true).validation.errors).toEqual(['writing_contract_required'])
  old.ruleLedger.assembly = WRITING_CONTRACT_VERSION
  expect(composeDraft(x.packet, old, true).validation.errors).toEqual(['code_owned_ledger_not_writer_output'])
})

it('keeps decimal values and quoted conditions intact when building review units, without interpreting support', () => {
  const prose = '지표는 3.5였다. “조건이 유지된다면 가능하다.” 다음 관측을 비교한다!'
  const rows = reviewSentences(prose)
  expect(rows).toEqual(['지표는 3.5였다.', '“조건이 유지된다면 가능하다.”', '다음 관측을 비교한다!'])
  expect(rows.join('').replace(/\s/gu, '')).toBe(prose.replace(/\s/gu, ''))
})
