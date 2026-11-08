import { createHash } from 'node:crypto'
import { requestBody, composeDraft } from './openrouter.js'
import { editorialReviewPassed } from './editorial.js'
import { RULE_VERSION } from './rules.js'

export const PROFILES = Object.freeze({
  'openai/gpt-5.4': { prompt: 2.5, completion: 15 },
  'openai/gpt-5.4-mini': { prompt: .75, completion: 4.5 },
})
export const BUDGET_USD = 1
export const MAX_OUTPUT = 8192
export const MAX_INPUT = 32000
export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const transient = code => code === 429 || [500, 502, 503, 504].includes(code)
const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

// AJV accepts untyped enum/const nodes, but Azure strict structured output rejects them.
// Validate the transmitted schema before reserving or spending money, not only model output.
export function assertProviderSchema(schema) {
  const visit = node => {
    const type=Array.isArray(node?.type)&&node.type.length===2&&node.type.includes('null')?node.type.find(t=>t!=='null'):node?.type
    if (!node || !['string', 'number', 'integer', 'boolean', 'object', 'array'].includes(type)) throw new Error('provider_schema_type_required')
    if (Object.hasOwn(node, 'const') || Object.hasOwn(node, 'uniqueItems')) throw new Error('provider_schema_unsupported_keyword')
    if (type === 'object') {
      const keys = Object.keys(node.properties ?? {})
      if (node.additionalProperties !== false || !Array.isArray(node.required) || node.required.length !== keys.length ||
        !keys.every(k => node.required.includes(k))) throw new Error('provider_schema_required_properties')
      Object.values(node.properties).forEach(visit)
    }
    if (type === 'array') visit(node.items)
  }
  visit(schema)
}

export function localDraftGate(packet) {
  return packet.currency === 'CLP' && packet.baseDate === '2026-09-11' && packet.observedDate === packet.baseDate &&
    packet.evidence.length > 0 && packet.evidence.every(e => e.review?.originalVerified === true && e.review?.admission === 'attributed_context') &&
    packet.evidence.some(e => e.eventDate === packet.baseDate && e.provenance === 'market_reporting')
}
export function paidBody(packet, model) {
  if (!Object.hasOwn(PROFILES, model)) throw new Error('paid_model_not_authorized')
  if (!localDraftGate(packet)) throw new Error('original_source_gate_failed')
  // Reuse the same public projection and safety guard as the free path, without changing its defaults.
  const base = requestBody(packet, 'openrouter/free', 'strict')
  const schema = JSON.parse(JSON.stringify(base.response_format.json_schema.schema, (key, value) => key === 'uniqueItems' ? undefined : value))
  assertProviderSchema(schema)
  const input = JSON.parse(base.messages[1].content)
  input.evidence = input.evidence.map(e => ({ ...e, role: 'context', attributionOnly: true }))
  const messages = [
    { role: 'system', content: base.messages[0].content + '\n과거 사례의 사후 검토 초안이다. 핵심 본문은 약 구백~천사백 자를 목표로 하되 근거가 적으면 더 짧게 쓴다. 구리·미국 요인의 서로 다른 연결과 소비환경을 설명한다. 원문 검토에서 허용된 admittedScope를 지키고, sharedLimitations는 본문에 되풀이하지 않는다. 이 제약은 구체적 반대 근거를 숨기라는 뜻이 아니다.' },
    { role: 'user', content: JSON.stringify(input) },
  ]
  const body = { model, messages, reasoning: { effort: 'medium' }, max_completion_tokens: MAX_OUTPUT,
    response_format: { type: 'json_schema', json_schema: { name: 'currency_brief', strict: true, schema } },
    provider: { only: ['azure'], require_parameters: true, data_collection: 'deny', zdr: true, allow_fallbacks: false, max_price: PROFILES[model] },
  }
  if (/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|-----BEGIN .*PRIVATE KEY|bearer\s+\S+/i.test(JSON.stringify(messages))) throw new Error('unsafe_public_input')
  inputUpperBound(body)
  return body
}
export function inputUpperBound(body) {
  // Byte-level BPE: <= one token per UTF-8 byte plus conservative message/schema framing.
  const bound = Buffer.byteLength(JSON.stringify({ messages: body.messages, response_format: body.response_format }), 'utf8') + 4096
  if (bound > MAX_INPUT) throw new Error('input_budget_exceeded')
  return bound
}
export function reservationFor(body) {
  const prices = PROFILES[body.model]
  if (!prices || (body.max_completion_tokens ?? body.max_tokens) !== MAX_OUTPUT) throw new Error('invalid_budget_profile')
  return Math.ceil((inputUpperBound(body) * prices.prompt + MAX_OUTPUT * prices.completion) / 1e6 * 1e9) / 1e9
}
export function reserve(ledger, model, attempt, body, routingCorrectionApproved = false) {
  if (![1, 2].includes(attempt) || body.model !== model) throw new Error('attempt_not_allowed')
  if (ledger.some(r => r.model === model && r.attempt === attempt)) throw new Error('duplicate_call')
  const prior = ledger.find(r => r.model === model && r.attempt === 1)
  if (attempt === 2 && (!prior || (prior.retryable !== true && !(routingCorrectionApproved && prior.reason === 'zdr_routing_404')))) throw new Error('retry_not_allowed')
  const amount = reservationFor(body)
  const committed = ledger.reduce((sum, r) => sum + (money(r.costUsd) ?? r.reservedUsd), 0)
  if (committed + amount > BUDGET_USD) throw new Error('total_budget_exceeded')
  return { model, attempt, reservedUsd: amount, costUsd: null, state: 'reserved', retryable: false }
}
// Default is offline legacy replay. Every actual paid call below requires the current contract.
export function parsePaidResponse(payload, packet, model, commonRules = false, requireWriterContract = false) {
  if (payload.error) return { valid: false, errors: ['provider_error'], retryable: transient(Number(payload.error.code)) }
  if (!(payload.model === model || payload.model?.startsWith(model + '-20'))) return { valid: false, errors: ['returned_model_mismatch'], retryable: false }
  const c = payload.choices?.[0]
  if (c?.finish_reason !== 'stop') return { valid: false, errors: [c?.finish_reason === 'length' ? 'output_truncated' : 'incomplete_response'], retryable: false }
  try {
    const draft = JSON.parse(c.message.content)
    const { candidate, validation, editorial, rules, ruleLedger, claimReview, assemblyVersion } = composeDraft(packet, draft, commonRules, requireWriterContract)
    return { ...validation, valid: validation.valid && editorial?.blockers.length === 0 && (!commonRules || rules?.automaticStatus === 'pass'),
      errors: [...validation.errors, ...(editorial?.blockers ?? []).map(code => `editorial:${code}`), ...(rules?.checks ?? []).filter(c => c.status === 'hold').map(c => `common:${c.ruleId}`)],
      safetyValidation: validation, editorial, rules, ruleLedger, claimReview, assemblyVersion, candidate, retryable: false }
  } catch { return { valid: false, errors: ['invalid_candidate_json'], retryable: false } }
}
export async function callPaid({ body, packet, apiKey, fetchImpl = fetch, timeoutMs = 120000 }) {
  if (!body.response_format?.json_schema?.schema?.required?.includes('ruleLedger') ||
    JSON.parse(body.messages?.find(m => m.role === 'user')?.content ?? '{}').ruleVersion !== RULE_VERSION)
    throw new Error('obsolete_paid_request_contract')
  assertProviderSchema(body.response_format.json_schema.schema)
  if (!apiKey) throw new Error('missing_key')
  const serialized = JSON.stringify(body)
  if (serialized.includes(apiKey)) throw new Error('credential_in_request_body')
  const start = Date.now(), controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response, raw, payload
  try {
    response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: serialized })
    raw = await response.text()
  } catch {
    return { valid: false, errors: [controller.signal.aborted ? 'timeout' : 'transport_error'], retryable: true, costUsd: null, latencyMs: Date.now() - start }
  } finally { clearTimeout(timer) }
  const latencyMs = Date.now() - start
  if (raw.includes(apiKey)) return { valid: false, errors: ['credential_in_response'], retryable: false, costUsd: null, latencyMs }
  try { payload = JSON.parse(raw) } catch { payload = {} }
  let costUsd = money(payload.usage?.cost), costSource = costUsd === null ? 'unknown' : 'usage.cost'
  const responseId = typeof payload.id === 'string' && /^gen-[a-zA-Z0-9-]+$/.test(payload.id) ? payload.id : null
  if (costUsd === null && responseId) {
    try {
      const detail = await fetchImpl(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(responseId)}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10000) })
      const result = await detail.json()
      costUsd = money(result.data?.total_cost)
      if (costUsd !== null) costSource = 'generation.total_cost'
    } catch { /* retain reservation, never treat missing usage as free */ }
  }
  const result = response.ok ? parsePaidResponse(payload, packet, body.model, true, true) : { valid: false, errors: [`http_${response.status}`], retryable: transient(response.status) }
  return { ...result, raw, latencyMs, responseId, actualModel: payload.model ?? null, costUsd, costSource,
    promptTokens: payload.usage?.prompt_tokens ?? null, completionTokens: payload.usage?.completion_tokens ?? null, reasoningTokens: payload.usage?.completion_tokens_details?.reasoning_tokens ?? null }
}
export function grade(scores, criticalErrors) {
  if (!Array.isArray(scores) || scores.length !== 5 || scores.some(s => !Number.isInteger(s) || s < 1 || s > 5) || !Number.isInteger(criticalErrors) || criticalErrors < 0) throw new Error('invalid_grade')
  const average = scores.reduce((s, n) => s + n, 0) / 5
  return { average, passed: average >= 4 && scores[4] >= 4 && criticalErrors === 0 }
}
export function chooseWinner(rows) {
  return rows.filter(r => (!r.rules || r.rules.status === 'pass') && r.validationPassed && r.editorial?.blockers?.length === 0 && editorialReviewPassed(r.editorialReview) && grade(r.scores, r.criticalErrors).passed).sort((a, b) => grade(b.scores, b.criticalErrors).average - grade(a.scores, a.criticalErrors).average || b.scores[4] - a.scores[4] || (a.costUsd ?? Infinity) - (b.costUsd ?? Infinity))[0]?.label ?? null
}
