// Offline only. Hide model/cost labels before reading new prose; preserve originals.
// Prior Gemini prose has already been seen, so agent grading is not fully blind.
import fs from 'node:fs/promises'
import { randomInt } from 'node:crypto'
import assert from 'node:assert/strict'
import { fingerprint } from './research-harness.js'
import { assembleReportContent } from './openrouter.js'
import { prepareClaimReview } from './claim-review.js'

const root = '.local-reports/private/model-suitability-clp-brl-trial-v1'
const entries = await fs.readdir(root)
const resultName = entries.filter(n => /^\d+-result\.json$/.test(n))
assert.equal(resultName.length, 1)
const result = JSON.parse(await fs.readFile(`${root}/${resultName[0]}`, 'utf8'))
const { snapshots } = JSON.parse(await fs.readFile(`${root}/001-snapshot.json`, 'utf8'))
const dir = `${root}/masked-review`
await fs.mkdir(dir)
const mapping = [], cards = []
for (const [caseIndex, snapshot] of snapshots.entries()) {
  const currency = snapshot.packet.currency
  const oldRoot = currency === 'CLP' ? '.local-reports/private/harness-comparison-clp-20261005-harness-ab-v1' :
    '.local-reports/private/harness-comparison-brl-20261007-harness-ab-v1'
  const previous = JSON.parse(await fs.readFile(`${oldRoot}/010-candidate.json`, 'utf8'))
  const previousAccounting = JSON.parse(await fs.readFile(`${oldRoot}/011-result.json`, 'utf8'))
  const candidates = [
    { stage: `${currency.toLowerCase()}-gemini-preserved`, currency, requestedModel: 'google/gemini-3.8-flash',
      ...previous, costUsd: previousAccounting.ledger.find(r => r.stage === 'harness_generation').costUsd, existing: true },
    ...result.results.filter(r => r.currency === currency).map(r => ({ ...r, costUsd: result.ledger.find(l => l.stage === r.stage).costUsd, existing: false })),
  ]
  for (let i = candidates.length - 1; i > 0; i--) { const j = randomInt(i + 1); [candidates[i], candidates[j]] = [candidates[j], candidates[i]] }
  for (const [index, candidate] of candidates.entries()) {
    const label = `${caseIndex + 1}${String.fromCharCode(65 + index)}`
    let content = null, prepared = null, inspectionFailure = null
    if (candidate.draft) {
      try {
        content = assembleReportContent(snapshot.packet, candidate.draft, true)
        prepared = prepareClaimReview(snapshot.packet, content)
      } catch {
        content = null; prepared = null; inspectionFailure = 'draft_not_safe_or_complete_for_inspection'
      }
    }
    const card = { label, currency, baseDate: snapshot.packet.baseDate, input: prepared,
      content, originalValidation: candidate.generated?.validation ?? null,
      generationStatus: candidate.status, inspectionFailure, publicationApproved: false }
    cards.push(card)
    mapping.push({ label, currency, stage: candidate.stage, model: candidate.requestedModel, costUsd: candidate.costUsd,
      existing: candidate.existing, contentHash: content ? fingerprint(content) : null })
    await fs.writeFile(`${dir}/${label}.json`, JSON.stringify(card, null, 2), { flag: 'wx' })
  }
}
await fs.writeFile(`${dir}/mapping-private.json`, JSON.stringify(mapping, null, 2), { flag: 'wx' })
await fs.writeFile(`${dir}/instructions.json`, JSON.stringify({ criteria: ['원인 설명', '변화 전달', '영업 관련성', '가독성', '근거 충실도'],
  scoring: '각 5점. 근거 범위 오류와 문체 개선을 분리하고 문장별로 원문을 대조한다. 원리/소비 근거의 부재를 허구로 채운 글에 점수를 주지 않는다.',
  modelsHidden: true, fullyBlind: false, reason: '이전 Gemini 원고는 이미 열람한 적이 있어 에이전트 평가를 완전 맹검이라고 보고하지 않는다.',
  samplePerModelPerCase: 1, publicationApproved: false }, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ dir, cards: cards.map(c => ({ label: c.label, currency: c.currency, generationStatus: c.generationStatus,
  validation: c.originalValidation, content: c.content })), fullyBlind: false, modelCalls: 0 }, null, 2))
