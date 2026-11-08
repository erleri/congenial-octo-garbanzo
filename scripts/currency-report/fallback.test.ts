import { describe, expect, it, vi } from 'vitest'
import { generateWithBackup, canUseBackup } from './fallback.js'
import { BACKUP_MODEL, DEFAULT_MODEL, EMERGENCY_MODEL } from './openrouter.js'
import { syntheticCase } from './rule-fixtures.js'
import { writerDraft } from './test-support.js'

const synthetic = syntheticCase()
const packet = synthetic.packet
const content = writerDraft(synthetic)
const success = (model = BACKUP_MODEL) => new Response(JSON.stringify({ model, choices: [{ finish_reason: 'stop', message: model === DEFAULT_MODEL ? { tool_calls: [{ function: { name: 'submit_currency_brief', arguments: JSON.stringify(content) } }] } : { content: JSON.stringify(content) } }] }))
const outage = { status: 'failed', reason: 'provider_generation_error', diagnostics: { errorCode: 502 }, attempts: 1 }
const common = { apiKey: 'fake-test-key', packet, privacy: 'public-data' }

describe('local free model backup', () => {

  it('makes one backup call after a failed primary without nested retries', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(success())
    const run = await generateWithBackup({ ...common, fetchImpl })
    expect(run.status).toBe('pending_review')
    expect(run.model).toBe(BACKUP_MODEL)
    expect(run.attempts).toBe(2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(run.trials.map(t => t.requestedModel)).toEqual([DEFAULT_MODEL, BACKUP_MODEL])
  })
  it('does not repeat a primary request when reusing its verified outage record', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(success())
    const run = await generateWithBackup({ ...common, primaryRun: outage, fetchImpl })
    expect(run.attempts).toBe(1)
    expect(run.trials[0].reused).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('stops after primary success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(success(DEFAULT_MODEL))
    expect((await generateWithBackup({ ...common, fetchImpl })).status).toBe('pending_review')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('does not consume the backup twice across automatic and explicit paths', async () => {
    const fetchImpl = vi.fn()
    const run = await generateWithBackup({ ...common, primaryRun: outage, fetchImpl, claimBackup: async () => false })
    expect(run.reason).toBe('backup_slot_already_claimed')
    expect(run.attempts).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it.each(['http_401','http_403','validation_failed','invalid_candidate','provider_content_filter'])('does not bypass %s', async reason => {
    const fetchImpl = vi.fn()
    expect(canUseBackup({ status: 'failed', reason })).toBe(false)
    await generateWithBackup({ ...common, primaryRun: { status: 'failed', reason, attempts: 1 }, fetchImpl })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('uses the random free router only after both fixed models have temporary outages', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(success(EMERGENCY_MODEL))
    const run = await generateWithBackup({ ...common, fetchImpl })
    expect(run.status).toBe('pending_review')
    expect(run.requestedModel).toBe(EMERGENCY_MODEL)
    expect(run.attempts).toBe(3)
    expect(run.trials.map(t => t.requestedModel)).toEqual([DEFAULT_MODEL, BACKUP_MODEL, EMERGENCY_MODEL])
  })
  it('preserves a failed emergency route and stops at three calls', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(new Response('', { status: 502 })))
    const run = await generateWithBackup({ ...common, fetchImpl })
    expect(run.status).toBe('failed')
    expect(run.attempts).toBe(3)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
  it('does not use the random router when the fixed backup returns invalid content', async () => {
    const badContent = { ...content, summary: '관측값은 10입니다.' }
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: BACKUP_MODEL, choices: [{ message: { content: JSON.stringify(badContent) } }] })))
    const run = await generateWithBackup({ ...common, privacy: 'strict', primaryRun: outage, fetchImpl })
    expect(run.reason).toBe('validation_failed')
    expect(run.validation.errors).toEqual(['untrusted_text'])
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).provider).toMatchObject({ data_collection: 'deny', zdr: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(run.trials).toHaveLength(2)
  })
  it('does not consume an emergency route twice', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 503 }))
    const run = await generateWithBackup({ ...common, primaryRun: outage, fetchImpl, claimEmergency: async () => false })
    expect(run.reason).toBe('emergency_slot_already_claimed')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('rejects unapproved primary models without network access', async () => {
    const fetchImpl = vi.fn()
    await expect(generateWithBackup({ ...common, model: 'paid/model', fetchImpl })).rejects.toThrow('unsupported_primary_for_backup')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('records the requested emergency router on repeated timeouts without claiming an actual returned model', async () => {
    const fetchImpl = vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort')))))
    const run = await generateWithBackup({ ...common, primaryRun: outage, fetchImpl, timeoutMs: 5 })
    expect(run.reason).toBe('timeout')
    expect(run.requestedModel).toBe(EMERGENCY_MODEL)
    expect(run.model).toBeUndefined()
    expect(run.attempts).toBe(2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

})
