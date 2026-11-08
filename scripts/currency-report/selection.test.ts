import { describe, expect, it } from 'vitest'
import { chooseWinner } from './paid-comparison.js'
import { EDITORIAL_VERSION, EDITORIAL_CHECKS } from './editorial.js'
import { syntheticReaderReview } from './rule-fixtures.js'

const candidate = label => ({
  label, validationPassed: true, scores: [4, 4, 4, 4, 4], criticalErrors: 0, costUsd: .05,
  rules: { status: 'pass' }, editorial: { blockers: [] },
  editorialReview: { version: EDITORIAL_VERSION, readerReview: syntheticReaderReview(), checks: Object.fromEntries(EDITORIAL_CHECKS.map(key =>
    [key, { passed: true, reason: '합성 검토용 판단이며 실제 승인 기록이 아닙니다.' }])) },
})
describe('comparison selection priority and admission propagation', () => {
  it('ranks quality before price', () => {
    const a = candidate('A'), b = candidate('B')
    a.scores = [5, 5, 5, 5, 4]; b.costUsd = .001
    expect(chooseWinner([a, b])).toBe('A')
  })
  it('breaks equal average by evidence fidelity before price', () => {
    const a = candidate('A'), b = candidate('B')
    a.scores = [4, 4, 4, 4, 5]; b.scores = [5, 4, 4, 4, 4]; b.costUsd = .001
    expect(chooseWinner([a, b])).toBe('A')
  })
  it('breaks equal quality and fidelity by confirmed cost', () => {
    const a = candidate('A'), b = candidate('B'); b.costUsd = .01
    expect(chooseWinner([a, b])).toBe('B')
  })
  it('does not treat an unknown cost as zero', () => {
    const a = { ...candidate('A'), costUsd: null }, b = candidate('B')
    expect(chooseWinner([a, b])).toBe('B')
  })
  it.each([
    ['safety failed', { validationPassed: false }],
    ['rules unverified', { rules: { status: 'unverified' } }],
    ['rules held', { rules: { status: 'hold' } }],
    ['critical error', { criticalErrors: 1 }],
    ['fidelity below minimum', { scores: [5, 5, 5, 5, 3] }],
    ['no editorial review', { editorialReview: undefined }],
    ['editorial blocker', { editorial: { blockers: ['limitation_as_driver'] } }],
  ])('excludes a candidate with %s without losing the qualified alternative', (_name, change) => {
    const a = candidate('A'), b = { ...candidate('B'), ...change }
    expect(chooseWinner([b])).toBeNull()
    expect(chooseWinner([a, b])).toBe('A')
  })
})
