// One explicit user-authorized editorial rerun. Never reset the earlier campaign budget.
import fs from 'node:fs/promises'
import { parse } from 'dotenv'
import { buildPacket, validateContent } from './core.js'
import { clpEvidence } from './clp-case.js'
import { privateDir, readDataset, saveReport } from './storage.js'
import { paidBody, reservationFor, inputUpperBound, fingerprint, callPaid, PROFILES, BUDGET_USD } from './paid-comparison.js'
import { EDITORIAL_VERSION } from './editorial.js'
import { editorialDecision } from './editorial-decision.js'

const dir = `${privateDir}/clp-20260911-editorial-v2`
const previous = `${privateDir}/clp-20260911-paid-v1`
const model = 'openai/gpt-5.4'
const read = (root, name) => fs.readFile(`${root}/${name}.json`, 'utf8').then(JSON.parse)
const save = (name, value) => fs.writeFile(`${dir}/${name}.json`, JSON.stringify(value, null, 2), { flag: 'wx' })

async function plan() {
  const old = await read(previous, 'snapshot'), manifest = await read(previous, 'finalized-ui')
  const priorLedger = await read(previous, 'corrected-ledger')
  const oldHash = fingerprint({ packet: old.packet, messages: old.bodies[0].messages, response_format: old.bodies[0].response_format })
  if (oldHash !== old.inputHash || oldHash !== manifest.inputHash) throw new Error('frozen_input_mismatch')
  if (priorLedger.length !== 4 || priorLedger.some(r => !Number.isFinite(r.reservedUsd) || r.reservedUsd < 0 || (r.costUsd !== null && (!Number.isFinite(r.costUsd) || r.costUsd < 0)))) throw new Error('invalid_prior_ledger')
  const confirmedUsd = priorLedger.reduce((s, r) => s + (r.costUsd ?? 0), 0)
  const unknownUsd = priorLedger.filter(r => r.costUsd === null).reduce((s, r) => s + r.reservedUsd, 0)
  if (Math.abs(confirmedUsd - manifest.confirmedCostUsd) > 1e-9 || Math.abs(unknownUsd - manifest.reservedUnknownUsd) > 1e-9) throw new Error('prior_cost_mismatch')
  const packet = buildPacket(await readDataset(), 'CLP', '2026-09-11', clpEvidence)
  for (const key of ['facts', 'series']) if (fingerprint(packet[key]) !== fingerprint(old.packet[key])) throw new Error('market_data_changed')
  const identities = p => p.evidence.map(({ id, url, publishedAt, eventDate, period }) => ({ id, url, publishedAt, eventDate, period }))
  if (fingerprint(identities(packet)) !== fingerprint(identities(old.packet))) throw new Error('evidence_identity_changed')
  packet.assessment.publishDecision = { eligible: false, reason: 'historical_review_only_observation_time_missing' }
  packet.limitations = old.packet.limitations
  const body = paidBody(packet, model), reservedUsd = reservationFor(body)
  if (confirmedUsd + unknownUsd + reservedUsd > BUDGET_USD) throw new Error('total_budget_exceeded')
  return { packet, body, inputHash: fingerprint({ packet, messages: body.messages, response_format: body.response_format }),
    previousInputHash: oldHash, previousReportId: manifest.rows.find(r => r.model === model)?.reportId,
    editorialVersion: EDITORIAL_VERSION, confirmedUsd, unknownUsd, reservedUsd, maxCalls: 1, publicationBlocked: true }
}

async function preflight(body) {
  const get = async url => { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error('preflight_failed'); return r.json() }
  const [zdr, catalog] = await Promise.all([get('https://openrouter.ai/api/v1/endpoints/zdr'), get(`https://openrouter.ai/api/v1/models/${model}/endpoints`)])
  const e = catalog.data?.endpoints?.find(e => e.tag === 'azure'), price = PROFILES[model]
  if (!e || !zdr.data?.some(p => p.tag === 'azure' && p.model_id === model) ||
    !['reasoning', 'structured_outputs', 'response_format', 'max_completion_tokens'].every(p => e.supported_parameters.includes(p)) ||
    !(Number(e.pricing.prompt) <= price.prompt / 1e6) || !(Number(e.pricing.completion) <= price.completion / 1e6) ||
    Number(e.pricing.request ?? 0) !== 0 || e.pricing.overrides?.some(p => p.min_prompt_tokens <= inputUpperBound(body))) throw new Error('unsupported_endpoint_or_price')
  return { model, provider: 'azure', checkedAt: new Date().toISOString(), pricing: e.pricing, zdr: true, dataCollection: 'deny' }
}

async function run() {
  const config = await plan()
  const apiKey = parse(await fs.readFile('.env.report.local', 'utf8')).OPENROUTER_API_KEY
  if (!apiKey || JSON.stringify(config).includes(apiKey)) throw new Error('invalid_local_key')
  // Persistent single-call lock also covers crashes, timeouts and unknown costs. No auto retries.
  await fs.mkdir(dir)
  await save('snapshot', config)
  await save('preflight', await preflight(config.body))
  await save('reservation', { reservedUsd: config.reservedUsd, priorCommittedUsd: config.confirmedUsd + config.unknownUsd, maxCalls: 1 })
  const result = await callPaid({ body: config.body, packet: config.packet, apiKey })
  await save('result', result)
  await save('candidate', { inputHash: config.inputHash, contentHash: result.candidate ? fingerprint(result.candidate) : null, content: result.candidate ?? null, validationPassed: result.valid, errors: result.errors, editorial: result.editorial })
  if (result.costUsd !== null && result.costUsd > config.reservedUsd) throw new Error('provider_cost_exceeded_reservation_stop')
  console.log(JSON.stringify({ valid: result.valid, errors: result.errors, editorial: result.editorial, model: result.actualModel,
    costUsd: result.costUsd, latencyMs: result.latencyMs, promptTokens: result.promptTokens, completionTokens: result.completionTokens, reasoningTokens: result.reasoningTokens,
    totalConfirmedUsd: config.confirmedUsd + (result.costUsd ?? 0), totalReservedUnknownUsd: config.unknownUsd + (result.costUsd === null ? config.reservedUsd : 0), publicationBlocked: true }))
}

async function finalize() {
  const config = await read(dir, 'snapshot'), result = await read(dir, 'result'), review = await read(dir, 'review')
  if (!result.valid || !validateContent(result.candidate, config.packet).valid) throw new Error('unsafe_candidate')
  if (result.rules && result.rules.status !== 'pass') throw new Error('common_content_review_required')
  const decision = editorialDecision(result.candidate, review)
  const oldManifest = await read(previous, 'finalized-ui'), old = oldManifest.rows.find(r => r.model === model)
  const oldReport = JSON.parse(await fs.readFile(`.local-reports/reviewable/${old.reportId}.json`, 'utf8'))
  const oldDecision = editorialDecision(oldReport.content, review.before)
  await save('finalize-lock', { at: new Date().toISOString() })
  const id = `CLP-2026-09-11-${Date.now()}`
  const report = { ...config.packet, id, schemaVersion: 'currency-report/1', publishedAt: null, generationMode: 'ai_enhanced', status: decision.status, content: result.candidate,
    comparison: { inputHash: config.inputHash, label: 'editorial-v2', model: result.actualModel, costUsd: result.costUsd, average: decision.average, preferred: decision.preferred, provisional: true, publicationBlocked: true, reviewNotes: decision.notes } }
  // Explicit sanitized projection: no raw response, IDs, token details, reviewer identity, or key.
  await saveReport(report)
  const manifest = { title: '편집 기준 변경 전후', winner: decision.passed ? 'after' : null, confirmedCostUsd: config.confirmedUsd + (result.costUsd ?? 0), reservedUnknownUsd: config.unknownUsd + (result.costUsd === null ? config.reservedUsd : 0),
    note: '같은 GPT-5.4·환율·세 출처로 비교했습니다. 지침과 근거 요약의 편집 방식이 바뀌었으며, 두 원고를 새 기준으로 재평가했습니다. 점수는 에이전트의 잠정 평가이며 기존 기록·기본 결과는 유지합니다. 자동 검사 통과는 근거·내용 평가 통과가 아닙니다.',
    rows: [
      { label: 'before', variant: '변경 전', model, generationCostUsd: old.generationCostUsd, costUsd: old.costUsd, average: oldDecision.average, passed: oldDecision.passed, validationPassed: true, reportId: old.reportId, notes: oldDecision.notes },
      { label: 'after', variant: '변경 후', model, generationCostUsd: result.costUsd, costUsd: result.costUsd, average: decision.average, passed: decision.passed, validationPassed: true, reportId: id, notes: decision.notes },
    ] }
  await fs.writeFile('.local-reports/reviewable/clp-editorial-comparison.json', JSON.stringify(manifest, null, 2), { flag: 'wx' })
  await save('finalized', { id, manifest, contentHash: review.contentHash })
  console.log(JSON.stringify({ id, previousId: old.reportId, costUsd: result.costUsd, publicationBlocked: true }))
}

try {
  const mode = process.argv[2] ?? 'plan'
  if (process.argv.length > 3) throw new Error('invalid_command')
  if (mode === 'plan') { const p = await plan(); console.log(JSON.stringify({ model, maxCalls: p.maxCalls, reservedUsd: p.reservedUsd, priorConfirmedUsd: p.confirmedUsd, priorUnknownReservedUsd: p.unknownUsd, upperBoundTotalUsd: p.confirmedUsd + p.unknownUsd + p.reservedUsd, inputHash: p.inputHash })) }
  else if (mode === 'run') await run()
  else if (mode === 'finalize') await finalize()
  else throw new Error('invalid_command')
} catch (error) {
  console.error(/^[a-z_]+$/.test(error.message ?? '') ? error.message : error.code ?? 'local_editorial_run_failed')
  process.exitCode = 1
}
