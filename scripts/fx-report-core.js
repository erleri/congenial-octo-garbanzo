const PRIMARY_CURRENCIES = ['BRL', 'MXN', 'CLP', 'COP', 'ARS', 'PEN']
const ANOMALY_CURRENCIES = ['GTQ', 'PYG', 'UYU', 'CNY']
const ALL_REPORT_CURRENCIES = [...PRIMARY_CURRENCIES, ...ANOMALY_CURRENCIES]
const EDITORIAL_CONTEXT_TAGS = [
  'broad_usd',
  'local_factor_possible',
  'policy_possible',
  'commodity_possible',
  'risk_sentiment_possible',
  'insufficient_evidence',
]
const EDITORIAL_SCENARIO_TAGS = [
  'direction_persistence',
  'volatility_range',
  'news_divergence',
  'plan_gap',
  'usd_krw_spillover',
]
const FORBIDDEN_AI_PATTERNS = [
  /<\/?[a-z][^>]*>/i,
  /(?:매수|매도|투자\s*권고|목표\s*환율|목표가)/,
  /(?:상승|하락|강세|약세|오름|내림)/,
  /(?:때문에|로\s*인해|의\s*영향으로|덕분에)/,
  /(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|십|백|천)\s*(?:퍼센트|프로|배)(?![가-힣A-Za-z])/,
  /https?:\/\/|www\./i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:will|guaranteed|certain to)\s+(?:rise|fall)/i,
  /\b(?:buy|sell)\b/i,
  /(?:ignore\s+(?:all\s+)?previous\s+instructions|system\s+prompt|reveal\s+secrets)/i,
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

function factCurrencyCode(currency) {
  return currency === 'USD/KRW' ? 'USD' : currency
}

function contextSentence(tag, hasEvidence) {
  if (!hasEvidence || tag === 'insufficient_evidence') return '확인 가능한 뉴스 근거가 제한적이므로 가격 흐름을 중심으로 확인합니다.'
  const sentences = {
    broad_usd: '선별된 달러 관련 뉴스는 광범위한 외환시장 배경으로 함께 확인합니다.',
    local_factor_possible: '선별된 현지 뉴스는 가능한 배경으로 함께 확인합니다.',
    policy_possible: '선별된 정책 관련 뉴스는 가능한 배경으로 함께 확인합니다.',
    commodity_possible: '선별된 원자재 관련 뉴스는 가능한 배경으로 함께 확인합니다.',
    risk_sentiment_possible: '선별된 위험선호 관련 뉴스는 가능한 배경으로 함께 확인합니다.',
  }
  return sentences[tag] ?? sentences.local_factor_possible
}

const SCENARIO_SENTENCES = {
  direction_persistence: '최근 변동 방향이 이어지는지 다음 영업일 가격을 확인합니다.',
  volatility_range: '단기 변동성이 통상 범위로 돌아오는지 함께 확인합니다.',
  news_divergence: '가격과 뉴스 흐름이 엇갈리면 인과관계를 확대 해석하지 않습니다.',
  plan_gap: '계획환율 편차가 확대되는 통화는 월 누적 평균과 함께 재확인합니다.',
  usd_krw_spillover: 'USD/KRW 움직임이 중남미 통화 환산 결과에 미치는 범위를 함께 확인합니다.',
}

function planObservationFromFact(item, evidence) {
  const factItem = evidence.facts.find((entry) => entry.id === item.factId)
  const metric = evidence.metrics.find((entry) => entry.currency === factItem?.currency)
  if (!factItem || !metric) return null
  const planType = factItem.horizon === 'leading_plan_delta' ? '선행 계획환율' : '이동 계획환율'
  return {
    currency: factItem.currency,
    text: `${factItem.currency} 현재값은 ${planType} 대비 ${formatPct(factItem.value)} 편차입니다.`,
    factIds: [factItem.id],
    evidenceIds: [],
  }
}

export function renderEditorialReport(evidence, decision) {
  const firstLead = evidence.facts.find((item) => item.id === decision.leadFactIds[0])
  const firstMetric = evidence.metrics.find((item) => item.currency === firstLead?.currency)
  const headline = firstMetric
    ? movementHeadline(firstMetric)
    : '당일 환율 변동을 판단할 수 있는 데이터가 충분하지 않습니다.'
  const keyMoves = decision.keyMoves.map((item) => {
    const metric = evidence.metrics.find((entry) => entry.currency === item.currency)
    const baseText = metric
      ? `${metric.currency}는 전일 대비 ${formatPct(metric.dayPct)}, 5영업일 대비 ${formatPct(metric.fiveDayPct)}를 기록했습니다.`
      : `${item.currency}의 최신 가격 흐름을 확인합니다.`
    return {
      currency: item.currency,
      text: `${baseText} ${contextSentence(item.contextTag, item.evidenceIds.length > 0)}`,
      factIds: item.factIds,
      evidenceIds: item.evidenceIds,
    }
  })
  const planObservations = decision.planSelections
    .map((item) => planObservationFromFact(item, evidence))
    .filter(Boolean)
  const anomalyCount = evidence.metrics.filter((metric) => Math.abs(metric.volatilityZ ?? 0) >= 2).length

  return {
    headline,
    executiveSummary: [
      headline,
      anomalyCount
        ? `통상 변동 범위를 벗어난 움직임이 ${anomalyCount}개 통화에서 감지됐습니다.`
        : '통상 변동 범위를 크게 벗어난 움직임은 제한적입니다.',
      keyMoves.some((item) => item.evidenceIds.length)
        ? '선별 뉴스는 가능한 배경으로만 제시하며 가격 움직임의 직접 원인으로 단정하지 않습니다.'
        : '확인 가능한 뉴스 근거가 제한적이므로 가격 데이터 중심으로 해석했습니다.',
    ],
    keyMoves,
    planObservations: planObservations.length
      ? planObservations
      : [{ currency: null, text: '비교 가능한 계획환율이 없거나 AI가 우선 관찰 대상으로 선택하지 않았습니다.', factIds: [], evidenceIds: [] }],
    scenarios: decision.scenarioTags.map((tag) => SCENARIO_SENTENCES[tag]),
    confidence: evidence.confidence,
    limitations: [
      '이 보고서는 관찰된 환율과 공개 뉴스에 대한 자동 분석이며 전망이나 투자 권고가 아닙니다.',
      evidence.news.length ? '뉴스는 가능한 배경이며 환율 변동의 직접 원인을 증명하지 않습니다.' : '확인 가능한 뉴스 근거가 제한적입니다.',
    ],
  }
}

function editorialDecisionShape(candidate) {
  const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value)
  return Boolean(
    exactKeys(candidate, ['leadFactIds', 'keyMoves', 'planSelections', 'scenarioTags', 'editorNote']) &&
    Array.isArray(candidate.leadFactIds) && candidate.leadFactIds.length >= 1 && candidate.leadFactIds.length <= 3 && candidate.leadFactIds.every((id) => typeof id === 'string') &&
    Array.isArray(candidate.keyMoves) && candidate.keyMoves.length >= 1 && candidate.keyMoves.length <= 3 && candidate.keyMoves.every((item) =>
      exactKeys(item, ['currency', 'factIds', 'evidenceIds', 'contextTag']) && typeof item.currency === 'string' &&
      Array.isArray(item.factIds) && item.factIds.length >= 1 && item.factIds.length <= 3 && item.factIds.every((id) => typeof id === 'string') &&
      Array.isArray(item.evidenceIds) && item.evidenceIds.length <= 2 && item.evidenceIds.every((id) => typeof id === 'string') &&
      EDITORIAL_CONTEXT_TAGS.includes(item.contextTag)) &&
    Array.isArray(candidate.planSelections) && candidate.planSelections.length <= 3 && candidate.planSelections.every((item) =>
      exactKeys(item, ['factId']) && typeof item.factId === 'string') &&
    Array.isArray(candidate.scenarioTags) && candidate.scenarioTags.length >= 1 && candidate.scenarioTags.length <= 3 && candidate.scenarioTags.every((tag) => EDITORIAL_SCENARIO_TAGS.includes(tag)) &&
    typeof candidate.editorNote === 'string' && candidate.editorNote.length <= 240
  )
}

export function validateEditorialDecision(candidate, evidence) {
  const errors = []
  if (!editorialDecisionShape(candidate)) errors.push('schema')
  const factsById = new Map(evidence.facts.map((item) => [item.id, item]))
  const newsById = new Map(evidence.news.map((item) => [item.id, item]))
  const currencies = new Set(evidence.metrics.map((item) => item.currency))
  const leadIds = Array.isArray(candidate?.leadFactIds) ? candidate.leadFactIds : []
  const keyMoves = Array.isArray(candidate?.keyMoves) ? candidate.keyMoves : []
  const planSelections = Array.isArray(candidate?.planSelections) ? candidate.planSelections : []
  const scenarioTags = Array.isArray(candidate?.scenarioTags) ? candidate.scenarioTags : []
  if (leadIds.some((id) => !factsById.has(id))) errors.push('fact_id')
  if (new Set(leadIds).size !== leadIds.length) errors.push('duplicate_selection')
  if (leadIds.some((id) => factsById.get(id)?.horizon !== 'day')) errors.push('lead_horizon')
  const moveFactIds = new Set(keyMoves.flatMap((item) => Array.isArray(item?.factIds) ? item.factIds : []))
  if (leadIds.some((id) => !moveFactIds.has(id))) errors.push('lead_coverage')

  for (const item of keyMoves) {
    const itemFactIds = Array.isArray(item?.factIds) ? item.factIds : []
    const itemEvidenceIds = Array.isArray(item?.evidenceIds) ? item.evidenceIds : []
    if (!currencies.has(item?.currency)) errors.push('currency')
    if (itemFactIds.some((id) => !factsById.has(id))) errors.push('fact_id')
    if (itemFactIds.some((id) => factsById.get(id)?.currency !== item?.currency)) errors.push('fact_currency')
    if (itemFactIds.some((id) => String(factsById.get(id)?.horizon).includes('plan_delta'))) errors.push('move_horizon')
    if (itemEvidenceIds.some((id) => !newsById.has(id))) errors.push('evidence_id')
    if (new Set(itemFactIds).size !== itemFactIds.length) errors.push('duplicate_selection')
    if (new Set(itemEvidenceIds).size !== itemEvidenceIds.length) errors.push('duplicate_selection')
    for (const id of itemEvidenceIds) {
      const codes = newsById.get(id)?.currencies ?? []
      if (!codes.includes(factCurrencyCode(item?.currency)) && !codes.includes('USD')) errors.push('evidence_currency')
    }
    if (item?.contextTag !== 'insufficient_evidence' && !itemEvidenceIds.length) errors.push('unsupported_context')
    if (item?.contextTag === 'insufficient_evidence' && itemEvidenceIds.length) errors.push('unsupported_context')
  }
  const selectedPlanIds = planSelections.map((item) => item?.factId)
  if (new Set(selectedPlanIds).size !== selectedPlanIds.length) errors.push('duplicate_selection')
  for (const item of planSelections) {
    const selected = factsById.get(item?.factId)
    if (!selected) errors.push('fact_id')
    else if (!['leading_plan_delta', 'moving_plan_delta'].includes(selected.horizon)) errors.push('plan_horizon')
  }
  if (new Set(scenarioTags).size !== scenarioTags.length) errors.push('duplicate_selection')
  if (FORBIDDEN_AI_PATTERNS.some((pattern) => pattern.test(candidate?.editorNote ?? ''))) errors.push('forbidden_content')
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

export function scoreEditorialDecision(candidate, evidence) {
  const validation = validateEditorialDecision(candidate, evidence)
  if (!validation.valid) return { score: 0, passed: false, threshold: 80, breakdown: {}, errors: validation.errors }
  const rankedDayFacts = evidence.metrics
    .filter((item) => Number.isFinite(item.dayPct))
    .sort((a, b) => Math.abs(b.dayPct) - Math.abs(a.dayPct))
    .slice(0, 3)
    .map((item) => `fact-${item.currency.toLowerCase()}-day`)
  const overlap = candidate.leadFactIds.filter((id) => rankedDayFacts.includes(id)).length
  const relevance = Math.round(25 * (overlap / Math.max(1, Math.min(3, rankedDayFacts.length))))
  const keyCurrencies = candidate.keyMoves.map((item) => item.currency)
  const grounding = candidate.keyMoves.every((item) => item.contextTag === 'insufficient_evidence' || item.evidenceIds.length) ? 25 : 0
  const nonRepetition = new Set(keyCurrencies).size === keyCurrencies.length && new Set(candidate.leadFactIds).size === candidate.leadFactIds.length ? 15 : 0
  const hasPlanData = evidence.facts.some((item) => ['leading_plan_delta', 'moving_plan_delta'].includes(item.horizon))
  const usefulness = (candidate.scenarioTags.length >= 2 ? 10 : 5) + (!hasPlanData || candidate.planSelections.length ? 10 : 0)
  const rendered = renderEditorialReport(evidence, candidate)
  const publicTexts = [rendered.headline, ...rendered.executiveSummary, ...rendered.keyMoves.map((item) => item.text), ...rendered.scenarios]
  const readability = publicTexts.every((text) => typeof text === 'string' && text.length > 0 && text.length <= 320) && new Set(publicTexts).size >= publicTexts.length - 1 ? 15 : 0
  const score = relevance + grounding + nonRepetition + usefulness + readability
  return {
    score,
    passed: score >= 80,
    threshold: 80,
    breakdown: { relevance, grounding, nonRepetition, usefulness, readability },
    errors: score >= 80 ? [] : ['quality_score'],
  }
}

export function buildBaselineEditorialDecision(evidence) {
  const ranked = evidence.metrics
    .filter((item) => Number.isFinite(item.dayPct))
    .sort((a, b) => Math.abs(b.dayPct) - Math.abs(a.dayPct))
    .slice(0, 3)
  const planSelections = evidence.facts
    .filter((item) => item.horizon === 'moving_plan_delta')
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 3)
    .map((item) => ({ factId: item.id }))
  return {
    leadFactIds: ranked.map((item) => `fact-${item.currency.toLowerCase()}-day`),
    keyMoves: ranked.map((item) => {
      const evidenceIds = relatedNewsIds(evidence.news, item.currency)
      return {
        currency: item.currency,
        factIds: [`fact-${item.currency.toLowerCase()}-day`, `fact-${item.currency.toLowerCase()}-five_day`].filter((id) => evidence.facts.some((factItem) => factItem.id === id)),
        evidenceIds,
        contextTag: evidenceIds.length ? 'local_factor_possible' : 'insufficient_evidence',
      }
    }),
    planSelections,
    scenarioTags: ['direction_persistence', 'volatility_range', ...(planSelections.length ? ['plan_gap'] : [])].slice(0, 3),
    editorNote: '가격 변동폭과 계획환율 편차를 기준으로 우선순위를 정했습니다.',
  }
}

export const FX_REPORT_PRIMARY_CURRENCIES = PRIMARY_CURRENCIES
export const FX_EDITORIAL_DECISION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['leadFactIds', 'keyMoves', 'planSelections', 'scenarioTags', 'editorNote'],
  properties: {
    leadFactIds: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: { type: 'string' } },
    keyMoves: { type: 'array', minItems: 1, maxItems: 3, items: { $ref: '#/$defs/move' } },
    planSelections: { type: 'array', maxItems: 3, items: { $ref: '#/$defs/plan' } },
    scenarioTags: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: { type: 'string', enum: EDITORIAL_SCENARIO_TAGS } },
    editorNote: { type: 'string', maxLength: 240 },
  },
  $defs: {
    move: {
      type: 'object', additionalProperties: false,
      required: ['currency', 'factIds', 'evidenceIds', 'contextTag'],
      properties: {
        currency: { type: 'string' },
        factIds: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: { type: 'string' } },
        evidenceIds: { type: 'array', maxItems: 2, uniqueItems: true, items: { type: 'string' } },
        contextTag: { type: 'string', enum: EDITORIAL_CONTEXT_TAGS },
      },
    },
    plan: {
      type: 'object', additionalProperties: false,
      required: ['factId'],
      properties: { factId: { type: 'string' } },
    },
  },
}
export const FX_REPORT_JSON_SCHEMA = FX_EDITORIAL_DECISION_JSON_SCHEMA
