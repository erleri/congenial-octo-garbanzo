import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { decideGeneration, trialEventHistory } from './generation-decision.js'
import { collectOfficialEvents, importManualOriginal, projectOfficialCalendar, discoveryDecisionEvents } from './official-events.js'

async function privateInput(file) {
  const target = await fs.realpath(file), root = await fs.realpath('.local-reports/private')
  if (!target.startsWith(root + path.sep) || path.extname(target) !== '.json') throw new Error('private_json_input_required')
  return target
}
export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { action: { type: 'string' }, 'as-of': { type: 'string' }, input: { type: 'string' }, dataset: { type: 'string' }, currency: { type: 'string' } }, strict: true })
  if (!['assess', 'collect', 'import', 'replay-capture'].includes(values.action)) throw new Error('explicit_local_action_required')
  const root = '.local-reports/private/event-decisions'
  await fs.mkdir(root, { recursive: true })
  const output = await fs.mkdtemp(root + '/run-')
  const save = (name, value) => fs.writeFile(`${output}/${name}.json`, JSON.stringify(value, null, 2), { flag: 'wx' })
  if (values.action === 'collect') {
    const result = await collectOfficialEvents({ asOf: values['as-of'] ?? new Date().toISOString() })
    await save('official-captures', result)
    await fs.mkdir('.local-reports/reviewable', { recursive: true })
    await fs.writeFile('.local-reports/reviewable/official-calendar.json', JSON.stringify(projectOfficialCalendar(result, values['as-of'] ?? new Date().toISOString()), null, 2))
    console.log(JSON.stringify({ output, modelCalls: 0, costUsd: 0, sources: result.results.map(r => ({ source: r.source, status: r.status, candidates: r.candidates.length })) }))
    return
  }
  const input = values.input ? JSON.parse(await fs.readFile(await privateInput(values.input), 'utf8')) : {}
  if (values.action === 'replay-capture') {
    if (!values['as-of']) throw new Error('explicit_capture_asof_required')
    const calendar = projectOfficialCalendar(input, values['as-of'])
    await save('calendar-replay', calendar)
    await fs.mkdir('.local-reports/reviewable', { recursive: true })
    await fs.writeFile('.local-reports/reviewable/official-calendar.json', JSON.stringify(calendar, null, 2))
    console.log(JSON.stringify({ output, entries: calendar.entries.length, modelCalls: 0, costUsd: 0 })); return
  }
  if (values.action === 'import') { await save('manual-original', importManualOriginal(input)); console.log(JSON.stringify({ output, status: 'manual_pending_review', modelCalls: 0 })); return }
  const lockPath = root + '/assessment.lock'
  let lock
  try { lock = await fs.open(lockPath, 'wx') } catch (e) { if (e.code === 'EEXIST') throw new Error('assessment_already_running_or_interrupted'); throw e }
  try {
    const dataset = JSON.parse(await fs.readFile(values.dataset ? await privateInput(values.dataset) : 'data/fx-full-history.json', 'utf8'))
    const currencies = values.currency ? [values.currency] : ['BRL', 'CLP', 'MXN']
    let recorded = []
    const historyFile = root + '/decision-history.json'
    try { recorded = JSON.parse(await fs.readFile(historyFile, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
    let trialHistory=[]
    try {trialHistory=trialEventHistory(JSON.parse(await fs.readFile('.local-reports/private/event-trials/journal.json','utf8')))} catch(e){if(e.code!=='ENOENT') throw e}
    const events = input.version === 'official-events/1' ? discoveryDecisionEvents(input, values['as-of']) : input.events ?? []
    const decisions = currencies.map(currency => decideGeneration({ dataset, currency, asOf: values['as-of'], events, history: [...recorded, ...trialHistory, ...(input.history ?? [])] }))
    await save('decisions', { decisions, datasetBaseDate: dataset.baseDate, modelCalls: 0, costUsd: 0 })
    await fs.writeFile(historyFile, JSON.stringify([...recorded, ...decisions].slice(-1000), null, 2))
    // The local UI projection deliberately omits raw originals and review records.
    const projection = { checkedAt: values['as-of'], datasetBaseDate: dataset.baseDate, decisions: decisions.map(d => ({ currency: d.currency, status: d.status, observedDate: d.price.observedDate,
      priceIssues: d.price.issues, windows: d.price.windows, events: d.events.map(e => ({ id: e.id, status: e.status, reason: e.reason })), paidCallAuthorized: false })) }
    await fs.mkdir('.local-reports/reviewable', { recursive: true })
    const latest = '.local-reports/reviewable/generation-status.json'
    await fs.writeFile(latest, JSON.stringify(projection, null, 2))
    console.log(JSON.stringify({ output, statusProjection: latest, datasetBaseDate: dataset.baseDate, decisions: decisions.map(d => ({ currency: d.currency, status: d.status })), modelCalls: 0, costUsd: 0 }))
  } finally { await lock.close(); await fs.unlink(lockPath) }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { console.error(/^[a-z_]+$/.test(error.message) ? error.message : 'local_decision_failed'); process.exitCode = 1 })
