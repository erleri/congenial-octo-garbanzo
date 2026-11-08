const pct = (current, previous) => previous > 0 ? ((current - previous) / previous) * 100 : null
const quantile = (values, probability) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * probability
  const lower = Math.floor(position)
  const fraction = position - lower
  return sorted[lower] + ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]) * fraction
}

function movement(series) {
  const current = series.at(-1)
  const previous = series.at(-2)
  if (!current || !previous) throw new Error('insufficient_observations')
  const dailyPct = pct(current.value, previous.value)
  const baselineRows = series.slice(-62, -1)
  const priorAbsoluteMoves = baselineRows.slice(1).map((row, index) => Math.abs(pct(row.value, baselineRows[index].value))).filter(Number.isFinite)
  const absoluteDailyPct = Math.abs(dailyPct)
  const p80 = quantile(priorAbsoluteMoves, 0.8)
  const p95 = quantile(priorAbsoluteMoves, 0.95)
  const notableThreshold = Math.max(0.75, p80 ?? 0)
  const sharpThreshold = Math.max(1.5, p95 ?? 0)
  const severity = absoluteDailyPct >= sharpThreshold ? 'sharp' : absoluteDailyPct >= notableThreshold ? 'notable' : 'calm'
  const percentile = priorAbsoluteMoves.length
    ? (priorAbsoluteMoves.filter(value => value <= absoluteDailyPct).length / priorAbsoluteMoves.length) * 100
    : null
  return {
    observedDate: current.date,
    previousObservedDate: previous.date,
    dailyPct,
    absoluteDailyPct,
    direction: dailyPct > 0 ? 'local_weaker' : dailyPct < 0 ? 'local_stronger' : 'unchanged',
    severity,
    baseline: { observations: priorAbsoluteMoves.length, p80AbsoluteDailyPct: p80, p95AbsoluteDailyPct: p95, notableThreshold, sharpThreshold, percentile },
  }
}

const isTimed = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))

function evidenceTimeline(evidence, observationAt) {
  const observationCutoff = isTimed(observationAt) ? Date.parse(observationAt) : null
  return evidence.map(item => {
    const eventAt = isTimed(item.eventAt) ? item.eventAt : null
    const publishedAt = isTimed(item.publishedAt) ? item.publishedAt : null
    const timedAt = eventAt ?? publishedAt
    const happenedBeforeObservation = timedAt && observationCutoff !== null ? Date.parse(timedAt) <= observationCutoff : null
    return {
      evidenceId: item.id,
      scope: item.scope,
      role: item.role,
      causalStatus: item.causalStatus,
      timingPrecision: timedAt ? 'timestamp' : 'date_only',
      happenedBeforeObservation,
      triggerReady: item.role === 'trigger'
        && ['confirmed', 'source_attributed'].includes(item.causalStatus)
        && Boolean(timedAt)
        && happenedBeforeObservation === true,
    }
  })
}

export function assessEvidencePacket(packet) {
  const move = movement(packet.series)
  const timeline = evidenceTimeline(packet.evidence, packet.observationAt)
  const evidenceByScope = {
    global: timeline.filter(item => item.scope === 'global').map(item => item.evidenceId),
    country: timeline.filter(item => item.scope === 'country').map(item => item.evidenceId),
    salesContext: timeline.filter(item => item.scope === 'sales_context').map(item => item.evidenceId),
  }
  const timedTriggers = timeline.filter(item => item.triggerReady).map(item => item.evidenceId)
  let publishDecision
  if (move.severity === 'calm') publishDecision = { eligible: false, reason: 'no_material_change' }
  else if (move.severity === 'sharp' && !timedTriggers.length) publishDecision = { eligible: false, reason: 'sharp_move_without_timed_trigger' }
  else if (!packet.evidence.length) publishDecision = { eligible: false, reason: 'insufficient_evidence' }
  else publishDecision = { eligible: true, reason: 'review_required' }
  return {
    movement: move,
    timeline,
    evidenceByScope,
    timedTriggerEvidenceIds: timedTriggers,
    publishDecision,
    limitations: [
      ...(move.baseline.observations < 20 ? ['변동성 기준 표본이 20개 미만이므로 절대 변동률 하한을 우선 적용했습니다.'] : []),
      ...(!packet.observationAt ? ['환율 관측 시각이 없어 사건과 관측의 일중 선후 관계를 확정하지 않습니다.'] : []),
      ...(move.severity === 'sharp' && !timedTriggers.length ? ['급변과 시간 순서가 확인된 직접·출처 귀속 근거가 없어 원인 보고서를 생성하지 않습니다.'] : []),
      '시간상 먼저 발생한 사건도 환율 변동의 원인임을 단독으로 증명하지는 않습니다.',
    ],
  }
}

export function selectHistoricalCases(dataset, configuration = { extremes: { BRL: 3, MXN: 3, CLP: 2 }, controls: { BRL: 1, MXN: 1 } }) {
  const cases = []
  const currencies = new Set([...Object.keys(configuration.extremes ?? {}), ...Object.keys(configuration.controls ?? {})])
  for (const currency of currencies) {
    const unique = new Map()
    for (const row of dataset.dailyRates ?? []) {
      if (row.currency !== currency || row.rateType !== 'LOCAL_PER_USD' || row.source === 'IMPUTED' || (row.imputationMethod && row.imputationMethod !== 'NONE')) continue
      if (typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value <= 0) continue
      const weekday = new Date(`${row.date}T00:00:00Z`).getUTCDay()
      if (!weekday || weekday === 6) continue
      unique.set(row.date, { date: row.date, value: row.value })
    }
    const rows = [...unique.values()].sort((a, b) => a.date.localeCompare(b.date))
    const ranked = rows.slice(1).map((row, index) => ({
      currency,
      baseDate: row.date,
      previousObservedDate: rows[index].date,
      dailyPct: pct(row.value, rows[index].value),
      evidenceStatus: 'unresearched',
    }))
    const extremeLimit = configuration.extremes?.[currency] ?? 0
    const extremes = [...ranked].sort((a, b) => Math.abs(b.dailyPct) - Math.abs(a.dailyPct)).slice(0, extremeLimit)
      .map(item => ({ ...item, caseType: 'extreme' }))
    cases.push(...extremes)
    const controlLimit = configuration.controls?.[currency] ?? 0
    const recent = ranked.slice(-260).filter(item => item.dailyPct !== 0 && !extremes.some(extreme => extreme.baseDate === item.baseDate))
    cases.push(...recent.sort((a, b) => Math.abs(a.dailyPct) - Math.abs(b.dailyPct)).slice(0, controlLimit)
      .map(item => ({ ...item, caseType: 'calm_control' })))
  }
  return cases
}
