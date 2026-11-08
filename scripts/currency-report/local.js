import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { parse } from 'dotenv'
import { buildPacket, eligibility, packetHash, validateContent, validDate } from './core.js'
import { BACKUP_MODEL, DEFAULT_MODEL, generateCandidate, requestBody } from './openrouter.js'
import { collectSources } from './sources.js'
import { fixtures } from './fixtures.js'
import { diagnosticAllowed, evaluationOptions, outageRetryAllowed, policyRetryAllowed } from './local-policy.js'
import { generateWithBackup } from './fallback.js'
import { selectHistoricalCases } from './evidence-quality.js'
import { fetchMarketNewsFeed, normalizeMarketNewsFeed } from './market-news.js'
import { DISCOVERY_CURRENCIES, fetchGdeltDiscovery } from './news-discovery.js'
import { buildOfficialReviewTargets } from './official-review.js'
import { buildEvidenceReview } from './evidence-review.js'
import { fetchOpenRouterWebSearch, searchNeeded } from './openrouter-web-search.js'
import { fetchLocalSourceDiscovery, LOCAL_SOURCE_COLLECTOR_VERSION, LOCAL_SOURCE_REGISTRY } from './local-source-discovery.js'
import { fixtureReports, readDataset, privateDir, publicDir, reviewDir, saveReport } from './storage.js'
import { mechanismEvidence } from './rules.js'

// This entry point is deliberately independent of workflows, production DB and mail.
const { values } = parseArgs({ options: {
  mode: { type: 'string', default: 'fixture' }, action: { type: 'string', default: 'status' },
  currency: { type: 'string' }, date: { type: 'string' }, evidence: { type: 'string' }, applications: { type: 'string' },
  privacy: { type: 'string', default: 'strict' }, 'retry-policy-change': { type: 'boolean', default: false },
  'retry-run': { type: 'string' },
  'with-backup': { type: 'boolean', default: false }, 'backup-from': { type: 'string' },
  'evaluation-id': { type: 'string' },
  'evaluation-target': { type: 'string', default: 'chain' },
  'retry-discovery': { type: 'boolean', default: false },
  'retry-search': { type: 'boolean', default: false },
} })

async function main() {
  let settings = {}
  try { settings = parse(await fs.readFile('.env.report.local')) } catch (e) { if (e.code !== 'ENOENT') throw e }
  const allowed = new Set(['OPENROUTER_API_KEY', 'FX_REPORT_AI_MODEL', 'OPENROUTER_SEARCH_MODEL', 'ALPHA_VANTAGE_API_KEY'])
  if (Object.keys(settings).some(k => !allowed.has(k))) throw new Error('unsupported_local_configuration')
  const apiKey = settings.OPENROUTER_API_KEY?.trim()
  const newsApiKey = settings.ALPHA_VANTAGE_API_KEY?.trim()
  const model = settings.FX_REPORT_AI_MODEL?.trim() || DEFAULT_MODEL
  // Search needs reliable tool invocation; report prose may continue to use free models.
  const searchModel = settings.OPENROUTER_SEARCH_MODEL?.trim() || 'perplexity/sonar'
  const privacy = values.privacy
  if (!['strict', 'public-data'].includes(privacy)) throw new Error('invalid_privacy_mode')
  if ((privacy !== 'strict' || values['retry-policy-change']) && values.mode !== 'live-local') throw new Error('privacy_trial_requires_live_local')
  if (!['fixture', 'live-local', 'local-db'].includes(values.mode)) throw new Error('invalid_mode')
  if (values['retry-discovery'] && (values.mode !== 'live-local' || values.action !== 'discover-evidence')) throw new Error('invalid_discovery_retry_mode')
  if (values['retry-search'] && (values.mode !== 'live-local' || values.action !== 'search-evidence')) throw new Error('invalid_search_retry_mode')
  if (values['retry-run'] && (values.mode !== 'live-local' || values.action !== 'generate' || values['retry-policy-change'])) throw new Error('invalid_outage_retry_mode')
  const evaluation = evaluationOptions({ mode: values.mode, action: values.action, evaluationId: values['evaluation-id'], target: values['evaluation-target'], conflictingFlags: Boolean(values['with-backup'] || values['backup-from'] || values['retry-run'] || values['retry-policy-change']) })
  const useBackup = Boolean(evaluation) || values['with-backup'] || Boolean(values['backup-from'])
  if (useBackup && (values.mode !== 'live-local' || !['generate', 'evaluate'].includes(values.action) || values['retry-run'] || values['retry-policy-change'])) throw new Error('invalid_backup_mode')
  if (useBackup && model !== DEFAULT_MODEL) throw new Error('unsupported_primary_for_backup')
  if (values.action === 'status') {
    console.log(JSON.stringify({ mode: values.mode, apiKey: apiKey ? '설정됨' : '누락', newsApiKey: newsApiKey ? '설정됨' : '누락', model, searchModel, privacy, reviewable: publicDir, private: privateDir,
      database: '미연결: 통화별 승인 통합 구현·검증 대기', productionWrites: false }, null, 2))
    return
  }
  if (values.action === 'cases') {
    if (values.mode !== 'live-local') throw new Error('cases_requires_live_local')
    const cases = selectHistoricalCases(await readDataset())
    await fs.mkdir(privateDir, { recursive: true })
    const destination = path.join(privateDir, 'historical-cases.json')
    await fs.writeFile(destination, JSON.stringify({ generatedAt: new Date().toISOString(), causesAsserted: false, cases }, null, 2))
    console.log(JSON.stringify({ mode: values.mode, result: destination, cases: cases.length, networkCalls: 0, causesAsserted: false }, null, 2))
    return
  }
  if (values.action === 'collect-news') {
    if (values.mode !== 'live-local' || !validDate(values.date)) throw new Error('news_date_required')
    if (!newsApiKey) { console.log(JSON.stringify({ mode: values.mode, status: 'not_collected', reason: 'missing_news_key', networkCalls: 0 })); return }
    await fs.mkdir(privateDir, { recursive: true })
    const claim = path.join(privateDir, `news-${values.date}-call.json`)
    try { await fs.writeFile(claim, JSON.stringify({ startedAt: new Date().toISOString(), baseDate: values.date }), { flag: 'wx' }) }
    catch (error) { if (error.code === 'EEXIST') { console.log(JSON.stringify({ status: 'not_collected', reason: 'daily_news_call_already_claimed', networkCalls: 0 })); return } throw error }
    const result = await fetchMarketNewsFeed({ apiKey: newsApiKey, baseDate: values.date })
    if (result.status !== 'collected') {
      await fs.writeFile(path.join(privateDir, `news-${values.date}-result.json`), JSON.stringify({ finishedAt: new Date().toISOString(), status: result.status, reason: result.reason }))
      console.log(JSON.stringify({ mode: values.mode, status: result.status, reason: result.reason, networkCalls: 1 })); return
    }
    const evidenceDir = path.resolve('.local-reports/evidence')
    await fs.mkdir(evidenceDir, { recursive: true })
    const outputs = {}
    for (const currency of ['BRL', 'MXN']) {
      const evidence = normalizeMarketNewsFeed(result.feed, currency, values.date)
      const destination = path.join(evidenceDir, `${currency}-${values.date}-news.json`)
      await fs.writeFile(destination, JSON.stringify(evidence, null, 2))
      outputs[currency] = { destination, candidates: evidence.length }
    }
    await fs.writeFile(path.join(privateDir, `news-${values.date}-result.json`), JSON.stringify({ finishedAt: new Date().toISOString(), status: 'collected_for_review', candidates: Object.fromEntries(Object.entries(outputs).map(([currency, output]) => [currency, output.candidates])) }))
    console.log(JSON.stringify({ mode: values.mode, status: 'collected_for_review', networkCalls: 1, outputs }, null, 2))
    return
  }
  if (values.action === 'discover-evidence') {
    if (values.mode !== 'live-local' || !DISCOVERY_CURRENCIES.includes(values.currency) || !validDate(values.date)) throw new Error('discovery_currency_and_date_required')
    await fs.mkdir(privateDir, { recursive: true })
    const resultPath = path.join(privateDir, `gdelt-${values.currency}-${values.date}-result.json`)
    if (values['retry-discovery']) {
      let prior
      try { prior = JSON.parse(await fs.readFile(resultPath, 'utf8')) } catch { throw new Error('discovery_retry_without_prior_result') }
      if (prior.status !== 'failed' || !['http_429', 'network_or_timeout'].includes(prior.reason)) throw new Error('discovery_retry_not_eligible')
    }
    const claim = path.join(privateDir, `gdelt-${values.currency}-${values.date}${values['retry-discovery'] ? '-retry' : ''}-call.json`)
    try { await fs.writeFile(claim, JSON.stringify({ startedAt: new Date().toISOString(), currency: values.currency, baseDate: values.date }), { flag: 'wx' }) }
    catch (error) { if (error.code === 'EEXIST') { console.log(JSON.stringify({ status: 'not_collected', reason: 'daily_discovery_call_already_claimed', networkCalls: 0 })); return } throw error }
    const result = await fetchGdeltDiscovery({ currency: values.currency, baseDate: values.date })
    const reviewTargets = buildOfficialReviewTargets(values.currency, values.date)
    const discoveryDir = path.resolve('.local-reports/discovery')
    await fs.mkdir(discoveryDir, { recursive: true })
    const destination = path.join(discoveryDir, `${values.currency}-${values.date}-candidates.json`)
    const reviewDocument = {
      currency: values.currency,
      baseDate: values.date,
      collectedAt: new Date().toISOString(),
      status: result.status,
      reason: result.reason,
      candidates: result.candidates,
      officialReviewTargets: reviewTargets,
      automaticEvidenceAdmission: false,
      causesAsserted: false,
    }
    await fs.writeFile(destination, JSON.stringify(reviewDocument, null, 2))
    await fs.writeFile(resultPath, JSON.stringify({ finishedAt: new Date().toISOString(), status: result.status, reason: result.reason, candidates: result.candidates.length, destination, retry: Boolean(values['retry-discovery']) }))
    console.log(JSON.stringify({ mode: values.mode, status: result.status, reason: result.reason, networkCalls: result.networkCalls ?? 0, candidates: result.candidates.length, officialReviewTargets: reviewTargets.length, result: destination, automaticEvidenceAdmission: false }, null, 2))
    return
  }
  if (values.action === 'search-evidence') {
    if (values.mode !== 'live-local' || values.currency !== 'CLP' || !validDate(values.date)) throw new Error('search_currency_and_date_required')
    if (!apiKey) { console.log(JSON.stringify({ mode: values.mode, status: 'not_collected', reason: 'missing_openrouter_key', networkCalls: 0 })); return }
    const discoveryPath = path.resolve(`.local-reports/discovery/${values.currency}-${values.date}-candidates.json`)
    let discovery
    try { discovery = JSON.parse(await fs.readFile(discoveryPath, 'utf8')) } catch (error) { if (error.code === 'ENOENT') throw new Error('discovery_document_not_found'); throw error }
    const initialReview = buildEvidenceReview(discovery, await readDataset())
    const check = searchNeeded(initialReview)
    if (!check.eligible) { console.log(JSON.stringify({ mode: values.mode, status: 'not_collected', reason: check.reason, networkCalls: 0 })); return }
    await fs.mkdir(privateDir, { recursive: true })
    const resultPath = path.join(privateDir, `openrouter-search-${values.currency}-${values.date}-result.json`)
    let retryReason = null
    if (values['retry-search']) {
      let prior
      try { prior = JSON.parse(await fs.readFile(resultPath, 'utf8')) } catch { throw new Error('search_retry_without_prior_result') }
      if (prior.status !== 'failed' || !['http_404', 'http_429', 'timeout', 'transport_error', 'search_not_executed'].includes(prior.reason)) throw new Error('search_retry_not_eligible')
      retryReason = prior.reason
    }
    const retrySlot = values['retry-search'] ? (searchModel === 'perplexity/sonar' ? '-retry-sonar' : retryReason === 'search_not_executed' ? '-retry-forced' : searchModel === 'openrouter/free' ? '-retry' : '-retry-paid') : ''
    const claim = path.join(privateDir, `openrouter-search-${values.currency}-${values.date}${retrySlot}-call.json`)
    try { await fs.writeFile(claim, JSON.stringify({ startedAt: new Date().toISOString(), currency: values.currency, baseDate: values.date, model: searchModel, maxSearches: 1, maxResults: 6 }), { flag: 'wx' }) }
    catch (error) { if (error.code === 'EEXIST') { console.log(JSON.stringify({ status: 'not_collected', reason: 'search_call_already_claimed', networkCalls: 0 })); return } throw error }
    const result = await fetchOpenRouterWebSearch({ apiKey, currency: values.currency, baseDate: values.date, model: searchModel })
    const destination = path.resolve(`.local-reports/discovery/${values.currency}-${values.date}-openrouter-candidates.json`)
    await fs.writeFile(destination, JSON.stringify({ currency: values.currency, baseDate: values.date, collectedAt: new Date().toISOString(), ...result, automaticEvidenceAdmission: false, causesAsserted: false }, null, 2))
    await fs.writeFile(resultPath, JSON.stringify({ finishedAt: new Date().toISOString(), status: result.status, reason: result.reason, model: result.model ?? 'not_reported', webSearchRequests: result.webSearchRequests, candidates: result.candidates.length, usage: result.usage ?? null, destination }))
    console.log(JSON.stringify({ mode: values.mode, status: result.status, reason: result.reason, networkCalls: 1, webSearchRequests: result.webSearchRequests, candidates: result.candidates.length, model: result.model ?? 'not_reported', usage: result.usage ?? null, result: destination, automaticEvidenceAdmission: false }, null, 2))
    return
  }
  if (values.action === 'discover-local-sources') {
    if (values.mode !== 'live-local' || !LOCAL_SOURCE_REGISTRY[values.currency] || !validDate(values.date)) throw new Error('local_source_currency_and_date_required')
    await fs.mkdir(privateDir, { recursive: true })
    const claim = path.join(privateDir, `local-source-${LOCAL_SOURCE_COLLECTOR_VERSION}-${values.currency}-${values.date}-call.json`)
    try { await fs.writeFile(claim, JSON.stringify({ startedAt: new Date().toISOString(), currency: values.currency, baseDate: values.date }), { flag: 'wx' }) }
    catch (error) { if (error.code === 'EEXIST') { console.log(JSON.stringify({ status: 'not_collected', reason: 'local_source_call_already_claimed', networkCalls: 0 })); return } throw error }
    const result = await fetchLocalSourceDiscovery({ currency: values.currency, baseDate: values.date })
    const discoveryDir = path.resolve('.local-reports/discovery')
    await fs.mkdir(discoveryDir, { recursive: true })
    const destination = path.join(discoveryDir, `${values.currency}-${values.date}-local-candidates.json`)
    await fs.writeFile(destination, JSON.stringify({ currency: values.currency, baseDate: values.date, collectedAt: new Date().toISOString(), ...result, automaticEvidenceAdmission: false, causesAsserted: false }, null, 2))
    await fs.writeFile(path.join(privateDir, `local-source-${LOCAL_SOURCE_COLLECTOR_VERSION}-${values.currency}-${values.date}-result.json`), JSON.stringify({ finishedAt: new Date().toISOString(), status: result.status, reason: result.reason, candidates: result.candidates.length, sourceResults: result.sourceResults, destination }))
    console.log(JSON.stringify({ mode: values.mode, status: result.status, reason: result.reason, networkCalls: result.networkCalls, candidates: result.candidates.length, sourceResults: result.sourceResults, result: destination, automaticEvidenceAdmission: false }, null, 2))
    return
  }
  if (values.action === 'prepare-evidence-review') {
    if (values.mode !== 'live-local' || !DISCOVERY_CURRENCIES.includes(values.currency) || !validDate(values.date)) throw new Error('review_currency_and_date_required')
    const discoveryPath = path.resolve(`.local-reports/discovery/${values.currency}-${values.date}-candidates.json`)
    const discoveryRoot = path.resolve('.local-reports/discovery') + path.sep
    if (!discoveryPath.startsWith(discoveryRoot)) throw new Error('invalid_discovery_path')
    let discovery
    try { discovery = JSON.parse(await fs.readFile(discoveryPath, 'utf8')) } catch (error) { if (error.code === 'ENOENT') throw new Error('discovery_document_not_found'); throw error }
    for (const suffix of ['openrouter-candidates', 'local-candidates']) {
      try {
        const supplemental = JSON.parse(await fs.readFile(path.resolve(`.local-reports/discovery/${values.currency}-${values.date}-${suffix}.json`), 'utf8'))
        if (supplemental.currency === discovery.currency && supplemental.baseDate === discovery.baseDate && Array.isArray(supplemental.candidates)) {
          const seen = new Set(discovery.candidates.map(candidate => candidate.url))
          discovery = { ...discovery, candidates: [...discovery.candidates, ...supplemental.candidates.filter(candidate => !seen.has(candidate.url))] }
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    const review = buildEvidenceReview(discovery, await readDataset())
    await fs.mkdir(reviewDir, { recursive: true })
    const destination = path.join(reviewDir, `${review.id}.json`)
    await fs.writeFile(destination, JSON.stringify(review, null, 2))
    console.log(JSON.stringify({ mode: values.mode, status: 'prepared_for_manual_review', result: destination, candidates: review.candidates.length, publicationBlocked: review.publicationBlocked, networkCalls: 0 }, null, 2))
    return
  }
  if (values.mode === 'local-db') throw new Error('local_database_integration_not_ready')
  if (values.mode === 'fixture') {
    if (values.action !== 'verify') throw new Error('fixture_supports_verify_only')
    const reports = await fixtureReports()
    const result = reports.map(r => ({ currency: r.currency, baseDate: r.baseDate, validation: validateContent(r.content, r), observations: r.series.length }))
    console.log(JSON.stringify({ mode: 'fixture', networkCalls: 0, result }, null, 2))
    if (result.some(r => !r.validation.valid)) process.exitCode = 1
    return
  }
  if (!['packet', 'generate', 'collect', 'diagnose', 'evaluate'].includes(values.action)) throw new Error('invalid_action')
  if (values.action === 'diagnose' && values['retry-policy-change']) throw new Error('incompatible_trial_flags')
  if (!['BRL', 'MXN', 'CLP'].includes(values.currency) || !validDate(values.date)) throw new Error('currency_and_date_required')
  if (values.action === 'collect') {
    const results = await collectSources({ currency: values.currency, asOf: values.date })
    await fs.mkdir(privateDir, { recursive: true })
    const destination = path.join(privateDir, `${values.currency}-${values.date}-sources-${Date.now()}.json`)
    await fs.writeFile(destination, JSON.stringify(results, null, 2), { flag: 'wx' })
    console.log(JSON.stringify({ mode: values.mode, result: destination, sources: results.map(r => ({ source: r.source, status: r.status, reason: r.reason ?? '발표일·지표 의미 검토 대기' })) }, null, 2))
    return
  }
  let evidence
  if (values.evidence) {
    const evidencePath = path.resolve(values.evidence)
    const evidenceRoot = path.resolve('.local-reports/evidence') + path.sep
    if (!evidencePath.startsWith(evidenceRoot) || !evidencePath.endsWith('.json')) throw new Error('evidence_must_be_local_json')
    const realPath = await fs.realpath(evidencePath)
    if (!realPath.startsWith(evidenceRoot)) throw new Error('evidence_link_outside_root')
    const stat = await fs.stat(realPath)
    if (stat.size > 100_000) throw new Error('evidence_too_large')
    evidence = JSON.parse(await fs.readFile(realPath, 'utf8'))
  } else {
    // Only these exact historical dates have manually reviewed source packets.
    evidence = fixtures.find(f => f.currency === values.currency && f.baseDate === values.date)?.evidence ?? []
  }
  const packet = buildPacket(await readDataset(), values.currency, values.date, evidence)
  if (values.applications) {
    // Basenames only, private/ only; no symlink escape or credential-bearing env file.
    if (!/^[a-zA-Z0-9_-]+\.json$/.test(values.applications)) throw new Error('invalid_applications_file')
    const file = await fs.realpath(path.join(privateDir, values.applications))
    if (path.dirname(file) !== await fs.realpath(privateDir)) throw new Error('invalid_applications_file')
    if ((await fs.stat(file)).size > 100_000) throw new Error('oversize_applications')
    packet.mechanismApplications = JSON.parse(await fs.readFile(file, 'utf8'))
    if (!Array.isArray(packet.mechanismApplications)) throw new Error('invalid_applications_file')
  }
  await fs.mkdir(privateDir, { recursive: true })
  const id = `${values.currency}-${values.date}`
  const fingerprint = packetHash(packet)
  let previous
  try { previous = JSON.parse(await fs.readFile(path.join(privateDir, `${values.currency}-latest.json`), 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
  const check = eligibility(packet, previous?.fingerprint)
  if (values.action === 'packet') {
    // Safe, reviewable evidence packet; no raw model responses or keys.
    const destination = path.join(privateDir, `${id}-packet.json`)
    await fs.writeFile(destination, JSON.stringify(packet, null, 2))
    console.log(JSON.stringify({ mode: values.mode, result: destination, check, networkCalls: 0 }, null, 2))
    return
  }
  if (!check.eligible) { console.log(JSON.stringify({ status: 'kept_previous', reason: check.reason })); return }
  if (!apiKey) { console.log('키 누락: .env.report.local의 OPENROUTER_API_KEY를 직접 설정하세요. 요청하지 않았습니다.'); process.exitCode = 1; return }
  const requestModel = evaluation?.target === 'backup' ? BACKUP_MODEL : model
  requestBody(packet, requestModel, privacy) // Validate public input and free model BEFORE consuming a slot.
  let claimName = evaluation?.claimName ?? `${id}-call.json`
  let primaryRun
  if (values['backup-from']) {
    if (!values['backup-from'].startsWith(`${id}-`) || !/^(BRL|MXN)-\d{4}-\d{2}-\d{2}-\d+$/.test(values['backup-from'])) throw new Error('invalid_backup_run')
    primaryRun = JSON.parse(await fs.readFile(path.join(privateDir, `${values['backup-from']}.json`), 'utf8'))
    if (!outageRetryAllowed({ prior: primaryRun, privacy, currency: values.currency, baseDate: values.date, fingerprint, model })) throw new Error('backup_not_eligible')
    // One backup slot per currency/date, not per failed primary run.
    claimName = `${id}-backup-call.json`
  }
  if (values['retry-run']) {
    if (!values['retry-run'].startsWith(`${id}-`) || !/^(BRL|MXN)-\d{4}-\d{2}-\d{2}-\d+$/.test(values['retry-run'])) throw new Error('invalid_retry_run')
    const prior = JSON.parse(await fs.readFile(path.join(privateDir, `${values['retry-run']}.json`), 'utf8'))
    if (!outageRetryAllowed({ prior, privacy, currency: values.currency, baseDate: values.date, fingerprint, model })) throw new Error('outage_retry_not_eligible')
    claimName = `${values['retry-run']}-manual-retry-call.json`
  }
  if (values.action === 'diagnose') {
    const files = (await fs.readdir(privateDir)).filter(name => name.startsWith(`${id}-`) && /^.*-\d+\.json$/.test(name))
    const runs = await Promise.all(files.map(async name => JSON.parse(await fs.readFile(path.join(privateDir, name), 'utf8'))))
    if (!diagnosticAllowed({ privacy, runs, currency: values.currency, baseDate: values.date, fingerprint, model })) throw new Error('diagnostic_not_eligible')
    claimName = `${id}-diagnostic-call.json`
  }
  if (values['retry-policy-change']) {
    const files = (await fs.readdir(privateDir)).filter(name => name.startsWith(`${id}-`) && /^.*-\d+\.json$/.test(name))
    const runs = await Promise.all(files.map(async name => JSON.parse(await fs.readFile(path.join(privateDir, name), 'utf8'))))
    const originalClaim = JSON.parse(await fs.readFile(path.join(privateDir, `${id}-call.json`), 'utf8'))
    if (!policyRetryAllowed({ privacy, retry: true, runs, currency: values.currency, baseDate: values.date, fingerprint, model, originalClaim })) throw new Error('policy_retry_not_eligible')
    claimName = `${id}-public-data-trial-call.json`
  }
  try {
    // Atomic daily claim: one logical request per currency/date, including crashes and restarts.
    await fs.writeFile(path.join(privateDir, claimName), JSON.stringify({ startedAt: new Date().toISOString(), model: requestModel, fingerprint, privacy, evaluationId: values['evaluation-id'] ?? null, evaluationTarget: evaluation?.target ?? null, timeoutMs: evaluation?.timeoutMs ?? 45_000, retryOf: values['retry-run'] ?? null, backupFrom: values['backup-from'] ?? null, withBackup: useBackup, policyRetry: values['retry-policy-change'] }), { flag: 'wx' })
  } catch (e) {
    if (e.code === 'EEXIST') { console.log(JSON.stringify({ status: 'kept_previous', reason: 'daily_call_already_claimed' })); return }
    throw e
  }
  const run = evaluation?.target === 'backup'
    ? { ...await generateCandidate({ apiKey, model: BACKUP_MODEL, packet, privacy, timeoutMs: evaluation.timeoutMs, maxAttempts: 1 }), requestedModel: BACKUP_MODEL }
    : useBackup
    ? await generateWithBackup({ apiKey, model, packet, privacy, primaryRun, timeoutMs: evaluation?.timeoutMs, onAttempt: event => console.log(JSON.stringify(event)), claimBackup: async () => {
      if (evaluation) return true // The atomic evaluation slot bounds the entire fallback chain.
      if (values['backup-from']) return true // Claimed atomically above.
      try {
        await fs.writeFile(path.join(privateDir, `${id}-backup-call.json`), JSON.stringify({ startedAt: new Date().toISOString(), fingerprint, privacy }), { flag: 'wx' })
        return true
      } catch (error) { if (error.code === 'EEXIST') return false; throw error }
    }, claimEmergency: async () => {
      if (evaluation) return true
      try {
        await fs.writeFile(path.join(privateDir, `${id}-emergency-router-call.json`), JSON.stringify({ startedAt: new Date().toISOString(), fingerprint, privacy }), { flag: 'wx' })
        return true
      } catch (error) { if (error.code === 'EEXIST') return false; throw error }
    } })
    : await generateCandidate({ apiKey, model, packet, privacy, maxAttempts: values.action === 'diagnose' || values['retry-run'] ? 1 : 2 })
  const runId = `${id}-${Date.now()}`
  // No raw/error text is printed. Redact any unexpected credential reflection even in private storage.
  const privateJson = JSON.stringify({ runId, fingerprint, packet, privacy, evaluationId: values['evaluation-id'] ?? null, evaluationTarget: evaluation?.target ?? null, timeoutMs: evaluation?.timeoutMs ?? 45_000, requestedModel: requestModel, backupFrom: values['backup-from'] ?? null, retryOf: values['retry-run'] ?? null, diagnostic: values.action === 'diagnose', policyRetry: values['retry-policy-change'], ...run }, null, 2).split(apiKey).join('[REDACTED]')
  await fs.writeFile(path.join(privateDir, `${runId}.json`), privateJson, { flag: 'wx' })
  if (run.status === 'pending_review' && values.action !== 'diagnose') {
    const { mechanismApplications: _privateApplications, explanationCards: _privateCards, ...publicPacket } = packet
    const publicEvidence = packet.evidence.map(({ sourceContext: _privateContext, ...e }) => e)
    await saveReport({ ...publicPacket, assemblyVersion: run.assemblyVersion, evidence: [...publicEvidence, ...mechanismEvidence(packet, run.ruleLedger)], id: runId, schemaVersion: 'currency-report/1', publishedAt: null, generationMode: 'ai_enhanced', status: 'pending_review', content: run.candidate,
      comparison: { inputHash: fingerprint, label: 'common-rules-review', model: run.model ?? model, costUsd: null, average: null, preferred: false, provisional: true, publicationBlocked: true, rulesReviewOnly: true } })
    // Unverified drafts are explicit-run only and cannot replace the previous default.
  }
  console.log(JSON.stringify({ mode: values.mode, privacy, status: run.status, reason: run.reason, attempts: run.attempts,
    diagnostics: run.diagnostics, result: run.status === 'pending_review' && values.action !== 'diagnose' ? path.join(publicDir, `${runId}.json`) : '기존 보고서 유지', requestedModel: run.requestedModel ?? model, model: run.model ?? 'not_reported' }, null, 2))
}
main().catch(error => {
  // Allowlist codes; never leak arbitrary filesystem/HTTP error messages.
  const safe = /^[a-z_]+$/.test(error.message) ? error.message : 'local_operation_failed'
  console.error(safe)
  process.exitCode = 1
})
