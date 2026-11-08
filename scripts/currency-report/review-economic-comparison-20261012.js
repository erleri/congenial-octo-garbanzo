// Explicit agent judgment of this saved response, not an AI judge or publication.
// No network, key reads, prose edits, automatic regeneration or old-file rewrites.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { assessClaimReview } from './claim-review.js'
const bytesHash = v => createHash('sha256').update(v).digest('hex')
const privateRoot = '.local-reports/private'
const approved = privateRoot + '/economic-approved-comparisons/run-RSCtjg'
const resultDir = privateRoot + '/event-trials/run-3zNSmb'
const reportId = 'CLP-2026-10-09-1791732283970'
async function main() {
  const input = JSON.parse(await fs.readFile(approved + '/trial-input.json', 'utf8'))
  const resultBytes = await fs.readFile(resultDir + '/result.json'), result = JSON.parse(resultBytes)
  const prepared = result.response.compiled.claimReview
  assert.equal(result.status, 'schema_and_content_review_required')
  assert.equal(result.costUsd, .024868); assert.equal(result.response.generationCalls, 1); assert.equal(result.response.retries, 0)
  const baselineReview = JSON.parse(await fs.readFile(privateRoot + '/event-trials/run-cv5X5k/content-review-detailed.json', 'utf8'))
  const proposal = JSON.parse(await fs.readFile(input.plan.scopedComparison.proposalFile, 'utf8'))
  // Append the fourth reservation; all prior rows remain byte-value equivalent.
  const beforeJournal = JSON.parse(await fs.readFile(approved + '/journal-before.json', 'utf8'))
  const journal = JSON.parse(await fs.readFile(privateRoot + '/event-trials/journal.json', 'utf8'))
  assert.equal(journal.length, 4); assert.deepEqual(journal.slice(0, 3), beforeJournal)
  assert.equal(journal[3].requestHash, input.plan.requestHash)
  const preserved = {}
  for (const key of ['input', 'baseline', 'review', 'report', 'ipc', 'wage']) {
    const item = proposal.preserved[key]
    assert.equal(bytesHash(await fs.readFile(item.file)), item.sha256)
    preserved[key] = item.sha256
  }
  for (const [id, name] of [['ine-cl-ipc-september', 'cl-ipc-followup.html'], ['ine-cl-real-wage-august', 'cl-wage-followup.html']]) {
    const original = await fs.readFile(privateRoot + '/source-review-2026-10-11/' + name, 'utf8')
    for (const passage of prepared.sources.find(s => s.id === id).sourceContext.passages)
      assert.ok(original.includes(passage.text), 'admitted paragraph must exist in preserved original')
  }
  const ipc = 'ine-cl-ipc-september', wage = 'ine-cl-real-wage-august'
  const anchor = (evidenceId, passageId) => {
    const source = prepared.sources.find(s => s.id === evidenceId)
    return { evidenceId, passageId, passageHash: source.sourceContext.passageHash,
      quote: source.sourceContext.passages.find(p => p.id === passageId).text }
  }
  const part = (quote, reason, refs) => ({ quote, support: 'supported', reason, anchors: refs.map(([e, p]) => anchor(e, p)), applicationIds: [] })
  const judgments = [
    { id: 'title:0', style: true, reason: '분류별 방향과 별도 실질보수 증가는 두 원문에 있다. 제목은 추상적이며 이전 원고와 거의 같아 구체성은 편집 개선이다.', parts: [
      part('물가는 분류별로 엇갈렸고 ', '같은 IPC의 양·음 기여 분류가 함께 있다. 물가 하락 추세나 중요도 순위를 뜻하지 않는다.', [[ipc, 'p1']]),
      part('별도 임금 자료는 실질보수 증가를 보여줬다', '별도 보수 발표에서 실질보수 지수의 연간 증가를 확인했다. 가구 전체 소득으로 확대하지 않는다.', [[wage, 'p2']]),
    ] },
    { id: 'summary:0', reason: '양·음 기여가 함께 있는 IPC 구성을 요약한다. 반대 기여가 전체 지수의 상승을 일부 줄였다는 설명이며 모든 가격이 올랐다는 단정은 없다.', parts: [
      part('새 물가 발표에서는 일부 분류 가격이 오르고 일부는 내려 ', '기준일 직전 IPC 발표에서 분류별 상승·하락을 모두 확인했다.', [[ipc, 'p0'], [ipc, 'p1']]),
      part('전체 지수 안에서 상쇄가 있었다.', '음의 기여를 같은 IPC 안의 상쇄로만 설명한다. 가구 부담이나 임금의 실제 상쇄가 아니다.', [[ipc, 'p4']]),
    ] },
    { id: 'summary:1', reason: '원문의 IPC 조정 정의와 연간 증가를 정확히 별도 임금 자료에 귀속한다.', parts: [
      part('별도 임금 자료에서는 물가 조정 보수 지수가 늘었다.', '실질보수 정의와 연간 증가가 원문 한 문단에 함께 있다.', [[wage, 'p2']]),
    ] },
    { id: 'drivers.0.title:0', reason: '양·음 분류 차이를 표현한다. 국가 경제·판매 성과나 전체 순위를 주장하지 않는다.', parts: [
      part('분류별 가격 방향이 엇갈림', '분류별 양·음 기여를 확인했고 품목 가격의 상승·하락도 각각 원문에 있다.', [[ipc, 'p1'], [ipc, 'p2'], [ipc, 'p4']]),
    ] },
    { id: 'drivers.0.text:0', reason: '코드의 월간 수치와 식품·교통의 상승, 보험·금융의 하락을 각각의 원문에 대조했다.', parts: [
      part('{{ipc_monthly}}를 기록한 물가 발표에서 ', '고정 fact는 9월 IPC의 전월 대비 +0.4%이며 원문 대상 월·단위와 일치한다.', [[ipc, 'p0']]),
      part('식품·비알코올 음료와 교통 가격은 올랐고, ', '두 분류의 양의 변화율을 원문에 대조했다. 기여도 전체 순위로 바꾸지 않는다.', [[ipc, 'p2']]),
      part('보험·금융서비스 가격은 내렸다.', '원문 보험·금융서비스 분류의 음의 가격 변화율을 확인했다.', [[ipc, 'p4']]),
    ] },
    { id: 'drivers.0.text:1', reason: '원문 음의 기여를 같은 지수의 상승 상쇄로 설명한다. 임금·가구 부담 상쇄로 확대하지 않는다.', parts: [
      part('보험·금융서비스의 음의 기여는 같은 지수의 상승을 일부 상쇄했다.', '전체 IPC가 양이고 보험·금융 기여가 음이라는 같은 지수의 구성을 설명한다.', [[ipc, 'p0'], [ipc, 'p4']]),
    ] },
    { id: 'drivers.0.text:2', style: true, reason: '출처의 강조와 검토 범위를 구분한 표현은 타당하다. 순위 미확인은 입력 범위 카드와 실제 검토의 상태이며 원문만으로 증명되는 경제 사실은 아니다. 본문에 이 검토 주의를 다시 넣는 것은 편집 개선 대상이다.', parts: [
      part('식품과 교통은 원문이 강조한 상승 분류이며, ', '원문의 destacaron을 출처에 귀속하며 선도 순위로 확대하지 않는다.', [[ipc, 'p2']]),
      part('전체 분류 기여도 순위를 확인한 것은 아니다.', '범위 카드 rankingStatus와 이번 검토 범위를 확인했다. 원문 전체 표의 존재나 미발표를 단정하지 않는 검토 상태 설명이다.', [[ipc, 'p2'], [ipc, 'p3'], [ipc, 'p4']]),
    ] },
    { id: 'drivers.1.title:0', style: true, reason: '별도 임금 지표라는 귀속은 맞지만 제목에 증가라는 새 정보를 생략했다. 내용 오류가 아닌 구체성 보완이다.', parts: [
      part('별도 임금 자료의 실질보수', '물가 자료가 아닌 보수 발표의 실질보수 지수를 가리킨다.', [[wage, 'p2']]),
    ] },
    { id: 'drivers.1.text:0', reason: '실질보수의 IPC 조정 정의와 코드가 삽입하는 8월 연간 +3.4%를 각각 확인했다. 9월 IPC를 다시 차감하지 않는다.', parts: [
      part('실질보수 지수는 이미 물가 변동을 반영해 조정한 지표이며, ', '원문이 명시한 IPC 조정 보수 지수 정의를 설명한다.', [[wage, 'p2']]),
      part('{{real_wage_annual}}로 나타났다.', '고정 fact의 8월·전년 대비 +3.4%가 원문과 일치한다.', [[wage, 'p2']]),
    ] },
    { id: 'drivers.1.text:1', required: true, reason: '원문 대조 결과 보수는 8월·물가는 9월로 문장 내용은 타당하다. 그러나 이 문장의 작성자 근거 연결에는 보수 출처만 있어 두 자료의 기간 관계를 완전히 연결하지 못한다. 수치·경제 사실 오류가 아닌 필수 출처 연결 보완이며, 경고 반복은 별도 편집 문제다.', parts: [
      { ...part('이는 별도 월의 임금 맥락이며, ', '보수 원문과 메타데이터는 8월을 지지한다. 다른 물가 자료의 9월과 연결하려면 IPC 출처도 이 주장에 필요하지만 작성자 대응표와 블록에서 빠져 있다.', [[wage, 'p2']]), support: 'limited' },
      part('전 가구 소득이나 소비·판매 결과를 관측한 것은 아니다.', '이 지표의 명시적 측정 대상은 보수 지수다. 지표 정의를 넘어 전체 가구·판매 효과로 해석하지 않는 범위 구별이다.', [[wage, 'p2']]),
    ] },
  ]
  assert.equal(judgments.length, prepared.claims.length)
  const review = { version: prepared.version, binding: prepared.binding, origin: 'agent', reviewer: 'Codex 문장별 저장 원문 검토 · 사용자 게시 승인 아님',
    claims: prepared.claims.map(c => {
      const j = judgments.find(j => j.id === c.id)
      assert.ok(j); assert.equal(j.parts.map(p => p.quote).join(''), c.quote)
      return { id: c.id, claimHash: c.claimHash, support: j.required ? 'limited' : 'supported', decision: j.required ? 'rewrite' : j.style ? 'refine' : 'keep', issue: j.required ? 'source_authority' : j.style ? 'style' : 'none',
        reason: j.reason, anchors: j.parts.flatMap(p => p.anchors), applicationIds: [], subclaims: j.parts }
    }) }
  const assessment = assessClaimReview(prepared, review)
  if (assessment.errors.length) console.error(JSON.stringify({ reviewErrors: assessment.errors }))
  assert.equal(assessment.status, 'needs_revision'); assert.deepEqual(assessment.errors, []); assert.deepEqual(assessment.requiredCorrections, ['drivers.1.text:1'])
  const quality = { scores: { explanation: 4, changeClarity: 4, businessRelevance: 3, readability: 4, evidenceFidelity: 4 }, average: 3.8,
    origin: 'agent_provisional', humanReaderEvaluation: 'pending', contentPassed: false, publicationApproved: false,
    reasons: { explanation: '같은 물가 지수의 상승과 상쇄를 한 흐름으로 설명하고 실질보수의 조정 정의도 유지했다. 환율 원인 설명은 아니다.',
      changeClarity: '요약의 포괄적 비교 금지가 없어지고 새 발표 내용이 먼저 나온다. 제목 구체성은 남는다.',
      businessRelevance: '영업 독자에게 물가 구성과 물가 조정 보수라는 공개 배경을 준다. 실제 판매·구매력 연결의 승인 근거가 없어 제한적이다.',
      readability: '세 블록을 두 블록으로 묶고 관찰 항목을 생략했다. 두 주의 문장은 남아 완전한 편집 목표 달성은 아니다.',
      evidenceFidelity: '수치·대상 기간·분류 방향·반대 기여와 정의는 원문에 맞는다. 별도 월 관계를 설명하는 문장의 작성자 근거 연결에 IPC가 빠져 필수 연결 보완이 남는다. 경제적 거짓이나 판매 추정은 발견되지 않았다.' } }
  const reportFile = '.local-reports/reviewable/' + reportId + '.json'
  const reportBytes = await fs.readFile(reportFile), report = JSON.parse(reportBytes)
  const baseline = JSON.parse(await fs.readFile(proposal.preserved.report.file, 'utf8'))
  assert.deepEqual(report.content, result.response.compiled.content)
  for (const field of ['facts', 'series', 'marketData', 'observedDate', 'observationAt', 'evidence']) assert.deepEqual(report[field], baseline[field])
  assert.deepEqual(report.content.change, baseline.content.change)
  assert.equal(report.content.watch.length, 0)
  const notes = [
    '실제 Sonnet 원고 그대로 · 자동 검사 통과. 문장별 원문 대조에서 기간 관계의 출처 연결 보완 1건. 수동 본문 교정 없음.',
    '같은 IPC의 상승·상쇄를 한 블록으로 묶고 불필요한 관찰 항목을 생략했습니다.',
    '보험·금융의 반대 기여, 실질보수 정의, 서로 다른 대상 월을 보존했습니다.',
    '제목 구체성과 본문 주의 문장 두 개는 편집 개선 여지가 있습니다. 경제 업데이트이며 환율 원인 설명은 아닙니다.',
    '에이전트 잠정 3.8/5 · 미채택 비교본. 사용자 독자 평가·게시 승인 없음.',
  ]
  report.comparison = { label: 'CLP economic editorial /4', model: result.response.actualModel, inputHash: input.plan.requestHash,
    costUsd: result.costUsd, average: 3.8, preferred: false, provisional: true, publicationBlocked: true, reviewNotes: notes, historicalReview: true }
  // Keep pending_review: passing agent review never becomes human approval.
  assert.equal(report.status, 'pending_review'); assert.equal(report.publishedAt, null)
  report.status = 'rejected'
  const manifestFile = '.local-reports/reviewable/clp-rules-comparison.json'
  const oldManifestBytes = await fs.readFile(approved + '/comparison-before.json'), manifest = JSON.parse(oldManifestBytes)
  assert.equal(bytesHash(await fs.readFile(manifestFile)), bytesHash(oldManifestBytes))
  const oldRows = structuredClone(manifest.rows)
  manifest.rows.push({ label: 'economic-4', variant: '편집 입력 /4', model: result.response.actualModel, reportId, average: 3.8,
    generationCostUsd: result.costUsd, passed: false, reviewLabel: '편집 개선 · 출처 연결 보완 필요', notes })
  manifest.statusLabel = '새 입력 편집 개선 · 네 건 모두 미채택'; manifest.winner = null
  manifest.confirmedCostUsd = Number(journal.reduce((n, r) => n + r.costUsd, 0).toFixed(9))
  manifest.note = '같은 날짜·환율·공식 출처의 네 번 독립 생성입니다. 점수는 에이전트의 잠정 평가이며 사용자 승인·통계적 개선 증명이 아닙니다. 이전 세 원고·평가·비용은 그대로 보존했습니다.'
  assert.deepEqual(manifest.rows.slice(0, 3), oldRows)
  const evaluation = { review, assessment, quality, detail: { independentSubclaims: review.claims.reduce((n, c) => n + c.subclaims.length, 0),
    origin: 'agent_source_review', humanApproval: false, proseChanged: false, preserved },
    comparison: { baselineReportId: baseline.id, reportId, baselineAverage: baselineReview.quality.average, average: 3.8,
      baselineDriverBlocks: baseline.content.drivers.length, driverBlocks: report.content.drivers.length,
      baselineWatchBlocks: baseline.content.watch.length, watchBlocks: 0,
      repeatedCaveats: { method: 'manual_editorial_judgment_not_regex', previousLocations: ['summary:1', 'drivers.1.text:1', 'drivers.2.text:1', 'watch.0.title:0', 'watch.0.text:0'],
        currentLocations: ['drivers.0.text:2', 'drivers.1.text:1'], verdict: 'reduced_not_eliminated' },
      newCostUsd: result.costUsd, previousCostUsd: proposal.baselineCostUsd, totalConfirmedUsd: manifest.confirmedCostUsd,
      unknownReservedUsd: 0, publicationApproved: false } }
  await fs.writeFile(resultDir + '/report-before-review.json', reportBytes, { flag: 'wx' })
  await fs.writeFile(resultDir + '/content-review-detailed.json', JSON.stringify(evaluation, null, 2), { flag: 'wx' })
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2))
  await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2))
  assert.equal(bytesHash(await fs.readFile(resultDir + '/result.json')), bytesHash(resultBytes))
  for (const key of Object.keys(preserved)) assert.equal(bytesHash(await fs.readFile(proposal.preserved[key].file)), preserved[key])
  console.log(JSON.stringify({ reportId, assessment: assessment.status, requiredCorrections: assessment.requiredCorrections,
    optionalRefinements: assessment.optionalRefinements, quality, comparison: evaluation.comparison, newModelCalls: 0 }, null, 2))
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
