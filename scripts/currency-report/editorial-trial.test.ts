import { describe, expect, it, vi } from 'vitest'
import { reserveStage, executeEditorialTrial, generationBody } from './run-clp-editorial-trial.js'
import { syntheticCase, syntheticUsdApplication, syntheticLedger } from './rule-fixtures.js'
import { selectMechanisms, evaluateRules } from './rules.js'
import { wireDraft } from './test-support.js'

function arithmeticCase() {
  const a = syntheticCase('CLP'), app = syntheticUsdApplication(a.packet)
  a.packet.mechanismApplications = [app]
  a.content.implications = [{ title: '같은 달러 대금의 환산', text: '같은 달러 금액을 헤지하지 않았다면 현지통화 환산액은 관측 환율에 비례한다.', kind: 'mechanism', factIds: [], evidenceIds: [] }]
  a.ledger = syntheticLedger(a.packet, a.content)
  for (const row of a.ledger.claims.filter(c => c.target.startsWith('implications.'))) Object.assign(row, {
    kind: 'mechanism', evidenceIds: [], factIds: a.packet.facts.map(f => f.id), mechanismId: app.mechanismId, applicationId: app.id })
  return a
}
describe('approved conditional arithmetic and bounded editorial execution', () => {
  it('supports arithmetic with facts and stated assumptions without inventing an article citation', () => {
    const a = arithmeticCase()
    expect(selectMechanisms(a.packet).checks).toEqual([])
    expect(evaluateRules(a).automaticStatus).toBe('pass')
    a.ledger.claims.at(-1).factIds = []
    expect(evaluateRules(a).checks.some(c => c.ruleId === 'R12' && c.status === 'hold')).toBe(true)
    const b = arithmeticCase(); b.packet.mechanismApplications[0].conditions[1].basis.assumptions = ['unhedged']
    expect(selectMechanisms(b.packet).selected).toEqual([])
    const c = arithmeticCase(); c.packet.mechanismApplications[0].review.origin = 'agent'
    expect(selectMechanisms(c.packet).selected).toEqual([])
  })
  it('reserves each paid stage once and keeps missing cost committed before the next stage', () => {
    const body = generationBody(syntheticCase('CLP').packet)
    const first = reserveStage([], 'generation', body)
    expect(first).toMatchObject({ reservedUsd: .09444, costUsd: null })
    expect(() => reserveStage([first], 'generation', body)).toThrow('invalid_or_duplicate_stage')
    expect(() => reserveStage([{ name: 'other', costUsd: null, reservedUsd: .30 }], 'generation', body)).toThrow('stage_budget_exceeded')
    const oversized = structuredClone(body); oversized.messages[1].content += 'a'.repeat(45000)
    expect(() => reserveStage([], 'generation', oversized)).toThrow('invalid_or_duplicate_stage')
  })
  it('stops an unsafe generated manuscript before buying review or another generation', async () => {
    const a = syntheticCase('CLP'), draft = wireDraft(a)
    draft.drivers[0].text = '검토 범위 밖의 이메일 reader@example.org가 포함되었다.'
    const invoke = vi.fn(async () => draft)
    const result = await executeEditorialTrial({ packet: a.packet, invoke })
    expect(result.status).toBe('generation_hold')
    expect(invoke.mock.calls.map(c => c[0])).toEqual(['generation'])
    expect(result.publicationApproved).toBe(false)
  })
  it('reviews a saved directive draft without repurchasing generation and keeps an inconclusive review unapproved', async () => {
    const a = syntheticCase('CLP')
    a.content.watch = [{ title: '정책 기대의 지속 여부', text: '정책 기대의 변화를 확인해야 합니다.', kind: 'interpretation', factIds: [], evidenceIds: [a.packet.evidence[0].id] }]
    const invoke = vi.fn(async (_name, body) => {
      const p = JSON.parse(body.messages[1].content)
      return { version: p.version, binding: p.binding, origin: 'agent', reviewer: 'Synthetic inconclusive review',
        claims: p.claims.map(c => ({ id: c.id, claimHash: c.claimHash, support: 'unverified', decision: 'keep', issue: 'verification_gap',
          reason: '합성 검토 대역은 이 설명의 지지를 확인하지 않았다.', anchors: [], applicationIds: [],
          subclaims: [{ quote: c.quote, support: 'unverified', reason: '원문 범위를 확인하지 않은 합성 검토다.', anchors: [], applicationIds: [] }] })) }
    })
    const result = await executeEditorialTrial({ packet: a.packet, savedDraft: wireDraft(a), invoke })
    expect(invoke.mock.calls.map(c => c[0])).toEqual(['review'])
    expect(result.status).toBe('unverified')
    expect(result.publicationApproved).toBe(false)
  })
})
