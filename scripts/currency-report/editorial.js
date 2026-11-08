// Editorial quality is separate from factual/safety validation and publication permission.
import { REASONING_CRITERIA, REASONING_WRITER_INSTRUCTIONS } from './reasoning-policy.js'
import { reviewSentences } from './report-text.js'
import { inspectPeriodicProse, PERIODIC_WRITING_VERSION } from './periodic-editing.js'
export const EDITORIAL_VERSION = 'currency-editorial/9'
export const READER_CRITERIA = Object.freeze({
  headlineConclusion: '제목은 요인 목록보다 근거 있는 핵심 해석을 먼저 전달한다. 확인되지 않은 환율 방향·원인·요인 순위는 단정하지 않는다.',
  transmissionSpecificity: REASONING_CRITERIA.currencyConnection,
  diagnosticWatch: REASONING_CRITERIA.observationScope,
  informationEconomy: '새 설명과 읽을 가치를 평가한다. 반복 검증 안내·제목 재진술은 편집 개선이며 사실 오류로 분류하지 않는다. 긴 글·항목 수를 보상하지 않으며 실제 조건·반대 근거는 유지한다. 품질 부족 판정에는 구체적 문장과 이유를 기록한다.',
})
export const PERIODIC_READER_CRITERIA = Object.freeze({
  headlineConclusion: '제목이 확인한 대상과 해석상 결론을 전달한다. 점검·검토 가능 안내에 머물지 않으며 정상·보완·미확인 상태를 과장하지 않는다.',
  transmissionSpecificity: '이번 근거가 전회 설명을 어떻게 재확인·보완하는지 전달한다. 새 원인이나 사건을 억지로 요구하지 않는다.',
  diagnosticWatch: '확인된 일정 또는 설명에 연결된 다음 질문을 구분한다. 근거가 없으면 관찰 항목 생략을 허용한다.',
  informationEconomy: '각 문장이 경로·변화·중요 조건을 추가하는지 평가한다. 과정 안내·범용 경고 반복을 줄이되 실제 조건은 보존한다. 짧음 자체를 감점하지 않는다.',
})
export const EDITORIAL_INSTRUCTIONS = [
  '## 독자가 읽을 설명',
  REASONING_WRITER_INSTRUCTIONS,
  '제목은 근거 있는 핵심 해석, 요약은 새 사건과 중요한 이유를 전달한다. 중요도 근거가 없으면 전체 요인의 순위를 만들지 않는다.',
  '배경은 새로운 사건 → 출처가 설명한 반응 경로 → 확인 가능한 통화 연결 순으로 쓴다. 두세 문장을 권장하되 길이를 채우지 않는다. 귀속은 설명 안에 자연스럽게 두고 제목을 재진술하지 않는다.',
  '같은 사건·경로는 합치고 다른 사건은 분리한다. 배경 세 개, 영업 의미·관찰 각 두 개는 상한이지 목표가 아니다.',
  '집필 가능한 영업 맥락은 근거 있는 구매력·수입 부담·금융 여건의 경로다. 개별 회사의 판매 결과를 추정하지 않는다. 코드 소유 항목은 재작성하지 않는다.',
].join('\n')

// Synthetic style demonstrations, never observations or admissible evidence.
export const WRITING_EXAMPLES = Object.freeze([
  { purpose: '출처 해석을 구체적으로 설명',
    premise: '가상 원문이 외화 매각 재개와 거래 가능한 달러 공급 증가, 달러 확보 부담 완화의 연결을 명시했다고 가정한다.',
    weak: '전문가는 외화 공급이 시장에 미치는 경로를 설명했다. 이것만으로 모든 변동을 설명할 수는 없다.',
    better: '현지 보도가 인용한 분석가는 외화 매각 재개로 시장에서 구할 수 있는 달러가 늘어나는 데 주목했다. 달러를 확보하려는 수요에 추가 공급이 대응하면서 달러 조달 부담을 덜 수 있다는 해석이다.',
    boundary: '실제 입력 원문에 이 연결이 있을 때만 귀속해 사용한다. 매각 계획을 집행 완료나 추세 전환으로 바꾸지 않는다.' },
  { purpose: '연결이 없는 맥락은 원인 항목에서 생략',
    premise: '가상 자료에는 금속 가격 반등만 있고 해당 통화 반응·전달 경로와 검토된 원리 적용 기록이 없다.',
    weak: '금속 가격 반등이 통화를 지지했다. 다만 직접 원인인지는 알 수 없다.',
    better: '원인 항목에서 생략한다. 가격 사실만으로 환율 연결을 만들지 않는다.',
    boundary: '사실이 존재한다는 것과 설명할 근거가 있다는 것은 다르다. 다른 사건의 문단에도 끼워 넣지 않는다.' },
])

export const SECTION_GUIDANCE = {
  title: '요인 목록이 아닌 근거 있는 핵심 해석을 먼저 보여 주는 짧은 결론. 현재 환율 방향·확정 원인·요인 순위를 새로 단정하지 않는다.',
  summary: '새 정보와 그것이 중요한 이유를 먼저 전달한다. 제목이나 요인 목록을 반복하지 않고 확인된 사실과 귀속 해석을 구분한다.',
  drivers: '새 정보 → 근거 있는 전달 경로 → 해당 통화의 연결. 두세 문장, 귀속은 유지하고 검증·면책 안내로 끝내지 않는다. 연결이 없으면 생략한다.',
  implications: '근거 있는 조건 → 구매력·수입환산·금융 여건의 경로 → 독자가 이해할 영업 환경. 관측된 기업 실적이나 구체적 업무 권고로 바꾸지 않는다.',
  watch: '변수 → 근거가 허용하는 변화/반응 → 앞선 경로와의 부합 여부를 살펴볼 관찰 목적. 경쟁 설명의 판별에는 추가 근거가 필요하다. 편집상 제안임을 밝히고, 의미 있는 관찰 목적이 없으면 생략한다.',
}

export const EDITORIAL_CHECKS = [
  'newInformation', 'explainedTransmission', 'currencyRelevance',
  'distinctInsights', 'evidenceFidelity', 'materialCaveatsPreserved',
]

const normalized = text => text.replace(/[\s.!?。！？]/gu, '')
const sentences = reviewSentences
// Narrow review signals, not a semantic truth detector. Never delete text automatically.
const caveat = /단정.{0,15}(어렵|없|않)|확정.{0,15}(어렵|없|않)|유일한 원인.{0,15}아니|(?:전체|모든).{0,12}설명.{0,12}(어렵|없)|(?:뜻|의미|자료|관측).{0,12}아니|기여도.{0,12}(없|어렵)/u
// Placement signals only: do not remove prose or classify its factual support.
export function prosePlacement(text) {
  if (/(?:칼럼|기사|보도).{0,16}(?:집계|마감).{0,12}(?:뒤|이후)|(?:직접\s*원인|원인).{0,12}입증하지/u.test(text)) return 'source_metadata'
  if (/요인별\s*기여도.{0,32}(?:확인되지|계산한\s*것은\s*아니|산출.{0,6}않)|(?:한\s*전문가|한\s*분석가).{0,12}(?:견해|해석).{0,35}(?:아니|입증)|입증된\s*순위는\s*아니|해석\s*단계의\s*설명으로\s*읽|(?:변동분|약세분|상승분|하락분).{0,10}크기.{0,15}계산한\s*것은\s*아니/u.test(text)) return 'shared_limitations'
  return null
}
const limitationHeading = /^(?:(?:당일|환율|직접)\s*)?(?:원인\s*단정(?:은|이)?\s*(?:어렵다는|불가)|관측\s*(?:한계|시각\s*부재)|해석의\s*한계|자료\s*부족|단일\s*원인이\s*아님)/u

export function inspectEditorial(content, { periodic = false } = {}) {
  if (!content) return { version: EDITORIAL_VERSION, blockers: ['missing_content'], warnings: [], metrics: { sentenceCount: 0, caveatSentences: 0 }, requiresHumanReview: true }
  const blockers = [], warnings = [], seenDrivers = new Set(), seenSentences = new Set()
  let sentenceCount = 0, caveatSentences = 0
  const placementSignals = []
  for (const sentence of sentences(content.summary ?? '')) {
    const placement = prosePlacement(sentence)
    if (placement) placementSignals.push({ location: 'summary', sentence, placement })
  }
  for (const section of ['drivers', 'implications', 'watch']) {
    for (const [index, block] of (content[section] ?? []).entries()) {
      const location = `${section}.${index}`
      if (section === 'drivers') {
        if (limitationHeading.test(block.title.trim())) blockers.push(`${location}:limitation_as_driver`)
        const key = normalized(block.text)
        if (seenDrivers.has(key)) blockers.push(`${location}:duplicate_driver`)
        seenDrivers.add(key)
      }
      const parts = sentences(block.text)
      let localCaveats = 0
      for (const sentence of parts) {
        sentenceCount++
        const placement = prosePlacement(sentence)
        if (placement) placementSignals.push({ location: `${location}.text`, sentence, placement })
        if (caveat.test(sentence) || placement) { caveatSentences++; localCaveats++ }
        const key = normalized(sentence)
        if (key.length >= 20 && seenSentences.has(key)) warnings.push(`${location}:repeated_sentence`)
        seenSentences.add(key)
      }
      if (localCaveats > 1 || (localCaveats && localCaveats === parts.length)) warnings.push(`${location}:caveat_heavy`)
      if (!periodic && section === 'drivers' && parts.length < 2) warnings.push(`${location}:explanation_needs_review`)
    }
  }
  if (caveatSentences >= 2 && caveatSentences / sentenceCount > .25) warnings.push('body:caveat_density')
  if (placementSignals.some(s => s.location === 'summary')) warnings.push('summary:verification_prose_needs_relocation')
  if (placementSignals.some(s => s.placement === 'source_metadata')) warnings.push('body:source_timing_prose_needs_relocation')
  // Narrow editorial signals ONLY: neither regex can decide truth or readability.
  if (/[·、]|및/u.test(content.title ?? '') && /함께.{0,12}(맞물|작용)/u.test(content.title ?? '')) warnings.push('title:factor_list_needs_review')
  for (const [i, block] of (content.watch ?? []).entries()) {
    if (/높은\s*수준.{0,8}유지/u.test(block.text)) warnings.push(`watch.${i}:level_without_change_needs_review`)
  }
  const periodicEditing = periodic ? inspectPeriodicProse(content) : null
  if (periodicEditing) warnings.push(...periodicEditing.warnings)
  return { version: EDITORIAL_VERSION, blockers, warnings: [...new Set(warnings)],
    ...(periodicEditing ? { periodicWritingVersion: PERIODIC_WRITING_VERSION, periodicEditing } : {}),
    metrics: { sentenceCount, caveatSentences }, placementSignals, requiresHumanReview: true }
}

// Independent reader judgment. "refine" is still readable, not a rejection.
// Missing/current-version mismatch is unverified; never use model self-ratings.
export function assessReaderReview(review, { periodic = false } = {}) {
  const checks = Object.entries(periodic ? PERIODIC_READER_CRITERIA : READER_CRITERIA).map(([criterion, standard]) => {
    const row = review?.version === EDITORIAL_VERSION && review.origin === 'human' && review.checks?.[criterion]
    const decision = row && ['keep', 'refine', 'rewrite'].includes(row.decision) &&
      typeof row.reason === 'string' && row.reason.trim().length >= 10 ? row.decision : 'unverified'
    return { criterion, standard, decision, reason: decision === 'unverified' ? '별도 독자 관점 검토 필요' : row.reason }
  })
  const status = checks.some(c => c.decision === 'rewrite') ? 'needs_revision' :
    checks.some(c => c.decision === 'unverified') ? 'unverified' : 'usable'
  return { version: EDITORIAL_VERSION, status, needsRefinement: checks.some(c => c.decision === 'refine'), checks,
    factualApproval: false, publicationApproved: false }
}

// A reviewer must explicitly substantiate all criteria. A model's self-check is not approval.
export function editorialReviewPassed(review) {
  return review?.version === EDITORIAL_VERSION && assessReaderReview(review.readerReview).status === 'usable' && EDITORIAL_CHECKS.every(key =>
    review.checks?.[key]?.passed === true && typeof review.checks[key].reason === 'string' && review.checks[key].reason.trim().length >= 10)
}
