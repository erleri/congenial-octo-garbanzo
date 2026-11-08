import { describe, it, expect } from 'vitest'
import { editorialDecision } from './editorial-decision.js'
import { EDITORIAL_CHECKS, EDITORIAL_VERSION } from './editorial.js'
import { fingerprint } from './paid-comparison.js'
import { syntheticReaderReview } from './rule-fixtures.js'

const content = { drivers: [{ title: '물가 해석', text: '새 정보가 확인됐다. 근거가 설명한 연결을 구분한다.' }], implications: [], watch: [] }
const review = () => ({ version: EDITORIAL_VERSION, readerReview: syntheticReaderReview(), contentHash: fingerprint(content), scores: [4,4,4,4,4], criticalErrors: 0, notes: ['원문과 대조한 잠정 검토 결과이며 운영 승인과는 구별한다.'], checks: Object.fromEntries(EDITORIAL_CHECKS.map(key => [key, { passed: true, reason: '실제 문장과 원문 범위를 대조한 판단을 기록했다.' }])) })

describe('editorial comparison admission', () => {
  it('keeps qualified content pending review, never published', () => {
    expect(editorialDecision(content, review())).toMatchObject({ passed: true, status: 'pending_review', preferred: true })
  })
  it('preserves failed evidence review as explicit rejected comparison only', () => {
    const r = review(); r.checks.evidenceFidelity.passed = false
    expect(editorialDecision(content, r)).toMatchObject({ passed: false, status: 'rejected', preferred: false })
  })
  it('rejects critical errors even with high scores and six positive checks', () => {
    const r = review(); r.criticalErrors = 1
    expect(editorialDecision(content, r).passed).toBe(false)
  })
  it('does not accept a review of a different text or incomplete review', () => {
    expect(() => editorialDecision({ ...content, title: 'changed' }, review())).toThrow('incomplete_editorial_review')
    const r = review(); r.checks.newInformation.reason = ''
    expect(() => editorialDecision(content, r)).toThrow('incomplete_editorial_review')
  })
  it('cannot approve invalid scores or duplicate/limitation-only drivers', () => {
    const r = review(); r.scores = [5]
    expect(() => editorialDecision(content, r)).toThrow()
    const limited = { ...content, drivers: [{ title: '관측 한계', text: '관측 시각이 없다. 원인은 확정할 수 없다.' }] }
    const r2 = review(); r2.contentHash = fingerprint(limited)
    expect(editorialDecision(limited, r2).passed).toBe(false)
  })
})
