// Offline source review and quarantined display of this exact paid comparison.
// Not a fallback/repair path: failed generation verdicts and manuscripts remain unchanged.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { assembleReportContent } from './openrouter.js'
import { validateContent } from './core.js'
import { fingerprint } from './research-harness.js'
import { prepareClaimReview, assessClaimReview, CLAIM_REVIEW_VERSION } from './claim-review.js'
import { auditHarnessReport } from './report-harness.js'
import { saveReport } from './storage.js'

const root = '.local-reports/private/harness-comparison-brl-20261007-harness-ab-v1'
const definitions = [
  [
    ['title:0', 'style', [1, 6, 7], '선거 이후 조정과 대외 달러의 동반 흐름은 원문에 있다. 숨고르기 장세는 장중 조정을 요약한 표현이지만 제목은 요인 나열에 가깝다.'],
    ['summary:0', 'claim_scope', [1, 6], '원문은 랠리 이후 조정을 보도한다. 차익 실현 매도라는 거래 동기를 확인하거나 그렇게 설명하지 않았다. 외신이 차익 실현성 되돌림을 전했다고 귀속하는 부분은 근거를 넓혔다.'],
    ['summary:1', 'none', [4, 5], '이전 거래일 선거 반응의 재정 기대와 구체적인 방안이 없는 상태를 함께 보존했다.'],
    ['drivers.0.title:0', 'claim_scope', [1, 6], '현지 차익 실현이라는 매도 동기는 원문에 확인되지 않았다. 조정이라는 가격 움직임과 거래 동기를 구분해야 한다.'],
    ['drivers.0.text:0', 'none', [6, 7], '신흥국 통화 대비 달러 강세와 달러 지수 상승이 기사에 있다. 주요 통화 전체의 개별 반응이 아니라 보도된 대외 달러 흐름이라는 범위다.'],
    ['drivers.0.text:1', 'style', [1, 4, 6], '전 거래일의 선거 반응과 당일 조정·글로벌 달러 동반 방향을 귀속한 설명이다. 숨고르기라는 비유 대신 기사 장중의 조정이라는 표현이 명료하다.'],
    ['drivers.1.title:0', 'none', [4, 5], '재정 관리 기대와 구체안 부재를 함께 보여 주며 정책 실행을 단정하지 않았다.'],
    ['drivers.1.text:0', 'none', [4, 5], '직전까지라는 시점을 유지하고 선거 이후 시장 인식으로 귀속한다. 숫자 일차 표기는 입력의 숫자 금지 계약 위반이지 선거 단계의 사실 오류는 아니다.'],
    ['drivers.1.text:1', 'none', [5], '시장 인식과 후보의 구체적 재정 조정안 부재라는 기사 조건에 맞는다.'],
    ['watch.0.title:0', 'style', [5], '구체적 방안이 없는 상태에 대응하는 확인 대상으로 읽을 수 있다. 원문이 직접 제시한 관찰 제안은 아니므로 작성자의 확인 질문으로 구분하는 편이 정확하다.'],
    ['watch.0.text:0', 'style', [5], '구체안 부재에 대한 확인 질문 자체는 타당한 편집 선택이다. 독자 업무 지시가 아닌 설명의 확인 기준으로 더 짧게 표현할 수 있다.'],
    ['watch.0.text:1', 'claim_scope', [5], '원문은 현재의 구체안 부재만 말한다. 공약 후퇴와 변동성 확대라는 조건부 전망은 원문이나 승인된 원리로 입증되지 않는다.'],
  ],
  [
    ['title:0', 'style', [1, 6], '이전 선거 기대와 당일 조정을 대외 흐름과 함께 보여 준다. 숨고르기와 동조는 독자가 직접 이해하기에 추상적이다.'],
    ['summary:0', 'none', [1, 4, 5, 6], '선거 기대 반응 이후 조정이라는 순서와 대외 달러 동반 방향을 원문 범위 안에서 요약했다.'],
    ['summary:1', 'none', [5], '구체적인 재정 조정 방안이 없다는 조건이며 정책 실행을 사실처럼 만들지 않았다.'],
    ['drivers.0.title:0', 'none', [4, 5], '선거 결과에 대한 기대와 미확정 정책이라는 조건을 함께 표시한다.'],
    ['drivers.0.text:0', 'none', [4, 5], '이전 거래일의 재정 관리 기대에 대한 시장 인식을 외신에 귀속한다. 실제 재정 개선이나 신규 발표로 확대하지 않았다.'],
    ['drivers.0.text:1', 'none', [5], '후보의 구체안 부재라는 원문의 중요한 조건을 보존했다. 공식 제시라는 말로 Reuters를 정부 공식 출처라고 부르지는 않는다.'],
    ['drivers.1.title:0', 'style', [6, 7], '대외 동반 방향은 맞지만 동조화라는 용어보다 무엇이 함께 움직였는지 밝히는 편이 읽기 쉽다.'],
    ['drivers.1.text:0', 'none', [6, 7], '기사에 다른 신흥국 통화에 대한 달러 강세와 지수 상승이 있다. 모든 통화의 동일 상승을 계량한 주장으로 확대하지 않았다.'],
    ['drivers.1.text:1', 'style', [1, 6], '당일 장중 조정과 대외 달러의 같은 방향이라는 내용은 원문에 맞는다. 조율하며와 궤를 같이했다는 표현은 구체적인 새 설명을 더하지 않는다.'],
  ],
]
const files = ['001-snapshot', '006-candidate', '010-candidate', '011-result']
const bytes = await Promise.all(files.map(f => fs.readFile(`${root}/${f}.json`, 'utf8')))
const [snapshot, baseline, harness, accounting] = bytes.map(JSON.parse)
assert.equal(snapshot.packet.currency, 'BRL'); assert.equal(snapshot.packet.baseDate, '2026-10-07')
assert.equal(accounting.unknownReservedUsd, 0)
const hashes = ['a9177984b8400fa186dcb97d26cede056b4f96c9887a2d29a4db77ce407fe39f', '683ac4a8eb2b354283247f94194f5216a44b526ba7ecd43cf4ebd83d46ce7423']
const rows = [], start = Date.now()
// A permanent review lock avoids duplicate public projections on rerun.
await fs.mkdir(`${root}/offline-review-lock`)
for (const [index, candidate] of [baseline, harness].entries()) {
  assert.equal(fingerprint(candidate.draft), hashes[index])
  const content = assembleReportContent(snapshot.packet, candidate.draft, true)
  const displayValidation = validateContent(content, snapshot.packet)
  if (!index) {
    assert.deepEqual(candidate.generated.validation.errors, ['direction_in_unverified_header'])
    assert.deepEqual(displayValidation.errors, ['untrusted_text'])
    // This exact manuscript has one ordinal, not a fabricated price or private field.
    // Normal generation remains blocked; this clone is checked only to isolate
    // the reason for local forensic viewing. The displayed manuscript is untouched.
    const inspectionCopy = structuredClone(content)
    inspectionCopy.drivers[1].text = inspectionCopy.drivers[1].text.replace('1차', '일차')
    assert.equal(validateContent(inspectionCopy, snapshot.packet).valid, true)
  } else assert.equal(displayValidation.valid, true)
  const input = prepareClaimReview(snapshot.packet, content), source = input.sources[0]
  const anchors = ids => ids.map(i => ({ evidenceId: source.id, passageId: `p${i}`, passageHash: source.sourceContext.passageHash,
    quote: source.sourceContext.passages.find(p => p.id === `p${i}`).text.slice(0, 470) }))
  assert.equal(input.claims.length, definitions[index].length)
  const review = { version: CLAIM_REVIEW_VERSION, binding: input.binding, origin: 'agent', reviewer: 'Codex original source review of Brazil matched comparison',
    claims: input.claims.map(c => {
      const [, issue, ids, reason] = definitions[index].find(r => r[0] === c.id)
      const support = issue === 'claim_scope' ? 'limited' : 'supported'
      return { id: c.id, claimHash: c.claimHash, issue, reason, support, decision: issue === 'claim_scope' ? 'rewrite' : issue === 'style' ? 'refine' : 'keep',
        anchors: anchors(ids), applicationIds: [], subclaims: [{ quote: c.quote, support, reason, anchors: anchors(ids), applicationIds: [] }] }
    }) }
  const assessment = assessClaimReview(input, review)
  assert.deepEqual(assessment.errors, [])
  const audit = auditHarnessReport({ packet: snapshot.packet, content, ledger: candidate.draft.ruleLedger, review })
  const quality = { origin: 'agent', blind: false, provisional: true, scores: index ? [3, 3, 2, 4, 4] : [3, 3, 2, 3, 2],
    criteria: ['원인 설명', '변화 전달', '영업 관련성', '가독성', '근거 충실도'], average: index ? 3.2 : 2.6, passed: false }
  const notes = index ? [
    '새 하네스의 실제 생성 원고입니다. 원문에 없는 차익 실현·변동성 전망을 본문에 넣지 않았고 관찰 항목을 억지로 채우지 않았습니다.',
    '설명은 짧고 추상적이며 소비·판매 환경의 별도 근거가 없습니다. 대응표의 일부 전달 경로에는 본문에 없는 차익 실현 표현이 있어 집필 기록도 보완 대상입니다.',
  ] : [
    '기존 입력의 실제 생성 원고입니다. 생성 검사는 방향 표현과 일차 투표의 숫자 표기로 미통과했습니다. 검사 판정은 유지하며 이 화면은 실패 원고의 로컬 열람입니다.',
    '원문에 없는 차익 실현 매도 동기와 공약 후퇴에 따른 변동성 확대를 덧붙였습니다. 해당 설명은 채택하지 않습니다.',
  ]
  const id = `BRL-2026-10-07-${start + index}`, costUsd = accounting.ledger[index].costUsd
  await saveReport({ ...snapshot.packet, id, schemaVersion: 'currency-report/1', content, generationMode: 'ai_enhanced', status: 'rejected', publishedAt: null,
    comparison: { label: index ? 'brl-harness-ab-new' : 'brl-harness-ab-baseline', model: snapshot.plan.model, costUsd,
      inputHash: snapshot.plan.calls[index].requestHash, average: quality.average, preferred: false, provisional: true, publicationBlocked: true,
      historicalReview: false, datasetFetchedAt: snapshot.packet.marketData.fetchedAt,
      reviewNotes: [...notes, '본문은 수정하지 않았습니다. 날짜·수치·차트는 동일 입력의 코드 조립이며 운영 게시 승인이 아닙니다.'] } })
  rows.push({ stage: candidate.stage, reportId: id, contentHash: fingerprint(content), originalGenerationValidation: candidate.generated.validation,
    displayValidation, review, assessment, audit, quality, costUsd,
    url: `http://127.0.0.1:4175/local-experience.html?mode=live-local&design=a&run=${id}#report/BRL/2026-10-07` })
}
const result = { rows, actualCostUsd: accounting.actualCostUsd, unknownReservedUsd: accounting.unknownReservedUsd,
  modelsCalled: 2, retries: 0, manuscriptEdits: 0, publicationApproved: false,
  finding: 'New input stayed closer to source, but did not produce deeper reader insight; one source and one sample per input.' }
for (const [i, f] of files.entries()) assert.equal(await fs.readFile(`${root}/${f}.json`, 'utf8'), bytes[i])
await fs.writeFile(`${root}/012-offline-review.json`, JSON.stringify(result, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ actualCostUsd: result.actualCostUsd, rows: rows.map(r => ({ url: r.url, costUsd: r.costUsd, average: r.quality.average,
  corrections: r.assessment.requiredCorrections, audit: r.audit.metrics })), manuscriptEdits: 0, publicationApproved: false }, null, 2))
