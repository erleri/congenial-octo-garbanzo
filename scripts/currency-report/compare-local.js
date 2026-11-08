import fs from 'node:fs/promises'
import path from 'node:path'
import { randomInt } from 'node:crypto'
import { parse } from 'dotenv'
import { buildPacket } from './core.js'
import { readDataset, privateDir, saveReport } from './storage.js'
import { clpEvidence, clpSourceDecisions } from './clp-case.js'
import { EDITORIAL_VERSION, inspectEditorial, editorialReviewPassed } from './editorial.js'
import { BUDGET_USD, PROFILES, paidBody, inputUpperBound, reservationFor, fingerprint, reserve, callPaid, parsePaidResponse, grade, chooseWinner } from './paid-comparison.js'

// One fixed campaign: changing CLI arguments cannot silently reset its $1 budget.
const campaign = path.join(privateDir, 'clp-20260911-paid-v1')
const read = name => fs.readFile(path.join(campaign, name), 'utf8').then(JSON.parse)
const writeNew = (name, value) => fs.writeFile(path.join(campaign, name), JSON.stringify(value, null, 2), { flag: 'wx' })
const mode = process.argv[2] ?? 'plan'
if (!['plan', 'run', 'blind', 'revalidate', 'retry-routing-approved', 'finalize', 'status'].includes(mode) || process.argv.length > 3) throw new Error('invalid_comparison_command')
const blindRead = label => read(`${label}-revalidated-blind.json`).catch(e => { if (e.code === 'ENOENT') return read(`${label}-corrected-blind.json`).catch(e => { if (e.code === 'ENOENT') return read(`${label}-blind.json`); throw e }); throw e })

async function plan() {
  const packet = buildPacket(await readDataset(), 'CLP', '2026-09-11', clpEvidence)
  // Local draft permission is not publication permission. Preserve the historical review block.
  const calculatedEligibility = packet.assessment.publishDecision
  packet.assessment.publishDecision = { eligible: false, reason: 'historical_review_only_observation_time_missing' }
  packet.limitations.push('과거 사례의 사후 검토 초안입니다. 환율 관측 시각이 없어 기사와 일중 선후 관계 및 변동 전체의 원인은 확정할 수 없습니다.', '기사 호가와 대시보드는 비교 기준이 다릅니다. 출처 귀속 해석과 조건부 일반 경로를 실제 판매 변화로 해석하지 않습니다.')
  const bodies = Object.keys(PROFILES).map(model => paidBody(packet, model))
  const inputHash = fingerprint({ packet, messages: bodies[0].messages, response_format: bodies[0].response_format })
  if (fingerprint(bodies[0].messages) !== fingerprint(bodies[1].messages) || fingerprint(bodies[0].response_format) !== fingerprint(bodies[1].response_format)) throw new Error('comparison_input_mismatch')
  const ceilings = bodies.map(body => ({ model: body.model, inputTokensUpperBound: inputUpperBound(body), perAttemptUsd: reservationFor(body) }))
  const worstCaseUsd = ceilings.reduce((s, r) => s + r.perAttemptUsd * 2, 0)
  if (worstCaseUsd > BUDGET_USD) throw new Error('campaign_budget_exceeded')
  return { packet, bodies, inputHash, ceilings, worstCaseUsd, calculatedEligibility, publicationBlocked: true, draftOnly: true }
}
async function preflight(bodies) {
  const zdrResponse = await fetch('https://openrouter.ai/api/v1/endpoints/zdr', { signal: AbortSignal.timeout(15000) })
  if (!zdrResponse.ok) throw new Error('zdr_preflight_failed')
  const zdr = await zdrResponse.json()
  const checks = []
  for (const body of bodies) {
    const response = await fetch(`https://openrouter.ai/api/v1/models/${body.model}/endpoints`, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('pricing_preflight_failed')
    const catalog = await response.json()
    const endpoint = catalog.data?.endpoints?.find(e => e.tag === 'azure')
    const price = PROFILES[body.model]
    if (!endpoint || !zdr.data?.some(e => e.tag === endpoint.tag && e.model_id === body.model) || !['reasoning', 'structured_outputs', 'response_format', 'max_completion_tokens'].every(p => endpoint.supported_parameters.includes(p)) ||
        !(Number(endpoint.pricing.prompt) <= price.prompt / 1e6) || !(Number(endpoint.pricing.completion) <= price.completion / 1e6) ||
        Number(endpoint.pricing.request ?? 0) !== 0 || endpoint.pricing.overrides?.some(p => p.min_prompt_tokens <= inputUpperBound(body))) throw new Error('unsupported_endpoint_or_price')
    checks.push({ model: body.model, endpoint: endpoint.tag, pricing: endpoint.pricing, checkedAt: new Date().toISOString(), privacy: 'Routing must enforce zdr=true/data_collection=deny; rejection does not relax these.' })
  }
  return checks
}
async function run() {
  const config = await plan()
  const env = parse(await fs.readFile('.env.report.local', 'utf8'))
  const apiKey = env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('missing_key')
  if (JSON.stringify(config.bodies).includes(apiKey)) throw new Error('credential_in_input')
  // A permanent campaign lock protects against concurrent processes and ambiguous interrupted calls.
  await fs.mkdir(privateDir, { recursive: true })
  await fs.mkdir(campaign)
  await writeNew('snapshot.json', config)
  await writeNew('source-review.json', clpSourceDecisions)
  const checks = await preflight(config.bodies)
  await writeNew('preflight.json', checks)
  const labels = randomInt(2) ? ['A', 'B'] : ['B', 'A']
  const mapping = config.bodies.map((body, i) => ({ label: labels[i], model: body.model }))
  await writeNew('mapping.json', mapping)
  const ledger = []
  for (const { label, model } of mapping) {
    const body = config.bodies.find(b => b.model === model)
    for (let attempt = 1; attempt <= 2; attempt++) {
      const reservation = reserve(ledger, model, attempt, body)
      await writeNew(`${label}-${attempt}-reservation.json`, reservation)
      ledger.push(reservation)
      const result = await callPaid({ body, packet: config.packet, apiKey })
      await writeNew(`${label}-${attempt}-result.json`, result)
      Object.assign(reservation, { costUsd: result.costUsd, retryable: result.retryable, state: 'finished' })
      console.log(JSON.stringify({ candidate: label, attempt, validationPassed: result.valid, errors: result.errors, costStatus: result.costUsd === null ? 'unknown_reserved' : 'recorded' }))
      if (result.costUsd !== null && result.costUsd > reservation.reservedUsd) throw new Error('provider_cost_exceeded_reservation_stop')
      if (!result.retryable || attempt === 2) {
        // Blind record contains no model name, latency or cost clues.
        await writeNew(`${label}-blind.json`, { label, inputHash: config.inputHash, validationPassed: result.valid, errors: result.errors, content: result.candidate ?? null })
        break
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  await writeNew('ledger.json', ledger)
  console.log('Two candidates completed. Read blind records before opening the model/cost mapping.')
}
async function finalize() {
  try { await fs.access(path.join(campaign, 'finalized.json')); throw new Error('comparison_already_finalized') } catch (e) { if (e.code !== 'ENOENT') throw e }
  await writeNew('finalize-lock.json', { startedAt: new Date().toISOString() })
  const config = await read('snapshot.json'), mapping = await read('mapping.json')
  const ledger = await read('corrected-ledger.json').catch(e => { if (e.code === 'ENOENT') return read('ledger.json'); throw e })
  const evaluation = await read('evaluation.json')
  if (evaluation.inputHash !== config.inputHash || evaluation.provisional !== true || !Array.isArray(evaluation.rows) || evaluation.rows.length !== 2 || new Set(evaluation.rows.map(r => r.label)).size !== 2) throw new Error('invalid_blind_evaluation')
  const rows = []
  for (const item of mapping) {
    const blind = await blindRead(item.label)
    const score = evaluation.rows.find(r => r.label === item.label)
    if (!score || !Array.isArray(score.claimReview) || !score.claimReview.length || !score.rationale) throw new Error('claim_review_required')
    const attempts = ledger.filter(r => r.model === item.model)
    const final = await read(`${item.label}-${attempts.at(-1).attempt}-result.json`)
    const costUsd = attempts.some(r => r.costUsd === null) ? null : attempts.reduce((s, r) => s + r.costUsd, 0)
    rows.push({ ...score, model: item.model, actualModel: final.actualModel, costUsd, generationCostUsd: final.costUsd, attempts: attempts.length, latencyMs: final.latencyMs,
      promptTokens: final.promptTokens, completionTokens: final.completionTokens, reasoningTokens: final.reasoningTokens,
      validationPassed: blind.validationPassed, validationErrors: blind.errors,
      rules: final.rules ? { ruleVersion: final.rules.ruleVersion, status: final.rules.status } : undefined,
      editorial: inspectEditorial(blind.content), ...grade(score.scores, score.criticalErrors) })
    const row = rows.at(-1)
    if (score.editorialReview?.contentHash !== fingerprint(blind.content)) throw new Error('editorial_content_review_required')
    row.passed = row.passed && (!row.rules || row.rules.status === 'pass') && row.editorial.blockers.length === 0 && editorialReviewPassed(score.editorialReview)
  }
  const winner = chooseWinner(rows)
  const manifest = { campaign: 'clp-20260911-paid-v1', currency: 'CLP', baseDate: '2026-09-11', inputHash: config.inputHash, editorialVersion: EDITORIAL_VERSION, provisional: true, publicationBlocked: true,
    winner, rows, sourceReview: clpSourceDecisions,
    confirmedCostUsd: ledger.reduce((s, r) => s + (r.costUsd ?? 0), 0), reservedUnknownUsd: ledger.filter(r => r.costUsd === null).reduce((s, r) => s + r.reservedUsd, 0), priorSearchCost: 'Excluded; no new paid search performed.' }
  const stamp = Date.now()
  for (const [i, row] of rows.entries()) {
    if (!row.validationPassed || !row.passed) continue
    const blind = await blindRead(row.label)
    row.reportId = `CLP-2026-09-11-${stamp + i}`
    await saveReport({ ...config.packet, id: row.reportId, schemaVersion: 'currency-report/1', publishedAt: null, generationMode: 'ai_enhanced', status: 'pending_review',
      content: blind.content, comparison: { inputHash: config.inputHash, label: row.label, model: row.model, costUsd: row.generationCostUsd, average: row.average, preferred: winner === row.label, provisional: true, publicationBlocked: true } })
  }
  await writeNew('finalized.json', manifest)
  await fs.mkdir('.local-reports/reviewable', { recursive: true })
  await fs.writeFile('.local-reports/reviewable/clp-comparison.json', JSON.stringify(manifest, null, 2), { flag: 'wx' })
  console.log(JSON.stringify(manifest, null, 2))
}
async function revalidate() {
  const config = await read('snapshot.json'), mapping = await read('mapping.json')
  for (const item of mapping) {
    const original = await read(`${item.label}-2-result.json`)
    const result = parsePaidResponse(JSON.parse(original.raw), config.packet, item.model)
    await writeNew(`${item.label}-revalidated-blind.json`, { label: item.label, inputHash: config.inputHash, validationPassed: result.valid, errors: result.errors, content: result.candidate ?? null, correction: 'direction-regex-v2: 적절하다 is not currency depreciation; unchanged saved output; no API call' })
  }
}
async function retryRoutingApproved() {
  const config = await read('snapshot.json'), mapping = await read('mapping.json'), ledger = await read('ledger.json')
  // Explicit human-approved correction, NOT a general 404 retry policy. Exactly one extra call per model.
  const bodies = config.bodies.map(old => {
    const { max_tokens, ...rest } = old
    return { ...rest, max_completion_tokens: max_tokens, provider: { ...old.provider, only: ['azure'], ignore: [] } }
  })
  const apiKey = parse(await fs.readFile('.env.report.local', 'utf8')).OPENROUTER_API_KEY
  if (!apiKey) throw new Error('missing_key')
  for (const item of mapping) {
    const prior = await read(`${item.label}-1-result.json`)
    if (prior.errors?.[0] !== 'http_404' || !prior.raw?.includes('No endpoints found matching your data policy (Zero data retention)') || ledger.filter(r => r.model === item.model).length !== 1) throw new Error('not_a_routing_correction')
  }
  const checks = await preflight(bodies)
  await writeNew('routing-correction-authorization.json', { scope: 'Human approved Azure correction, one call per model, no automatic retry', approvedAt: new Date().toISOString(), checks, inputHash: config.inputHash, bodies })
  for (const item of mapping) {
    const body = bodies.find(b => b.model === item.model)
    const prior = ledger.find(r => r.model === item.model)
    prior.reason = 'zdr_routing_404'
    const reservation = reserve(ledger, item.model, 2, body, true)
    await writeNew(`${item.label}-2-reservation.json`, reservation)
    ledger.push(reservation)
    const result = await callPaid({ body, packet: config.packet, apiKey })
    await writeNew(`${item.label}-2-result.json`, result)
    Object.assign(reservation, { costUsd: result.costUsd, retryable: false, state: 'finished' })
    await writeNew(`${item.label}-corrected-blind.json`, { label: item.label, inputHash: config.inputHash, validationPassed: result.valid, errors: result.errors, content: result.candidate ?? null })
    console.log(JSON.stringify({ candidate: item.label, validationPassed: result.valid, errors: result.errors, costStatus: result.costUsd === null ? 'unknown_reserved' : 'recorded' }))
    if (result.costUsd !== null && result.costUsd > reservation.reservedUsd) throw new Error('provider_cost_exceeded_reservation_stop')
  }
  await writeNew('corrected-ledger.json', ledger)
}
try {
  if (mode === 'plan') { const { ceilings, worstCaseUsd, inputHash, packet } = await plan(); console.log(JSON.stringify({ inputHash, ceilings, worstCaseUsd, evidence: packet.evidence.length, publishDecision: packet.assessment.publishDecision, draftOnly: true }, null, 2)) }
  else if (mode === 'run') await run()
  else if (mode === 'retry-routing-approved') await retryRoutingApproved()
  else if (mode === 'revalidate') await revalidate()
  else if (mode === 'blind') for (const label of ['A', 'B']) console.log(JSON.stringify(await blindRead(label), null, 2))
  else if (mode === 'finalize') await finalize()
  else console.log(JSON.stringify(await read('finalized.json'), null, 2))
} catch (error) {
  // Do not dump environment, provider error bodies or raw exception objects.
  console.error(`Local comparison stopped: ${/^[a-zA-Z0-9_: ]+$/.test(error.message ?? '') ? error.message : error.code ?? 'see_private_records'}`)
  process.exitCode = 1
}
