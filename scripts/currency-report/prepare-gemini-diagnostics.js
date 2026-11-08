// Deliberately OFFLINE. No key loading, fetch, generation, or automatic retry.
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { privateDir } from './storage.js'
import { finalTrialDir } from './run-final-clp-trial.js'
import { prepareGeminiTrial, GEMINI_PRICE, geminiTrialDir, geminiCompatibleDir } from './run-gemini-clp-trial.js'
import { fingerprint, inputUpperBound } from './paid-comparison.js'

export function diagnosticStages(base) {
  const tiny = { type: 'object', additionalProperties: false, properties: { status: { type: 'string', enum: ['ok'] } }, required: ['status'] }
  const light = structuredClone(base.body.response_format.json_schema.schema)
  delete light.properties.ruleLedger
  light.required = light.required.filter(k => k !== 'ruleLedger')
  const stages = [
    { id: 'connection', maxTokens: 256, schema: tiny, messages: [{ role: 'user', content: '연결 시험입니다. JSON status 필드에 ok를 반환하세요.' }] },
    { id: 'structure', maxTokens: 2048, schema: light, messages: [{ role: 'user', content: '형식 시험입니다. 시장 분석을 하지 마세요. 모든 문장은 형식 시험이라는 내용으로만 채우고 근거 배열은 비워 두세요.' }] },
    { id: 'evidence', maxTokens: 4096, schema: light, messages: base.body.messages.map(m => m.role === 'system' ? { ...m, content: m.content + '\n이번 요청은 형식·근거 연결 진단 전용이며 ruleLedger는 출력하지 않는다. 공개·승인 대상이 아니다.' } : m) },
    { id: 'full-ledger', maxTokens: 8192, schema: base.body.response_format.json_schema.schema, messages: base.body.messages },
  ].map(stage => {
    const body = { ...structuredClone(base.body), stream: true, max_tokens: stage.maxTokens, messages: structuredClone(stage.messages),
      response_format: { type: 'json_schema', json_schema: { ...base.body.response_format.json_schema, schema: structuredClone(stage.schema) } } }
    delete body.max_completion_tokens
    const inputTokensUpperBound = inputUpperBound(body)
    const reservedUsd = Math.ceil((inputTokensUpperBound * GEMINI_PRICE.prompt + stage.maxTokens * GEMINI_PRICE.completion) / 1e6 * 1e9) / 1e9
    return { id: stage.id, body, inputTokensUpperBound, reservedUsd, requestHash: fingerprint(body),
      publishable: false, requiresNewApproval: true, maxCalls: 1, retries: 0 }
  })
  return stages
}

export function diagnosticPlan(input) {
  const base = prepareGeminiTrial(input, true)
  const stages = diagnosticStages(base)
  return { mode: 'offline-plan', model: base.body.model, sourceInputHash: base.sourceInputHash,
    generationCalls: 0, executionEnabled: false, automaticStageAdvance: false,
    maximumIfAllSeparatelyApprovedUsd: Number(stages.reduce((sum, s) => sum + s.reservedUsd, 0).toFixed(9)), stages }
}

async function main() {
  if (process.argv.length > 2) throw new Error('offline_only_no_execution_mode')
  const input = JSON.parse(await fs.readFile(`${finalTrialDir}/snapshot.json`, 'utf8'))
  const plan = diagnosticPlan(input)
  const old = []
  for (const dir of [geminiTrialDir, geminiCompatibleDir]) {
    const result = JSON.parse(await fs.readFile(`${dir}/result.json`, 'utf8'))
    const reservation = JSON.parse(await fs.readFile(`${dir}/reservation.json`, 'utf8'))
    old.push({ campaign: dir.split('/').pop(), errors: result.errors, responseId: result.responseId ?? null,
      costUsd: result.costUsd ?? null, reservedUsd: reservation.reservedUsd,
      reconciliation: result.responseId ? 'id_available_lookup_not_executed' : 'no_generation_id_account_activity_required' })
  }
  const record = { ...plan, previousRequests: old }
  const dir = `${privateDir}/gemini-diagnostics-${fingerprint(record).slice(0, 16)}`
  try {
    await fs.mkdir(dir)
    await fs.writeFile(`${dir}/plan.json`, JSON.stringify(record, null, 2), { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST' || fingerprint(JSON.parse(await fs.readFile(`${dir}/plan.json`, 'utf8'))) !== fingerprint(record)) throw error
    // Repeating an offline plan reuses an identical record, never overwrites it.
  }
  console.log(JSON.stringify({ mode: plan.mode, generationCalls: 0, executionEnabled: false,
    stages: plan.stages.map(({ id, reservedUsd }) => ({ id, reservedUsd })),
    maximumIfAllSeparatelyApprovedUsd: plan.maximumIfAllSeparatelyApprovedUsd,
    previousRequests: old, savedPlan: `${dir}/plan.json` }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(/^[a-z_]+$/.test(error.message ?? '') ? error.message : 'diagnostic_prepare_failed'); process.exitCode = 1 })
}
