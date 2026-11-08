// Read-only integration/security check against the isolated local app and DB.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { assertLocalApi } from './local-db.js'

async function main() {
  const cfg = JSON.parse(await fs.readFile('.local-reports/private/local-db/connection.json', 'utf8'))
  const api = assertLocalApi(cfg.url), app = 'http://127.0.0.1:4176'
  const checks = []
  const check = (name, value) => { assert.ok(value, name); checks.push(name) }
  const config = await fetch(app + '/__local-db/config').then(r => r.json())
  check('config_is_local_and_public_key_only', config.url === api && Object.keys(config).sort().join(',') === 'anonKey,url')
  for (const [url, expected] of [['/.env.report.local', 403], ['/.local-reports/private/event-trials/journal.json', 403],
    ['/.local-reports/reviewable/CLP-2026-10-09-1791732283970.json', 403], ['/api/mailing-list', 403], ['/__report/index', 404]])
    check('http_boundary_' + url, (await fetch(app + url)).status === expected)
  const mailing = await fs.readFile('data/mailing_list.json')
  check('mailing_writes_blocked', (await fetch(app + '/api/mailing-list', { method: 'POST', body: '[]' })).status === 403)
  assert.deepEqual(await fs.readFile('data/mailing_list.json'), mailing)
  check('config_writes_blocked', (await fetch(app + '/__local-db/config', { method: 'POST' })).status === 405)
  const headers = { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey }
  const publicResponse = await fetch(api + '/rest/v1/currency_reports?select=report', { headers })
  const reports = await publicResponse.json()
  check('anon_reads_approved_projection', publicResponse.ok && reports.length > 0 && reports.every(r => r.report.status === 'approved' && r.report.publishedAt))
  const originalId = 'CLP-2026-10-09-1791732283970'
  check('unapproved_actual_manuscript_not_public', !reports.some(r => r.report.id === originalId))
  const privateResponse = await fetch(api + '/rest/v1/currency_report_runs?select=id&limit=1', { headers })
  const privateRows = await privateResponse.json()
  check('anon_cannot_read_runs', !privateResponse.ok || Array.isArray(privateRows) && privateRows.length === 0)
  check('public_rows_have_no_private_fields', reports.every(r => !r.report.claimLedger && !r.report.claimReview && !r.report.sourceContext && r.report.evidence.every(e => !e.sourceContext)))
  const files = []
  async function walk(dir) { for (const e of await fs.readdir(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) await walk(p); else if (/\.(js|css|html)$/.test(p)) files.push(p) } }
  for (const dir of ['dist', 'dist-report-ui', 'dist-app-local']) await walk(dir)
  const keyFile = await fs.readFile('.env.report.local', 'utf8')
  const openrouter = keyFile.match(/^\s*OPENROUTER_API_KEY\s*=\s*["']?([^"'\s\r\n]+)/m)?.[1]
  const secrets = [cfg.serviceKey, openrouter].filter(v => typeof v === 'string' && v.length > 12)
  check('secret_scan_has_actual_values', secrets.length >= 1)
  for (const file of files) { const value = await fs.readFile(file, 'utf8'); assert.ok(secrets.every(secret => !value.includes(secret)), 'secret_in_bundle') }
  check('browser_builds_have_no_secret_keys', true)
  const generated = await fs.readFile('src/generated/fxReportConfig.ts', 'utf8')
  check('production_report_flag_unchanged_off', generated.includes('enabled: false'))
  const result = { checkedAt: new Date().toISOString(), checks, filesScanned: files.length, modelCalls: 0, costUsd: 0,
    dbWrites: 0, mailingListHash: createHash('sha256').update(mailing).digest('hex') }
  const dir = await fs.mkdtemp('.local-reports/private/app-report-verification-')
  await fs.writeFile(dir + '/result.json', JSON.stringify(result, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ directory: dir, ...result }))
}
main().catch(e => { console.error(/^[a-z_]+$/.test(e.message) ? e.message : 'app_report_verification_failed'); process.exitCode = 1 })
