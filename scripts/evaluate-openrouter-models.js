import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildFxReportEvidence } from './fx-report-core.js'
import { enhanceReportWithOpenRouter } from './openrouter-report.js'

const DEFAULT_MODELS = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
]
const DATA_PATH = path.resolve('data/fx-full-history.json')
const OUTPUT_DIR = path.resolve(process.env.FX_REPORT_EVAL_OUTPUT_DIR ?? 'fx-report-model-evaluation')

function clampDays(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? Math.min(20, Math.max(1, parsed)) : 10
}

export function selectEvaluationDates(dataset, requestedDays = 10) {
  const limit = clampDays(requestedDays)
  return [...new Set((dataset.dailyRates ?? [])
    .filter((row) => (
      row.currency === 'BRL' && row.rateType === 'LOCAL_PER_USD' && row.date <= dataset.baseDate &&
      row.source !== 'IMPUTED' && (!row.imputationMethod || row.imputationMethod === 'NONE')
    ))
    .map((row) => row.date))]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit)
    .reverse()
}

export function blindOrder(baseDate, models = DEFAULT_MODELS) {
  const parity = [...baseDate].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 2
  return parity ? [...models].reverse() : [...models]
}

function renderContent(content) {
  if (!content) return '_유효한 후보 없음_'
  const lines = [
    `**제목:** ${content.headline}`,
    '',
    '**핵심 요약**',
    ...(content.executiveSummary ?? []).map((item) => `- ${item}`),
    '',
    '**주요 움직임**',
    ...(content.keyMoves ?? []).map((item) => `- ${item.currency ?? '전체'}: ${item.text} (${item.factIds.join(', ') || '근거 없음'})`),
    '',
    '**계획환율 관찰**',
    ...(content.planObservations ?? []).map((item) => `- ${item.currency ?? '전체'}: ${item.text}`),
    '',
    '**시나리오**',
    ...(content.scenarios ?? []).map((item) => `- ${item}`),
    '',
    '**한계**',
    ...(content.limitations ?? []).map((item) => `- ${item}`),
  ]
  return lines.join('\n')
}

export function buildBlindReview(results, models = DEFAULT_MODELS) {
  const mapping = []
  const lines = [
    '# LATAM FX 모델 블라인드 비교',
    '',
    '이 문서는 게시·메일 발송과 분리된 평가 결과입니다. 각 날짜에서 문장 명료성, 재무 실무 유용성, 과장 없는 해석을 비교하십시오.',
    '',
    '> 제한: 과거 뉴스와 과거 계획환율을 재구성하지 않으므로 이번 평가는 환율 사실 기반 문장 품질과 검증 통과율을 중심으로 봅니다.',
    '',
  ]
  for (const baseDate of [...new Set(results.map((item) => item.baseDate))]) {
    lines.push(`## ${baseDate}`, '')
    const orderedModels = blindOrder(baseDate, models)
    orderedModels.forEach((model, index) => {
      const label = `후보 ${String.fromCharCode(65 + index)}`
      const result = results.find((item) => item.baseDate === baseDate && item.requestedModel === model)
      mapping.push({ baseDate, label, requestedModel: model, actualModel: result?.actualModel ?? null })
      lines.push(`### ${label}`, '')
      if (!result?.ok) {
        lines.push(`_생성 실패: ${result?.errorCode ?? 'unknown'}_`, '')
      } else {
        lines.push(renderContent(result.candidate), '')
      }
      lines.push('- 명료성 (1–5):', '- 실무 유용성 (1–5):', '- 절제된 해석 (1–5):', '- 선호 여부:', '')
    })
  }
  return { markdown: `${lines.join('\n')}\n`, mapping }
}

function errorCode(error) {
  if (Array.isArray(error?.validation?.errors) && error.validation.errors.length) return error.validation.errors.join(',')
  if (error?.status) return `http_${error.status}`
  if (error?.name === 'AbortError') return 'timeout'
  return 'openrouter_failure'
}

async function evaluateOne({ apiKey, model, evidence }) {
  const startedAt = Date.now()
  try {
    const result = await enhanceReportWithOpenRouter({ apiKey, model, evidence })
    return {
      baseDate: evidence.baseDate,
      requestedModel: model,
      actualModel: result.model,
      ok: true,
      durationMs: Date.now() - startedAt,
      validation: result.validation,
      candidate: result.candidate,
    }
  } catch (error) {
    return {
      baseDate: evidence.baseDate,
      requestedModel: model,
      actualModel: typeof error?.model === 'string' ? error.model : null,
      ok: false,
      durationMs: Date.now() - startedAt,
      errorCode: errorCode(error),
      error: error instanceof Error ? error.message : String(error),
      validation: error?.validation ?? null,
      candidate: null,
    }
  }
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured.')
  const dataset = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'))
  const models = (process.env.FX_REPORT_EVAL_MODELS ?? DEFAULT_MODELS.join(','))
    .split(',').map((item) => item.trim()).filter(Boolean)
  if (models.length !== 2) throw new Error('FX_REPORT_EVAL_MODELS must contain exactly two model IDs.')
  const dates = selectEvaluationDates(dataset, process.env.FX_REPORT_EVAL_DAYS)
  if (!dates.length) throw new Error('No observed BRL business dates are available for evaluation.')

  const results = []
  for (const baseDate of dates) {
    const evidence = buildFxReportEvidence({ ...dataset, baseDate }, { leading: {}, moving: {} }, [])
    for (const model of models) {
      console.log(`Evaluating ${baseDate} with ${model}`)
      results.push(await evaluateOne({ apiKey, model, evidence }))
    }
  }

  const { markdown, mapping } = buildBlindReview(results, models)
  const summary = models.map((model) => {
    const modelResults = results.filter((item) => item.requestedModel === model)
    return {
      model,
      attempts: modelResults.length,
      valid: modelResults.filter((item) => item.ok).length,
      averageDurationMs: Math.round(modelResults.reduce((sum, item) => sum + item.durationMs, 0) / modelResults.length),
      errors: modelResults.filter((item) => !item.ok).map((item) => ({ baseDate: item.baseDate, code: item.errorCode })),
    }
  })
  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(OUTPUT_DIR, 'blind-review.md'), markdown, 'utf8'),
    fs.writeFile(path.join(OUTPUT_DIR, 'mapping.json'), `${JSON.stringify(mapping, null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(OUTPUT_DIR, 'results.json'), `${JSON.stringify({ createdAt: new Date().toISOString(), dates, summary, results }, null, 2)}\n`, 'utf8'),
  ])
  console.log(`Wrote model evaluation artifacts to ${OUTPUT_DIR}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
