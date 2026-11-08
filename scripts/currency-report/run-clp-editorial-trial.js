// User-authorized local four-stage trial. Permanent locks, no retries or fallback.
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import Ajv from 'ajv'
import { parse } from 'dotenv'
import { requestBody, composeDraft } from './openrouter.js'
import { selectMechanisms, packetBinding, registryHash, RULE_VERSION } from './rules.js'
import { MECHANISM_VERSION } from './mechanisms.js'
import { runEditorialWorkflow } from './claim-review.js'
import { trialBody, requestTokenBound, costPlan, MODEL, PROVIDER, PRICE_CEILING } from './prepare-clp-editorial.js'
import { sourceTextHash } from './source-context.js'
import { callOpenRouterStream, reconcileGenerationCost } from './openrouter-stream.js'
import { createPrivateStreamJournal } from './stream-journal.js'

export const TRIAL_BUDGET = .38
const ROUTES = [PROVIDER, 'google-vertex/global/flex']
const root = '.local-reports/private/clp-20261005-editorial-trial-v1'
const preparedRoot = '.local-reports/private/clp-20261005-editorial-input-v1'
const APPROVED_INPUT_HASH = 'b86511b5cede13e9c0a99f1b7d0aab1ce4233da2ff329f83f8eb5b5b76500a04'
const hash = v => sourceTextHash(JSON.stringify(v))
const save = (name, value) => fs.writeFile(`${root}/${name}.json`, JSON.stringify(value, null, 2), { flag: 'wx' })

export function approvedPacket(prepared) {
  if (prepared.inputHash !== APPROVED_INPUT_HASH || hash({ packet: prepared.packet, generation: prepared.generation }) !== APPROVED_INPUT_HASH ||
    hash({ facts: prepared.packet.facts, series: prepared.packet.series }) !== prepared.marketHash) throw new Error('approved_input_changed')
  const packet = structuredClone(prepared.packet), proposal = prepared.mechanismProposals[0]
  if (proposal.mechanismId !== 'usd-payment-conversion' || proposal.version !== MECHANISM_VERSION || proposal.registryHash !== registryHash)
    throw new Error('approved_mechanism_changed')
  packet.mechanismApplications = [{ ...proposal, packetHash: packetBinding(packet), conditions: proposal.conditions.map((c, i) => ({
    condition: c.condition, support: c.support, evidenceIds: [],
    basis: i === 0 ? { type: 'facts', convention: 'LOCAL_PER_USD', factIds: packet.facts.map(f => f.id) } :
      { type: 'conditional', assumptions: ['equal_usd_amount', 'unhedged'], exceptions: ['hedging', 'prepayment', 'fixed_contract_rate'] },
  })), review: { origin: 'human', status: 'pass', reviewer: '사용자 대화 승인',
    reason: '사용자가 같은 달러 금액·미헤지 조건의 환산 설명과 네 단계 신규 상한 $0.38 시험을 승인했다. 헤지·선결제·계약 환율 예외를 보존하며 실제 기업 노출·마진 효과는 승인하지 않았다.' } }]
  if (selectMechanisms(packet).checks.length) throw new Error('approved_application_invalid')
  return packet
}
export function generationBody(packet) {
  const common = requestBody(packet, 'openrouter/free', 'strict')
  return trialBody({ schema: common.response_format.json_schema.schema, messages: common.messages.map(m => m.role === 'system' ?
    { ...m, content: m.content + '\n과거 사례의 검토 초안이다. 기사 속 장중 반응은 보도에 귀속한다. 정부 계획·정책 신호·집행 물량을 구분하고 원문 조건을 보존한다. 관측 기준과 조건부 달러 환산 설명은 코드가 표시하므로 다시 작성하지 않는다. 같은 기관의 해석을 독립 검증으로 세지 않는다. 최종 JSON만 출력한다.' } : m) }, 'generation')
}
export function reserveStage(ledger, name, body) {
  const stage = costPlan().stages.find(s => s.name === name)
  if (!stage || ledger.some(r => r.name === name) || body.model !== MODEL || body.max_tokens !== stage.maxOutputTokens ||
    body.provider?.only?.length !== 1 || !ROUTES.includes(body.provider.only[0]) || body.provider.zdr !== true || body.provider.data_collection !== 'deny' ||
    body.provider.allow_fallbacks !== false || requestTokenBound(body) > stage.maxInputTokens) throw new Error('invalid_or_duplicate_stage')
  const committed = ledger.reduce((s, r) => s + (r.costUsd ?? r.reservedUsd), 0)
  if (committed + stage.reservedUsd > TRIAL_BUDGET) throw new Error('stage_budget_exceeded')
  return { name, reservedUsd: stage.reservedUsd, costUsd: null, state: 'reserved', requestHash: hash(body) }
}
export async function executeEditorialTrial({ packet, invoke, savedDraft }) {
  const generated = composeDraft(packet, savedDraft ?? await invoke('generation', generationBody(packet)), true, !savedDraft)
  const ruleHolds = (generated.rules?.checks ?? []).filter(c => c.status === 'hold' && c.ruleId !== 'R09')
  // The explicit reviewer/editor may repair a task directive. Structural, secret,
  // reference and ledger failures stop. Never purchase another generation.
  const directiveOnly = generated.candidate && generated.validation.errors.length > 0 &&
    generated.validation.errors.every(e => e === 'advice_or_instruction') && ruleHolds.every(c => c.ruleId === 'R11')
  if ((!generated.validation.valid && !directiveOnly) || (ruleHolds.length && !directiveOnly) || generated.editorial?.blockers.length) return {
    status: 'generation_hold', generated, ruleHolds, publicationApproved: false }
  let reviews = 0
  const workflow = await runEditorialWorkflow({ packet, content: generated.candidate,
    reviewer: async (_input, contract) => invoke(++reviews === 1 ? 'review' : 'recheck', trialBody(contract, reviews === 1 ? 'review' : 'recheck'), contract.schema),
    editor: async (_plan, contract) => invoke('correction', trialBody(contract, 'correction'), contract.schema),
  })
  return { status: workflow.status, generated, workflow, publicationApproved: false }
}
export async function endpointPreflight(body, initial = false) {
  const get = async url => { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error('preflight_failed'); return r.json() }
  const [catalog, zdr] = await Promise.all([get(`https://openrouter.ai/api/v1/models/${MODEL}/endpoints`), get('https://openrouter.ai/api/v1/endpoints/zdr')])
  // Select an available route BEFORE the first paid call, then pin every stage.
  // This is not transport/model retry, and never relaxes privacy or price ceilings.
  const route = initial ? ROUTES.find(tag => catalog.data?.endpoints?.some(e => e.tag === tag && e.status === 0) &&
    zdr.data?.some(e => e.tag === tag && e.model_id === MODEL)) : body.provider.only[0]
  const e = catalog.data?.endpoints?.find(e => e.tag === route)
  const number = v => v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0
  if (!e || e.model_id !== MODEL || e.status !== 0 || !zdr.data?.some(z => z.tag === route && z.model_id === MODEL) ||
    !['reasoning', 'response_format', 'structured_outputs', 'max_tokens'].every(p => e.supported_parameters?.includes(p)) ||
    !(e.max_completion_tokens >= body.max_tokens) || !(e.context_length >= requestTokenBound(body) + body.max_tokens) ||
    !number(e.pricing?.prompt) || !number(e.pricing?.completion) ||
    Number(e.pricing.prompt) > PRICE_CEILING.prompt / 1e6 || Number(e.pricing.completion) > PRICE_CEILING.completion / 1e6 ||
    !number(e.pricing.internal_reasoning ?? e.pricing.completion) || Number(e.pricing.internal_reasoning ?? e.pricing.completion) > PRICE_CEILING.completion / 1e6 ||
    Number(e.pricing.request ?? 0) !== 0 || e.pricing.overrides?.some(p => p.min_prompt_tokens <= requestTokenBound(body)))
    throw new Error('stage_endpoint_privacy_or_price_not_supported')
  return { checkedAt: new Date().toISOString(), model: MODEL, provider: route, pricing: e.pricing, zdr: true, dataCollection: 'deny' }
}
async function main() {
  const mode = process.argv[2]
  if (!['check', 'run', 'resume-review'].includes(mode) || process.argv.length !== 3) throw new Error('explicit_trial_mode_required')
  const prepared = JSON.parse(await fs.readFile(`${preparedRoot}/input.json`, 'utf8'))
  const packet = approvedPacket(prepared), body = generationBody(packet)
  const read = name => fs.readFile(`${root}/${name}.json`, 'utf8').then(JSON.parse)
  let previous, savedDraft
  if (mode === 'resume-review') {
    const [snapshot, stopped, accounting, output, transport] = await Promise.all(['snapshot', 'result', 'accounting', 'generation-output', 'generation-transport'].map(read))
    if (stopped.status !== 'generation_hold' || stopped.generated.validation.errors.some(e => e !== 'advice_or_instruction') ||
      accounting.stages.length !== 1 || accounting.stages[0].name !== 'generation' || accounting.budgetUsd !== TRIAL_BUDGET ||
      hash(snapshot.packet) !== hash(packet) || hash({ packet: snapshot.packet, body: snapshot.body }) !== snapshot.inputHash ||
      hash(output) !== hash(JSON.parse(transport.partialText)) || !transport.valid) throw new Error('invalid_review_continuation')
    previous = accounting.stages
    savedDraft = output
    body.provider.only = snapshot.body.provider.only
  }
  const preflight = await endpointPreflight(body, mode !== 'resume-review')
  body.provider.only = [preflight.provider]
  reserveStage([], 'generation', body)
  if (mode === 'check') {
    console.log(JSON.stringify({ mode, inputHash: hash({ packet, body }), ruleVersion: RULE_VERSION,
      principleApplication: selectMechanisms(packet).selected.map(m => m.applicationId), maxNewCostUsd: costPlan().newMaximumUsd,
      generationInputBound: requestTokenBound(body), ...preflight, generationCalls: 0 })); return
  }
  const apiKey = parse(await fs.readFile('.env.report.local', 'utf8')).OPENROUTER_API_KEY
  if (!apiKey || JSON.stringify({ packet, body }).includes(apiKey)) throw new Error('invalid_local_key')
  if (mode === 'resume-review') await save('review-continuation-lock', { at: new Date().toISOString(), existingGenerationReused: true, maximumTotalCalls: 4 })
  else {
    await fs.mkdir(root) // A crash or failure keeps this permanent single-trial lock.
    await save('authorization', { origin: 'human', userReply: 'ㅇㅋ 그렇게 해.', authorizedScope: 'Same USD amount, unhedged conversion with exceptions; local generation/review/one correction/recheck',
      budgetUsd: TRIAL_BUDGET, maxCalls: 4, retries: 0, publicationApproved: false, authorizedAt: new Date().toISOString() })
    await save('snapshot', { packet, body, inputHash: hash({ packet, body }), previousInputHash: prepared.inputHash, ruleVersion: RULE_VERSION })
  }
  const ledger = previous ?? [], accounting = () => ({ stages: ledger, actualKnownUsd: Number(ledger.reduce((s, r) => s + (r.costUsd ?? 0), 0).toFixed(9)),
    unknownReservedUsd: Number(ledger.filter(r => r.costUsd === null).reduce((s, r) => s + r.reservedUsd, 0).toFixed(9)), budgetUsd: TRIAL_BUDGET,
    calls: ledger.length, retries: 0, olderReservationsUntouched: true })
  const validate = new Ajv({ allErrors: true })
  const invoke = async (name, request, fullSchema) => {
    request.provider.only = [preflight.provider]
    const entry = reserveStage(ledger, name, request)
    const endpoint = name === 'generation' ? preflight : await endpointPreflight(request)
    // Persist request, privacy check and unresolved reservation before sending.
    await save(`${name}-request`, request); await save(`${name}-preflight`, endpoint)
    await save(`${name}-reservation`, entry); ledger.push(entry)
    await fs.writeFile(`${root}/accounting.json`, JSON.stringify(accounting(), null, 2))
    const checkpoint = await createPrivateStreamJournal(`clp-editorial-v1-${name}`)
    console.log(JSON.stringify({ phase: `${name}_started`, reservedUsd: entry.reservedUsd, inputTokenBound: requestTokenBound(request) }))
    const transport = await callOpenRouterStream({ body: request, apiKey, checkpoint, timeoutMs: 240000 })
    await save(`${name}-transport`, transport)
    let cost = { costUsd: transport.costUsd, costSource: transport.costSource }
    if (cost.costUsd === null && transport.responseId) cost = await reconcileGenerationCost({ responseId: transport.responseId, apiKey })
    Object.assign(entry, cost, { state: 'completed', responseId: transport.responseId, model: transport.actualModel,
      latencyMs: transport.latencyMs, usage: transport.usage, transportErrors: transport.errors })
    await fs.writeFile(`${root}/accounting.json`, JSON.stringify(accounting(), null, 2))
    console.log(JSON.stringify({ phase: `${name}_finished`, costUsd: cost.costUsd, latencyMs: transport.latencyMs, errors: transport.errors }))
    if (cost.costUsd !== null && cost.costUsd > entry.reservedUsd) throw new Error('provider_cost_exceeded_reservation')
    if (!transport.valid) throw new Error(`${name}_transport_failed`)
    let parsed
    try { parsed = JSON.parse(transport.partialText) } catch { throw new Error(`${name}_invalid_json`) }
    if (!validate.compile(fullSchema ?? request.response_format.json_schema.schema)(parsed)) throw new Error(`${name}_full_schema_failed`)
    if (JSON.stringify(parsed).includes(apiKey)) throw new Error('credential_in_response')
    await save(`${name}-output`, parsed)
    return parsed
  }
  let result
  try { result = await executeEditorialTrial({ packet, invoke, savedDraft }) }
  catch (e) { result = { status: 'stopped', error: /^[a-z_]+$/.test(e.message ?? '') ? e.message : 'trial_failed', publicationApproved: false } }
  await save(mode === 'resume-review' ? 'result-after-review' : 'result', result)
  console.log(JSON.stringify({ phase: 'trial_finished', status: result.status, error: result.error ?? null, ...accounting() }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => {
  console.error(/^[a-z_]+$/.test(e.message ?? '') ? e.message : 'editorial_trial_failed'); process.exitCode = 1
})
