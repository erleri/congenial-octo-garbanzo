// Explicit saved-case editing, not a generator, model call or approval.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { saveReport } from './storage.js'

export function polishClpCopy(parent, id) {
  if (parent.id !== 'CLP-2026-10-09-1791888644987' || parent.status !== 'pending_review' || !parent.comparison?.citationRevision)
    throw new Error('reviewed_parent_required')
  const next = structuredClone(parent)
  next.id = id; next.publishedAt = null
  next.content.title = '칠레 9월 물가는 상승, 분류별 흐름은 엇갈림\n8월 실질보수는 증가'
  next.content.drivers[0].title = '식품·교통 상승, 보험·금융 하락'
  const warning = ' 식품과 교통은 원문이 강조한 상승 분류이며, 전체 분류 기여도 순위를 확인한 것은 아니다.'
  if (!next.content.drivers[0].text.endsWith(warning)) throw new Error('unexpected_parent_prose')
  next.content.drivers[0].text = next.content.drivers[0].text.slice(0, -warning.length)
  next.content.drivers[1].title = '8월 실질보수, 전년 대비 증가'
  const old = '이는 별도 월의 임금 맥락이며, 전 가구 소득이나 소비·판매 결과를 관측한 것은 아니다.'
  if (!next.content.drivers[1].text.endsWith(old)) throw new Error('unexpected_parent_prose')
  next.content.drivers[1].text = next.content.drivers[1].text.slice(0, -old.length) + '8월 보수 지표로, 9월 물가와는 대상 기간이 다르다.'
  next.content.limitations.push('실질보수 지수는 전 가구 소득이나 실제 소비·판매 결과를 직접 보여주는 지표가 아닙니다.')
  next.comparison = { ...next.comparison, citationRevision: false, editorialRevision: true, referenceOnly: true,
    label: '수동 편집 사본 · 제목과 반복 경고 정리 · AI 재생성 없음', publicationBlocked: true, preferred: false,
    reviewNotes: ['사용자 요청에 따른 수동 편집 사본입니다. AI 재생성·채택·게시 결과가 아닙니다.', '이전 점수와 실제 생성 비용은 원고의 기존 기록이며 이 편집본의 새 평가나 지출이 아닙니다.'] }
  return next
}

async function main() {
  const parentFile = '.local-reports/reviewable/CLP-2026-10-09-1791888644987.json'
  const preserved = [parentFile, '.local-reports/reviewable/CLP-2026-10-09-1791732283970.json',
    '.local-reports/private/event-trials/journal.json', '.local-reports/private/source-review-2026-10-11/cl-ipc-followup.html',
    '.local-reports/private/source-review-2026-10-11/cl-wage-followup.html']
  const sha = v => createHash('sha256').update(v).digest('hex')
  const bytes = await Promise.all(preserved.map(p => fs.readFile(p)))
  const parent = JSON.parse(bytes[0]), next = polishClpCopy(parent, `CLP-2026-10-09-${Date.now()}`)
  for (const field of ['facts', 'series', 'evidence', 'baseDate', 'observedDate', 'observationAt', 'marketData', 'limitations']) assert.deepEqual(next[field], parent[field])
  for (const field of ['summary', 'change', 'implications', 'watch']) assert.deepEqual(next.content[field], parent.content[field])
  next.content.drivers.forEach((d, i) => { assert.deepEqual(d.evidenceIds, parent.content.drivers[i].evidenceIds); assert.deepEqual(d.factIds, parent.content.drivers[i].factIds) })
  // Direct original recheck: aggregate CPI, component directions and real-pay
  // definition/growth. This is editorial review, not a new quality rating.
  assert.ok(bytes[3].toString().includes('variación mensual de 0,4%'))
  assert.ok(bytes[3].toString().includes('alimentos y bebidas no alcohólicas'))
  assert.ok(bytes[3].toString().includes('seguros y servicios financieros'))
  assert.ok(bytes[4].toString().includes('agosto de 2026'))
  assert.ok(bytes[4].toString().includes('creció 3,4% en doce meses'))
  const review = { parentId: parent.id, editedId: next.id, editingMode: 'manual', modelCalls: 0, costUsd: 0,
    changedTargets: ['title', 'drivers.0.title', 'drivers.0.text', 'drivers.1.title', 'drivers.1.text', 'limitations'],
    claimChecks: [
      { target: 'title', evidenceIds: parent.evidence.map(e => e.id), finding: '9월 IPC의 상승·분류 방향 차이와 별도 8월 실질보수 증가. 인과나 같은 기간 비교 없음.' },
      { target: 'drivers.0', evidenceIds: next.content.drivers[0].evidenceIds, finding: '상승·하락 및 동일 지수 상쇄 보존. 순위 주장과 검토 경고를 모두 하지 않음.' },
      { target: 'drivers.1', evidenceIds: next.content.drivers[1].evidenceIds, finding: '물가 조정 정의·전년 대비 증가·8월/9월 구별 보존. 소득·판매 범위 주의는 공통 한계로 이동.' },
    ], inheritedQualityNotReevaluated: true, publicationApproved: false,
    preservedHashes: Object.fromEntries(preserved.map((p, i) => [p, sha(bytes[i])])) }
  const dir = await fs.mkdtemp('.local-reports/private/editorial-copy-')
  await fs.writeFile(dir + '/review.json', JSON.stringify(review, null, 2), { flag: 'wx' })
  await fs.writeFile(dir + '/before.json', bytes[0], { flag: 'wx' })
  await saveReport(next)
  for (const [i, file] of preserved.entries()) assert.equal(sha(await fs.readFile(file)), sha(bytes[i]))
  console.log(JSON.stringify({ id: next.id, directory: dir, modelCalls: 0, costUsd: 0, originalsUnchanged: true, publicationApproved: false }))
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(e => { console.error(e.message); process.exitCode = 1 })
