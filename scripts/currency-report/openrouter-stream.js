// Node-only transport. Partial text and checkpoint records are PRIVATE diagnostics,
// never publishable reports. This module does not retry or choose another model.
const generationId = value => typeof value === 'string' && /^gen-[a-zA-Z0-9-]{1,200}$/.test(value) ? value : null
const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

export async function reconcileGenerationCost({ responseId, apiKey, fetchImpl = fetch }) {
  if (!generationId(responseId) || !apiKey) throw new Error('invalid_cost_lookup')
  const result=(reason,status=null,costUsd=null)=>({costUsd,costSource:costUsd===null?'unknown':'generation.total_cost',
    lookup:{version:'generation-cost-lookup/1',reason,httpStatus:status}})
  try {
    let response
    for(let attempt=0;attempt<2;attempt++){
      try{response=await fetchImpl(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(responseId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10000),
      })}catch(error){if(attempt===0)continue;return result(error?.name==='TimeoutError'||error?.name==='AbortError'?'timeout':'network_error')}
      if(response.status<500||attempt===1)break
      await response.body?.cancel().catch(()=>{})
    }
    if(!response.ok)return result(({401:'authentication_error',403:'permission_error',404:'record_not_found',429:'lookup_rate_limited'})[response.status]
      ??(response.status>=500?'provider_error':'http_error'),response.status)
    let payload
    try{payload=await response.json()}catch{return result('invalid_json',response.status)}
    // Refuse a mismatched activity record rather than attributing another call's cost.
    if(payload.data?.id!==responseId)return result('identity_mismatch',response.status)
    if(typeof payload.data.finish_reason!=='string'||!payload.data.finish_reason)return result('completion_not_confirmed',response.status)
    const costUsd = money(payload.data.total_cost)
    return result(costUsd===null?'cost_missing':'confirmed',response.status,costUsd)
  } catch { return result('lookup_error') }
}

export async function callOpenRouterStream({ body, apiKey, fetchImpl = fetch,
  timeoutMs = 240000, idleMs = 60000, maxBytes = 500000, checkpoint = async () => {} }) {
  if (!apiKey) throw new Error('missing_key')
  if (![timeoutMs, idleMs, maxBytes].every(v => Number.isSafeInteger(v) && v > 0)) throw new Error('invalid_stream_limits')
  if (body.stream !== true || body.provider?.zdr !== true || body.provider?.data_collection !== 'deny' ||
    body.provider?.allow_fallbacks !== false || body.provider?.only?.length !== 1) throw new Error('unsafe_stream_request')
  const serialized = JSON.stringify(body)
  if (serialized.includes(apiKey)) throw new Error('credential_in_request_body')
  const start = Date.now(), controller = new AbortController()
  const state = { responseId: null, actualModel: null, partialText: '', usage: null,
    headersMs: null, firstEventMs: null, firstContentMs: null, comments: 0, events: 0,
    finishReason: null, done: false, bytes: 0, providerError: null }
  let reader, raw = '', buffer = '', data = [], error = null, httpStatus = null, retryAfterAt = null
  const elapsed = () => Date.now() - start
  const record = async phase => {
    if (JSON.stringify(state).includes(apiKey)) throw new Error('credential_in_response')
    await checkpoint({ ...state, usage: structuredClone(state.usage), phase, elapsedMs: elapsed() })
  }
  const bounded = async operation => {
    const remaining = timeoutMs - elapsed()
    if (remaining <= 0) throw new Error('stream_total_timeout')
    let timer
    try {
      return await Promise.race([operation(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(remaining <= idleMs ? 'stream_total_timeout' : 'stream_idle_timeout')), Math.min(remaining, idleMs))
      })])
    } finally { clearTimeout(timer) }
  }
  const acceptId = id => {
    const clean = generationId(id)
    if (!clean) return
    if (state.responseId && clean !== state.responseId) throw new Error('generation_id_mismatch')
    state.responseId = clean
  }
  const event = async () => {
    if (!data.length) return
    const text = data.join('\n'); data = []
    if (state.done) throw new Error('event_after_done')
    if (text === '[DONE]') { state.done = true; await record('done'); return }
    let payload
    try { payload = JSON.parse(text) } catch { throw new Error('invalid_sse_json') }
    if (JSON.stringify(payload).includes(apiKey)) throw new Error('credential_in_response')
    state.firstEventMs ??= elapsed(); state.events++
    acceptId(payload.id)
    if (payload.model) {
      if (state.actualModel && payload.model !== state.actualModel) throw new Error('stream_model_changed')
      state.actualModel = payload.model
    }
    if (payload.usage) {
      if (state.usage && money(state.usage.cost) !== null && money(payload.usage.cost) !== money(state.usage.cost)) throw new Error('usage_cost_changed')
      const u = payload.usage
      state.usage = { cost: money(u.cost), prompt_tokens: u.prompt_tokens ?? null,
        completion_tokens: u.completion_tokens ?? null,
        completion_tokens_details: { reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? null } }
    }
    if (payload.error) { state.providerError = payload.error; throw new Error('provider_stream_error') }
    if ((payload.choices ?? []).some(c => c.index !== undefined && c.index !== 0)) throw new Error('multiple_stream_choices')
    for (const choice of payload.choices ?? []) {
      if (choice.finish_reason === 'error') throw new Error('provider_stream_error')
      if (choice.finish_reason) {
        if (state.finishReason && state.finishReason !== choice.finish_reason) throw new Error('finish_reason_changed')
        state.finishReason = choice.finish_reason
      }
      if (typeof choice.delta?.content === 'string' && choice.delta.content.length) {
        state.firstContentMs ??= elapsed()
        state.partialText += choice.delta.content
        if (state.partialText.includes(apiKey)) throw new Error('credential_in_response')
      }
    }
    await record('event')
  }
  const line = async text => {
    if (!text) return event()
    if (text.startsWith(':')) { state.comments++; return }
    if (text.startsWith('data:')) data.push(text.slice(5).replace(/^ /, ''))
  }
  try {
    const response = await bounded(() => fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: serialized,
    }))
    httpStatus = response.status; state.headersMs = elapsed()
    const retryAfter=response.headers.get('retry-after')
    if(retryAfter){const until=/^\d+$/.test(retryAfter)?Date.now()+Number(retryAfter)*1000:Date.parse(retryAfter)
      if(Number.isFinite(new Date(until).getTime())&&until>Date.now())retryAfterAt=new Date(until).toISOString()}
    acceptId(response.headers.get('x-generation-id'))
    await record('headers')
    if (!response.body) throw new Error('missing_response_body')
    reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const sse = response.ok && response.headers.get('content-type')?.includes('text/event-stream')
    while (true) {
      const chunk = await bounded(() => reader.read())
      if (chunk.done) break
      state.bytes += chunk.value.byteLength
      if (state.bytes > maxBytes) throw new Error('stream_size_limit')
      const text = decoder.decode(chunk.value, { stream: true })
      raw += text
      if (raw.includes(apiKey)) throw new Error('credential_in_response')
      if (!sse) continue
      buffer += text
      // Preserve a trailing CR across chunks; accept CRLF, CR, or LF SSE lines.
      let match
      while ((match = /\r\n|\n|\r(?!$)/.exec(buffer))) {
        const before = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        await line(before)
      }
    }
    const tail = decoder.decode()
    raw += tail; buffer += tail
    if (!sse) {
      let payload
      try { payload = JSON.parse(raw) } catch { payload = {} }
      if (JSON.stringify(payload).includes(apiKey)) throw new Error('credential_in_response')
      acceptId(payload.id)
      state.usage = payload.usage ? { cost: money(payload.usage.cost) } : null
      state.providerError = payload.error ?? null
      throw new Error(response.ok ? 'expected_event_stream' : `http_${response.status}`)
    }
    // EOF does not terminate an unfinished SSE event or substitute for [DONE].
    if (!state.done || buffer.trim() || data.length) throw new Error('stream_incomplete')
    if (state.finishReason !== 'stop') throw new Error(state.finishReason === 'length' ? 'output_truncated' : 'stream_incomplete')
    if (!(state.actualModel === body.model || state.actualModel?.startsWith(body.model + '-20'))) throw new Error('returned_model_mismatch')
  } catch (caught) {
    error = /^[a-z_]+(?:_\d+)?$/.test(caught.message ?? '') ? caught.message : 'stream_transport_error'
    controller.abort()
    if (reader) void reader.cancel().catch(() => {})
    if (error === 'credential_in_response') { state.partialText = ''; state.actualModel = null; state.usage = null; state.providerError = null }
  } finally { reader?.releaseLock() }
  const costUsd = money(state.usage?.cost)
  const result = { ...state, valid: !error, errors: error ? [error] : [], httpStatus,...(retryAfterAt?{retryAfterAt}:{}),
    latencyMs: elapsed(), costUsd, costSource: costUsd === null ? 'unknown' : 'usage.cost',
    generationCalls: 1, retries: 0,
    // Only COMPLETE transport output may be passed to existing full report checks.
    payload: !error ? { id: state.responseId, model: state.actualModel, usage: state.usage,
      choices: [{ finish_reason: 'stop', message: { content: state.partialText } }] } : null }
  await checkpoint({ ...result, phase: 'result' })
  return result
}
