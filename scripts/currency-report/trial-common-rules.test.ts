import { describe, expect, it } from 'vitest'
import { draftAssessment, TRIAL_BUDGET_USD } from './trial-common-rules.js'

describe('historical common-rules trial', () => {
  const result = () => ({ candidate: { title: '검토본' }, safetyValidation: { valid: true }, editorial: { blockers: [] },
    rules: { semanticStatus: 'unverified', checks: [{ ruleId: 'R09', status: 'hold', reason: 'historical_review_only' }] } })
  it('allows inspecting a historical draft without approving content or publication', () => {
    expect(TRIAL_BUDGET_USD).toBe(.25)
    expect(draftAssessment(result())).toMatchObject({ viewable: true, automaticDraftStatus: 'pass', semanticStatus: 'unverified', publicationApproved: false })
  })
  it('retains other structural failures and never projects unsafe candidates', () => {
    const r = result(); r.rules.checks.push({ ruleId: 'R10', status: 'hold', reason: 'missing_claim' })
    expect(draftAssessment(r).automaticDraftStatus).toBe('hold')
    expect(draftAssessment({ ...r, safetyValidation: { valid: false } }).viewable).toBe(false)
    expect(draftAssessment({}).viewable).toBe(false)
  })
})
