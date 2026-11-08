import { expect, it } from 'vitest'
import { EDITORIAL_VERSION, READER_CRITERIA, assessReaderReview, inspectEditorial } from './editorial.js'
import { RULE_VERSION, evaluateRules } from './rules.js'
import { syntheticCase, syntheticReview, syntheticReaderReview } from './rule-fixtures.js'
import { editorialDecision } from './editorial-decision.js'
import { chooseWinner, fingerprint } from './paid-comparison.js'
import { EDITORIAL_CHECKS } from './editorial.js'
import { requestBody } from './openrouter.js'
import { paidBody } from './paid-comparison.js'
import { comparisonPacket } from './test-support.js'

const reading = syntheticReaderReview

it('treats specific refinements as usable without granting factual or publication approval', () => {
  const review = reading()
  review.checks.headlineConclusion = { decision: 'refine', reason: '결론은 전달되지만 주제 목록을 줄이면 읽기가 더 쉽다.' }
  expect(assessReaderReview(review)).toMatchObject({ status: 'usable', needsRefinement: true, factualApproval: false, publicationApproved: false })
  const args = syntheticCase(), semantic = syntheticReview(args)
  semantic.readerReview = review
  expect(evaluateRules({ ...args, review: semantic })).toMatchObject({ status: 'pass', publicationApproved: false, readerReview: { status: 'usable' } })
  args.packet.evidence[0].publishedAt = '2025-07-01'
  const fresh = syntheticReview(args); fresh.readerReview = review
  expect(evaluateRules({ ...args, review: fresh })).toMatchObject({ automaticStatus: 'hold', readerReview: { status: 'usable' } })
})

it('holds a substantively empty explanation despite favorable aggregate scores and other approvals', () => {
  const args = syntheticCase(), review = syntheticReview(args)
  review.readerReview.checks.transmissionSpecificity = { decision: 'rewrite', reason: '본문은 제목을 반복할 뿐 새 정보에서 통화까지의 연결을 주지 않는다.' }
  const result = evaluateRules({ ...args, review })
  expect(result).toMatchObject({ automaticStatus: 'pass', semanticStatus: 'hold', readerReview: { status: 'needs_revision' } })
  expect(result.checks).toContainEqual(expect.objectContaining({ ruleId: 'R02', location: 'reader.transmissionSpecificity', status: 'hold' }))
})

it('keeps missing, obsolete, model-origin or unreasoned reader judgments unverified', () => {
  const review = reading()
  expect(assessReaderReview({ ...review, version: 'currency-editorial/3' }).status).toBe('unverified')
  expect(assessReaderReview({ ...review, origin: 'model' }).status).toBe('unverified')
  delete review.checks.diagnosticWatch
  expect(assessReaderReview(review).status).toBe('unverified')
  review.checks.diagnosticWatch = { decision: 'keep', reason: '좋음' }
  expect(assessReaderReview(review).status).toBe('unverified')
  const args = syntheticCase(), bound = syntheticReview(args)
  delete bound.readerReview
  expect(evaluateRules({ ...args, review: bound }).semanticStatus).toBe('unverified')
})

it('flags the observed factor-list and high-level-only phrasing without rewriting or automatically rejecting it', () => {
  const { content } = syntheticCase()
  content.title = '미국 물가·구리·국내 여건이 함께 맞물린 외환시장'
  content.watch = [{ ...content.drivers[0], text: '국채 수익률이 높은 수준을 유지하면 달러 지지 해석이 강화될 수 있다.' }]
  const before = structuredClone(content), result = inspectEditorial(content)
  expect(result.blockers).toEqual([])
  expect(result.warnings).toContain('title:factor_list_needs_review')
  expect(result.warnings).toContain('watch.0:level_without_change_needs_review')
  expect(content).toEqual(before)
  content.title = '정책 기대를 다시 평가한 시장'
  content.watch = []
  expect(inspectEditorial(content).warnings).toEqual([])
})

it('sends the same strengthened criteria and dot-target examples through free and paid contracts without adding narrative fields', () => {
  const packet = comparisonPacket(), free = requestBody(packet, 'openrouter/free'), paid = paidBody(packet, 'openai/gpt-5.4')
  for (const body of [free, paid]) {
    const input = JSON.parse(body.messages[1].content), prompt = body.messages[0].content
    expect(input).toMatchObject({ ruleVersion: RULE_VERSION, editorialVersion: EDITORIAL_VERSION })
    expect(prompt).toContain('제목은 근거 있는 핵심 해석')
    expect(prompt).toContain(READER_CRITERIA.transmissionSpecificity)
    expect(prompt).not.toContain(READER_CRITERIA.informationEconomy)
    expect(prompt).toContain('문장 분리·전달 경로 재서술·자기 점수·승인 결과는 작성하지 않는다.')
    expect(prompt).toContain('drivers.0.text')
    expect(prompt).toContain('두 결과를 채우려고')
    const schema = body.response_format.json_schema.schema
    expect(schema.properties.title.description).toContain('핵심 해석')
    expect(schema.properties.watch.items.properties.text.description).toContain('관찰 목적')
    expect(schema.required).toEqual(['title', 'summary', 'drivers', 'implications', 'watch', 'ruleLedger'])
  }
})

it('cannot bypass reader checks via editorial admission or comparison selection', () => {
  const { content } = syntheticCase()
  const review = { version: EDITORIAL_VERSION, contentHash: fingerprint(content), scores: [4, 4, 4, 4, 4], criticalErrors: 0,
    notes: ['합성 대역: 선택 경로를 검사하며 실제 원고를 승인하지 않는다.'], readerReview: reading(),
    checks: Object.fromEntries(EDITORIAL_CHECKS.map(key => [key, { passed: true, reason: '합성 검토 대역의 문장별 기준을 확인했다고 가정한다.' }])) }
  const candidate = { label: 'synthetic', validationPassed: true, rules: { status: 'pass' }, editorial: { blockers: [] },
    scores: review.scores, criticalErrors: 0, costUsd: 0, editorialReview: review }
  review.readerReview.checks.headlineConclusion.decision = 'refine'
  expect(editorialDecision(content, review).passed).toBe(true)
  expect(chooseWinner([candidate])).toBe('synthetic')
  review.readerReview.checks.diagnosticWatch = { decision: 'rewrite', reason: '지표 이름만 나열하고 어떤 해석을 확인할지 설명하지 않았다.' }
  expect(editorialDecision(content, review)).toMatchObject({ passed: false, readerReview: { status: 'needs_revision' } })
  expect(chooseWinner([candidate])).toBeNull()
  delete review.readerReview.checks.diagnosticWatch
  expect(() => editorialDecision(content, review)).toThrow('incomplete_editorial_review')
})
