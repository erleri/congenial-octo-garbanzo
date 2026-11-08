// A separately approved $0.25, one-call historical trial. Never reuse old campaign locks.
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parse } from 'dotenv'
import { buildPacket } from './core.js'
import { clpEvidence } from './clp-case.js'
import { privateDir, readDataset, saveReport } from './storage.js'
import { paidBody, reservationFor, inputUpperBound, fingerprint, callPaid, PROFILES } from './paid-comparison.js'
import { RULE_VERSION } from './rules.js'

const dir = `${privateDir}/clp-20260911-common-rules-v1`
const previous = `${privateDir}/clp-20260911-paid-v1`
const editorial = `${privateDir}/clp-20260911-editorial-v2`
const model = 'openai/gpt-5.4'
export const TRIAL_BUDGET_USD = .25
const read = (root, name) => fs.readFile(`${root}/${name}.json`, 'utf8').then(JSON.parse)
const save = (name, value) => fs.writeFile(`${dir}/${name}.json`, JSON.stringify(value, null, 2), { flag: 'wx' })

export function draftAssessment(result) {
  // R09 continues to block publication. A historical draft can still be inspected.
  const holds = (result.rules?.checks ?? []).filter(c => c.status === 'hold' && c.ruleId !== 'R09')
  return { viewable: !!result.candidate && result.safetyValidation?.valid === true,
    automaticDraftStatus: result.rules && holds.length === 0 && result.editorial?.blockers.length === 0 ? 'pass' : 'hold',
    holds, publicationApproved: false, semanticStatus: result.rules?.semanticStatus ?? 'unverified' }
}

export async function plan() {
  const [old, manifest, ledger, rerun] = await Promise.all([
    read(previous, 'snapshot'), read(previous, 'finalized-ui'), read(previous, 'corrected-ledger'), read(editorial, 'result'),
  ])
  const oldHash = fingerprint({ packet: old.packet, messages: old.bodies[0].messages, response_format: old.bodies[0].response_format })
  if (oldHash !== old.inputHash || oldHash !== manifest.inputHash) throw new Error('frozen_input_mismatch')
  if (ledger.some(r => !Number.isFinite(r.reservedUsd) || r.reservedUsd < 0 || (r.costUsd !== null && (!Number.isFinite(r.costUsd) || r.costUsd < 0))) ||
    !Number.isFinite(rerun.costUsd) || rerun.costUsd < 0) throw new Error('invalid_prior_ledger')
  const priorConfirmedUsd = ledger.reduce((s, r) => s + (r.costUsd ?? 0), 0) + rerun.costUsd
  const priorUnknownUsd = ledger.filter(r => r.costUsd === null).reduce((s, r) => s + r.reservedUsd, 0)
  const evidence = structuredClone(clpEvidence)
  // This appended arithmetic explanation was not in the article. Do not launder it into attribution.
  evidence.find(e => e.id === 'rm-inflation').summary = evidence.find(e => e.id === 'rm-inflation').summary.split(' 별도의 조건부 산술 경로:')[0]
  const packet = buildPacket(await readDataset(), 'CLP', '2026-09-11', evidence)
  for (const key of ['facts', 'series']) if (fingerprint(packet[key]) !== fingerprint(old.packet[key])) throw new Error('market_data_changed')
  const identities = p => p.evidence.map(({ id, url, publishedAt, eventDate, period }) => ({ id, url, publishedAt, eventDate, period }))
  if (fingerprint(identities(packet)) !== fingerprint(identities(old.packet))) throw new Error('evidence_identity_changed')
  packet.assessment.publishDecision = { eligible: false, reason: 'historical_review_only_observation_time_missing' }
  packet.limitations = old.packet.limitations
  // No fabricated human application approval, and no CLP-only explanation cards.
  const body = paidBody(packet, model), reservedUsd = reservationFor(body)
  if (reservedUsd > TRIAL_BUDGET_USD) throw new Error('trial_budget_exceeded')
  return { packet, body, inputHash: fingerprint({ packet, messages: body.messages, response_format: body.response_format }),
    ruleVersion: RULE_VERSION, priorConfirmedUsd, priorUnknownUsd, reservedUsd, budgetUsd: TRIAL_BUDGET_USD,
    maxCalls: 1, retries: 0, publicationBlocked: true,
    inputChanges: ['Common rules and sentence ledger required', 'Removed non-article USD-conversion sentence; source identities unchanged', 'No currency-specific explanation cards or approved general-mechanism applications'] }
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
  await fs.mkdir(dir) // Persistent single-call lock; no overwrite even on timeout or crash.
  await save('snapshot', config)
  await save('preflight', await preflight(config.body))
  await save('reservation', { reservedUsd: config.reservedUsd, budgetUsd: TRIAL_BUDGET_USD, maxCalls: 1, retries: 0 })
  const result = await callPaid({ body: config.body, packet: config.packet, apiKey })
  await save('result', result)
  await save('draft-assessment', draftAssessment(result))
  if (result.costUsd !== null && result.costUsd > config.reservedUsd) throw new Error('provider_cost_exceeded_reservation_stop')
  console.log(JSON.stringify({ model: result.actualModel, costUsd: result.costUsd, errors: result.errors,
    latencyMs: result.latencyMs, promptTokens: result.promptTokens, completionTokens: result.completionTokens,
    reasoningTokens: result.reasoningTokens, ...draftAssessment(result), publicationBlocked: true }))
}

async function project() {
  const config = await read(dir, 'snapshot'), result = await read(dir, 'result'), draft = draftAssessment(result)
  await save('projection-lock', { at: new Date().toISOString() })
  const id = draft.viewable ? `CLP-2026-09-11-${Date.now()}` : null
  const notes = [draft.viewable ? `자동 원고 검사: ${draft.automaticDraftStatus === 'pass' ? '통과' : '보류'}. 독립 내용 검토와 게시 승인은 미완료입니다.` : '생성 전 요청 거부: 새 규칙 버전 필드의 문자형 누락으로 Azure HTTP 400. 새 원고 없음. 수정 후 실제 재호출은 미실행.',
    ...draft.holds.map(c => `${c.ruleId} ${c.location}: ${c.reason}`)]
  // Explicit public projection, excluding request, raw, reviewer records, and sentence ledger.
  const report = { id, schemaVersion: 'currency-report/1', currency: config.packet.currency, baseDate: config.packet.baseDate,
    observedDate: config.packet.observedDate, publishedAt: null, generationMode: 'ai_enhanced',
    status: draft.automaticDraftStatus === 'pass' ? 'pending_review' : 'rejected',
    facts: config.packet.facts, series: config.packet.series, evidence: config.packet.evidence.map(({ review: _review, ...e }) => e),
    limitations: config.packet.limitations, assessment: config.packet.assessment, content: result.candidate,
    comparison: { inputHash: config.inputHash, label: 'common-rules-v1', model: result.actualModel, costUsd: result.costUsd,
      average: null, preferred: false, provisional: true, publicationBlocked: true, rulesReviewOnly: true, reviewNotes: notes } }
  if (id) await saveReport(report)
  const before = await read(previous, 'finalized-ui'), after = await read(editorial, 'finalized')
  const rows = [
    { ...before.rows.find(r => r.model === model), variant: '첫 원고', reviewLabel: '당시 잠정 평가 — 새 규칙 미검증', passed: false },
    { ...after.manifest.rows.find(r => r.label === 'after'), variant: '이전 편집 기준', reviewLabel: '미채택 비교본', passed: false },
    { label: 'common-rules-v1', variant: '공통 규칙 적용', model: result.actualModel ?? model, ...(id ? { reportId: id } : { validationErrors: result.errors }), average: null,
      generationCostUsd: result.costUsd, costUsd: result.costUsd, passed: false, reviewLabel: id ? '자동 원고 검사 / 사용자 내용 검토 대기' : '요청 거부 — 원고 없음', notes },
  ]
  const manifest = { title: '공통 규칙 적용 전후', statusLabel: id ? '독립 내용 검토 대기' : '새 원고 생성 실패', winner: null,
    note: 'GPT-5.4·같은 환율과 세 출처를 사용했습니다. 새 규칙·문장별 대응표를 적용하고 기사 외 환산 설명을 입력에서 제외했습니다. 이전 점수는 당시 잠정 평가입니다.',
    confirmedCostUsd: config.priorConfirmedUsd + (result.costUsd ?? 0),
    reservedUnknownUsd: config.priorUnknownUsd + (result.costUsd === null ? config.reservedUsd : 0), rows }
  await fs.writeFile('.local-reports/reviewable/clp-rules-comparison.json', JSON.stringify(manifest, null, 2), { flag: 'wx' })
  await save('projected', { id, manifest, contentHash: result.candidate ? fingerprint(result.candidate) : null })
  console.log(JSON.stringify({ id, costUsd: result.costUsd, publicationBlocked: true, automaticDraftStatus: draft.automaticDraftStatus }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length > 3) throw new Error('invalid_command')
    const mode = process.argv[2] ?? 'plan'
    if (mode === 'plan') { const p = await plan(); console.log(JSON.stringify({ model, reservedUsd: p.reservedUsd, budgetUsd: p.budgetUsd, inputTokenUpperBound: inputUpperBound(p.body), priorConfirmedUsd: p.priorConfirmedUsd, priorUnknownUsd: p.priorUnknownUsd, maxCalls: 1, retries: 0, networkCalls: 0 })) }
    else if (mode === 'run') await run()
    else if (mode === 'project') await project()
    else throw new Error('invalid_command')
  } catch (e) { console.error(/^[a-z_]+$/.test(e.message ?? '') ? e.message : e.code ?? 'local_trial_failed'); process.exitCode = 1 }
}
