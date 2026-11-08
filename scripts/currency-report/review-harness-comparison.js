// Offline, non-blind agent review of two preserved model manuscripts. No paid calls.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { fingerprint } from './research-harness.js'
import { prepareClaimReview, assessClaimReview, CLAIM_REVIEW_VERSION } from './claim-review.js'
import { auditHarnessReport } from './report-harness.js'
import { saveReport } from './storage.js'

const root = '.local-reports/private/harness-comparison-clp-20261005-harness-ab-v1'
const definitions = {
  baseline_generation: [
    ['title:0', 'style', '발표와 시장 신호라는 근거 범위를 지켰다. 제목은 여전히 요인 목록으로 결론이 약하다.', ['df-close/p0', 'df-close/p3']],
    ['summary:0', 'style', '전체 요약의 다음 문장이 시장 분석가의 해석임을 밝힌다. 안정 신호를 당국의 공식 목표와 혼동하지 않게 시장에서 읽힌 신호로 더 구체화하는 편이 좋다.', ['df-close/p0', 'df-close/p2', 'df-close/p3']],
    ['summary:1', 'none', '글로벌 달러 강세와 현지 요인을 대비한 XTB 평가 및 정책 신호 해석이 있다.', ['lt-close/p13', 'df-close/p3']],
    ['drivers.0.title:0', 'none', '계획과 정책 신호라는 대상이 원문에 맞는다.', ['df-close/p2', 'df-close/p3']],
    ['drivers.0.text:0', 'none', '공급 계획 발표를 실제 집행 완료로 확대하지 않았다.', ['df-close/p2']],
    ['drivers.0.text:1', 'style', '분석가 귀속 안에서 규모보다 신호를 중요하게 본 판단과 적정 범위 해석을 전달한다. 시장 심리의 크기를 계량한 결과처럼 읽히지 않도록 신호의 중요성이라는 표현이 더 정확하다.', ['df-close/p3']],
    ['drivers.1.title:0', 'none', '공급 기대와 대외 여건의 대비라는 범위를 지킨다.', ['lt-close/p9', 'lt-close/p13']],
    ['drivers.1.text:0', 'claim_scope', '원문은 현지 발표 이후 환율 반응과 글로벌 대비를 설명한다. 특정 분석가가 통화 심리의 전환을 평가했다는 주장까지 직접 지지하지 않는다. 가격 반응과 심리 상태를 구분해야 한다.', ['lt-close/p9', 'lt-close/p13']],
    ['drivers.1.text:1', 'none', '자금 조달 필요와 시장 여건에 따른 변경 가능성을 보존했다.', ['lt-close/p10']],
    ['implications.0.title:0', 'none', '코드 소유 설명의 동일 USD 결제 환산 범위에 맞는다.', ['@usd']],
    ['implications.0.text:0', 'none', '같은 USD 금액·미헤지 가정과 환율에 비례하는 환산 관계다.', ['@usd']],
    ['implications.0.text:1', 'none', '헤지·선결제·고정 계약 환율 예외를 보존한다.', ['@usd']],
    ['watch.0.title:0', 'none', '포지션과 실제 공급 조건을 향후 확인 대상으로 제시한다.', ['df-close/p3', 'lt-close/p10']],
    ['watch.0.text:0', 'style', '실제 포지션 정리를 관찰할 경우 신호 해석을 대조하는 조건으로 읽힌다. 나타나는지라는 의문형 주어보다 확인된다면이라는 조건형이 더 명확하다.', ['df-close/p3']],
    ['watch.0.text:1', 'none', '규모 변경이라는 조건에 따라 공급 기대 해석이 약해질 수 있다는 한정적 관찰이며 실제 변화나 목표환율을 단정하지 않았다.', ['lt-close/p10']],
  ],
  harness_generation: [
    ['title:0', 'style', '허용된 요인을 묶었으나 시장 해석이라는 제목은 구체적인 결론을 전달하지 못한다.', ['df-close/p3', 'lt-close/p13']],
    ['summary:0', 'none', '시장에서 제시된 시각으로 귀속했고 규모보다 신호라는 BeFX 해석에 맞는다.', ['df-close/p3']],
    ['summary:1', 'none', '현지·글로벌 대비와 실제 매각의 변경 조건을 함께 보존했다.', ['lt-close/p13', 'lt-close/p10']],
    ['drivers.0.title:0', 'style', '계획을 정책 개입 신호로 읽는 맥락이며 실제 집행을 선언하지 않는다. 공급 계획이라는 구체 명칭을 중심으로 쓰면 더 명료하다.', ['df-close/p2', 'df-close/p3']],
    ['drivers.0.text:0', 'style', '분석가 귀속을 지켰다. 외환시장 안정이라는 넓은 말보다 적정 환율 범위에 대한 관심이라는 실제 분석가 표현을 전달하는 것이 정확하다.', ['df-close/p2', 'df-close/p3']],
    ['drivers.0.text:1', 'none', '매각 조건이 원문에 명시돼 있고 실제 집행으로 확대하지 않았다.', ['lt-close/p10']],
    ['drivers.0.text:2', 'style', '구리 반등과 원유 하락은 실제 보도와 일치한다. 그러나 정책 신호 문단 안의 이 문장은 앞뒤 연결이 없어 별도 배경 또는 생략이 더 적절하다.', ['df-close/p10', 'df-close/p9']],
    ['drivers.1.title:0', 'none', '글로벌 달러와 현지 반응의 차이라는 원문 비교 범위를 지킨다.', ['lt-close/p13']],
    ['drivers.1.text:0', 'none', 'XTB의 현지 요인 설명에 직접 귀속하고 글로벌 대비를 보존한다.', ['lt-close/p13', 'lt-close/p9']],
    ['drivers.1.text:1', 'claim_scope', '제시한 La Tercera 구절은 가격 반응을 현지 발표와 연결한다. 단기 심리에 직접 영향을 미쳤다는 분석가의 평가까지 입증하지는 않는다. 가격 반응에서 별도 심리·직접 인과 판정으로 확대했다.', ['lt-close/p13', 'lt-close/p9']],
    ['implications.0.title:0', 'none', '같은 USD 결제 환산에 한정한 코드 설명이다.', ['@usd']],
    ['implications.0.text:0', 'none', '승인된 동일 USD 금액과 미헤지 조건을 지켰다.', ['@usd']],
    ['implications.0.text:1', 'none', '승인된 예외를 보존하고 실제 기업 마진이나 판매를 추정하지 않았다.', ['@usd']],
    ['watch.0.title:0', 'none', '원문이 향후 확인할 대상으로 말한 비거주자 포지션이다.', ['df-close/p3']],
    ['watch.0.text:0', 'none', '확인된다면이라는 조건 안에서 포지션 축소와 정책 신호 가설의 지지를 연결한다.', ['df-close/p3']],
    ['watch.0.text:1', 'claim_scope', '비거주자 포지션이 변하지 않는다면 그 투자자 집단의 경로는 확인되지 않은 것이다. 그것만으로 정부 발표의 심리적 영향력 전반이 제한적이었다는 평가가 힘을 얻는다고 확대할 근거는 없다.', ['df-close/p3', 'df-close/p4']],
  ],
}

async function main() {
  const files = ['001-snapshot', '006-candidate', '010-candidate', '011-result']
  const bytes = await Promise.all(files.map(f => fs.readFile(`${root}/${f}.json`, 'utf8')))
  const [snapshot, baseline, harness, result] = bytes.map(JSON.parse)
  assert.equal(result.ledger.length, 2); assert.equal(result.unknownReservedUsd, 0)
  const original = JSON.parse(await fs.readFile('.local-reports/reviewable/CLP-2026-10-05-1791383294191.json', 'utf8'))
  assert.equal(fingerprint(original.facts), fingerprint(snapshot.packet.facts))
  assert.equal(fingerprint(original.series), fingerprint(snapshot.packet.series))
  const rows = [], runStart = Date.now()
  for (const [index, candidate] of [baseline, harness].entries()) {
    assert.equal(candidate.generated.validation.valid, true)
    const input = prepareClaimReview(snapshot.packet, candidate.generated.candidate), list = definitions[candidate.stage]
    assert.equal(list.length, input.claims.length)
    const refs = keys => ({ applicationIds: keys.includes('@usd') ? [input.applicableMechanisms.find(a => a.mechanismId === 'usd-payment-conversion').applicationId] : [],
      anchors: keys.filter(key => key !== '@usd').map(key => {
        const [evidenceId, passageId] = key.split('/'), source = input.sources.find(s => s.id === evidenceId)
        return { evidenceId, passageId, passageHash: source.sourceContext.passageHash,
          quote: source.sourceContext.passages.find(p => p.id === passageId).text.slice(0, 460) }
      }) })
    const review = { version: CLAIM_REVIEW_VERSION, binding: input.binding, origin: 'agent', reviewer: 'Codex source review of preserved harness comparison 2026-10-08',
      claims: input.claims.map(c => {
        const [, issue, reason, keys] = list.find(row => row[0] === c.id), support = issue === 'claim_scope' ? 'limited' : 'supported'
        const row = { id: c.id, claimHash: c.claimHash, issue, reason, support,
          decision: issue === 'claim_scope' ? 'rewrite' : issue === 'style' ? 'refine' : 'keep', ...refs(keys) }
        const split = candidate.stage === 'harness_generation' && c.id === 'drivers.0.text:2'
          ? [{ quote: '원자재 시장에서는 구리 가격 반등이 나타났으나 ', keys: ['df-close/p10'] }, { quote: '유가 등 여타 상품 흐름은 엇갈렸습니다.', keys: ['df-close/p9'] }]
          : [{ quote: c.quote, keys }]
        return { ...row, subclaims: split.map(part => ({ quote: part.quote, support, reason, ...refs(part.keys) })) }
      }) }
    const assessment = assessClaimReview(input, review)
    assert.deepEqual(assessment.errors, [])
    const audit = auditHarnessReport({ packet: snapshot.packet, content: candidate.generated.candidate, ledger: candidate.generated.ruleLedger, review })
    const scores = index ? [3, 3, 3, 3, 4] : [3, 3, 3, 4, 4]
    const quality = { origin: 'agent', blind: false, criteria: ['원인 설명', '변화 전달', '영업 관련성', '가독성', '근거 충실도'], scores,
      average: scores.reduce((n, v) => n + v, 0) / 5, passed: false, provisional: true,
      mandatoryContentCorrections: assessment.requiredCorrections.length,
      reasons: index ? ['출처 귀속과 변경 조건은 더 명확해졌다.', '정책 문단에 구리·유가를 끼워 넣었고 두 번째 배경은 단기 심리라는 추상어를 반복한다.', '내용 범위 보완 두 문장. 새로운 소비 근거와 추가 전달 경로는 없다.'] :
        ['문단이 상대적으로 짧고 집중돼 있다.', '공급 기대와 정책 신호를 설명하지만 전달 경로의 구체성은 여전히 부족하다.', '통화 심리를 전환시켰다는 귀속 범위 보완 한 문장.'] }
    const costUsd = result.ledger.find(r => r.stage === candidate.stage).costUsd
    const id = `CLP-2026-10-05-${runStart + index}`
    await saveReport({ ...original, id, content: candidate.generated.candidate, status: 'rejected', publishedAt: null,
      comparison: { label: index ? 'harness-ab-new' : 'harness-ab-baseline', model: snapshot.plan.model, costUsd, average: quality.average,
        inputHash: snapshot.plan.calls[index].requestHash, preferred: false, provisional: true, publicationBlocked: true, referenceOnly: false, historicalReview: true,
        reviewNotes: [index ? '새 하네스 입력으로 실제 생성한 원고이며 본문을 수정하지 않았습니다.' : '기존 입력으로 새로 생성한 비교 원고이며 본문을 수정하지 않았습니다.',
          ...quality.reasons, `에이전트 잠정 평가 ${quality.average}/5. 게시 승인이나 다른 통화의 품질 보증이 아닙니다.`] } })
    rows.push({ stage: candidate.stage, reportId: id, input, review, assessment, audit, quality, costUsd,
      contentHash: fingerprint(candidate.generated.candidate),
      url: `http://127.0.0.1:4175/local-experience.html?mode=live-local&design=a&run=${id}#report/CLP/2026-10-05` })
  }
  const comparison = { version: 'harness-content-comparison/1', rows, actualCostUsd: result.actualCostUsd, unknownReservedUsd: result.unknownReservedUsd,
    harnessGenerationCostChangePct: (rows[1].costUsd / rows[0].costUsd - 1) * 100,
    finding: 'One matched input trial: clearer attribution and lower observed cost, but worse paragraph focus. Neither manuscript passed the content-quality gate.',
    reviewerOrigin: 'agent', blind: false, sampleCountPerInput: 1, manuscriptEdits: 0, additionalModelCalls: 0, additionalCostUsd: 0, publicationApproved: false }
  await fs.writeFile(`${root}/012-offline-review.json`, JSON.stringify(comparison, null, 2), { flag: 'wx' })
  for (const [i, file] of files.entries()) assert.equal(await fs.readFile(`${root}/${file}.json`, 'utf8'), bytes[i])
  console.log(JSON.stringify({ actualCostUsd: comparison.actualCostUsd, costChangePct: comparison.harnessGenerationCostChangePct,
    rows: rows.map(r => ({ stage: r.stage, reportId: r.reportId, costUsd: r.costUsd, average: r.quality.average,
      corrections: r.assessment.requiredCorrections, mapping: r.audit.metrics, url: r.url })), publicationApproved: false }, null, 2))
}
main().catch(() => { console.error('harness_comparison_review_failed'); process.exitCode = 1 })
