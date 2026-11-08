// Explicit local-only integration fixture; never invents a quality score for a real report.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { assertLocalApi } from './local-db.js'

const reportId = 'CLP-2026-10-15-1792145210900'
const sourcePath = `.local-reports/reviewable/${reportId}.json`
const source = await fs.readFile(sourcePath), report = JSON.parse(source)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
assert.equal(report.id, reportId)
assert.equal(report.comparison.average, null)
assert.equal(report.presentationVersion, 'monthly-facts/1')
const cfg = JSON.parse(await fs.readFile('.local-reports/private/local-db/connection.json', 'utf8'))
const url = assertLocalApi(cfg.url)
const accounts = JSON.parse(await fs.readFile('.local-reports/private/local-db/accounts.json', 'utf8'))
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient(url, cfg.serviceKey, options), anon = createClient(url, cfg.anonKey, options)
const admin = createClient(url, cfg.anonKey, options)
const ok = result => { assert.equal(result.error, null); return result.data }
const checks = []
const check = (name, value) => { assert.ok(value, name); checks.push(name) }
const dir = await fs.mkdtemp('.local-reports/private/reader-release-')
const previous = ok(await anon.from('currency_reports').select('run_id,report').eq('currency', 'CLP').eq('base_date', '2026-10-09').single())
ok(await admin.auth.signInWithPassword(accounts.admin))
let fixtureRunId
try {
  // Preserve an unscored actual candidate, and prove that the existing approval gate rejects it.
  const existing = ok(await service.from('currency_report_runs').select('id').eq('candidate->>id', reportId))
  let actualRunId = existing[0]?.id
  if (!actualRunId) {
    actualRunId = randomUUID()
    const attempts = ok(await service.from('currency_report_runs').select('attempt').eq('currency', 'CLP').eq('base_date', report.baseDate))
    ok(await service.from('currency_report_runs').insert({ id: actualRunId, currency: 'CLP', base_date: report.baseDate,
      attempt: Math.max(0, ...attempts.map(r => r.attempt)) + 1, rule_version: 'reader-release-check/1',
      event_binding: 'unscored-editorial:' + hash(source), candidate: report,
      packet: { sourceHash: hash(source), sourceReportId: reportId, localOnly: true },
      validation: { structureValid: true, contentReview: 'unverified', qualityAverage: null, evidenceScore: null, criticalErrors: 0 },
      cost: { modelCalls: 0, newCostUsd: 0 } }))
  }
  const denied = await admin.rpc('review_currency_report', { p_run_id: actualRunId, p_decision: 'approved' })
  check('unscored_actual_copy_not_approved', denied.error?.code === '22023')
  check('unapproved_actual_copy_not_public', ok(await anon.from('currency_reports').select('run_id').eq('run_id', actualRunId)).length === 0)
  check('failed_approval_has_no_review_record', ok(await service.from('currency_report_reviews').select('id').eq('run_id', actualRunId)).length === 0)

  // Separate future-date fixture. Its score is a synthetic input, NOT an evaluation of the actual prose.
  const fixture = structuredClone(report), baseDate = '2098-12-28'
  fixture.id = `CLP-${baseDate}-${Date.now()}`
  fixture.baseDate = baseDate
  fixture.testOnly = true
  fixture.content.title = '[승인 연결 시험 · 실제 발행 아님] ' + report.content.title
  fixture.content.summary = '새 편집본의 공개 복사·표시·철회만 확인하는 시험 사본입니다. 날짜와 점수는 시험용이며 원고 품질 승인이 아닙니다.'
  fixtureRunId = randomUUID()
  const attempts = ok(await service.from('currency_report_runs').select('attempt').eq('currency', 'CLP').eq('base_date', baseDate))
  ok(await service.from('currency_report_runs').insert({ id: fixtureRunId, currency: 'CLP', base_date: baseDate,
    attempt: Math.max(0, ...attempts.map(r => r.attempt)) + 1, rule_version: 'reader-release-fixture/1',
    event_binding: 'synthetic-reader-copy:' + hash(source), candidate: fixture,
    packet: { sourceHash: hash(source), sourceReportId: reportId, localOnly: true, synthetic: true },
    validation: { structureValid: true, contentReview: 'passed', criticalErrors: 0, qualityAverage: 4, evidenceScore: 4,
      synthetic: true, note: 'Test inputs only; no quality evaluation or publication approval of the source report.' },
    cost: { modelCalls: 0, newCostUsd: 0 } }))
  check('fixture_admin_approval', ok(await admin.rpc('review_currency_report', { p_run_id: fixtureRunId, p_decision: 'approved' })) === 'published')
  const projected = ok(await anon.from('currency_reports').select('report').eq('run_id', fixtureRunId).single()).report
  check('display_version_survives', projected.presentationVersion === 'monthly-facts/1')
  for (const field of ['facts', 'series', 'observedDate']) assert.deepEqual(projected[field], report[field])
  assert.deepEqual(projected.marketData, { source: report.marketData.source, rateType: report.marketData.rateType, fetchedAt: report.marketData.fetchedAt })
  check('private_capture_metadata_not_published', !projected.marketData.snapshotCommit && !projected.marketData.capturedAt)
  assert.deepEqual(projected.content.drivers, report.content.drivers)
  check('facts_chart_drivers_unchanged', true)
  check('fixture_and_manual_edit_labels_survive', projected.testOnly === true && projected.authorship === 'ai_with_manual_edit')
  check('private_metadata_removed', !projected.comparison && !projected.validation && !projected.packet && projected.evidence.every(e => !e.sourceContext))
  check('duplicate_approval_blocked', (await admin.rpc('review_currency_report', { p_run_id: fixtureRunId, p_decision: 'approved' })).error?.code === '55000')
  await fs.writeFile(dir + '/projected-fixture.json', JSON.stringify(projected, null, 2), { flag: 'wx' })
  check('fixture_withdrawal', ok(await admin.rpc('review_currency_report', { p_run_id: fixtureRunId, p_decision: 'withdrawn', p_reason: 'Local projection test complete; not a quality-approved report.' })) === 'withdrawn')
  check('withdrawn_fixture_not_public', ok(await anon.from('currency_reports').select('run_id').eq('run_id', fixtureRunId)).length === 0)
  check('approval_and_withdrawal_audit_preserved', ok(await service.from('currency_report_reviews').select('decision').eq('run_id', fixtureRunId)).length === 2)
  assert.deepEqual(ok(await anon.from('currency_reports').select('run_id,report').eq('run_id', previous.run_id).single()), previous)
  check('previous_actual_public_report_unchanged', true)
  check('source_file_unchanged', hash(await fs.readFile(sourcePath)) === hash(source))
  const result = { checkedAt: new Date().toISOString(), sourceReportId: reportId, sourceHash: hash(source), actualRunId,
    actualApproval: 'blocked_unscored', fixtureRunId, fixtureId: fixture.id, fixtureWithdrawn: true, checks,
    modelCalls: 0, newCostUsd: 0, qualityEvaluationPerformed: false, productionChanged: false }
  await fs.writeFile(dir + '/result.json', JSON.stringify(result, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ directory: dir, ...result }))
} finally {
  // Any partially completed fixture remains auditable but must not stay publicly recommended.
  if (fixtureRunId) {
    const state = await service.from('currency_report_runs').select('status').eq('id', fixtureRunId).maybeSingle()
    if (state.data?.status === 'published') ok(await admin.rpc('review_currency_report', { p_run_id: fixtureRunId, p_decision: 'withdrawn', p_reason: 'Local integration fixture cleanup after interruption.' }))
  }
  await admin.auth.signOut()
}
