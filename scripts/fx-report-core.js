const PRIMARY_CURRENCIES = ['BRL', 'MXN', 'CLP', 'COP', 'ARS', 'PEN']
const ANOMALY_CURRENCIES = ['GTQ', 'PYG', 'UYU', 'CNY']
const ALL_REPORT_CURRENCIES = [...PRIMARY_CURRENCIES, ...ANOMALY_CURRENCIES]
const FORBIDDEN_AI_PATTERNS = [
  /<\/?[a-z][^>]*>/i,
  /(?:매수|매도|투자\s*권고|목표\s*환율|목표가)/,
  /(?:will|guaranteed|certain to)\s+(?:rise|fall)/i,
  /\b(?:buy|sell)\b/i,
  /\d/,
]

const CURRENCY_TERMS = {
  BRL: ['brl', 'brazil', 'brazilian', 'real'],
  MXN: ['mxn', 'mexico', 'mexican', 'peso'],
  CLP: ['clp', 'chile', 'chilean'],
  COP: ['cop', 'colombia', 'colombian'],
  ARS: ['ars', 'argentina', 'argentine'],
  PEN: ['pen', 'peru', 'peruvian', 'sol'],
  GTQ: ['gtq', 'guatemala', 'quetzal'],
  PYG: ['pyg', 'paraguay', 'guarani'],
  UYU: ['uyu', 'uruguay', 'uruguayan'],
  CNY: ['cny', 'china', 'chinese', 'yuan', 'renminbi'],
  USD: ['usd', 'dollar', 'federal reserve', 'fed'],
}

function finiteNumber(value) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function percentChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null
  return round(((current - previous) / previous) * 100)
}

function average(values) {
  const valid = values.filter(Number.isFinite)
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null
}

function standardDeviation(values) {
  const mean = average(values)
  if (mean === null || values.length < 2) return null
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length)
}

function normalizeText(value, maxLength = 240) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value ?? ''))
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function articleTimestamp(article) {
  const raw = String(article.time_published ?? article.publishedAt ?? '')
  if (/^\d{8}T\d{6}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`
  }
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function normalizeNewsEvidence(articles, limit = 8) {
  const seen = new Set()
  const evidence = []

  for (const article of Array.isArray(articles) ? articles : []) {
    const title = normalizeText(article.title, 180)
    const url = normalizeUrl(article.url)
    if (!title || !url) continue
    const dedupeKey = `${title.toLowerCase()}|${url}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    const haystack = `${title} ${normalizeText(article.summary, 480)}`.toLowerCase()
    const currencies = Object.entries(CURRENCY_TERMS)
      .filter(([, terms]) => terms.some((term) => haystack.includes(term)))
      .map(([currency]) => currency)
    evidence.push({
      id: `news-${evidence.length + 1}`,
      title,
      source: normalizeText(article.source, 80) || '공개 뉴스',
      url,
      publishedAt: articleTimestamp(article),
      currencies,
      summary: normalizeText(article.summary, 360),
    })
    if (evidence.length >= limit) break
  }

  return evidence
}

function rowsFor(dataset, currency, rateType = 'LOCAL_PER_USD') {
  const rows = (dataset.dailyRates ?? [])
    .filter((row) => row.currency === currency && row.rateType === rateType && row.date <= dataset.baseDate)
    .map((row) => ({ ...row, value: finiteNumber(row.value) }))
    .filter((row) => row.value !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
  const observed = rows.filter((row) => row.source !== 'IMPUTED' && (!row.imputationMethod || row.imputationMethod === 'NONE'))
  return observed.length >= 2 ? observed : rows
}

function percentilePosition(values, current) {
  if (!values.length || !Number.isFinite(current)) return null
  const atOrBelow = values.filter((value) => value <= current).length
  return round((atOrBelow / values.length) * 100, 1)
}

function metricFor(dataset, currency, rateType = 'LOCAL_PER_USD') {
  const rows = rowsFor(dataset, currency, rateType)
  const latest = rows.at(-1)
  if (!latest) return null
  const previous = rows.at(-2)
  const fiveDay = rows.at(-6)
  const thirtyDay = rows.at(-31)
  const monthStart = rows.find((row) => row.date.slice(0, 7) === dataset.baseDate.slice(0, 7))
  const cutoff = new Date(`${latest.date}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - 364)
  const cutoffDate = cutoff.toISOString().slice(0, 10)
  const yearRows = rows.filter((row) => row.date >= cutoffDate)
  const dailyChanges = yearRows.slice(1).map((row, index) => percentChange(row.value, yearRows[index].value)).filter(Number.isFinite)
  const latestChange = percentChange(latest.value, previous?.value)
  const meanChange = average(dailyChanges)
  const sd = standardDeviation(dailyChanges)

  return {
    currency,
    rateType,
    latestDate: latest.date,
    latest: round(latest.value, 8),
    previous: previous ? round(previous.value, 8) : null,
    dayPct: latestChange,
    fiveDayPct: percentChange(latest.value, fiveDay?.value),
    mtdPct: percentChange(latest.value, monthStart?.value),
    thirtyDayPct: percentChange(latest.value, thirtyDay?.value),
    percentile52w: percentilePosition(yearRows.map((row) => row.value), latest.value),
    volatilityZ: sd && latestChange !== null && meanChange !== null ? round((latestChange - meanChange) / sd, 2) : null,
    observationCount: rows.length,
  }
}

function planDelta(planValue, actualValue) {
  if (!Number.isFinite(planValue) || !Number.isFinite(actualValue) || actualValue === 0) return null
  return round(((actualValue - planValue) / planValue) * 100)
}

function movementHeadline(metric) {
  if (metric.currency === 'USD/KRW') {
    if (Math.abs(metric.dayPct ?? 0) < 0.05) return 'USD/KRW가 보합권에 머물렀습니다.'
    return metric.dayPct > 0 ? 'USD/KRW 상승과 원화 약세가 주요 움직임으로 관찰됐습니다.' : 'USD/KRW 하락과 원화 강세가 주요 움직임으로 관찰됐습니다.'
  }
  if (Math.abs(metric.dayPct ?? 0) < 0.05) return `${metric.currency}/USD 환율이 보합권에 머물렀습니다.`
  return metric.dayPct > 0
    ? `${metric.currency}/USD 환율 상승과 현지통화 약세가 주요 움직임으로 관찰됐습니다.`
    : `${metric.currency}/USD 환율 하락과 현지통화 강세가 주요 움직임으로 관찰됐습니다.`
}

function formatPct(value) {
  if (!Number.isFinite(value)) return '-'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function confidenceFor(metrics, news) {
  const complete = metrics.filter((metric) => metric?.dayPct !== null && metric?.thirtyDayPct !== null).length
  if (complete >= 6 && news.length >= 2) return 'high'
  if (complete >= 5) return 'medium'
  return 'low'
}

function fact(metric, horizon, value, label) {
  return {
    id: `fact-${metric.currency.toLowerCase()}-${horizon}`,
    currency: metric.currency,
    horizon,
    value,
    label,
  }
}

export function buildFxReportEvidence(dataset, businessPlan = { leading: {}, moving: {} }, articles = []) {
  if (!dataset?.baseDate) throw new Error('FX dataset is missing baseDate.')

  const primaryMetrics = PRIMARY_CURRENCIES.map((currency) => metricFor(dataset, currency)).filter(Boolean)
  const anomalyMetrics = ANOMALY_CURRENCIES.map((currency) => metricFor(dataset, currency))
    .filter((metric) => metric && (Math.abs(metric.volatilityZ ?? 0) >= 2 || Math.abs(metric.dayPct ?? 0) >= 1))
  const usdKrw = metricFor(dataset, 'USD', 'KRW')
  const metrics = [...primaryMetrics, ...anomalyMetrics, ...(usdKrw ? [{ ...usdKrw, currency: 'USD/KRW' }] : [])]
    .map((metric) => ({
      ...metric,
      leadingPlan: metric.currency === 'USD/KRW' ? null : finiteNumber(businessPlan.leading?.[metric.currency]),
      movingPlan: metric.currency === 'USD/KRW' ? null : finiteNumber(businessPlan.moving?.[metric.currency]),
      leadingPlanDeltaPct: metric.currency === 'USD/KRW' ? null : planDelta(finiteNumber(businessPlan.leading?.[metric.currency]), metric.latest),
      movingPlanDeltaPct: metric.currency === 'USD/KRW' ? null : planDelta(finiteNumber(businessPlan.moving?.[metric.currency]), metric.latest),
    }))
  const news = normalizeNewsEvidence(articles)
  const facts = metrics.flatMap((item) => [
    fact(item, 'day', item.dayPct, `${item.currency} 일간 ${formatPct(item.dayPct)}`),
    fact(item, 'five_day', item.fiveDayPct, `${item.currency} 5영업일 ${formatPct(item.fiveDayPct)}`),
    fact(item, 'mtd', item.mtdPct, `${item.currency} 월초 대비 ${formatPct(item.mtdPct)}`),
    fact(item, 'thirty_day', item.thirtyDayPct, `${item.currency} 30영업일 ${formatPct(item.thirtyDayPct)}`),
    fact(item, 'percentile_52w', item.percentile52w, `${item.currency} 52주 위치 ${item.percentile52w ?? '-'}%`),
    fact(item, 'leading_plan_delta', item.leadingPlanDeltaPct, `${item.currency} 선행 계획 대비 ${formatPct(item.leadingPlanDeltaPct)}`),
    fact(item, 'moving_plan_delta', item.movingPlanDeltaPct, `${item.currency} 이동 계획 대비 ${formatPct(item.movingPlanDeltaPct)}`),
  ]).filter((item) => item.value !== null)

  return {
    version: '2.0.0',
    baseDate: dataset.baseDate,
    generatedAt: new Date().toISOString(),
    dataFetchedAt: dataset.fetchedAt ?? null,
    metrics,
    facts,
    news,
    confidence: confidenceFor(metrics, news),
  }
}

function relatedNewsIds(news, currency) {
  const code = currency === 'USD/KRW' ? 'USD' : currency
  return news.filter((item) => item.currencies.includes(code)).slice(0, 2).map((item) => item.id)
}

export function buildDeterministicReport(evidence) {
  const ranked = evidence.metrics
    .filter((metric) => Number.isFinite(metric.dayPct))
    .sort((a, b) => Math.abs(b.dayPct) - Math.abs(a.dayPct))
  const top = ranked.slice(0, 3)
  const anomalyCount = evidence.metrics.filter((metric) => Math.abs(metric.volatilityZ ?? 0) >= 2).length
  const planItems = evidence.metrics
    .filter((metric) => metric.currency !== 'USD/KRW' && Number.isFinite(metric.movingPlanDeltaPct))
    .sort((a, b) => Math.abs(b.movingPlanDeltaPct) - Math.abs(a.movingPlanDeltaPct))
    .slice(0, 3)

  const headline = top.length
    ? movementHeadline(top[0])
    : '당일 환율 변동을 판단할 수 있는 데이터가 충분하지 않습니다.'
  const executiveSummary = [
    headline,
    anomalyCount
      ? `통상 변동 범위를 벗어난 움직임이 ${anomalyCount}개 통화에서 감지됐습니다.`
      : '통상 변동 범위를 크게 벗어난 움직임은 제한적입니다.',
    evidence.news.length
      ? '선별 뉴스는 가능한 배경으로만 제시하며 가격 움직임의 직접 원인으로 단정하지 않습니다.'
      : '확인 가능한 뉴스 근거가 제한적이므로 가격 데이터 중심으로 해석했습니다.',
  ]

  return {
    headline,
    executiveSummary,
    keyMoves: top.map((metric) => ({
      currency: metric.currency,
      text: `${metric.currency}는 전일 대비 ${formatPct(metric.dayPct)}, 5영업일 대비 ${formatPct(metric.fiveDayPct)}를 기록했습니다.`,
      factIds: [`fact-${metric.currency.toLowerCase()}-day`, `fact-${metric.currency.toLowerCase()}-five_day`],
      evidenceIds: relatedNewsIds(evidence.news, metric.currency),
    })),
    planObservations: planItems.length
      ? planItems.map((metric) => ({
          currency: metric.currency,
          text: `${metric.currency} 현재값은 이동 계획환율 대비 ${formatPct(metric.movingPlanDeltaPct)} 편차입니다.`,
          factIds: [`fact-${metric.currency.toLowerCase()}-moving_plan_delta`],
          evidenceIds: [],
        }))
      : [{ currency: null, text: '비교 가능한 이동 계획환율이 없어 편차 판단을 생략했습니다.', factIds: [], evidenceIds: [] }],
    scenarios: [
      '최근 변동 방향이 이어지는지 다음 영업일 가격과 변동성 범위를 함께 확인합니다.',
      '가격과 뉴스 흐름이 엇갈리면 뉴스 인과관계를 확대 해석하지 않습니다.',
      '계획환율 편차가 확대되는 통화는 월 누적 평균과 함께 재확인합니다.',
    ],
    confidence: evidence.confidence,
    limitations: [
      '이 보고서는 관찰된 환율과 공개 뉴스에 대한 자동 분석이며 전망이나 투자 권고가 아닙니다.',
      evidence.news.length ? '뉴스는 가능한 배경이며 환율 변동의 직접 원인을 증명하지 않습니다.' : '확인 가능한 뉴스 근거가 제한적입니다.',
    ],
  }
}

function allAiTexts(candidate) {
  return [
    candidate?.headline,
    ...(candidate?.executiveSummary ?? []),
    ...(candidate?.keyMoves ?? []).map((item) => item.text),
    ...(candidate?.planObservations ?? []).map((item) => item.text),
    ...(candidate?.scenarios ?? []),
    ...(candidate?.limitations ?? []),
  ].filter((value) => typeof value === 'string')
}

function isReportShape(candidate) {
  const strings = (value, min = 0, max = Infinity) => Array.isArray(value) && value.length >= min && value.length <= max && value.every((item) => typeof item === 'string')
  const statements = (value) => Array.isArray(value) && value.length <= 3 && value.every((item) =>
    item && typeof item === 'object' && (item.currency === null || typeof item.currency === 'string') &&
    typeof item.text === 'string' && strings(item.factIds) && strings(item.evidenceIds),
  )
  return Boolean(
    candidate && typeof candidate === 'object' &&
    typeof candidate.headline === 'string' &&
    strings(candidate.executiveSummary, 1, 3) &&
    statements(candidate.keyMoves) &&
    statements(candidate.planObservations) &&
    strings(candidate.scenarios, 1, 3) &&
    ['high', 'medium', 'low'].includes(candidate.confidence) &&
    strings(candidate.limitations, 0, 3)
  )
}

export function validateAiReport(candidate, evidence) {
  const errors = []
  if (!isReportShape(candidate)) errors.push('schema')
  const factIds = new Set(evidence.facts.map((item) => item.id))
  const factsById = new Map(evidence.facts.map((item) => [item.id, item]))
  const evidenceIds = new Set(evidence.news.map((item) => item.id))
  const currencies = new Set(evidence.metrics.map((item) => item.currency))

  for (const item of [...(candidate?.keyMoves ?? []), ...(candidate?.planObservations ?? [])]) {
    if (item.currency !== null && !currencies.has(item.currency)) errors.push('currency')
    if (!Array.isArray(item.factIds) || item.factIds.some((id) => !factIds.has(id))) errors.push('fact_id')
    if (!Array.isArray(item.evidenceIds) || item.evidenceIds.some((id) => !evidenceIds.has(id))) errors.push('evidence_id')
    if (item.currency && item.factIds?.some((id) => factsById.get(id)?.currency !== item.currency)) errors.push('fact_currency')
    if (item.evidenceIds?.length && !item.factIds?.length) errors.push('unsupported_causality')
  }

  for (const text of allAiTexts(candidate)) {
    if (text.length > 320) errors.push('length')
    if (FORBIDDEN_AI_PATTERNS.some((pattern) => pattern.test(text))) errors.push('forbidden_content')
    if (/\b[A-Z]{3}(?:\/[A-Z]{3})?\b/g.test(text)) {
      const mentioned = text.match(/\b[A-Z]{3}(?:\/[A-Z]{3})?\b/g) ?? []
      if (mentioned.some((code) => !currencies.has(code))) errors.push('currency')
    }
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

export const FX_REPORT_PRIMARY_CURRENCIES = PRIMARY_CURRENCIES
export const FX_REPORT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'executiveSummary', 'keyMoves', 'planObservations', 'scenarios', 'confidence', 'limitations'],
  properties: {
    headline: { type: 'string', maxLength: 160 },
    executiveSummary: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', maxLength: 240 } },
    keyMoves: { type: 'array', maxItems: 3, items: { $ref: '#/$defs/item' } },
    planObservations: { type: 'array', maxItems: 3, items: { $ref: '#/$defs/item' } },
    scenarios: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', maxLength: 240 } },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    limitations: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 240 } },
  },
  $defs: {
    item: {
      type: 'object', additionalProperties: false,
      required: ['currency', 'text', 'factIds', 'evidenceIds'],
      properties: {
        currency: { type: ['string', 'null'] },
        text: { type: 'string', maxLength: 320 },
        factIds: { type: 'array', items: { type: 'string' } },
        evidenceIds: { type: 'array', items: { type: 'string' } },
      },
    },
  },
}
