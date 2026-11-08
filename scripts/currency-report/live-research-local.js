// Public discovery and capture only. No API keys or model requests are read here.
import fs from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { runResearch, inspectDossier, fingerprint } from './research-harness.js'
import { validDate } from './core.js'
import { searchQuestion, collectOriginal, PUBLIC_RESEARCH_VERSION } from './public-research-adapter.js'
import { harnessRequest } from './report-harness.js'
import { packetBinding } from './rules.js'
import { requestBody } from './openrouter.js'
import { trialBody, requestTokenBound, PRICE_CEILING } from './prepare-clp-editorial.js'
import { endpointPreflight } from './run-clp-editorial-trial.js'
import { researchTimeScope } from './research-time-scope.js'

export async function collectHarnessResearch({ packet, dossier, asOf, maxQueries = 4, maxOriginals = 6, fetchImpl = fetch, checkpoint = async () => {} }) {
  if (!Number.isInteger(maxOriginals) || maxOriginals < 1 || maxOriginals > 8) throw new Error('invalid_original_limit')
  if (!validDate(asOf) || !validDate(packet.baseDate) || packet.baseDate > asOf) throw new Error('invalid_research_asof')
  const searchLog = []
  const discovery = maxQueries === 0 ? { coverage: inspectDossier(packet, dossier), candidates: [], stopReason: 'discovery_not_requested' } : await runResearch({ packet, dossier, mode: 'live_public', maxQueries, recheckQuestions: ['local'],
    search: async query => {
      const result = await searchQuestion({ currency: packet.currency, baseDate: query.timeScope.anchorDate,
        startDate:query.timeScope.startDate, questionId: query.questionId, round: query.round, asOf, fetchImpl })
      const entry = { queryId: query.queryId, questionId: query.questionId, round: query.round, timeScope:query.timeScope, ...result }
      searchLog.push(entry); await checkpoint('search', entry)
      if (['failed', 'not_collected'].includes(result.status)) throw new Error('public_search_unavailable')
      return result.candidates
    } })
  // Seed URLs are preserved admitted sources; they remain useful when discovery is unavailable.
  const merged = new Map(packet.evidence.map(e => [e.url, { url: e.url, title: e.title, questionIds: dossier.cards.filter(c => c.evidenceId === e.id).map(c => c.questionId), origin: 'preserved_source' }]))
  for (const candidate of discovery.candidates) {
    const prior = merged.get(candidate.url)
    if (prior) prior.questionIds = [...new Set([...prior.questionIds, ...candidate.questionIds])]
    else merged.set(candidate.url, { ...candidate, origin: 'new_candidate' })
  }
  const originals = []
  for (const candidate of [...merged.values()].slice(0, maxOriginals)) {
    let captured
    try { captured = await collectOriginal({ candidate, currency: packet.currency, baseDate: packet.baseDate,
      timeScope:researchTimeScope(packet,candidate.questionIds[0]??'market'),fetchImpl }) }
    catch { captured = { url: candidate.url, status: 'not_collected', reason: 'source_not_supported', networkCalls: 0 } }
    const previous = packet.evidence.find(e => e.url === candidate.url)
    const entry = { ...captured, origin: candidate.origin, matchesFrozenBody: !!(captured.bodyHash && previous?.sourceContext?.bodyHash === captured.bodyHash) }
    originals.push(entry); await checkpoint('original', entry)
  }
  return { version: PUBLIC_RESEARCH_VERSION, mode: 'live_public', currency: packet.currency, baseDate: packet.baseDate, asOf,
    discovery, searchLog, originals, networkCalls: searchLog.reduce((n, s) => n + s.networkCalls, 0) + originals.reduce((n, s) => n + s.networkCalls, 0),
    modelCalls: 0, apiCostUsd: 0, publicationApproved: false,
    next: 'Review captured original passages and publication metadata before re-binding any new evidence or dossier.' }
}

export function prepareHarnessComparison(packet, dossier) {
  const prepared = harnessRequest(packet, dossier)
  if (!prepared.request) return { status: 'research_needed', coverage: prepared.brief.coverage, calls: [], paidCallAuthorized: false }
  const bodies = [requestBody(packet, 'openrouter/free', 'strict'), prepared.request].map((base, i) => {
    const body = trialBody({ schema: base.response_format.json_schema.schema, messages: base.messages }, 'generation')
    body.provider.only = ['google-vertex/global/flex']
    const maxInputTokens = requestTokenBound(body)
    if (maxInputTokens > 44000) throw new Error('comparison_input_limit_exceeded')
    const maximumUsd = Math.ceil((maxInputTokens * PRICE_CEILING.prompt + body.max_tokens * PRICE_CEILING.completion) / 1e6 * 1e9) / 1e9
    return { stage: i ? 'harness_generation' : 'baseline_generation', body, requestHash: fingerprint(body), maxInputTokens, maxOutputTokens: body.max_tokens, maximumUsd }
  })
  return { version: 'harness-comparison/1', status: 'prepared_not_called', packetHash: packetBinding(packet), dossierHash: fingerprint(dossier),
    model: bodies[0].body.model, reasoning: 'medium', calls: bodies, maxCalls: 2, retries: 0,
    priceCeilingPerMillionTokens: PRICE_CEILING, totalMaximumUsd: Number(bodies.reduce((n, b) => n + b.maximumUsd, 0).toFixed(9)),
    requiresEndpointPreflight: true, paidCallAuthorized: false, publicationApproved: false,
    scope: 'Same preserved packet, baseline vs harness input. New discoveries are excluded until original review; optional review/correction calls need their own explicit total budget.' }
}

async function main() {
  const { values } = parseArgs({ options: { mode: { type: 'string' }, input: { type: 'string' }, dossier: { type: 'string' }, 'as-of': { type: 'string' } }, strict: true })
  if (!['prepare', 'collect', 'originals', 'preflight'].includes(values.mode) || !values.input || !values.dossier) throw new Error('explicit_research_inputs_required')
  const packet = JSON.parse(await fs.readFile(values.input, 'utf8')).packet
  const dossier = JSON.parse(await fs.readFile(values.dossier, 'utf8'))
  const plan = prepareHarnessComparison(packet, dossier)
  await fs.mkdir('.local-reports/private/harness-live', { recursive: true })
  const dir = await fs.mkdtemp('.local-reports/private/harness-live/clp-')
  let sequence = 0
  const save = (name, value) => fs.writeFile(`${dir}/${name}.json`, JSON.stringify(value, null, 2), { flag: 'wx' })
  await save('comparison-plan', plan)
  if (values.mode === 'preflight') {
    if (plan.status !== 'prepared_not_called') throw new Error('comparison_not_ready')
    const checks = []
    for (const call of plan.calls) {
      try { checks.push({ stage: call.stage, status: 'available', ...await endpointPreflight(call.body) }) }
      catch { checks.push({ stage: call.stage, status: 'unavailable', reason: 'endpoint_privacy_price_or_access_not_verified' }) }
    }
    await save('preflight', { checks, paidCallAuthorized: false, modelCalls: 0 })
    console.log(JSON.stringify({ output: dir, checks, totalMaximumUsd: plan.totalMaximumUsd, modelCalls: 0, paidCallAuthorized: false }))
    return
  }
  if (['collect', 'originals'].includes(values.mode)) {
    const research = await collectHarnessResearch({ packet, dossier, asOf: values['as-of'], maxQueries: values.mode === 'originals' ? 0 : 4, checkpoint: async (stage, value) => {
      await save(`${String(sequence++).padStart(3, '0')}-${stage}`, value)
      console.log(JSON.stringify({ stage, question: value.questionId ?? null, status: value.status, reason: value.reason ?? null }))
    } })
    await save('research', research)
    console.log(JSON.stringify({ output: dir, modelCalls: 0, apiCostUsd: 0, networkCalls: research.networkCalls,
      originalsCaptured: research.originals.filter(r => r.status === 'collected_pending_review').length, unresolvedQuestions: research.discovery.coverage.questions.filter(q => q.status !== 'covered').map(q => q.id),
      totalProposedGenerationMaximumUsd: plan.totalMaximumUsd, paidCallAuthorized: false }))
  } else console.log(JSON.stringify({ output: dir, totalProposedGenerationMaximumUsd: plan.totalMaximumUsd, paidCallAuthorized: false }))
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(() => { console.error('harness_public_research_failed'); process.exitCode = 1 })
