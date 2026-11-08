// Deliberately offline. Unlisted URLs fail; there is no fetch/network fallback.
export const REPLAY_LIMITS = Object.freeze({ maxRequests: 12, maxOriginals: 6, maxBytes: 12_000_000,
  maxBytesPerRequest: 2_000_000, timeoutMs: 120_000 })

export function createResearchReplayTransport(responses = [], overrides = {}, now = Date.now) {
  const limits = { ...REPLAY_LIMITS, ...overrides }
  if (Object.keys(limits).some(k => !Object.hasOwn(REPLAY_LIMITS, k) || !Number.isInteger(limits[k]) || limits[k] < 0 || limits[k] > REPLAY_LIMITS[k])
    || !Array.isArray(responses) || responses.length > 40 || typeof now !== 'function') throw new Error('invalid_replay_limits_or_responses')
  const fixtures = new Map()
  for (const r of responses) {
    if (!r || typeof r.url !== 'string' || fixtures.has(r.url) || typeof r.body !== 'string'
      || (r.status !== undefined && (!Number.isInteger(r.status) || r.status < 200 || r.status > 599))
      || (r.contentType !== undefined && typeof r.contentType !== 'string')
      || (r.error !== undefined && !['timeout', 'transport'].includes(r.error))) throw new Error('invalid_replay_response')
    fixtures.set(r.url, structuredClone(r))
  }
  const started = now(), ledger = []
  let bytes = 0
  const fetchImpl = async (url, options = {}) => {
    const entry = { url: String(url), status: 'reserved', bytes: 0 }
    const reason = ledger.filter(r => r.attempted).length >= limits.maxRequests ? 'request_limit'
      : now() - started >= limits.timeoutMs ? 'time_limit'
      : options.signal?.aborted ? 'aborted' : null
    ledger.push(entry)
    if (reason) { Object.assign(entry, { status: 'blocked', reason, attempted: false }); throw new Error('replay_request_blocked') }
    entry.attempted = true
    const fixture = fixtures.get(String(url))
    if (!fixture || fixture.error) {
      Object.assign(entry, { status: 'failed', reason: fixture?.error ?? 'fixture_missing' })
      throw new Error('replay_transport_failure')
    }
    const size = Buffer.byteLength(fixture.body)
    if (size > limits.maxBytesPerRequest || bytes + size > limits.maxBytes) {
      Object.assign(entry, { status: 'blocked', reason: size > limits.maxBytesPerRequest ? 'response_size_limit' : 'total_size_limit' })
      throw new Error('replay_size_limit')
    }
    bytes += size
    Object.assign(entry, { status: 'returned', bytes: size, httpStatus: fixture.status ?? 200 })
    return new Response(fixture.body, { status: fixture.status ?? 200,
      headers: { 'content-type': fixture.contentType ?? 'text/html', 'content-length': String(size) } })
  }
  return { fetchImpl, limits, ledger, snapshot: () => ({ simulatedRequests: ledger.filter(r => r.attempted).length,
    simulatedBytes: bytes, blockedRequests: ledger.filter(r => r.status === 'blocked').length,
    networkCalls: 0, modelCalls: 0, apiCostUsd: 0 }) }
}
