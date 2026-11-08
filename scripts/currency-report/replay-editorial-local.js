// Saved-output regression. Editorial changes are agent-authored examples, not
// a new AI generation or semantic/publication approval. Original records stay intact.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createSourceContext } from './source-context.js'
import { CLAIM_REVIEW_VERSION, prepareClaimReview, correctionPlan, applyCorrections, assessClaimReview } from './claim-review.js'

const hash = text => createHash('sha256').update(text).digest('hex')
const id = 'CLP-2026-10-05-1791370805381'
const reportFile = path.join('.local-reports/reviewable', `${id}.json`)
const sourceFile = '.local-reports/private/clp-20261005-research-writing-input/sources.json'
const reportBytes = await fs.readFile(reportFile, 'utf8'), sourceBytes = await fs.readFile(sourceFile, 'utf8')
const report = JSON.parse(reportBytes), sources = JSON.parse(sourceBytes)
const packet = { currency: report.currency, baseDate: report.baseDate, observedDate: report.observedDate,
  facts: report.facts, series: report.series,
  assessment: { publishDecision: { eligible: false, reason: 'historical_review_only_observation_time_missing' } },
  evidence: sources.map(s => {
    const blocks = s.excerpt.split(/\n\s*\n|\\n\\n/u).filter(s => s.trim()).map(text => ({ kind: 'paragraph', text }))
    return { id: s.id, country: 'CLP', url: s.url, publisher: s.publisher, title: s.title, publishedAt: s.publishedAt,
      eventDate: s.eventDate, period: s.period, summary: '저장된 원문 발췌를 대조하는 사후 검토 사례.',
      review: { originalVerified: s.originalChecked === true, scope: s.admission },
      sourceContext: createSourceContext({ blocks, selected: blocks.slice(0, 12).map((_, i) => i) }) }
  }) }
const prepared = prepareClaimReview(packet, report.content)
const edits = {
  'drivers.0.title:0': ['거래량과 상대적인 규모를 입증하지 않은 제목이다.', '정부의 달러 공급 계획과 장중 반응'],
  'drivers.0.text:0': ['발표된 매각 계획을 정례적 재개로 확대하는 근거가 부족하다.', '칠레 예산국의 달러 매각 계획 발표가 현지 시장에 추가 달러 공급의 신호를 주었습니다.'],
  'drivers.0.text:1': ['매도 거래량 급증을 보여 주는 자료 없이 가격 반응을 거래량으로 바꾸었다.', '보도가 인용한 분석가는 이를 추가 달러 공급의 신호로 해석했으며, 기사에는 발표 뒤 달러 가격이 내려간 장중 반응이 담겼습니다.'],
  'drivers.1.text:1': ['저장된 발췌의 당일 상승을 지속적인 상승 추세로 확대했다.', '보도가 인용한 분석가는 그날 구리 가격 상승도 페소를 지지하는 배경으로 설명했습니다.'],
  'implications.0.title:0': ['독자에게 변동성 관리 업무를 제안하는 제목이다.', '달러 결제대금의 현지통화 환산 경로'],
  'implications.0.text:1': ['독자에게 점검 업무를 지시하며 일반 환산 경로의 조건도 빠졌다.', '이는 같은 달러 금액을 헤지하지 않은 경우의 조건부 환산 경로이며, 계약 환율이나 선결제 조건에 따라 실제 부담은 달라질 수 있습니다.'],
  'implications.1.title:0': ['앞선 환산 경로와 중복되며 실제 원가 안정으로 확대했다.', ''],
  'implications.1.text:0': ['동일 대금 환산에서 내구재의 실제 수입 단가 효과로 범위를 확대했다.', ''],
  'implications.1.text:1': ['소비자가격 전가 압력을 낮춘다는 관계가 이 자료로 입증되지 않는다.', ''],
  'watch.1.text:1': ['환율 반등이 달러 강세인지 페소 강세인지 불명확하다.', '구리 가격의 지지가 약해지고 글로벌 달러 선호가 더 강해진다면, 현지 공급 요인이 페소를 지지한다는 해석은 약해질 수 있습니다.'],
}
const review = { version: CLAIM_REVIEW_VERSION, binding: prepared.binding, origin: 'agent', reviewer: 'Codex saved CLP defect review',
  claims: prepared.claims.map(c => ({ id: c.id, claimHash: c.claimHash,
    support: edits[c.id] ? 'unsupported' : 'unverified', decision: edits[c.id] ? 'rewrite' : 'keep',
    issue: edits[c.id] ? (['implications.0.title:0', 'implications.0.text:1'].includes(c.id) ? 'advice' : 'claim_scope') : 'verification_gap',
    reason: edits[c.id]?.[0] ?? '이번 재생에서는 전체 문장의 의미적 지지와 원리 적용 승인을 완료하지 않았다.',
    anchors: [], applicationIds: [], subclaims: [{ quote: c.quote, support: edits[c.id] ? 'unsupported' : 'unverified',
      reason: edits[c.id]?.[0] ?? '전체 주장 지지를 확인하지 않은 저장 원고의 재평가다.', anchors: [], applicationIds: [] }] })) }
const plan = correctionPlan(prepared, review)
const patches = plan.items.map(i => ({ id: i.id, target: i.target, claimHash: i.claimHash, before: i.quote,
  after: edits[i.id][1], ...(i.target === 'drivers.0.text' ? { kind: 'interpretation' } : {}) }))
const revision = applyCorrections({ packet, content: report.content, plan, patches })
if (revision.status !== 'requires_recheck') throw new Error('saved_replay_safety_failed')
const recheckInput = prepareClaimReview(packet, revision.content)
const recheckReview = { ...review, binding: recheckInput.binding, claims: recheckInput.claims.map(c => ({ id: c.id,
  claimHash: c.claimHash, support: 'unverified', decision: 'keep', issue: 'verification_gap',
  reason: '수정 예시의 원리 적용 조건과 전체 문장 지지를 독립적으로 재검토해야 한다.', anchors: [], applicationIds: [],
  subclaims: [{ quote: c.quote, support: 'unverified', reason: '교정 예시 전체의 지지를 다시 확인해야 한다.', anchors: [], applicationIds: [] }] })) }
const result = { version: CLAIM_REVIEW_VERSION, originalId: id, originalContent: report.content,
  originalBytesHash: hash(reportBytes), sourceBytesHash: hash(sourceBytes), input: { packet, content: report.content },
  review, plan, patches, revision, recheck: assessClaimReview(recheckInput, recheckReview),
  originalCostUsd: report.comparison?.costUsd ?? null, newCostUsd: 0, networkCalls: 0,
  provenance: 'agent_authored_correction_example_not_new_ai_output', publicationApproved: false,
  inputLimitation: 'Preserved partial HTML paragraph extraction; omitted quotes are not invented or treated as reviewed. New source context capture is a separate adapter input.' }
if (hash(await fs.readFile(reportFile, 'utf8')) !== hash(reportBytes) || hash(await fs.readFile(sourceFile, 'utf8')) !== hash(sourceBytes))
  throw new Error('saved_original_changed')
const destination = path.join('.local-reports/private/editorial-workflow', `${Date.now()}-saved-clp`)
await fs.mkdir(destination, { recursive: true })
await fs.writeFile(path.join(destination, 'result.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
for (const [name, value] of Object.entries({ input: { packet, content: report.content }, review, patches }))
  await fs.writeFile(path.join(destination, `${name}.json`), JSON.stringify(value, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ originalId: id, claims: prepared.claims.length, correctedSentences: patches.length,
  automaticStatus: revision.safety.valid ? 'pass' : 'hold', semanticStatus: result.recheck.status,
  originalsPreserved: true, publicationApproved: false, newCostUsd: 0, networkCalls: 0,
  output: path.join(destination, 'result.json') }, null, 2))
