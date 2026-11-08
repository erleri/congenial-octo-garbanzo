// Public repository snapshot only; does not load keys or regenerate operational data.
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { validDate } from './core.js'
async function bounded(response, maximum) {
  if (!response.ok) throw new Error('public_market_source_unavailable')
  const reader = response.body?.getReader(), chunks = []; let bytes = 0
  if (!reader) throw new Error('public_market_source_empty')
  for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > maximum) { await reader.cancel(); throw new Error('public_market_source_oversize') } chunks.push(Buffer.from(part.value)) }
  return Buffer.concat(chunks).toString('utf8')
}
export async function fetchPublicMarketSnapshot(fetchImpl = fetch) {
  const commit = JSON.parse(await bounded(await fetchImpl('https://api.github.com/repos/erleri/congenial-octo-garbanzo/commits/main', { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/vnd.github+json' } }), 500000))
  if (!/^[a-f0-9]{40}$/.test(commit.sha ?? '')) throw new Error('public_commit_not_verified')
  const url = `https://raw.githubusercontent.com/erleri/congenial-octo-garbanzo/${commit.sha}/public/data.json`
  const body = await bounded(await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(20000) }), 5000000)
  if (/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|-----BEGIN .*PRIVATE KEY/i.test(body)) throw new Error('private_data_in_public_snapshot')
  const dataset = JSON.parse(body)
  if (!validDate(dataset.baseDate) || !Array.isArray(dataset.dailyRates) || !Array.isArray(dataset.monthlyRates) || !['BRL','CLP','MXN'].every(c => dataset.dailyRates.some(r => r.currency === c && r.rateType === 'LOCAL_PER_USD')))
    throw new Error('public_market_schema_changed')
  return { dataset, receipt: { source: 'public_repository_fallback', commit: commit.sha, url,
    capturedAt: new Date().toISOString(), baseDate: dataset.baseDate, sha256: createHash('sha256').update(body).digest('hex'), bytes: Buffer.byteLength(body),
    observationTimeVerified: false, productionDeploymentVerified: false, modelCalls: 0, costUsd: 0 } }
}
async function main() {
  const result = await fetchPublicMarketSnapshot()
  await fs.mkdir('.local-reports/private/market-snapshots', { recursive: true })
  const output = await fs.mkdtemp('.local-reports/private/market-snapshots/run-')
  await fs.writeFile(`${output}/dataset.json`, JSON.stringify(result.dataset), { flag: 'wx' })
  await fs.writeFile(`${output}/receipt.json`, JSON.stringify(result.receipt, null, 2), { flag: 'wx' })
  await fs.mkdir('.local-reports/reviewable', { recursive: true })
  let prior
  try { prior = JSON.parse(await fs.readFile('.local-reports/reviewable/market-data.json', 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
  if (prior?.baseDate > result.dataset.baseDate) throw new Error('older_snapshot_preserved_not_promoted')
  await fs.writeFile('.local-reports/reviewable/market-data.json', JSON.stringify(result.dataset))
  console.log(JSON.stringify({ output, ...result.receipt }))
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(e => { console.error(/^[a-z_]+$/.test(e.message) ? e.message : 'public_snapshot_failed'); process.exitCode = 1 })
