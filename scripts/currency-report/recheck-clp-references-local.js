// Saved-case recheck only. No env/key loading, network or approval writes.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { prepareClaimReview, assessClaimReview } from './claim-review.js'
import { reviseClaimReferences } from './evidence-scope.js'
import { saveReport } from './storage.js'

const sha = b => createHash('sha256').update(b).digest('hex')
async function main() {
  const paths = {
    input: '.local-reports/private/economic-approved-comparisons/run-RSCtjg/trial-input.json',
    result: '.local-reports/private/event-trials/run-3zNSmb/result.json',
    review: '.local-reports/private/event-trials/run-3zNSmb/content-review-detailed.json',
    report: '.local-reports/reviewable/CLP-2026-10-09-1791732283970.json',
    journal: '.local-reports/private/event-trials/journal.json',
    ipc: '.local-reports/private/source-review-2026-10-11/cl-ipc-followup.html',
    wage: '.local-reports/private/source-review-2026-10-11/cl-wage-followup.html',
  }
  const bytes = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, file]) => [key, await fs.readFile(file)])))
  const input = JSON.parse(bytes.input), result = JSON.parse(bytes.result), oldReview = JSON.parse(bytes.review)
  const compiled = result.response.compiled
  const requirement = { target: 'drivers.1.text', quote: '이는 별도 월의 임금 맥락이며, 전 가구 소득이나 소비·판매 결과를 관측한 것은 아니다.',
    evidenceIds: ['ine-cl-real-wage-august', 'ine-cl-ipc-september'], reason: '기간 관계는 8월 보수와 9월 IPC의 두 원문과 대상 월을 모두 확인해야 한다.' }
  const options = { scopeCards: input.dossier.scopeCards, claimLedger: compiled.claimLedger, purpose: 'economic_update', referenceRequirements: [requirement] }
  const before = prepareClaimReview(input.packet, compiled.content, options)
  assert.ok(before.referenceIssues.some(i => i.code === 'relation_source_missing'))
  const revision = reviseClaimReferences(input.packet, compiled.content, before.claims, compiled.claimLedger, [requirement])
  const prepared = prepareClaimReview(input.packet, revision.content, { ...options, claimLedger: revision.claimLedger })
  assert.deepEqual(prepared.referenceIssues, [])
  // This recorded agent recheck revisits the citation-only correction. It does
  // not copy the old binding as a valid review or increase the quality score.
  const review = structuredClone(oldReview.review)
  review.binding = prepared.binding; review.reviewer = 'Codex 저장 원문 출처 연결 재검토 · 2026-10-13 · 사용자 승인 아님'
  const row = review.claims.find(r => r.id === 'drivers.1.text:1')
  const ipc = prepared.sources.find(s => s.id === requirement.evidenceIds[1])
  const wage = prepared.sources.find(s => s.id === requirement.evidenceIds[0])
  assert.equal(ipc.period, '2026-09'); assert.equal(wage.period, '2026-08')
  assert.ok(bytes.wage.toString().includes('agosto de 2026'))
  const passage = ipc.sourceContext.passages.find(p => p.id === 'p0')
  assert.ok(bytes.ipc.toString().includes(passage.text))
  const anchor = { evidenceId: ipc.id, passageId: passage.id, passageHash: ipc.sourceContext.passageHash, quote: passage.text }
  row.anchors.push(anchor); row.subclaims[0].anchors.push(anchor)
  for (const claim of prepared.claims) {
    const rechecked = review.claims.find(r => r.id === claim.id)
    assert.equal(rechecked.claimHash, claim.claimHash)
    for (const a of rechecked.anchors) assert.ok(bytes[a.evidenceId === ipc.id ? 'ipc' : 'wage'].toString().includes(a.quote))
  }
  Object.assign(row, { support: 'supported', decision: 'keep', issue: 'none', reason: '8월 보수와 9월 IPC의 대상 월을 각각 원문·메타데이터로 확인했고, 문장과 블록에 두 출처를 연결했다. 지표 범위 구분을 유지한다.' })
  Object.assign(row.subclaims[0], { support: 'supported', reason: '보수의 8월과 IPC 원문의 9월을 각각 확인했다. 서로 다른 대상 월의 관계만 지지하며 경제적 인과로 확대하지 않는다.' })
  const assessment = assessClaimReview(prepared, review)
  assert.equal(assessment.status, 'reviewed'); assert.deepEqual(assessment.errors, [])
  assert.deepEqual(assessment.requiredCorrections, [])
  for (const target of ['title', 'summary', 'change', 'implications', 'watch', 'limitations']) assert.deepEqual(revision.content[target], compiled.content[target])
  revision.content.drivers.forEach((d, i) => { assert.equal(d.text, compiled.content.drivers[i].text); assert.equal(d.title, compiled.content.drivers[i].title) })
  const dir = await fs.mkdtemp('.local-reports/private/reference-recheck-')
  let previewId = null
  if (process.argv.includes('--preview')) {
    const parent = JSON.parse(bytes.report)
    previewId = `${parent.currency}-${parent.baseDate}-${Date.now()}`
    await saveReport({ ...parent, id: previewId, status: 'pending_review', publishedAt: null, content: revision.content,
      comparison: { ...parent.comparison, referenceOnly: true, citationRevision: true, preferred: false, publicationBlocked: true,
        label: '출처 연결 보완 · 원문과 본문 보존 · 신규 호출 0',
        reviewNotes: ['출처 연결 보완 사본입니다. 실제 AI 재생성이나 게시 승인 결과가 아닙니다.', '원문의 문장·수치·차트 및 이전 품질 평가 3.8/5는 유지합니다.'] } })
  }
  const record = { revision, prepared, review, assessment, quality: oldReview.quality, parentReportId: JSON.parse(bytes.report).id,
    previewId, preservedHashes: Object.fromEntries(Object.entries(bytes).map(([key, b]) => [key, sha(b)])), publicationApproved: false,
    modelCalls: 0, costUsd: 0, limitation: '출처 연결만 재검토했다. 품질 3.8/5 및 독자·게시 승인은 그대로 미통과/대기다.' }
  await fs.writeFile(dir + '/recheck.json', JSON.stringify(record, null, 2), { flag: 'wx' })
  for (const [key, file] of Object.entries(paths)) assert.equal(sha(await fs.readFile(file)), record.preservedHashes[key])
  console.log(JSON.stringify({ directory: dir, previewId, citationCheck: assessment.status, requiredCorrections: assessment.requiredCorrections,
    qualityAverage: oldReview.quality.average, publicationApproved: false, originalsUnchanged: true, modelCalls: 0, costUsd: 0 }))
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
