import { describe, expect, it } from 'vitest'
import { evaluationOptions } from './local-policy.js'

describe('explicit local long-running evaluation', () => {
  it('leaves normal generation at its existing defaults', () => {
    expect(evaluationOptions({ mode: 'live-local', action: 'generate' })).toBeNull()
  })
  it('assigns a fixed atomic slot and bounded 120 second timeout', () => {
    expect(evaluationOptions({ mode: 'live-local', action: 'evaluate', evaluationId: 'brl-120s-20260913' })).toEqual({ timeoutMs: 120000, target: 'chain', claimName: 'evaluation-brl-120s-20260913-call.json' })
  })
  it('allows an explicit backup-only evaluation but no arbitrary model target', () => {
    expect(evaluationOptions({ mode: 'live-local', action: 'evaluate', evaluationId: 'backup-only', target: 'backup' })?.target).toBe('backup')
    expect(() => evaluationOptions({ mode: 'live-local', action: 'evaluate', evaluationId: 'backup-only', target: 'paid' })).toThrow('invalid_local_evaluation')
    expect(() => evaluationOptions({ mode: 'live-local', action: 'generate', target: 'backup' })).toThrow('evaluation_id_requires_evaluate')
  })
  it.each(['', '../outside', 'UPPER', 'a/b'])('rejects unsafe/missing evaluation identifiers: %s', evaluationId => {
    expect(() => evaluationOptions({ mode: 'live-local', action: 'evaluate', evaluationId })).toThrow('invalid_local_evaluation')
  })
  it('rejects other modes and mixed retry flags', () => {
    expect(() => evaluationOptions({ mode: 'fixture', action: 'evaluate', evaluationId: 'test' })).toThrow('invalid_local_evaluation')
    expect(() => evaluationOptions({ mode: 'live-local', action: 'evaluate', evaluationId: 'test', conflictingFlags: true })).toThrow('invalid_local_evaluation')
    expect(() => evaluationOptions({ mode: 'live-local', action: 'generate', evaluationId: 'test' })).toThrow('evaluation_id_requires_evaluate')
  })
})
