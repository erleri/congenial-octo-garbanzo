// Offline projection of exact, reviewed manuscripts, including quarantined failures.
// No generation verdict repair, publication, env loading or API invocation.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { fingerprint } from './research-harness.js'
import { auditHarnessReport } from './report-harness.js'
import { saveReport } from './storage.js'

const root = '.local-reports/private/model-suitability-clp-brl-trial-v1'
const masked = `${root}/masked-review`
const paths = ['001-snapshot.json','019-result.json']
const originals = await Promise.all(paths.map(p => fs.readFile(`${root}/${p}`, 'utf8')))
const [{ snapshots }, result] = originals.map(JSON.parse)
const mapping = JSON.parse(await fs.readFile(`${masked}/mapping-private.json`, 'utf8'))
const evaluations = JSON.parse(await fs.readFile(`${masked}/evaluations-before-unmasking.json`, 'utf8'))
assert.equal(result.ledger.length, 4); assert.equal(result.unknownReservedUsd, 0)
await fs.mkdir(`${root}/projection-lock`)
const displayNames = { 'google/gemini-3.8-flash': 'Gemini 3.8 Flash', 'openai/gpt-5.4': 'GPT-5.4', 'anthropic/claude-sonnet-5.5': 'Claude Sonnet 5.5' }
const notes = {
  '1A': ['정책 신호와 조건을 구체적으로 귀속하지만 공통 시각 한계·독립성 주의가 본문에 반복됩니다.', '포지션 변화가 없거나 매각 규모가 줄면 신호 해석이 약해진다는 역추론은 원문 범위를 넘습니다.', '숫자 월 표기와 확인해야라는 인용 관찰이 생성 계약에 걸렸습니다. 그 자체를 허위 사실·가격 업무 지시라고 판단하지 않았습니다.'],
  '1B': ['기존 Gemini 결과를 그대로 재사용했습니다. 이번 신규 호출 비용은 없습니다.', '정책 문단에 무관한 상품 배경을 섞었고 직접 심리 효과·포지션 미변화의 역추론은 보완 대상입니다.'],
  '1C': ['제목과 출처 명칭이 구체적이고 발표·조건·대외 대비를 더 명확히 연결했습니다.', '요약에서 BeFX와 XTB의 평가를 묶어 규모보다 중요하다는 공통 판단으로 귀속한 부분은 수정이 필요합니다.', '본문에도 검토용 주의가 남아 있습니다. 생성 검사 통과가 게시 승인은 아닙니다.'],
  '2A': ['선거 기대와 당일 조정을 가장 자세히 구분했지만, 가격 반응을 헤알 매수 반응으로 설명한 부분은 근거 범위를 넓혔습니다.', '일차 표기와 원문에 있는 다른 통화 이름이 생성 계약에 걸렸습니다. 다른 통화를 잘못 계산한 사실 오류로 확대하지 않습니다.'],
  '2B': ['기존 Gemini 결과를 재사용했습니다. 이번 신규 호출 비용은 없습니다.', '본문의 필수 근거 교정은 없지만 숨고르기·동조·조율 같은 표현이 구체적인 설명을 더하지 않습니다.'],
  '2C': ['대외 동반 흐름과 국내 기대를 독자가 이해하기 쉽게 구분했습니다.', '제목의 당일 재정 기대 재평가와, 동조가 약하면 그 특정 국내 원인의 비중을 높인다는 관찰은 원문 범위를 넘습니다.'],
}
const countries = [], rows = [], start = Date.now()
for (const snapshot of snapshots) {
  const currency = snapshot.packet.currency
  const local = []
  for (const model of ['google/gemini-3.8-flash','openai/gpt-5.4','anthropic/claude-sonnet-5.5']) {
    const m = mapping.find(m => m.currency === currency && m.model === model)
    const card = JSON.parse(await fs.readFile(`${masked}/${m.label}.json`, 'utf8'))
    const evaluation = evaluations.find(e => e.label === m.label)
    assert.equal(fingerprint(card.content), m.contentHash); assert.equal(m.contentHash, evaluation.contentHash)
    assert.ok(!/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|bearer\s+\S+|-----BEGIN .*PRIVATE KEY/i.test(JSON.stringify(card.content)))
    const originalCandidate = m.existing ? JSON.parse(await fs.readFile(`${currency === 'CLP' ? '.local-reports/private/harness-comparison-clp-20261005-harness-ab-v1' : '.local-reports/private/harness-comparison-brl-20261007-harness-ab-v1'}/010-candidate.json`, 'utf8')) :
      result.results.find(r => r.stage === m.stage)
    const audit = auditHarnessReport({ packet: snapshot.packet, content: card.content,
      ledger: originalCandidate.generated?.ruleLedger ?? originalCandidate.draft?.ruleLedger, review: evaluation.review })
    const id = `${currency}-${snapshot.packet.baseDate}-${start + rows.length}`
    await saveReport({ ...snapshot.packet, id, schemaVersion: 'currency-report/1', generationMode: 'ai_enhanced',
      content: card.content, status: 'rejected', publishedAt: null,
      comparison: { label: `writer-${m.label.toLowerCase()}`, model, costUsd: m.costUsd,
        inputHash: m.existing ? snapshot.plan.calls[1].requestHash : result.results.find(r=>r.stage===m.stage) ?
          JSON.parse(originals[0]).plan.calls.find(c=>c.stage===m.stage).requestHash : '',
        average: evaluation.quality.average, preferred: false, provisional: true, publicationBlocked: true,
        historicalReview: currency === 'CLP', datasetFetchedAt: snapshot.packet.marketData?.fetchedAt,
        reviewNotes: [...notes[m.label], '실제 원고를 수정하지 않은 로컬 비교본입니다. 기존 승인·원고·비용 기록을 교체하지 않았습니다.'] } })
    const row = { label: m.label, model, modelLabel: displayNames[model], currency, costUsd: m.costUsd, existing: m.existing,
      generationStatus: card.generationStatus, generationValidation: card.originalValidation,
      statusLabel: card.originalValidation?.valid ? '생성 검사 통과 · 미게시 비교본' : '생성 계약 미통과 · 격리 열람',
      content: card.content, contentHash: m.contentHash, notes: notes[m.label], evaluation, audit,
      reportId: id, url: `http://127.0.0.1:4175/local-experience.html?mode=live-local&design=a&run=${id}#report/${currency}/${snapshot.packet.baseDate}` }
    rows.push(row)
    // Explicit whitelist: no passages, raw model response, ledger or review sent to screenshot page.
    local.push({ modelLabel: row.modelLabel, costUsd: row.costUsd, existing: row.existing,
      statusLabel: row.statusLabel, content: row.content, notes: row.notes })
  }
  countries.push({ currency, baseDate: snapshot.packet.baseDate, facts: snapshot.packet.facts, rows: local })
}
for (const [i,p] of paths.entries()) assert.equal(await fs.readFile(`${root}/${p}`, 'utf8'), originals[i])
await fs.writeFile(`${root}/final-review.json`, JSON.stringify({ rows, countries, newActualCostUsd: result.actualCostUsd,
  existingGeminiGenerationCostUsd: mapping.filter(m=>m.existing).reduce((n,m)=>n+m.costUsd,0),
  unknownReservedUsd: result.unknownReservedUsd, calls: 4, retries: 0, publicationApproved: false,
  assessment: 'GPT more concrete in these samples, but no model met the content gate; one sample per case/model, agent provisional and not fully blind.' },null,2),{flag:'wx'})
console.log(JSON.stringify({ newActualCostUsd: result.actualCostUsd, rows: rows.map(r=>({model:r.modelLabel,currency:r.currency,costUsd:r.costUsd,
  average:r.evaluation.quality.average,corrections:r.evaluation.assessment.requiredCorrections,url:r.url})), publicationApproved:false },null,2))
