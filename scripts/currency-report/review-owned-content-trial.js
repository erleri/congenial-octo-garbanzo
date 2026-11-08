// Offline source review and local comparison display of the one paid result.
// No model calls, automatic correction or publication approval.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { prepareClaimReview, assessClaimReview, CLAIM_REVIEW_VERSION } from './claim-review.js'
import { saveReport } from './storage.js'
const root = '.local-reports/private/clp-20261005-owned-content-trial-v1'
const read = name => fs.readFile(`${root}/${name}.json`, 'utf8').then(JSON.parse)
const save = (name, v) => fs.writeFile(`${root}/${name}.json`, JSON.stringify(v, null, 2), { flag: 'wx' })
const sha = v => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const judgments = [
  ['title:0', 'style', '정책 신호와 대외 여건의 대비는 타당하다. 여전히 요인 나열형 제목이어서 정책 신호의 의미를 더 구체화할 수 있다.', ['df-close/p3', 'lt-close/p13']],
  ['summary:0', 'none', '계획 발표와 정책 신호에 대한 시장 관심이며 실제 집행 완료를 선언하지 않는다.', ['df-close/p0', 'df-close/p2', 'df-close/p3']],
  ['summary:1', 'style', '정책 신호 해석과 현지 요인 중심 반응은 기사에 있다. 적정 범위 관리 의지는 당국의 직접 발언이 아닌 시장 해석임을 더 명료하게 귀속하면 좋다.', ['df-close/p3', 'lt-close/p13']],
  ['drivers.0.title:0', 'none', '계획 발표와 신호라는 대상이 기사에 부합한다.', ['df-close/p2', 'df-close/p3']],
  ['drivers.0.text:0', 'none', '시장에서는이라는 귀속 안에서 당국의 관심을 해석한다. 당국의 확정 목표를 직접 인용했다고 쓰지 않았다.', ['df-close/p0', 'df-close/p3']],
  ['drivers.0.text:1', 'none', '인용된 분석가의 판단으로 범위를 한정했고 규모와 신호의 비교가 원문에 있다.', ['df-close/p3']],
  ['drivers.0.text:2', 'none', '재정 필요와 시장 상황에 따른 규모 변경 조건을 보존했다.', ['lt-close/p10']],
  ['drivers.1.title:0', 'style', '바로 이어지는 본문이 구리를 명시하므로 다른 원자재의 동반 상승까지 주장한다고 판정하지 않는다. 구리라는 명칭으로 바꾸는 편이 정확하다.', ['df-close/p10']],
  ['drivers.1.text:0', 'source_authority', '구리 반등은 확인되지만 가용 외화 증가라는 부분은 DF가 인용한 XTB의 발표 해석이다. 보도가 확인한 실제 공급 증가 사실처럼 읽히지 않도록 분석가에게 직접 귀속해야 한다.', ['df-close/p5', 'df-close/p10']],
  ['drivers.1.text:1', 'style', '이 문장은 분석가들에게 직접 귀속했다. 바로 앞의 구리 문맥을 유지하며 공급 발표와 가격 반응을 설명하는 해석으로 한정한다.', ['df-close/p5', 'lt-close/p13']],
  ['implications.0.title:0', 'none', '코드가 승인된 동일 달러 결제 환산 범위를 표시한다.', ['@usd']],
  ['implications.0.text:0', 'none', '동일 USD 금액과 미헤지 조건을 지킨 산술 관계다. 기업 실적이나 장부 평가를 추정하지 않는다.', ['@usd']],
  ['implications.0.text:1', 'none', '승인된 헤지·선결제·계약 환율 예외를 보존한다.', ['@usd']],
  ['watch.0.title:0', 'none', '관찰 변수 절에서 실제 집행 및 포지션 조정 여부를 확인할 대상으로 제시한다.', ['df-close/p3', 'lt-close/p10']],
  ['watch.0.text:0', 'none', '원문의 향후 비거주자 포지션 조정 여부를 관찰한다는 발언에 맞는다.', ['df-close/p3']],
  ['watch.0.text:1', 'none', '집행 및 포지션 반응이 확인된다면이라는 가정이며 실제 관측이나 예측으로 바꾸지 않는다. 반대 상황에서 해석이 약해지는 조건도 보존한다.', ['df-close/p3', 'lt-close/p10']],
]
async function main() {
  const [snapshot, result, accounting, transport] = await Promise.all(['snapshot', 'result', 'accounting', 'transport'].map(read))
  assert.equal(snapshot.inputHash, sha({ packet: snapshot.packet, body: snapshot.body }))
  assert.equal(result.generated?.validation.valid, true)
  assert.equal(transport.valid, true)
  const content = result.generated.candidate, input = prepareClaimReview(snapshot.packet, content)
  assert.equal(input.claims.length, judgments.length)
  const refs = list => ({ applicationIds: list.includes('@usd') ? [input.applicableMechanisms.find(a => a.mechanismId === 'usd-payment-conversion').applicationId] : [],
    anchors: list.filter(r => r !== '@usd').map(r => {
      const [evidenceId, passageId] = r.split('/'), s = input.sources.find(s => s.id === evidenceId)
      return { evidenceId, passageId, passageHash: s.sourceContext.passageHash, quote: s.sourceContext.passages.find(p => p.id === passageId).text.slice(0, 460) }
    }) })
  const review = { version: CLAIM_REVIEW_VERSION, binding: input.binding, origin: 'agent', reviewer: 'Codex independent source review 2026-10-07',
    claims: input.claims.map(c => {
      const [, issue, reason, references] = judgments.find(j => j[0] === c.id)
      const support = issue === 'source_authority' ? 'limited' : 'supported'
      const row = { id: c.id, claimHash: c.claimHash, issue, reason, support,
        decision: issue === 'style' ? 'refine' : issue === 'none' ? 'keep' : 'rewrite', ...refs(references) }
      let splits = [c.quote]
      if (c.id === 'drivers.1.text:0') splits = ['현지 보도는 구리 가격의 연속 반등과 함께 ', '시장 내 가용 외화가 늘어난 점을 통화 지지 요인으로 함께 전했습니다.']
      if (c.id === 'watch.0.text:1') splits = ['당국의 외화 매각이 예정대로 집행되고 외국인 투자자의 포지션 축소가 확인된다면 정책 신호가 시장에 안착했다는 설명을 지지하지만, ', '집행 규모가 축소되거나 매도 포지션이 유지될 경우 발표 효과에 대한 해석은 약화될 수 있습니다.']
      if (c.id === 'summary:1') splits = ['현지 보도는 대외 여건과 별개로 ', '당국이 적정 환율 범위를 관리하겠다는 의지를 보인 점에 시장 반응이 집중되었다고 전했습니다.']
      row.subclaims = splits.map((quote, i) => ({ quote, support: c.id === 'drivers.1.text:0' && i === 0 ? 'supported' : support, reason,
        ...refs(c.id === 'drivers.1.text:0' ? [i === 0 ? 'df-close/p10' : 'df-close/p5'] : references) }))
      return row
    }) }
  const assessment = assessClaimReview(input, review)
  assert.deepEqual(assessment.errors, [])
  assert.deepEqual(assessment.requiredCorrections, ['drivers.1.text:0'])
  const technicalHolds = result.generated.rules.checks.filter(c => c.status === 'hold')
  const quality = { origin: 'agent_provisional', blind: false, scores: { cause: 4, change: 3, salesRelevance: 3, readability: 4, evidence: 3 },
    average: 3.4, passed: false, reasons: ['정책 신호 설명과 관찰 조건이 전보다 명확하다.', '요약과 두 번째 배경은 여전히 추상적이며 영업 의미는 조건부 환산 한 항목에 한정된다.', '분석가 귀속 보완 한 문장 및 문장별 대응표 네 위치 미통과.'] }
  const previousCost = .0112635
  const comparison = { generation: { previousUsd: previousCost, currentUsd: accounting.costUsd,
    changePercent: accounting.costUsd === null ? null : (accounting.costUsd / previousCost - 1) * 100 },
    previousFourStageUsd: .04443975, currentCalls: 1, currentModelReviewCalls: 0, retries: 0,
    previousAgentScore: 3.2, currentAgentScore: quality.average, controlledBenchmark: false }
  await save('content-review', { input, review, assessment, quality, technicalHolds, comparison, manuscriptUnchanged: true, publicationApproved: false })
  const previous = JSON.parse(await fs.readFile('.local-reports/reviewable/CLP-2026-10-05-1791378393983.json', 'utf8'))
  assert.equal(sha(previous.facts), sha(snapshot.packet.facts)); assert.equal(sha(previous.series), sha(snapshot.packet.series))
  const id = `CLP-2026-10-05-${Date.now()}`
  const notes = ['Gemini가 한 번 새로 작성한 실제 원문입니다. 본문을 수동 교정하지 않았습니다.',
    '공식 관측 이후·장부 평가·외화 확보 압박 표현은 사라졌습니다. 정책 신호와 조건부 관찰 설명은 개선됐습니다.',
    '가용 외화 증가 문장은 실제 집행 확인과 분석가 해석을 구분하도록 귀속 보완이 필요합니다. 문장별 대응표 네 위치도 규칙 미통과입니다.',
    '에이전트 잠정 평가 3.4/5이며 품질 합격·게시 승인이 아닙니다. 과거 사례이고 현재 시장 보고서가 아닙니다.']
  await saveReport({ ...previous, id, content, assemblyVersion: result.generated.assemblyVersion,
    status: 'rejected', publishedAt: null, generationMode: 'ai_enhanced',
    comparison: { inputHash: snapshot.inputHash, label: 'gemini-owned-content-v1', model: accounting.actualModel,
      costUsd: accounting.costUsd, average: quality.average, preferred: false, provisional: true, publicationBlocked: true,
      referenceOnly: false, historicalReview: true, reviewNotes: notes } })
  const projection = { id, contentHash: sha(content), manuscriptUnchanged: true, comparison, quality,
    url: `http://127.0.0.1:4175/local-experience.html?mode=live-local&design=a&run=${id}#report/CLP/2026-10-05` }
  await save('projection', projection)
  console.log(JSON.stringify(projection, null, 2))
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
