import assert from 'node:assert/strict'
const base = 'http://127.0.0.1:4175'
const get = url => fetch(base + url, { signal: AbortSignal.timeout(10_000) })
const summaries = await (await get('/__report/index?mode=fixture')).json()
assert.deepEqual(summaries.map(s => s.currency), ['BRL', 'MXN', 'CLP'])
for (const s of summaries) {
  const report = await (await get(`/__report/${s.id}?mode=fixture`)).json()
  assert.equal(report.baseDate, s.baseDate)
  assert.equal(report.status, 'sample')
  assert.ok(report.series.length > 200)
  assert.equal('raw' in report, false)
  assert.equal('apiKey' in report, false)
}
for (const resource of ['/.env.report.local', '/.local-reports/private/boundary-probe.txt', '/data/mailing_list.json']) {
  const response = await get(resource)
  // Do not print bodies, even on a security failure.
  assert.equal(response.status, 403, 'private resource not explicitly denied')
}
assert.equal((await get('/__report/no-such-report')).status, 404)
const mutation = await fetch(base + '/__report/index', { method: 'POST', body: '{}', signal: AbortSignal.timeout(10_000) })
assert.equal(mutation.status, 405)
console.log('Local report API: fixture summaries/details, private-file denial and read-only boundary PASS')
