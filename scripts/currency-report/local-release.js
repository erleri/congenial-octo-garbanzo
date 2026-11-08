// Preparation and readiness only: never reads production credentials or dispatches models.
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { assessPilot, assessRelease, prepareEventTrial, eventTrialEndpointPreflight, EVENT_TRIAL_POLICY } from './lifecycle-control.js'

export function assertLocalDbTarget(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('isolated_local_db_required') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.port !== '56322') throw new Error('isolated_local_db_required')
  return { host: url.hostname, port: 56322 }
}
export function isolatedConfig(template) {
  const config = template.replace(/^project_id\s*=\s*"[^"]+"/m, 'project_id = "latamfx-2x-isolated"')
    .replace(/\b(?:543|553)(\d{2})\b/g, '563$1')
    .replace(/^site_url\s*=.*$/m, 'site_url = "http://127.0.0.1:4175/local-experience.html"')
    .replace(/^additional_redirect_urls\s*=.*$/m, 'additional_redirect_urls = ["http://127.0.0.1:4175/**", "http://127.0.0.1:4176", "http://127.0.0.1:4176/**", "http://127.0.0.1:4177", "http://127.0.0.1:4177/**"]')
    .replace(/^inspector_port\s*=.*$/m, 'inspector_port = 56328')
  if (!config.includes('port = 56322') || !config.includes('project_id = "latamfx-2x-isolated"') || /^\w*port\s*=\s*(?:543|553)\d{2}/m.test(config)) throw new Error('isolated_config_not_verified')
  return config
}
async function input(file) {
  const root = await fs.realpath('.local-reports/private'), target = await fs.realpath(file)
  if (!target.startsWith(root + path.sep) || path.extname(target) !== '.json') throw new Error('private_json_input_required')
  return JSON.parse(await fs.readFile(target, 'utf8'))
}
export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { action: { type: 'string' }, input: { type: 'string' }, 'as-of': { type: 'string' } }, strict: true })
  if (!['prepare-db', 'prepare-trial', 'readiness', 'pilot', 'endpoint-preflight'].includes(values.action)) throw new Error('explicit_preparation_action_required')
  await fs.mkdir('.local-reports/private/release', { recursive: true })
  const output = await fs.mkdtemp('.local-reports/private/release/run-')
  if (values.action === 'prepare-db') {
    const target = `${output}/supabase`
    await fs.mkdir(target)
    const template = await fs.readFile('supabase/config.toml', 'utf8')
    const config = isolatedConfig(template)
    await fs.writeFile(`${target}/config.toml`, config, { flag: 'wx' })
    await fs.cp('supabase/migrations', `${target}/migrations`, { recursive: true, errorOnExist: true, force: false })
    await fs.cp('supabase/tests', `${target}/tests`, { recursive: true, errorOnExist: true, force: false })
    await fs.writeFile(`${target}/seed.sql`, '-- Isolated report tests only; no operational seed.\n', { flag: 'wx' })
    console.log(JSON.stringify({ workdir: path.resolve(output), project: 'latamfx-2x-isolated', dbPort: 56322, migrationApplied: false, rolesVerified: false })); return
  }
  const data = values.input ? await input(values.input) : {}
  if (values.action === 'endpoint-preflight') {
    const body = { model: EVENT_TRIAL_POLICY.model, max_tokens: 8192, messages: [], reasoning: { effort: 'medium' }, provider: { only: [EVENT_TRIAL_POLICY.route], require_parameters: true, zdr: true, data_collection: 'deny', allow_fallbacks: false } }
    const result = await eventTrialEndpointPreflight(body)
    await fs.writeFile(`${output}/endpoint.json`, JSON.stringify({ ...result, requestPrepared: false, paidCallAuthorized: false }, null, 2), { flag: 'wx' })
    console.log(JSON.stringify({ output, ...result, requestPrepared: false, paidCallAuthorized: false })); return
  }
  const result = values.action === 'pilot' ? assessPilot({ records: data.records ?? [], version: data.version ?? 'event-driven/1', asOf: values['as-of'] })
    : values.action === 'prepare-trial' ? prepareEventTrial(data)
    : assessRelease(data.checks ?? {})
  await fs.writeFile(`${output}/result.json`, JSON.stringify(result, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ output, status: result.status, missing: result.missing ?? result.issues, modelCalls: 0, costUsd: 0 }))
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(e => { console.error(/^[a-z_]+$/.test(e.message) ? e.message : 'local_preparation_stopped'); process.exitCode = 1 })
