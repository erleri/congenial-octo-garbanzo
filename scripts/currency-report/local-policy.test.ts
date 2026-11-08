import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL } from './openrouter.js'
import { diagnosticAllowed, outageRetryAllowed, policyRetryAllowed } from './local-policy.js'

describe('explicit local replay authorization', () => {
  it('permits explicit outage retries only for the same data, model and privacy policy', () => {
    const prior = { status: 'failed', reason: 'provider_generation_error', diagnostics: { errorCode: 502 }, privacy: 'public-data', requestedModel: DEFAULT_MODEL, fingerprint: 'same', packet: { currency: 'BRL', baseDate: '2025-06-20' } }
    const args = { prior, privacy: 'public-data', model: DEFAULT_MODEL, fingerprint: 'same', currency: 'BRL', baseDate: '2025-06-20' }
    expect(outageRetryAllowed(args)).toBe(true)
    expect(outageRetryAllowed({ ...args, fingerprint: 'new' })).toBe(false)
    expect(outageRetryAllowed({ ...args, privacy: 'strict' })).toBe(false)
    expect(outageRetryAllowed({ ...args, prior: { ...prior, reason: 'validation_failed' } })).toBe(false)
    expect(outageRetryAllowed({ ...args, prior: { ...prior, diagnostics: { errorCode: 401 } } })).toBe(false)
    expect(outageRetryAllowed({ ...args, prior: { ...prior, status: 'pending_review' } })).toBe(false)
  })
  it('permits a policy-change trial only after the matching strict 404, not arbitrary replays', () => {
    const run = { status: 'failed', reason: 'http_404', fingerprint: 'same', model: DEFAULT_MODEL, packet: { currency: 'BRL', baseDate: '2025-06-20' } }
    const args = { privacy: 'public-data', retry: true, runs: [run], currency: 'BRL', baseDate: '2025-06-20', fingerprint: 'same', model: DEFAULT_MODEL }
    expect(policyRetryAllowed(args)).toBe(true)
    expect(policyRetryAllowed({ ...args, retry: false })).toBe(false)
    expect(policyRetryAllowed({ ...args, fingerprint: 'changed' })).toBe(false)
    expect(policyRetryAllowed({ ...args, runs: [{ ...run, reason: 'http_401' }] })).toBe(false)
    expect(policyRetryAllowed({ ...args, runs: [{ ...run, privacy: 'public-data' }] })).toBe(false)
    const legacy = { ...args, runs: [{ ...run, model: undefined }] }
    expect(policyRetryAllowed(legacy)).toBe(false)
    expect(policyRetryAllowed({ ...legacy, originalClaim: { model: DEFAULT_MODEL, fingerprint: 'same' } })).toBe(true)
    expect(policyRetryAllowed({ ...legacy, originalClaim: { model: DEFAULT_MODEL, fingerprint: 'other' } })).toBe(false)
  })
  it('only diagnoses the matching legacy parse failure without a preserved response', () => {
    const run = { status: 'failed', reason: 'invalid_candidate', privacy: 'public-data', fingerprint: 'same', requestedModel: DEFAULT_MODEL, packet: { currency: 'BRL', baseDate: '2025-06-20' } }
    const args = { privacy: 'public-data', runs: [run], currency: 'BRL', baseDate: '2025-06-20', fingerprint: 'same', model: DEFAULT_MODEL }
    expect(diagnosticAllowed(args)).toBe(true)
    expect(diagnosticAllowed({ ...args, fingerprint: 'other' })).toBe(false)
    expect(diagnosticAllowed({ ...args, runs: [{ ...run, raw: '{}' }] })).toBe(false)
    expect(diagnosticAllowed({ ...args, privacy: 'strict' })).toBe(false)
  })
})
