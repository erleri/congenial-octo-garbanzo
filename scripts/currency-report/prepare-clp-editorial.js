// Offline request preparation. Capture is a separate, explicit public read-only operation.
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createSourceContext, projectSourceContext, sourceTextHash } from './source-context.js'
import { extractReviewedClpArticle } from './article-context-adapters.js'
import { requestBody } from './openrouter.js'
import { MECHANISMS, MECHANISM_VERSION } from './mechanisms.js'
import { registryHash, packetBinding } from './rules.js'
import { prepareClaimReview, claimReviewContract } from './claim-review.js'
import { geminiWireSchema } from './run-gemini-clp-trial.js'
import { requestTokenBound } from './request-budget.js'
// Saved trial/replay tools retain their original import path.
export { requestTokenBound } from './request-budget.js'

export const CLP_EDITORIAL_INPUT_VERSION = 'clp-editorial-input/1'
export const MODEL = 'google/gemini-3.8-flash'
export const PROVIDER = 'google-vertex/global'
export const PRICE_CEILING = Object.freeze({ prompt: .75, completion: 3.75 })
export const STAGES = Object.freeze([
  { name: 'generation', maxInputTokens: 44000, maxOutputTokens: 16384 },
  { name: 'review', maxInputTokens: 55000, maxOutputTokens: 16384 },
  { name: 'correction', maxInputTokens: 55000, maxOutputTokens: 8192 },
  { name: 'recheck', maxInputTokens: 55000, maxOutputTokens: 16384 },
])
const root = '.local-reports/private/clp-20261005-editorial-input-v1'
const oldRoot = '.local-reports/private/clp-20261005-research-writing-v1'
const reportFile = '.local-reports/reviewable/CLP-2026-10-05-1791370805381.json'
const hash = value => sourceTextHash(JSON.stringify(value))
const sourceConfigs = [
  { id: 'df-close', url: 'https://www.df.cl/mercados/bolsa-monedas/dolar-hoy-n75vd',
    selectors: ['Fue una jornada', 'La Dirección de Presupuestos informó', 'Rodrigo Castillo', 'Sebastián Moncada', 'El cobre subió el lunes por segunda sesión'] },
  { id: 'lt-close', url: 'https://www.latercera.com/pulso/noticia/el-valor-del-dolar-en-chile-el-5-de-octubre-de-2026/',
    selectors: ['El dólar inició', 'Al cierre de esta edición', 'Dipres) informara', 'sujeto a modificaciones', 'principalmente a factores locales', 'El precio spot del metal'] },
]
const amendments = {
  'df-close': {
    summary: 'DF는 칠레 장중 달러 가격이 정부의 달러 공급 계획 발표 뒤 방향을 바꿨다고 보도했다. BeFX의 Rodrigo Castillo는 매각 규모보다 정책 신호가 중요하다고 해석했으며 비거주자 포지션 조정은 앞으로 확인할 가능성으로 말했다. XTB의 Sebastián Moncada는 추가 공급과 구리 반등을 페소 지지 배경으로 설명했다. DF의 구리 보도 범위는 두 거래일 연속 상승이다.',
    scope: '기사 속 이후 장중 맥락만 설명. 발표와 실제 집행·비거주자 청산을 구분. 전문가 해석은 귀속. 구리의 짧은 상승을 장기 추세로 확대하지 않음. DF의 가격 기준을 다른 기사나 저장 환율과 합치지 않음.',
  },
  'lt-close': {
    summary: 'La Tercera는 정부의 달러 공급 계획 발표 이후 기사 판 마감까지 달러가 내려갔다고 보도했다. XTB의 Felipe Oyarzún은 글로벌 달러가 강한 가운데 나타난 현지 반응을 현지 요인과 연결했다. 기사에 인용된 예산국 설명은 자금 조달 필요와 시장 여건에 따라 매각 금액이 달라질 수 있다고 명시했다. 기사 속 구리 현물·선물 가격은 다른 상품 기준이다.',
    scope: '현지 발표와 글로벌 달러 배경의 대비를 출처에 귀속. 금액 변경 조건 보존. 실제 집행액·원인별 기여도 추정 금지. XTB 인용을 DF와 독립 검증 횟수로 세지 않음. 게시시각 미상 유지.',
  },
}

// Simplify only the provider schema; full constraints remain in local AJV validation.
export function providerSchema(schema) {
  return geminiWireSchema(JSON.parse(JSON.stringify(schema, (key, value) => key === 'uniqueItems' ? undefined : value)))
}
export function trialBody(contract, stageName) {
  const stage = STAGES.find(s => s.name === stageName)
  if (!stage) throw new Error('unknown_editorial_stage')
  return { model: MODEL, stream: true, max_tokens: stage.maxOutputTokens, reasoning: { effort: 'medium' },
    messages: contract.messages,
    response_format: { type: 'json_schema', json_schema: { name: `local_${stageName}`, strict: true, schema: providerSchema(contract.schema) } },
    provider: { only: [PROVIDER], require_parameters: true, data_collection: 'deny', zdr: true, allow_fallbacks: false, max_price: PRICE_CEILING } }
}
export function costPlan() {
  const stages = STAGES.map(s => ({ ...s, reservedUsd: Math.ceil((s.maxInputTokens * PRICE_CEILING.prompt + s.maxOutputTokens * PRICE_CEILING.completion) / 1e6 * 1e9) / 1e9 }))
  return { stages, newMaximumUsd: Number(stages.reduce((sum, s) => sum + s.reservedUsd, 0).toFixed(9)),
    maxCalls: 4, maxCorrections: 1, retries: 0, newSearches: 0, reservationCreated: false,
    note: 'Input caps must be checked before each call. Unknown costs retain the full stage reservation. No extra stages are authorized by this plan.' }
}
export function prepareEditorialInput({ snapshot, report, sources }) {
  if (report.currency !== 'CLP' || report.baseDate !== '2026-10-05' || snapshot.input.currency !== report.currency ||
    snapshot.input.baseDate !== report.baseDate || snapshot.input.observedDate !== report.observedDate || snapshot.input.observedAt != null ||
    snapshot.input.datasetFetchedAt !== '2026-10-05T05:44:59.792Z' ||
    hash(report.facts) !== hash(snapshot.input.facts)) throw new Error('frozen_market_boundary_mismatch')
  if (sources.length !== 2 || new Set(sources.map(s => s.id)).size !== 2) throw new Error('source_identity_mismatch')
  const evidence = sourceConfigs.map(config => {
    const s = sources.find(s => s.id === config.id), prior = report.evidence.find(e => e.id === config.id)
    if (!s || !prior || s.url !== config.url || prior.url !== config.url || s.bodyHash !== sourceTextHash(JSON.stringify(s.blocks)))
      throw new Error('source_identity_or_hash_mismatch')
    const selected = [...new Set(config.selectors.map(marker => {
      const indexes = s.blocks.flatMap((b, i) => b.text.includes(marker) ? [i] : [])
      if (indexes.length !== 1) throw new Error('required_source_context_missing_or_ambiguous')
      return indexes[0]
    }))]
    const sourceContext = createSourceContext({ blocks: s.blocks, selected, sourceVersion: s.sourceVersion })
    const e = { ...prior, summary: amendments[s.id].summary, role: 'context', causalStatus: 'source_attributed',
      eventAt: null, collectedAt: s.collectedAt,
      review: { originalVerified: true, admission: 'attributed_context', scope: amendments[s.id].scope, checkedAt: s.collectedAt }, sourceContext }
    projectSourceContext(e)
    return e
  })
  const packet = { currency: report.currency, baseDate: report.baseDate, observedDate: report.observedDate, observationAt: null,
    facts: structuredClone(report.facts), series: structuredClone(report.series), evidence,
    limitations: ['저장된 환율의 실제 관측시각은 미상입니다. 이후 기사 속 장중 움직임은 별도 기준으로 설명합니다.',
      '기사의 가격·상품·비교 시점이 다르며 하나의 변동률로 합치지 않습니다.',
      '현재 접근 가능한 원문을 사용한 과거 사례 검토이며 당시 최초 게시판을 보장하지 않습니다.'],
    assessment: { publishDecision: { eligible: false, reason: 'historical_review_only_observation_time_missing' } } }
  const mechanism = MECHANISMS.find(m => m.id === 'usd-payment-conversion')
  const proposal = { id: 'usd-conversion-clp-20261005', mechanismId: mechanism.id, version: MECHANISM_VERSION,
    registryHash, packetHash: packetBinding(packet), currency: packet.currency, baseDate: packet.baseDate,
    conditions: mechanism.conditions.map((condition, i) => ({ condition,
      support: i === 0 ? '고정된 spot·day·five·mtd와 CLP/USD 단위를 사용한다. 기간별 방향을 구분한다.' :
        '같은 달러 금액을 헤지하지 않은 경우만 설명한다. 실제 기업 노출은 가정하지 않는다.',
      evidenceIds: [], factIds: i === 0 ? packet.facts.map(f => f.id) : [] })),
    counterevidence: '헤지·선결제·고정 계약 환율은 환산 부담을 바꿀 수 있다. 소비자가격·판매·마진 효과를 추가하지 않는다.',
    source: mechanism.source, review: { origin: 'agent', status: 'pending_human_application_review', reason: '산술 관계와 조건은 검토했으나 사람 적용 승인으로 기록하지 않았다.' } }
  // Proposals are private. An unapproved principle is never silently transmitted as approved.
  const common = requestBody(packet, 'openrouter/free', 'strict')
  const generation = trialBody({ schema: common.response_format.json_schema.schema, messages: common.messages.map(m =>
    m.role === 'system' ? { ...m, content: m.content + '\n과거 사례 검토 초안이다. 두 매체의 XTB 해석은 같은 기관이다. 원문 인용의 정책 신호·금액 변경 조건을 보존한다. 관측 기준과 달러 환산은 코드가 담당한다.' } : m) }, 'generation')
  if (requestTokenBound(generation) > STAGES[0].maxInputTokens) throw new Error('generation_input_cap_exceeded')
  const reviewInput = prepareClaimReview(packet, report.content)
  const review = trialBody(claimReviewContract(reviewInput), 'review')
  if (requestTokenBound(review) > STAGES[1].maxInputTokens) throw new Error('review_input_cap_exceeded')
  return { version: CLP_EDITORIAL_INPUT_VERSION, packet, generation, savedManuscriptReview: { input: reviewInput, body: review },
    inputHash: hash({ packet, generation }), marketHash: hash({ facts: packet.facts, series: packet.series }),
    mechanismProposals: [proposal], costs: costPlan(),
    state: { inputPrepared: true, paidCallAuthorized: false, publicationApproved: false, quality: 'unverified',
      principleApplication: 'pending', generationCalls: 0, newCostUsd: 0 } }
}

async function immutable(file, value) {
  const bytes = JSON.stringify(value, null, 2)
  try { await fs.writeFile(file, bytes, { flag: 'wx' }) }
  catch (e) { if (e.code !== 'EEXIST') throw e; if (await fs.readFile(file, 'utf8') !== bytes) throw new Error('frozen_input_changed') }
}
async function main() {
  const mode = process.argv[2]
  if (!['capture', 'prepare', 'preflight'].includes(mode) || process.argv.length !== 3) throw new Error('explicit_preparation_mode_required')
  await fs.mkdir(root, { recursive: true })
  if (mode === 'preflight') {
    const prepared = JSON.parse(await fs.readFile(`${root}/input.json`, 'utf8'))
    const get = async url => {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' })
      if (!r.ok) throw new Error('endpoint_catalog_fetch_failed')
      return r.json()
    }
    const [catalog, zdr] = await Promise.all([get(`https://openrouter.ai/api/v1/models/${MODEL}/endpoints`), get('https://openrouter.ai/api/v1/endpoints/zdr')])
    const endpoint = catalog.data?.endpoints?.find(e => e.tag === PROVIDER)
    const price = value => value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0
    if (!endpoint || endpoint.model_id !== MODEL || endpoint.status !== 0 ||
      !zdr.data?.some(e => e.tag === PROVIDER && e.model_id === MODEL) ||
      !['reasoning', 'response_format', 'structured_outputs', 'max_tokens'].every(p => endpoint.supported_parameters?.includes(p)) ||
      !price(endpoint.pricing?.prompt) || !price(endpoint.pricing?.completion) ||
      Number(endpoint.pricing.prompt) > PRICE_CEILING.prompt / 1e6 || Number(endpoint.pricing.completion) > PRICE_CEILING.completion / 1e6 ||
      !price(endpoint.pricing.internal_reasoning ?? endpoint.pricing.completion) ||
      Number(endpoint.pricing.internal_reasoning ?? endpoint.pricing.completion) > PRICE_CEILING.completion / 1e6 ||
      Number(endpoint.pricing.request ?? 0) !== 0 || endpoint.pricing.overrides?.some(p => p.min_prompt_tokens <= 55000) ||
      !(endpoint.max_completion_tokens >= 16384) || !(endpoint.context_length >= 71384)) throw new Error('stage_endpoint_privacy_or_price_not_supported')
    const prior = JSON.parse(await fs.readFile(`${oldRoot}/accounting.json`, 'utf8'))
    if (!Number.isFinite(prior.campaignActualUsd) || prior.campaignActualUsd < 0 || prior.unknownReservedUsd !== 0) throw new Error('prior_campaign_cost_unresolved')
    const result = { checkedAt: new Date().toISOString(), model: MODEL, provider: PROVIDER,
      pricing: endpoint.pricing, zdr: true, dataCollection: 'deny', inputHash: prepared.inputHash,
      costs: prepared.costs, priorCampaignActualUsd: prior.campaignActualUsd,
      combinedMaximumUsd: Number((prior.campaignActualUsd + prepared.costs.newMaximumUsd).toFixed(9)),
      olderReservationsUntouched: true, paidCallAuthorized: false, generationCalls: 0 }
    const file = `${root}/preflight-${Date.now()}.json`
    await immutable(file, result)
    console.log(JSON.stringify({ file, ...result }))
    return
  }
  if (mode === 'capture') {
    const file = `${root}/sources.json`
    try { await fs.access(file); throw new Error('sources_already_captured') } catch (e) { if (e.code !== 'ENOENT') throw e }
    const sources = []
    for (const config of sourceConfigs) {
      const r = await fetch(config.url, { signal: AbortSignal.timeout(30000), redirect: 'error' })
      if (!r.ok || !r.headers.get('content-type')?.includes('text/html')) throw new Error('original_source_fetch_failed')
      const html = await r.text()
      const extracted = extractReviewedClpArticle(config.url, html)
      sources.push({ id: config.id, url: config.url, collectedAt: new Date().toISOString(), ...extracted })
    }
    await immutable(file, sources)
    console.log(JSON.stringify({ mode, sources: sources.map(s => ({ id: s.id, blocks: s.blocks.length, bodyHash: s.bodyHash })), generationCalls: 0, newCostUsd: 0 }))
    return
  }
  const read = file => fs.readFile(file, 'utf8')
  const [snapshotBytes, reportBytes, sourceBytes] = await Promise.all([read(`${oldRoot}/snapshot.json`), read(reportFile), read(`${root}/sources.json`)])
  if (sourceTextHash(snapshotBytes) !== 'd9d8847e804d801f9d38383ef1ba180b201afe9d02bd244c56bc719f313cd5c4' ||
    sourceTextHash(reportBytes) !== '36cba1329bf5aab45722c4ebd08b34616a003e7a39058bf1bbf1b56ecc1a116b') throw new Error('preserved_baseline_changed')
  const [snapshot, report, sources] = [snapshotBytes, reportBytes, sourceBytes].map(JSON.parse)
  const prepared = prepareEditorialInput({ snapshot, report, sources })
  await immutable(`${root}/input.json`, prepared)
  console.log(JSON.stringify({ mode, inputHash: prepared.inputHash, marketHash: prepared.marketHash,
    generationInputBound: requestTokenBound(prepared.generation), savedReviewInputBound: requestTokenBound(prepared.savedManuscriptReview.body),
    ...prepared.costs, ...prepared.state }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => {
  console.error(/^[a-z_]+$/.test(e.message ?? '') ? e.message : 'clp_editorial_preparation_failed'); process.exitCode = 1
})
