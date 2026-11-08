// node scripts/currency-report/chile-monthly-local.js --period YYYY-MM [--live]
// Without --live: print fixed sources only, no filesystem or network writes.
import { parseArgs } from 'node:util'
import { CHILE_MONTHLY_SOURCES, collectChileMonthlyOriginals } from './chile-monthly-originals.js'
import { saveChileMonthlyCapture } from './chile-monthly-store.js'
try {
  const { values } = parseArgs({ options: { period: { type: 'string' }, live: { type: 'boolean', default: false } }, strict: true })
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(values.period ?? '')) throw new Error('explicit_month_required')
  if (!values.live) console.log(JSON.stringify({ mode: 'plan', period: values.period, sources: CHILE_MONTHLY_SOURCES, networkCalls: 0, modelCalls: 0 }))
  else {
    const stored = await saveChileMonthlyCapture(await collectChileMonthlyOriginals({ period: values.period }))
    console.log(JSON.stringify({ directory: stored.directory, networkCalls: stored.manifest.networkCalls, modelCalls: 0,
      results: stored.manifest.results.map(r => ({ sourceId: r.sourceId, status: r.status, reason: r.reason,
        originals: r.originals.map(o => ({ status: o.status, reason: o.reason, bytes: o.bytes, sha256: o.sha256 })) })), evidenceReady: false }))
  }
} catch {
  console.error('chile_monthly_capture_failed; no report or publication changed')
  process.exitCode = 1
}
