import { expect, it } from 'vitest'
import { currentCase, wireDraft } from './test-support.js'
import { composeDraft } from './openrouter.js'
import { inspectRejectedDraft } from './rejected-draft-inspection.js'

const sample = () => {
  const args = currentCase(), draft = wireDraft(args)
  draft.ruleLedger.claims.find(c => c.target.startsWith('drivers.'))!.target = 'drivers[0].title'
  return { ...args, draft }
}
it('permits read-only local inspection of a target-format failure without repairing or accepting the original ledger', () => {
  const { packet, draft } = sample(), before = structuredClone(draft)
  const inspected = inspectRejectedDraft(packet, draft)
  expect(inspected).toMatchObject({ inspectionOnly: true, candidateAccepted: false, publicationApproved: false, status: 'rejected' })
  expect(inspected.contentForInspection.drivers[0].text).toBe(draft.drivers[0].text)
  expect(draft).toEqual(before)
  expect(composeDraft(packet, draft, true).validation.errors).toContain('draft_schema')
})
it('blocks unsafe prose and unknown sources even when the ledger has the same displayable format error', () => {
  const { packet, draft } = sample()
  draft.drivers[0].text = '비밀키 sk-or-example 및 user@example.com'
  expect(() => inspectRejectedDraft(packet, draft)).toThrow('unsafe_rejected_draft_display')
  draft.drivers[0].text = '원문 설명'
  draft.drivers[0].evidenceIds = ['unknown-source']
  expect(() => inspectRejectedDraft(packet, draft)).toThrow('unsafe_rejected_draft_display')
})
