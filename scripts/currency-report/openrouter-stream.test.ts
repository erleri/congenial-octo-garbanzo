import { describe, expect, it, vi } from 'vitest'
import { callOpenRouterStream, reconcileGenerationCost } from './openrouter-stream.js'

// Synthetic protocol replays. These exercise transport, not provider availability
// or report quality. No real API request is made by this suite.
const key = 'synthetic-test-key'
const body = { stream: true, model: 'test/model', messages: [],
  provider: { only: ['test/provider'], zdr: true, data_collection: 'deny', allow_fallbacks: false } }
const encode = new TextEncoder()
const event = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`
const chunk = (content: string, finish: string | null = null) => ({ id: 'gen-test', model: body.model,
  choices: [{ index: 0, delta: { content }, finish_reason: finish }] })
const response = (parts: Uint8Array[], headers = {}) => new Response(new ReadableStream({ start(c) { parts.forEach(p => c.enqueue(p)); c.close() } }),
  { headers: { 'content-type': 'text/event-stream', 'x-generation-id': 'gen-test', ...headers } })
const call = (text: string, options = {}) => callOpenRouterStream({ body, apiKey: key,
  fetchImpl: vi.fn(async () => response([encode.encode(text)])), ...options })

describe('private streaming diagnostic transport', () => {
  it('reassembles fragmented Korean UTF-8 and CRLF, ignores keepalives, and accepts a repeated finish in the usage chunk', async () => {
    const text = ': OPENROUTER PROCESSING\r\n\r\n' + event(chunk('한글')) + event(chunk('', 'stop')) +
      event({ id: 'gen-test', choices: [{ delta: {}, finish_reason: 'stop' }], usage: { cost: .002, prompt_tokens: 10, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 8 } } }) + 'data: [DONE]\r\n\r\n'
    const bytes = encode.encode(text), records: Array<{ phase: string; partialText: string }> = []
    const result = await callOpenRouterStream({ body, apiKey: key,
      fetchImpl: vi.fn(async () => response(Array.from(bytes, b => Uint8Array.of(b)))), checkpoint: async r => { records.push(r) } })
    expect(result.valid).toBe(true)
    expect(result.partialText).toBe('한글')
    expect(result.comments).toBe(1)
    expect(result.costUsd).toBe(.002)
    expect(result.usage.completion_tokens_details.reasoning_tokens).toBe(8)
    expect(records[0]).toMatchObject({ phase: 'headers', partialText: '' })
    expect(result.firstContentMs).not.toBeNull()
  })
  it('preserves partial text, header ID and usage on interrupted EOF without admitting a candidate payload', async () => {
    const result = await call(event(chunk('일부')) + event({ usage: { cost: .01 } }))
    expect(result).toMatchObject({ valid: false, responseId: 'gen-test', partialText: '일부', costUsd: .01, payload: null })
    expect(result.errors).toEqual(['stream_incomplete'])
  })
  it('distinguishes HTTP JSON rejection from an error delivered inside a successful HTTP stream', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: 400 } }), { status: 400 }))
    expect(await call('', { fetchImpl })).toMatchObject({ errors: ['http_400'], providerError: { code: 400 } })
    expect((await call(event(chunk('途中')) + event({ error: { code: 500 } }))).errors).toEqual(['provider_stream_error'])
  })
  it('retains the early generation ID when the body goes idle before a token arrives, and makes no retry', async () => {
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream({ start() {} }), {
      headers: { 'content-type': 'text/event-stream', 'x-generation-id': 'gen-idle' } }))
    vi.useFakeTimers()
    try {
      const pending = call('', { fetchImpl, idleMs: 5, timeoutMs: 1000 })
      await vi.advanceTimersByTimeAsync(10)
      const result = await pending
      expect(result).toMatchObject({ responseId: 'gen-idle', firstContentMs: null, costUsd: null, retries: 0 })
      expect(result.errors).toEqual(['stream_idle_timeout'])
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })
  it('enforces the total deadline even if processing comments keep the socket alive', async () => {
    let interval: ReturnType<typeof setInterval>
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream({
      start(c) { interval = setInterval(() => c.enqueue(encode.encode(': processing\n\n')), 2) },
      cancel() { clearInterval(interval) },
    }), { headers: { 'content-type': 'text/event-stream' } }))
    vi.useFakeTimers()
    try {
      const pending = call('', { fetchImpl, timeoutMs: 25, idleMs: 1000 })
      await vi.advanceTimersByTimeAsync(30)
      const result = await pending
      expect(result.errors).toEqual(['stream_total_timeout'])
      expect(result.firstContentMs).toBeNull()
      expect(result.comments).toBeGreaterThan(0)
    } finally { clearInterval(interval!); vi.useRealTimers() }
  })
  it('never repairs truncated model output even when an end marker was received', async () => {
    const result = await call(event(chunk('{', 'length')) + 'data: [DONE]\n\n')
    expect(result.errors).toEqual(['output_truncated'])
    expect(result.payload).toBeNull()
  })
  it('rejects a header/event ID conflict so cost cannot be attributed to the wrong generation', async () => {
    const result = await call(event({ ...chunk('x'), id: 'gen-other' }))
    expect(result.errors).toEqual(['generation_id_mismatch'])
    expect(result.responseId).toBe('gen-test')
  })
  it('bounds buffered data and suppresses credential echoes before checkpointing them', async () => {
    expect((await call(event(chunk('x'.repeat(100))), { maxBytes: 10 })).errors).toEqual(['stream_size_limit'])
    const records: unknown[] = []
    const result = await call(event(chunk(key)), { checkpoint: async (r: unknown) => { records.push(r) } })
    expect(result.errors).toEqual(['credential_in_response'])
    expect(JSON.stringify(records)).not.toContain(key)
    expect(result.partialText).toBe('')
  })
  it('fails closed before POST when privacy constraints are missing', async () => {
    const fetchImpl = vi.fn()
    await expect(call('', { body: { ...body, provider: { ...body.provider, zdr: false } }, fetchImpl })).rejects.toThrow('unsafe_stream_request')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('uses only a matching ID for read-only cost reconciliation and retains unknown cost otherwise', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://openrouter.ai/api/v1/generation?id=gen-test')
      return new Response(JSON.stringify({ data: { id: 'gen-test', finish_reason: 'stop', total_cost: .003 } }))
    })
    expect(await reconcileGenerationCost({ responseId: 'gen-test', apiKey: key, fetchImpl })).toEqual({ costUsd: .003, costSource: 'generation.total_cost' })
    const mismatch = vi.fn(async () => new Response(JSON.stringify({ data: { id: 'gen-other', total_cost: .003 } })))
    expect((await reconcileGenerationCost({ responseId: 'gen-test', apiKey: key, fetchImpl: mismatch })).costUsd).toBeNull()
    const pending = vi.fn(async () => new Response(JSON.stringify({ data: { id: 'gen-test', finish_reason: null, total_cost: 0 } })))
    expect((await reconcileGenerationCost({ responseId: 'gen-test', apiKey: key, fetchImpl: pending })).costUsd).toBeNull()
  })
})
