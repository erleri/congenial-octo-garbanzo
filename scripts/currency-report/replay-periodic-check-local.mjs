// Saved CLP replay only. No environment loader, credentials, transport or app registration.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { preparePeriodicCheck } from './periodic-check.js'
import { projectSourceContext } from './source-context.js'
import { requestBody, composeDraft } from './openrouter.js'
import { claimReviewContract } from './claim-review.js'
import { generationWire, decodeGenerationOutput } from './generation-wire.js'
import { WRITING_CONTRACT_VERSION } from './writing-contract.js'

globalThis.fetch = () => { throw new Error('offline_periodic_replay_only') }
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'))
const digest = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const reportFile = '.local-reports/reviewable/CLP-2026-09-10-1793093118350.json'
const sampleFile = 'docs/2.0/periodic-report-samples-20261027.json'
const report = read(reportFile), samples = read(sampleFile)
const before = read('.local-reports/private/periodic-samples-20261027-ZFgS7Q/preservation-before.json')
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const f = path.join(dir, e.name)
    return e.isDirectory() ? walk(f) : [f.replaceAll('\\', '/')]
  })
}
for (const f of walk('.local-reports/private').filter(f => /(?:reservation|ledger|result|cost)\.json$/.test(f))) before[f] = digest(f)
for (const f of [sampleFile, 'artifacts/periodic-report-samples-20261027.html']) before[f] = digest(f)
assert.ok(Object.entries(before).every(([f, h]) => digest(f) === h), 'saved original already changed')
const out = fs.mkdtempSync('.local-reports/private/periodic-check-replay-20261027-')
fs.writeFileSync(out + '/preservation-before.json', JSON.stringify(before, null, 2))
const packet = Object.fromEntries(['currency', 'baseDate', 'observedDate', 'marketData', 'facts', 'series', 'evidence', 'limitations'].map(k => [k, structuredClone(report[k])]))
const priceBasis = Object.fromEntries(['provider', 'seriesId', 'priceKind', 'dateBasis', 'timeZone'].map(k => [k, packet.marketData.reportPriceBasis[k]]))
const ids = { D: 'news-df-20260910', E: 'news-emol-20260910' }
const topics = [['copper', '구리', 'E', 'n0'], ['rates', '미국 금리', 'D', 'n1']].map(([id, label, ref, passage]) => {
  const e = packet.evidence.find(e => e.id === ids[ref]), context = projectSourceContext(e)
  assert.ok(context.passages.some(p => p.id === passage))
  return { id, label, relation: 'supports', sourceLinks: [{ evidenceId: e.id, passageIds: [passage], passageHash: context.passageHash }],
    review: { origin: 'agent', status: 'checked', checkedOn: '2026-10-27',
      reason: '저장된 검토 요지에서 구리는 Emol n0, 미국 금리 자금 유인은 DF n1 범위만 연결했다. 원문 신규 검증이나 전체 기간 원인 판정이 아니다.' } }
})
const previous = { id: 'simulated-prior-20260827', currency: packet.currency, origin: 'simulated', status: 'published',
  publishedAt: '2026-08-27T23:00:00Z', observedDate: '2026-08-27', value: 925.25, priceBasis,
  topics: topics.map(({ id, label }) => ({ id, label })) }
const scenarios = [
  { id: 'normal', expected: 'normal_check', prior: previous, current: topics },
  { id: 'update', expected: 'explanation_update', prior: { ...previous, topics: previous.topics.slice(0, 1) }, current: topics },
  { id: 'partial', expected: 'partial_evidence', prior: previous, current: topics.filter(t => t.id === 'rates') },
]
const cases = []
for (const [index, s] of scenarios.entries()) {
  const preparationInput = { packet, previous: s.prior, topics: s.current, mode: 'saved_replay' }
  fs.writeFileSync(`${out}/${s.id}-preparation-input.json`, JSON.stringify(preparationInput, null, 2))
  const prepared = preparePeriodicCheck(preparationInput)
  assert.equal(prepared.status, 'ready_for_local_draft')
  const p = prepared.packet, plan = p.periodicCheck
  assert.equal(plan.scenario, s.expected)
  const body = requestBody(p, 'openrouter/free'), input = JSON.parse(body.messages[1].content)
  // Replay preserves the existing sample files. These explicit test responses
  // move numbers/gaps to code-owned fields; they are NOT newly generated prose.
  const sample = samples.samples[index]
  const descriptions = sample.sections.filter(b => b.sourceIds.some(id => ids[id]))
  const draft = { title: index === 0 ? '구리와 미국 금리 두 경로를 점검' : sample.title,
    summary: index === 0 ? '확인한 당일 시장 해석은 구리의 페소 지지력과 미국 금리의 달러 유인 경로를 함께 다룹니다.' :
      index === 1 ? '구리를 중심으로 보던 가상의 이전 메모에 미국 금리 여건을 추가했습니다.' : sample.summary,
    drivers: plan.selectedTopicIds.map(id => {
      const topic = topics.find(t => t.id === id), ref = topic.sourceLinks[0].evidenceId === ids.E ? 'E' : 'D'
      const block = descriptions.find(b => b.sourceIds.includes(ref))
      // This first sentence is the already-verified price comparison, now assembled by code.
      const text = index === 2 ? block.text.slice(block.text.indexOf('DF의')) : block.text
      return { title: block.heading, text, kind: 'interpretation', evidenceIds: [ids[ref]] }
    }), implications: [], watch: [] }
  const targets = [['title', draft.title], ['summary', draft.summary], ...draft.drivers.flatMap((b, i) => [[`drivers.${i}.title`, b.title], [`drivers.${i}.text`, b.text]])]
  draft.ruleLedger = { version: WRITING_CONTRACT_VERSION, claims: targets.map(([target]) => ({ target, kind: 'interpretation',
    evidenceIds: target.startsWith('drivers.') ? draft.drivers[Number(target.split('.')[1])].evidenceIds : [...new Set(draft.drivers.flatMap(b => b.evidenceIds))],
    mechanismId: '', applicationId: '' })) }
  const wire = generationWire(body.response_format.json_schema.schema, 'openai/gpt-6.1-sol')
  const slots = structuredClone(draft)
  for (const [field, { max }] of Object.entries(wire.contract.sections)) slots[field] = Object.fromEntries(Array.from({ length: max }, (_, i) => [`slot_${i}`, draft[field][i] ?? null]))
  const result = composeDraft(p, decodeGenerationOutput(slots, wire.contract), true, true)
  assert.equal(result.validation.valid, true, JSON.stringify(result.validation))
  assert.equal(result.rules.automaticStatus, 'pass', JSON.stringify(result.rules.checks))
  assert.equal(result.rules.semanticStatus, 'unverified')
  assert.equal(result.claimReview.purpose, 'periodic_check')
  assert.equal(result.claimReview.publicationApproved, false)
  const reviewer = claimReviewContract(result.claimReview)
  assert.ok(reviewer.messages[0].content.includes('정기 점검 검토'))
  assert.ok(Math.abs(plan.comparison.changePct - samples.price.changePct) < 1e-9)
  if (s.id === 'partial') {
    assert.deepEqual(input.evidence.map(e => e.id), [ids.D])
    assert.deepEqual(input.evidence[0].sourceContext.passages.map(p => p.id), ['n1'])
    assert.equal(result.candidate.limitations.filter(t => t.includes('재확인하지 못한 설명')).length, 1)
  }
  fs.writeFileSync(`${out}/${s.id}.json`, JSON.stringify({ input, schema: body.response_format.json_schema.schema,
    system: body.messages[0].content, outputOrigin: 'explicit_saved_sample_test_response_not_model', result, reviewer }, null, 2))
  cases.push({ id: s.id, scenario: plan.scenario, selectedTopicIds: plan.selectedTopicIds, missingTopics: plan.missingTopics,
    comparison: plan.comparison, automaticStatus: result.rules.automaticStatus,
    contentReview: result.rules.semanticStatus, publicationApproved: result.rules.publicationApproved })
}
const none = preparePeriodicCheck({ packet, previous, topics: [], mode: 'saved_replay' })
assert.equal(none.status, 'hold')
const preserve = Object.entries(before).every(([f, h]) => digest(f) === h)
assert.ok(preserve)
const result = { version: 'periodic-saved-replay/1', origin: 'saved_price_and_reviewed_notes_with_hypothetical_prior',
  cases, allEvidenceMissing: { status: none.status, holds: none.holds },
  sourceReport: report.id, preservedFiles: Object.keys(before).length, originalFilesUnchanged: preserve,
  modelCalls: 0, externalCalls: 0, newApiCostUsd: 0, productionChanges: false,
  limitation: '입력 선택·공통 조립·검토 연결의 검증이다. 새 AI 품질·독립 내용 검토·실제 발행 적합성은 미검증이다.' }
fs.writeFileSync(out + '/result.json', JSON.stringify(result, null, 2))
console.log(JSON.stringify({ output: out, ...result }, null, 2))
