// One newly authorized generation, maximum $0.084. No model review, edit,
// retry, search or publication. A permanent directory prevents repeat calls.
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { parse } from 'dotenv'
import { endpointPreflight, generationBody } from './run-clp-editorial-trial.js'
import { requestTokenBound, PRICE_CEILING, MODEL } from './prepare-clp-editorial.js'
import { composeDraft } from './openrouter.js'
import { callOpenRouterStream, reconcileGenerationCost } from './openrouter-stream.js'
import { createPrivateStreamJournal } from './stream-journal.js'

const root = '.local-reports/private/clp-20261005-owned-content-trial-v1'
const priorRoot = '.local-reports/private/clp-20261005-editorial-trial-v1'
const prepared = '.local-reports/private/saved-claims-evaluation-vKmGXm/generation-request.json'
const hash = value => createHash('sha256').update(value).digest('hex')
const save = (name, value) => fs.writeFile(`${root}/${name}.json`, JSON.stringify(value, null, 2), { flag: 'wx' })
async function main() {
  const mode = process.argv[2]
  if (!['check', 'run'].includes(mode) || process.argv.length !== 3) throw new Error('explicit_mode_required')
  const snapshotBytes = await fs.readFile(`${priorRoot}/snapshot.json`)
  if (hash(snapshotBytes) !== 'e89d08bc8eedc4c314d9544fb2dd3fbea89b10b586f4acf5451af0f4a591506f') throw new Error('snapshot_changed')
  const packet = JSON.parse(snapshotBytes).packet, body = generationBody(packet)
  const preparedBody = JSON.parse(await fs.readFile(prepared, 'utf8'))
  if (JSON.stringify(body) !== JSON.stringify(preparedBody) || hash(JSON.stringify(body)) !== '5e143e23e650d80c80311711edf2ca13efe6a7ee4ec51b926dc6ae9bd1e387f3') throw new Error('approved_request_changed')
  const reservedUsd = Math.ceil((requestTokenBound(body) * PRICE_CEILING.prompt + body.max_tokens * PRICE_CEILING.completion) / 1e6 * 1e9) / 1e9
  if (reservedUsd > .084 || body.model !== MODEL || body.max_tokens !== 16384) throw new Error('budget_exceeded')
  // Same model/privacy. Pin the available Flex route, with no fallback.
  body.provider.only = ['google-vertex/global/flex']
  const preflight = await endpointPreflight(body)
  if (mode === 'check') { console.log(JSON.stringify({ reservedUsd, inputUpperBound: requestTokenBound(body), ...preflight, calls: 0 })); return }
  const apiKey = parse(await fs.readFile('.env.report.local', 'utf8')).OPENROUTER_API_KEY
  if (!apiKey || JSON.stringify(body).includes(apiKey)) throw new Error('invalid_key')
  await fs.mkdir(root)
  await save('authorization', { userReply: 'ㅇㅋ', scope: 'same evidence one Gemini generation and offline review', budgetUsd: .084, maxCalls: 1, retries: 0, at: new Date().toISOString() })
  await save('snapshot', { packet, body, inputHash: hash(JSON.stringify({ packet, body })), preflight })
  await save('reservation', { reservedUsd, costUsd: null, calls: 1, retries: 0 })
  const checkpoint = await createPrivateStreamJournal('clp-owned-content-v1-generation')
  console.log(JSON.stringify({ phase: 'generation_started', reservedUsd }))
  const transport = await callOpenRouterStream({ body, apiKey, checkpoint, timeoutMs: 240000 })
  await save('transport', transport)
  let cost = { costUsd: transport.costUsd, costSource: transport.costSource }
  if (cost.costUsd === null && transport.responseId) cost = await reconcileGenerationCost({ responseId: transport.responseId, apiKey })
  const accounting = { ...cost, reservedUsd, unknownReservedUsd: cost.costUsd === null ? reservedUsd : 0,
    responseId: transport.responseId, actualModel: transport.actualModel, latencyMs: transport.latencyMs, usage: transport.usage, calls: 1, retries: 0 }
  await save('accounting', accounting)
  let result
  if (!transport.valid) result = { status: 'transport_failed', errors: transport.errors }
  else if (!(transport.actualModel === MODEL || transport.actualModel?.startsWith(MODEL + '-20'))) result = { status: 'model_mismatch' }
  else if (cost.costUsd !== null && cost.costUsd > reservedUsd) result = { status: 'cost_exceeded' }
  else {
    try {
      const draft = JSON.parse(transport.partialText)
      await save('draft', draft)
      const generated = composeDraft(packet, draft, true, true)
      result = { status: generated.validation.valid ? 'generated_pending_content_review' : 'validation_hold', generated }
    } catch { result = { status: 'invalid_output' } }
  }
  await save('result', { ...result, publicationApproved: false })
  console.log(JSON.stringify({ phase: 'finished', status: result.status, validation: result.generated?.validation, ...accounting }))
}
main().catch(e => { console.error(/^[a-z_]+$/.test(e.message ?? '') ? e.message : 'owned_content_trial_failed'); process.exitCode = 1 })
