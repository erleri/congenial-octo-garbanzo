import { createHash } from 'node:crypto'
import Ajv from 'ajv'
import { MECHANISMS, MECHANISM_VERSION } from './mechanisms.js'
import { inspectEditorial, EDITORIAL_VERSION, assessReaderReview } from './editorial.js'
import { validateContent } from './core.js'
import { reviewSentences } from './report-text.js'
import { periodicPlan, periodicDraftIssues } from './periodic-check.js'
import { PERIODIC_WRITING_VERSION } from './periodic-editing.js'
import {projectFxWritingBackground} from './fx-writing-background.js'
import {assertSharedPacket} from './shared-writing-contract.js'
import {isOfficialSnapshotBackground} from './official-statistic-availability.js'
import {validMarketPeriod,samePeriod} from './news-period.js'

export const RULE_VERSION = 'currency-rules/9'
export const RULES = {
  R01: '새 정보와 검증된 비교', R02: '사건·전달 경로·통화 연결', R03: '사실·귀속 해석·일반 원리 구분',
  R04: '기간·통화·근거 직접성과 중요도', R05: '중복 없는 선별', R06: '조건부 영업 의미',
  R07: '공통 한계와 중요한 반대 근거', R08: '관찰의 판단 목적', R09: '발행 가치와 원래 기준일 유지',
  R10: '제목·요약을 포함한 주장 근거', R11: '구조·수치·방향·개인정보', R12: '버전·적용 조건·검토 기록',
}
export const SEMANTIC_RULES = Object.keys(RULES).filter(id => !['R11', 'R12'].includes(id))
export const ruleHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const registryHash = ruleHash(MECHANISMS)
export const packetBinding = p => ruleHash({ currency: p.currency, baseDate: p.baseDate, observedDate: p.observedDate,
  observationAt: p.observationAt, marketData: p.marketData, facts: p.facts, series: p.series, evidence: p.evidence,
  ...(p.periodicCheck ? { periodicCheck: p.periodicCheck } : {}),
  ...(p.fxWritingBackground ? {fxWritingBackground:p.fxWritingBackground} : {}),
  ...(p.fxWritingFocus ? {fxWritingFocus:p.fxWritingFocus} : {}),
  ...(p.sharedReference ? {sharedReference:p.sharedReference} : {}) })
const issue = (ruleId, reason, location = 'report', status = 'hold') => ({ ruleId, status, location, reason })
const safe = text => !/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|-----BEGIN .*PRIVATE KEY|bearer\s+\S+|<[^>]+>|ignore\s+(previous|all)|system\s*prompt|지시.*무시/i.test(text)
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const meaningful = value => typeof value === 'string' && value.trim().length >= 10
// Completeness only. Length is not evidence of an economic connection.
const present = value => typeof value === 'string' && /[\p{L}\p{N}]/u.test(value)

// Selection order is not an importance/truth verdict. It never counts coverage or headlines.
export function rankEvidence(packet) {
  return packet.evidence.filter(e => ['GLOBAL', packet.currency].includes(e.country) && date(e.eventDate) &&
    e.eventDate <= packet.baseDate && date(e.publishedAt?.slice(0, 10)) && e.publishedAt.slice(0, 10) <= packet.baseDate)
    .map((e, index) => ({ e, index, rank: [e.eventDate === packet.baseDate ? 1 : 0, e.country === packet.currency ? 1 : 0,
      e.review?.originalVerified === true ? 2 : e.provenance === 'official' ? 1 : 0,
      e.publishedAt.slice(0, 10) === packet.baseDate ? 1 : 0] }))
    .sort((a, b) => { for (let i = 0; i < a.rank.length; i++) { const d = b.rank[i] - a.rank[i]; if (d) return d } return a.index - b.index })
    .map(({ e }) => e)
}

// Only local reviewer-authored packet metadata supplies applications; never model output.
export function selectMechanisms(packet) {
  const selected = [], checks = [], seen = new Set()
  if (packet.mechanismApplications !== undefined && !Array.isArray(packet.mechanismApplications))
    return { selected, checks: [issue('R12', '원리 적용 기록은 배열이어야 함')] }
  const eligibleIds = new Set(rankEvidence(packet).map(e => e.id))
  const factIds = new Set((packet.facts ?? []).filter(f => Number.isFinite(f.value)).map(f => f.id))
  const conditionValid = (c, i, m) => {
    if (c?.condition !== m.conditions[i] || !meaningful(c.support) || !Array.isArray(c.evidenceIds)) return false
    if (c.basis === undefined) return c.evidenceIds.length > 0 && c.evidenceIds.every(id => eligibleIds.has(id))
    // Arithmetic may depend on calculated facts and an explicitly hypothetical
    // exposure. Do not attach an unrelated newspaper ID to invent that exposure.
    if (m.id !== 'usd-payment-conversion' || c.evidenceIds.length) return false
    if (i === 0) return c.basis?.type === 'facts' && c.basis.convention === 'LOCAL_PER_USD' &&
      Array.isArray(c.basis.factIds) && c.basis.factIds.includes('spot') && c.basis.factIds.some(id => ['day', 'five', 'mtd'].includes(id)) &&
      c.basis.factIds.every(id => factIds.has(id)) && packet.facts.find(f => f.id === 'spot')?.value > 0
    return c.basis?.type === 'conditional' && JSON.stringify(c.basis.assumptions) === JSON.stringify(['equal_usd_amount', 'unhedged']) &&
      JSON.stringify(c.basis.exceptions) === JSON.stringify(['hedging', 'prepayment', 'fixed_contract_rate'])
  }
  for (const raw of packet.mechanismApplications ?? []) {
    const a = raw ?? {}
    const m = MECHANISMS.find(m => m.id === a.mechanismId)
    const valid = m && !seen.has(a.id) && /^[a-z][a-z0-9-]{0,59}$/.test(a.id) &&
      a.version === MECHANISM_VERSION && a.registryHash === registryHash && a.packetHash === packetBinding(packet) &&
      a.currency === packet.currency && a.baseDate === packet.baseDate && a.review?.origin === 'human' &&
      a.review?.status === 'pass' && meaningful(a.review?.reason) &&
      Array.isArray(a.conditions) && a.conditions.length === m.conditions.length && a.conditions.every((c, i) => conditionValid(c, i, m)) &&
      meaningful(a.counterevidence) && safe(JSON.stringify(a))
    if (!valid) { checks.push(issue('R12', '원리 적용 검토 누락·오래된 버전·근거 불일치', a.id ?? 'application')); continue }
    seen.add(a.id)
    selected.push({ applicationId: a.id, mechanismId: m.id, version: m.version, title: m.title,
      allowed: m.allowed, prohibited: m.prohibited, conditions: a.conditions.map(({ condition, support, evidenceIds, basis }) => ({ condition, support, evidenceIds, ...(basis ? { basis: structuredClone(basis) } : {}) })), counterevidence: a.counterevidence,
      counterconditions: m.counterconditions, source: m.source })
  }
  return { selected, checks }
}

const text = { type: 'string', maxLength: 480 }
const refs = { type: 'array', maxItems: 6, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 80 } }
export const ledgerSchema = {
  type: 'object', additionalProperties: false, required: ['ruleVersion', 'mechanismVersion', 'currency', 'baseDate', 'claims'],
  properties: {
    assembly: { type: 'string', enum: ['writer-links/1'] },
    ruleVersion: { type: 'string', enum: [RULE_VERSION] }, mechanismVersion: { type: 'string', enum: [MECHANISM_VERSION] },
    currency: { type: 'string' }, baseDate: { type: 'string' },
    claims: { type: 'array', minItems: 1, maxItems: 60, items: {
      type: 'object', additionalProperties: false,
      required: ['target', 'quote', 'kind', 'factIds', 'evidenceIds', 'mechanismId', 'applicationId', 'eventKey', 'pathwayKey', 'newInformation', 'transmission', 'currencyConnection', 'watchPurpose'],
      properties: { target: { type: 'string', pattern: '^(title|summary|(?:drivers|implications|watch)\\.[0-2]\\.(?:title|text))$',
        description: '본문 위치는 점 표기만 사용: title, summary, drivers.0.title, drivers.0.text, implications.0.text, watch.0.text. drivers[0].text 같은 괄호 표기는 금지.' },
        quote: { ...text, minLength: 1 }, kind: { type: 'string', enum: ['fact', 'interpretation', 'mechanism'] }, factIds: refs, evidenceIds: refs,
        mechanismId: { type: 'string', maxLength: 80 }, applicationId: { type: 'string', maxLength: 80 },
        eventKey: text, pathwayKey: text, newInformation: text, transmission: text, currencyConnection: text, watchPurpose: text },
    } },
  },
}
const validateLedger = new Ajv({ allErrors: true }).compile(ledgerSchema)
export function proseTargets(content) {
  return Object.fromEntries([['title', content.title], ['summary', content.summary],
    ...['drivers', 'implications', 'watch'].flatMap(section => (content[section] ?? []).flatMap((b, i) =>
      [['title', b.title], ['text', b.text]].map(([field, value]) => [`${section}.${i}.${field}`, value])))])
}
const normalize = value => value.replace(/\s+/gu, '')

// Writer instructions live in writing-contract.js; legacy ledgers remain readable offline.
export function evaluateRules({ packet, content, ledger, safety, review }) {
  const periodic = periodicPlan(packet)
  const checks = [], automatic = []
  const add = (id, reason, target) => automatic.push(issue(id, reason, target))
  let materialDate=packet.baseDate
  if(packet.sharedReference?.materialCutoff){
    try{assertSharedPacket(packet);materialDate=packet.sharedReference.materialCutoff.asOf.slice(0,10)}
    catch{add('R04','가격과 독립된 자료 기준시각 바인딩 불일치')}
  }
  let writingBackground=null
  if(packet.fxWritingBackground) {
    try {writingBackground=projectFxWritingBackground(packet)}
    catch {add('R12','영업 배경의 출처·이용·기간 바인딩 미검증')}
  }
  const consumerIds=new Set(writingBackground?.consumerContext?.sourceAttributions.map(s=>s.evidenceId)??[])
  if (periodic) periodicDraftIssues(packet, content ?? {}).forEach(reason => add('R04', reason))
  const rechecked = validateContent(content, packet)
  if (!safety?.valid || !rechecked.valid) add('R11', `기존 구조·수치·방향·보안 검사: ${[...(safety?.errors ?? ['미실행']), ...rechecked.errors].join(', ')}`)
  const usableContent = content && ['drivers', 'implications', 'watch'].every(key => Array.isArray(content[key]) && content[key].every(b => typeof b?.text === 'string' && typeof b?.title === 'string')) && typeof content.title === 'string' && typeof content.summary === 'string'
  if (!date(packet.baseDate) || !date(packet.observedDate) || packet.observedDate > packet.baseDate ||
    !packet.facts?.every(f => Number.isFinite(f.value))) add('R11', '기준일·관측일·수치 형식 오류')
  if (!safe(JSON.stringify({ content, ledger }))) add('R11', '비공개 정보·HTML·지시문 의심')
  const mechanisms = selectMechanisms(packet)
  automatic.push(...mechanisms.checks)
  const shapeOK = validateLedger(ledger)
  if (!shapeOK) add('R12', '주장 대응표 누락 또는 버전·구조 불일치')
  if (usableContent && shapeOK) {
    if (ledger.currency !== packet.currency || ledger.baseDate !== packet.baseDate) add('R04', '대응표 통화·기준일 불일치')
    const targets = proseTargets(content), events = new Map()
    for (const [target, prose] of Object.entries(targets)) {
      const rows = ledger.claims.filter(c => c.target === target)
      if (normalize(rows.map(c => c.quote).join('')) !== normalize(prose)) add('R10', '모든 문장에 순서대로 대응하는 근거 연결 필요', target)
      const [section, index, field] = target.split('.')
      const block = content[section]?.[Number(index)]
      if (field === 'text' && block?.kind === 'mechanism' && !rows.some(c => c.kind === 'mechanism')) add('R03', '일반 원리를 근거 해석으로 낮춰 표시한 대응표', target)
      if (block?.evidenceIds && rows.some(c => c.evidenceIds.some(id => !block.evidenceIds.includes(id)))) add('R10', '화면에 표시한 출처와 대응표 출처 불일치', target)
      // Current writer supplies prose + source links. Explanation quality belongs
      // to semantic/reader review, not a second model-authored paraphrase of prose.
      if (ledger.assembly !== 'writer-links/1' && target.startsWith('drivers.') && target.endsWith('.text')) {
        if (!rows.length || !rows.some(c => [c.newInformation, c.transmission, c.currencyConnection].every(present))) add('R02', '새 정보·전달 경로·통화 연결 누락', target)
        const keys = [...new Set(rows.map(c => `${c.eventKey}|${c.pathwayKey}`))]
        for (const key of keys) {
          if (key === '|' || (events.has(key) && events.get(key) !== target)) add('R05', '사건·전달 경로 중복 또는 식별 누락', target)
          events.set(key, target)
        }
      }
      if (ledger.assembly !== 'writer-links/1' && target.startsWith('watch.') && target.endsWith('.text') && !rows.some(c => present(c.watchPurpose))) add('R08', '변화·반응과 앞선 경로를 연결하는 관찰 목적 누락', target)
    }
    for (const c of ledger.claims) {
      if (reviewSentences(c.quote).length > 1) add('R10', '문장 단위로 근거 연결을 분리해야 함', c.target)
      if (!Object.hasOwn(targets, c.target)) add('R10', '없는 본문 위치', c.target)
      const approvedMechanism = mechanisms.selected.find(a => a.applicationId === c.applicationId && a.mechanismId === c.mechanismId)
      if ((!c.evidenceIds.length && !(c.kind === 'mechanism' && approvedMechanism)) || c.evidenceIds.some(id => !packet.evidence.some(e => e.id === id)) ||
        c.factIds.some(id => !packet.facts.some(f => f.id === id))) add('R10', '일별 근거 누락 또는 존재하지 않는 ID', c.target)
      for (const id of c.evidenceIds) {
        const e = packet.evidence.find(e => e.id === id)
        // Reviewed monthly statistics deliberately have no day-event timestamp.
        // Only their bound business-context positions may omit that timestamp;
        // release date, target month and use conditions were rechecked above.
        const sharedBackground=packet.sharedReference&&e?.sharedNotes?.claims.every(n=>['consumer_background','policy_background'].includes(n.role))
        const backgroundPosition=c.target.startsWith('implications.')||packet.sharedReference&&['title','summary'].includes(c.target)
        const monthlyBackground=backgroundPosition&&(consumerIds.has(id)||sharedBackground)&&e?.country===packet.currency&&e.eventDate===null
        const periodMarket=packet.sharedReference?.commentaryPeriod&&e?.eventDate===null&&validMarketPeriod(e.marketPeriod)
          &&samePeriod(e.marketPeriod,packet.sharedReference.commentaryPeriod)&&e.marketPeriod.end<=materialDate
          &&e.sharedNotes?.claims.length&&e.sharedNotes.claims.every(n=>samePeriod(n.marketPeriod,e.marketPeriod)&&n.sourceSessionDate===null)
        if (e && (!['GLOBAL', packet.currency].includes(e.country) || !date(e.eventDate)&&!monthlyBackground&&!periodMarket || e.eventDate > materialDate ||
          !date(e.publishedAt?.slice(0, 10))&&!(monthlyBackground&&isOfficialSnapshotBackground(e,packet.sharedReference?.materialCutoff?.asOf))
          ||e.publishedAt!=null&&e.publishedAt.slice(0, 10) > materialDate || !e.period?.trim())) add('R04', '출처 통화·기간·발표일 불일치', c.target)
        if (e?.scope === 'sales_context' && c.target.startsWith('drivers.')) add('R03', '소비 맥락을 당일 원인으로 사용', c.target)
      }
      if (c.kind === 'mechanism' || c.mechanismId || c.applicationId) {
        if (!approvedMechanism || !approvedMechanism.conditions.every(condition => condition.basis?.type === 'conditional' ||
          (condition.basis?.type === 'facts' ? condition.basis.factIds.every(id => c.factIds.includes(id)) : condition.evidenceIds.some(id => c.evidenceIds.includes(id)))))
          add('R12', '검증된 원리와 당일 적용 조건의 연결 누락', c.target)
      }
      // Deliberately narrow known regressions; semantic paraphrases still require review.
      if (/수입\s*비중.{0,8}(높|크)|환율.{0,12}보다.{0,12}(먼저|더\s*크)|효과.{0,8}(우선|가장\s*크)/u.test(c.quote))
        checks.push(issue('R06', '업종 노출·효과 순위의 별도 근거 검토 필요', c.target, 'unverified'))
    }
  }
  if (usableContent) {
    const editorial = inspectEditorial(content, { periodic: Boolean(periodic) })
    editorial.blockers.forEach(reason => add('R05', reason))
    editorial.warnings.forEach(reason => checks.push(issue(reason.includes('caveat') || reason.startsWith('periodic:scope') ? 'R07' : reason.startsWith('title:') || reason.startsWith('periodic:title') ? 'R10' : reason.startsWith('periodic:process') ? 'R05' : reason.startsWith('watch.') ? 'R08' : 'R02', reason, 'report', 'unverified')))
    for (const b of content.drivers) {
      if (normalize(b.text.split(/[.!?。！？]/u)[0]) === normalize(b.title)) checks.push(issue('R02', '제목 재진술 의심: 새 설명인지 확인', b.title, 'unverified'))
    }
    for (const [target, prose] of Object.entries(proseTargets(content))) {
      if (/수입\s*비중.{0,8}(높|크)|환율.{0,16}보다.{0,35}(먼저|더\s*크)|효과.{0,8}(우선|가장\s*크)/u.test(prose))
        checks.push(issue('R06', '업종 노출·효과 순위의 별도 근거 검토 필요', target, 'unverified'))
    }
  }
  if (!periodic && (packet.baseDate !== packet.observedDate || packet.assessment?.publishDecision?.eligible === false))
    add('R09', packet.assessment?.publishDecision?.reason ?? '새 관측일 없음')
  const binding = ruleHash({ ruleVersion: RULE_VERSION, editorialVersion: EDITORIAL_VERSION, registryHash, packetHash: packetBinding(packet),
    ...(periodic ? { periodicWritingVersion: PERIODIC_WRITING_VERSION } : {}),
    applications: packet.mechanismApplications ?? [], content, ledger })
  const bound = review?.binding === binding && review.ruleVersion === RULE_VERSION && review.origin === 'human' && meaningful(review.reviewer)
  const targets = usableContent ? Object.keys(proseTargets(content)) : []
  const perClaim = bound && shapeOK && ledger.claims.every((c, i) => {
    const r = review.claims?.[i]
    return r?.claimHash === ruleHash(c) && r.status === 'pass' && meaningful(r.reason)
  }) && review.claims.length === ledger.claims.length
  const contentChecks = SEMANTIC_RULES.map(ruleId => {
    const r = bound && review.checks?.[ruleId]
    return issue(ruleId, r && meaningful(r.reason) ? r.reason : '별도 내용 검토 필요', 'report',
      r?.status === 'hold' ? 'hold' : r?.status === 'pass' && meaningful(r.reason) && perClaim ? 'pass' : 'unverified')
  })
  if (!perClaim) contentChecks.push(issue('R10', `제목·요약 포함 ${targets.length}개 위치의 문장별 근거 검토 미완료`, 'report', 'unverified'))
  if (bound && review.claims?.some(r => r.status === 'hold')) contentChecks.push(issue('R10', '문장별 내용 검토에서 반려된 주장 있음', 'report', 'hold'))
  const readerReview = assessReaderReview(bound ? review.readerReview : undefined, { periodic: Boolean(periodic) })
  for (const c of readerReview.checks) {
    if (c.decision === 'rewrite' || c.decision === 'unverified') contentChecks.push(issue(
      { headlineConclusion: 'R10', transmissionSpecificity: 'R02', diagnosticWatch: 'R08', informationEconomy: 'R05' }[c.criterion],
      c.reason, `reader.${c.criterion}`, c.decision === 'rewrite' ? 'hold' : 'unverified'))
  }
  const scores = review?.scores
  const scoreValid = bound && Array.isArray(scores) && scores.length === (periodic ? 4 : 5) && scores.every(n => Number.isInteger(n) && n >= 1 && n <= 5)
  const quality = scoreValid && scores.reduce((a, b) => a + b, 0) / scores.length >= 4 && scores.at(-1) >= 4 && review.criticalErrors === 0
  if (!quality) contentChecks.push(issue('R12', '평균 4점·근거 4점·중대 오류 0건의 독립 검토 필요', 'report', scoreValid ? 'hold' : 'unverified'))
  const automaticStatus = automatic.length ? 'hold' : 'pass'
  const semanticStatus = contentChecks.some(c => c.status === 'hold') ? 'hold' : contentChecks.some(c => c.status !== 'pass') ? 'unverified' : 'pass'
  return { ruleVersion: RULE_VERSION, mechanismVersion: MECHANISM_VERSION, editorialVersion: EDITORIAL_VERSION,
    ...(periodic ? { purpose: 'periodic_check', periodicVersion: periodic.version, periodicWritingVersion: PERIODIC_WRITING_VERSION, periodicBinding: periodic.binding,
      scoreCriteria: ['changeClarity', 'checkUsefulness', 'readability', 'evidenceFidelity'] } : {}),
    binding, automaticStatus, semanticStatus, readerReview,
    status: automaticStatus === 'hold' || semanticStatus === 'hold' ? 'hold' : semanticStatus,
    checks: [...automatic, ...checks, ...contentChecks], publicationApproved: false }
}

// General-principle sources remain separate from the market packet and cannot become triggers.
export function mechanismEvidence(packet, ledger) {
  return selectMechanisms(packet).selected.filter((m, i, all) => all.findIndex(x => x.mechanismId === m.mechanismId) === i && ledger?.claims.some(c => c.mechanismId === m.mechanismId)).map(m => ({ id: `principle-${m.mechanismId}`, country: 'GLOBAL',
    url: m.source.url, publisher: m.source.publisher, title: `일반 원리: ${m.title}`, publishedAt: '', eventDate: '',
    collectedAt: m.source.checkedAt, period: '일반 원리 — 당일 사건 아님', summary: `${m.allowed}. ${m.source.scope}`,
    scope: 'sales_context', role: 'context', causalStatus: 'contextual' }))
}
