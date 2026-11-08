// Purpose-specific editorial policy. Signals request review; they do not
// establish truth, remove sentences, rewrite manuscripts or grant approval.
import { reviewSentences } from './report-text.js'

export const PERIODIC_WRITING_VERSION = 'periodic-writing/2'
export const PERIODIC_SECTION_GUIDANCE = Object.freeze({
  title: '확인한 대상과 그 대상의 해석상 결론을 함께 보여준다. 점검·검토가 가능하다는 제작 과정 대신 독자가 기억할 내용을 제목으로 쓴다. 귀속·조건을 유지하고 실제 원인 지속·순위를 추가하지 않는다.',
  summary: '이번 자료에서 무엇을 확인했고 독자가 어떤 설명을 유지하거나 보완해 읽을지 전달한다. 본문을 읽기 전 필요한 결론을 먼저 쓰고, 검토 자료가 있다는 안내나 공통 범위 경고로 요약을 채우지 않는다.',
  drivers: '선택한 항목의 이번 근거와 의미를 출처에 귀속해 설명한다. 첫 문장으로 충분하면 끝낸다. 다음 문장은 추가 전달 경로·확인된 변화·실제 조건을 보탤 때만 쓴다.',
  watch: '앞선 설명을 지지하거나 약화하는지 확인할 다음 질문만 선택적으로 쓴다. 일정 근거가 없으면 발표일을 만들지 않는다.',
})
export const PERIODIC_PROSE_INSTRUCTIONS = [
  `## 독자용 점검본 ${PERIODIC_WRITING_VERSION}`,
  `제목: ${PERIODIC_SECTION_GUIDANCE.title}`,
  `요약: ${PERIODIC_SECTION_GUIDANCE.summary}`,
  `설명: ${PERIODIC_SECTION_GUIDANCE.drivers}`,
  '전회 대비 상태는 글을 선별하는 입력이다. 정상 점검이면 지금 근거가 지지하는 경로를, 설명 보완이면 새 경로나 조건을, 일부 미확인이면 확인된 부분의 결론을 전달한다.',
  'sourceLinks·귀속·기간·조건은 주장 선택에 적용한다. 이 제약들을 매 문단의 경고 문장으로 옮기지 않는다. 공통 범위·미확인 항목은 코드 소유 한계 영역이 담당한다.',
  '해석을 실제로 바꾸는 조건·반대 근거·가격 기준 차이는 해당 설명에 남긴다. 문장을 줄이려고 이 조건을 삭제하거나 더 강한 인과·전체 기간 지속으로 바꾸지 않는다.',
  '본문 길이·문장 수는 목표가 아니다. 제목의 재서술, 점검 가능 안내, 일반 면책으로 빈 문장을 채우지 않는다.',
].join('\n')
export const PERIODIC_PROSE_REVIEW_INSTRUCTIONS = [
  `## 독자용 결론과 배치 검토 ${PERIODIC_WRITING_VERSION}`,
  '제목을 읽고 무엇을 확인했는지 말할 수 있는가? 점검할 수 있다·검토 근거가 있다는 말만 남으면 근거 오류와 구분해 style/refine으로 기록한다.',
  '각 문장이 근거 있는 경로·변화·조건을 추가하는지 확인한다. 점검 가능 안내나 공통 범위 경고가 두 위치에 반복되면 readerValue에서 구체적 문장과 이유를 남긴다. 길이나 자동 경고 수로 점수를 결정하지 않는다.',
  '반복 경고를 줄인 제목·요약이 실제 원인 지속·순위·기여도·영향 소멸을 새로 단정하면 여전히 필수 범위 교정이다. 범용 한계를 별도 영역으로 보낸 것과 중요한 조건 삭제를 구분한다.',
  '검사 신호는 배치·문체 검토 후보다. 알려진 문구와 비슷하다는 이유만으로 사실 오류·게시 불가를 확정하지 않는다. 출처가 지지하는 조건부 설명은 유지한다.',
].join('\n')

export const PERIODIC_SHARED_SCOPE_NOTE = '이번에 확인한 자료의 시점과 범위에 한정한 설명입니다. 전회 이후 전체 기간의 원인 지속이나 요인별 기여도를 검증한 결과는 아닙니다.'

// Preserve all existing limitations, including exact digit-bearing price
// notices. Combine only digit-free notices when the shared schema has 4 slots.
export function periodicLimitations(existing, gap) {
  const rows = [...new Set([...(gap ? [gap] : []), ...existing, PERIODIC_SHARED_SCOPE_NOTE])]
  while (rows.length > 4) {
    let merged = false
    for (let i = rows.length - 1; i >= 0 && !merged; i--) {
      for (let j = i - 1; j >= 0; j--) {
        if (!/\d/.test(rows[i] + rows[j]) && rows[j].length + rows[i].length + 1 <= 480) {
          rows[j] += ' ' + rows[i]; rows.splice(i, 1); merged = true; break
        }
      }
    }
    if (!merged) throw new Error('periodic_limitations_capacity')
  }
  return rows
}

const processTitle = /(?:점검|검토)(?:할|하는)?\s*수\s*있|(?:점검|검토)(?:이|가)?\s*가능/u
const processSentence = /(?:검토\s*요지|검토\s*자료).{0,65}담겼|(?:전회|기존).{0,30}(?:항목|설명).{0,50}(?:점검할\s*근거|(?:재?점검|검토)할\s*수\s*있)/u
const scopeAnnouncement = /(?:비교\s*기간|전체\s*기간).{0,18}원인.{0,18}(?:지속|우열).{0,25}(?:입증|확인).{0,14}(?:아니|않|못)|(?:단독\s*효과|요인별\s*기여도|기여\s*크기).{0,22}(?:확인|계산|산출|입증).{0,14}(?:아니|않|못)/u

export function inspectPeriodicProse(content) {
  const signals = []
  if (processTitle.test(content.title ?? '')) signals.push({ location: 'title', quote: content.title,
    code: 'process_title', placement: 'reader_conclusion', issue: 'style' })
  const locations = [['summary', content.summary ?? ''], ...['drivers', 'watch'].flatMap(section =>
    (content[section] ?? []).map((b, i) => [`${section}.${i}.text`, b.text]))]
  for (const [location, text] of locations) for (const quote of reviewSentences(text)) {
    if (processSentence.test(quote)) signals.push({ location, quote, code: 'process_prose', placement: 'omit_if_no_reader_information', issue: 'style' })
    if (scopeAnnouncement.test(quote)) signals.push({ location, quote, code: 'scope_announcement', placement: 'shared_limitations', issue: 'style' })
  }
  const warnings = []
  if (signals.some(s => s.code === 'process_title')) warnings.push('periodic:title_process_needs_review')
  if (signals.some(s => s.code === 'process_prose')) warnings.push('periodic:process_prose_needs_review')
  const scopes = signals.filter(s => s.code === 'scope_announcement')
  if (scopes.length) warnings.push('periodic:scope_prose_needs_relocation')
  if (new Set(scopes.map(s => s.location)).size >= 2) warnings.push('periodic:repeated_scope_caveats')
  return { version: PERIODIC_WRITING_VERSION, signals, warnings, scopeAnnouncements: scopes.length,
    requiresContentReview: true, manuscriptEdited: false, publicationApproved: false }
}
