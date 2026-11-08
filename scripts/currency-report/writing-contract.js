import { RULE_VERSION, proseTargets, selectMechanisms } from './rules.js'
import { MECHANISM_VERSION } from './mechanisms.js'
import { reviewSentences } from './report-text.js'

export const WRITING_CONTRACT_VERSION = 'writer-links/1'
export const WRITING_CONTRACT_INSTRUCTIONS = [
  '## 역할과 제출 경계',
  '입력은 evidence의 확인된 사실·귀속 해석 → 채택 범위와 중요한 조건 → researchBrief 또는 explanationCards의 설명 후보 순으로 읽는다. 기간·통화 적합성, 직접성, 새 정보 순으로 선별하며 기사 수를 중요도로 쓰지 않는다.',
  '집필은 본문과 위치별 근거 ID만 제출한다. ruleLedger는 이름만 유지한 위치별 출처 연결이다. quote·문장 분리·전달 경로 재서술·자기 점수·승인 결과는 작성하지 않는다.',
  'title·summary·각 소제목·본문 위치마다 claims에 하나씩 연결한다. target은 drivers.0.text 같은 점 표기다. 각 위치의 모든 주장에 필요한 출처를 연결하되, 출처 ID가 있다는 이유로 그 안의 모든 해석을 허용하지 않는다.',
  '일반 원리는 제공된 applicableMechanisms의 mechanismId/applicationId만 사용한다. 출처 자체의 설명은 interpretation으로 귀속하고, 사용하지 않은 원리 ID는 빈 문자열이다.',
  '코드는 정확한 원고에서 문장을 나누고 위치별 출처를 검토 후보로 연결한다. 검토자는 문장의 모든 주장과 근거를 대조한다. 이 연결은 지지 판정이나 게시 승인이 아니다.',
].join('\n')

export function writingLinksSchema(packet) {
  const shared=packet.sharedReference
  const ref = { type: 'array', minItems: 0, maxItems: 4, uniqueItems: true,
    items: { type: 'string', enum: packet.evidence.map(e => e.id) } }
  const text = { type: 'string', maxLength: 80 }
  return { type: 'object', additionalProperties: false, required: ['version', 'claims'], properties: {
    version: { type: 'string', enum: [WRITING_CONTRACT_VERSION] },
    claims: { type: 'array', minItems: 1, maxItems: packet.fxWritingBackground||shared?16:12, items: {
      type: 'object', additionalProperties: false,
      required: ['target', 'kind', 'evidenceIds', 'mechanismId', 'applicationId',...(shared?['materialClaimIds']:[])],
      properties: { target: { type: 'string', pattern: packet.fxWritingBackground||shared?'^(title|summary|(?:drivers|implications|watch)\\.[0-2]\\.(?:title|text))$':'^(title|summary|(?:drivers|watch)\\.[0-2]\\.(?:title|text))$' },
        kind: { type: 'string', enum: ['fact', 'interpretation', 'mechanism'] }, evidenceIds: ref,
        ...(shared?{materialClaimIds:{type:'array',minItems:1,maxItems:8,uniqueItems:true,items:{type:'string',enum:packet.evidence.flatMap(e=>e.sharedNotes.claims.map(r=>r.claimId))}}}:{}),
        mechanismId: text, applicationId: text },
    } },
  } }
}

// Call only after full local schema validation. No legacy manuscript migration.
// Inherited references are candidates for a reviewer, never evidence of entailment.
export function assembleWritingLedger(packet, draft) {
  const targets = proseTargets(draft), rows = draft.ruleLedger.claims
  const mechanisms = selectMechanisms(packet).selected
  if (rows.length !== Object.keys(targets).length || new Set(rows.map(r => r.target)).size !== rows.length ||
    rows.some(r => !Object.hasOwn(targets, r.target))) throw new Error('writing_target_coverage')
  for (const row of rows) {
    const [section, index, field] = row.target.split('.')
    const block = draft[section]?.[Number(index)]
    if (block && (row.evidenceIds.some(id => !block.evidenceIds.includes(id)) ||
      field === 'text' && (row.kind !== block.kind || block.evidenceIds.some(id => !row.evidenceIds.includes(id)))))
      throw new Error('writing_source_or_kind_mismatch')
    const mechanism = mechanisms.find(m => m.applicationId === row.applicationId && m.mechanismId === row.mechanismId)
    if ((row.kind === 'mechanism' || row.mechanismId || row.applicationId) && !mechanism)
      throw new Error('writing_mechanism_not_admitted')
    if (!row.evidenceIds.length && !(row.kind === 'mechanism' && mechanism)) throw new Error('writing_reference_missing')
  }
  return { ruleVersion: RULE_VERSION, mechanismVersion: MECHANISM_VERSION, currency: packet.currency,
    baseDate: packet.baseDate, assembly: WRITING_CONTRACT_VERSION,
    claims: rows.flatMap(row => reviewSentences(targets[row.target]).map(quote => ({
      ...Object.fromEntries(Object.entries(row).filter(([key])=>key!=='materialClaimIds')), quote, factIds: [], eventKey: '', pathwayKey: '', newInformation: '',
      transmission: '', currencyConnection: '', watchPurpose: '',
    }))) }
}
