import { describe, expect, it } from 'vitest'
import { EDITORIAL_VERSION, EDITORIAL_CHECKS, inspectEditorial, editorialReviewPassed, prosePlacement } from './editorial.js'
import { syntheticReaderReview } from './rule-fixtures.js'

// Authored editorial example, NOT model output or an approved historical market report.
const driver = { title: '물가의 구성 차이에 주목한 달러 해석', kind: 'interpretation', evidenceIds: ['emol-morning'],
  text: 'Emol이 인용한 분석가는 일반 물가가 예상에 부합했어도 근원물가의 압력이 끈질겼다는 점에 주목했다. 기사 속 해석의 연결은 근원물가 압력에서 미국 금리 기대를 거쳐 달러 지지 가능성으로 이어진다. 칠레 내부의 경기 소식과 구분해서 읽을 공통 달러 배경이다.' }
const draft = () => ({ title: '미국 물가의 구성과 칠레의 소비 여건', summary: '미국 물가 보도에서는 일반 물가와 근원물가의 차이가 해석의 핵심이었다. 칠레의 소비환경은 물가 부담과 구매력의 경로로 따로 읽는다.',
  drivers: [{ ...driver }],
  implications: [{ title: '물가 부담과 큰 구매의 시점', text: 'Reporte Minero가 인용한 경제학자는 물가 부담이 구매력을 약화시키고 불확실성이 큰 구매를 늦추는 경로를 설명했다. 구매력과 구매 시점을 나누어 보면 내구재 소비환경을 이해하는 데 도움이 된다.', kind: 'mechanism', evidenceIds: ['rm-inflation'] }],
  watch: [{ title: '물가 해석 이후 달러 흐름', text: 'Emol 오전 보도가 관찰 변수로 제시한 것은 국채 수익률과 달러 지수다. 두 지표의 후속 반응은 기사 속 달러 지지 해석이 실제 시장 흐름과 맞물리는지 판단할 자료가 된다.', kind: 'interpretation', evidenceIds: ['emol-morning'] }],
})
const limitation = { ...driver, title: '당일 원인 단정은 어렵다는 관측 한계', text: '관측시각이 달라 직접 원인을 확정할 수 없다. 해당 발표만으로 전체 변동을 설명하기 어렵다.' }

describe('editorial inspection and independent review', () => {
  it('routes the reported verification prose to metadata or shared limitations without treating style as a factual failure', () => {
    const quotes = [
      '다만 요인별 기여도와 정확한 관측시각은 확인되지 않아 해석 단계의 설명으로 읽어야 한다.',
      '이는 한 분석가의 당일 해석이며 요인별 기여도를 계산한 것은 아니다.',
      '이 평가는 한 전문가의 견해이며 칠레 페소 약세 분석 전체에 대한 입증된 순위는 아니다.',
      'Reuters 칼럼은 칠레 집계 마감 뒤에 나온 종합 해설이어서 당일 칠레 환율의 직접 원인을 입증하지 않는다.',
    ]
    expect(quotes.map(prosePlacement)).toEqual(['shared_limitations', 'shared_limitations', 'shared_limitations', 'source_metadata'])
    const d = draft(); d.summary = quotes[0]
    d.drivers = quotes.slice(1).map((text, i) => ({ ...driver, title: `검토용 배경 ${i}`, text }))
    const before = structuredClone(d), result = inspectEditorial(d)
    expect(result.blockers).toEqual([])
    expect(result.warnings).toEqual(expect.arrayContaining(['summary:verification_prose_needs_relocation', 'body:source_timing_prose_needs_relocation', 'body:caveat_density']))
    expect(result.placementSignals).toHaveLength(4)
    expect(d).toEqual(before)
  })

  it('keeps actual economic qualifications distinct from generic verification announcements', () => {
    const sentences = [
      '구리 조정의 영향도 인정했지만 구리 가격은 여전히 높은 수준이라며 국채금리를 더 중요한 압력으로 평가했다.',
      '물가가 내려도 금리 인하가 없으면 금융 부담이 바로 줄어드는 것은 아니다.',
      '분석가는 달러 선호가 페소 지지력을 약화시켰다고 해석했다.',
    ]
    expect(sentences.map(prosePlacement)).toEqual([null, null, null])
    const d = draft(); d.drivers = [{ ...driver, text: sentences.join(' ') }]
    expect(inspectEditorial(d).placementSignals).toEqual([])
  })
  it('accepts a single informative driver; does not force a third filler slot', () => {
    const result = inspectEditorial(draft())
    expect(result).toMatchObject({ version: EDITORIAL_VERSION, blockers: [], warnings: [], requiresHumanReview: true })
  })
  it('identifies the reported CLP limitation heading without rewriting the response', () => {
    const d = draft(); d.drivers.push(limitation)
    const original = JSON.stringify(d)
    const result = inspectEditorial(d)
    expect(result.blockers).toContain('drivers.1:limitation_as_driver')
    expect(result.warnings).toContain('drivers.1:caveat_heavy')
    expect(JSON.stringify(d)).toBe(original)
  })
  it('flags paraphrased caveats and duplicated sentences as review signals', () => {
    const d = draft()
    for (const section of ['drivers', 'implications', 'watch'] as const) d[section][0].text = '전체 변동을 설명하기 어렵다. 다른 요인의 영향도 단정할 수 없다.'
    const result = inspectEditorial(d)
    expect(result.warnings).toContain('body:caveat_density')
    expect(result.metrics.caveatSentences).toBe(6)
    expect(result.requiresHumanReview).toBe(true)
  })
  it('blocks identical driver bodies, but permits a relevant contradiction near its claim', () => {
    const d = draft(); d.drivers.push({ ...driver, title: '제목만 바꾼 같은 설명' })
    expect(inspectEditorial(d).blockers).toContain('drivers.1:duplicate_driver')
    d.drivers = [{ ...driver, text: driver.text + ' 다만 두 보도의 구리 가격 기준은 서로 달라 같은 관측으로 비교할 수 없다.' }]
    expect(inspectEditorial(d).blockers).toEqual([])
    expect(d.drivers[0].text).toContain('서로 달라')
  })




  it('requires explicit reasoned human checks rather than old scores or self-awarded approval', () => {
    const review = { version: EDITORIAL_VERSION, readerReview: syntheticReaderReview(), checks: Object.fromEntries(EDITORIAL_CHECKS.map(key => [key, { passed: true, reason: '검토자가 문장과 출처를 대조한 테스트 전용 근거다.' }])) }
    expect(editorialReviewPassed(review)).toBe(true)
    expect(editorialReviewPassed(undefined)).toBe(false)
    expect(editorialReviewPassed({ ...review, version: 'old' })).toBe(false)
    review.checks.explainedTransmission.passed = false
    expect(editorialReviewPassed(review)).toBe(false)
    review.checks.explainedTransmission = { passed: true, reason: '통과' }
    expect(editorialReviewPassed(review)).toBe(false)
  })
})
