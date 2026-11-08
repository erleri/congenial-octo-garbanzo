import Ajv from 'ajv'
import { createHash } from 'node:crypto'
import { assessEvidencePacket } from './evidence-quality.js'
import { projectSourceContext } from './source-context.js'
import {sharedForeignCurrencyIssue,assertSharedPacket} from './shared-writing-contract.js'
import { isCodeOwnedPriceLimitation } from './price-limitations.js'

const text = { type: 'string', minLength: 1, maxLength: 480 }
const ids = { type: 'array', maxItems: 6, uniqueItems: true, items: { type: 'string', maxLength: 80 } }
const claim = {
  type: 'object', additionalProperties: false,
  required: ['title', 'text', 'kind', 'factIds', 'evidenceIds'],
  properties: { title: { ...text, maxLength: 70 }, text, kind: { enum: ['fact', 'interpretation', 'mechanism'] }, factIds: ids, evidenceIds: ids },
}
export const currencyContentSchema = {
  type: 'object', additionalProperties: false,
  required: ['title', 'summary', 'change', 'drivers', 'implications', 'watch', 'limitations'],
  properties: {
    title: { ...text, maxLength: 90 }, summary: { ...text, maxLength: 260 }, change: claim,
    drivers: { type: 'array', minItems: 1, maxItems: 3, items: claim },
    implications: { type: 'array', minItems: 0, maxItems: 2, items: claim },
    watch: { type: 'array', minItems: 0, maxItems: 2, items: claim },
    limitations: { type: 'array', minItems: 1, maxItems: 4, items: text },
  },
}
const validateShape = new Ajv({ allErrors: true }).compile(currencyContentSchema)
const initialContentSchema=structuredClone(currencyContentSchema)
initialContentSchema.properties.drivers.minItems=0
initialContentSchema.properties.drivers.maxItems=2
const validateInitialShape=new Ajv({allErrors:true}).compile(initialContentSchema)
const ISO = /^\d{4}-\d{2}-\d{2}$/
export function validDate(value) {
  return typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}
// Normalize only the period's start for future-period guards. This does not
// assert that a month/quarter is complete or change the source's display label.
export function referencePeriodStart(value) {
  if (validDate(value)) return value
  if (typeof value !== 'string') return null
  if (/^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/.test(value)&&validDate(value.slice(0,10))&&validDate(value.slice(11))&&value.slice(0,10)<=value.slice(11)) return value.slice(0,10)
  if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) return `${value}-01`
  if (/^\d{4}-Q[1-4]$/.test(value)) return `${value.slice(0,4)}-${String((Number(value.at(-1))-1)*3+1).padStart(2,'0')}-01`
  return null
}
const percent = (a, b) => b > 0 ? ((a - b) / b) * 100 : null
const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
// Korean substring matching must not confuse 적절하다/부적절하다 with currency 절하.
export const hasDirectionalText = value => /강세|약세|상승|하락|(?:^|[^가-힣])(?:평가)?절[상하]/u.test(value)

export function buildPacket(dataset, currency, baseDate, evidence = []) {
  if (!['BRL', 'MXN', 'CLP'].includes(currency) || !validDate(baseDate)) throw new Error('invalid_currency_or_date')
  if (baseDate > dataset.baseDate) throw new Error('future_dataset_date')
  const unique = new Map(), origins = new Map()
  for (const r of dataset.dailyRates ?? []) {
    if (r.currency !== currency || r.rateType !== 'LOCAL_PER_USD' || r.date > baseDate || !validDate(r.date)) continue
    // Weekend API carry-forwards are not independent business observations.
    const weekday = new Date(`${r.date}T00:00:00Z`).getUTCDay()
    if (!weekday || weekday === 6 || r.source === 'IMPUTED' || (r.imputationMethod && r.imputationMethod !== 'NONE')) continue
    if (typeof r.value !== 'number' || !Number.isFinite(r.value) || r.value <= 0) continue
    unique.set(r.date, { date: r.date, value: r.value, ...(typeof r.observedAt === 'string' ? { observedAt: r.observedAt } : {}) })
    origins.set(r.date, ['API', 'JSON', 'EXCEL'].includes(r.source) ? r.source : 'UNKNOWN')
  }
  const rows = [...unique.values()].sort((a, b) => a.date.localeCompare(b.date))
  const last = rows.at(-1)
  if (!last || rows.length < 6) throw new Error('insufficient_observations')
  const previousMonth = rows.filter(r => r.date.slice(0, 7) < last.date.slice(0, 7)).at(-1)
  const yearFrom = new Date(`${last.date}T00:00:00Z`)
  yearFrom.setUTCDate(yearFrom.getUTCDate() - 364)
  const series = rows.filter(r => r.date >= yearFrom.toISOString().slice(0, 10))
  const facts = [
    { id: 'spot', value: last.value, label: `1 USD = ${last.value.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${currency}` },
    { id: 'day', value: percent(last.value, rows.at(-2).value), label: '' },
    { id: 'five', value: percent(last.value, rows.at(-6).value), label: '' },
    ...(previousMonth ? [{ id: 'mtd', value: percent(last.value, previousMonth.value), label: '' }] : []),
  ].map(f => f.id === 'spot' ? f : ({ ...f, label: `${{ day: '전 관측일 대비', five: '5관측일 대비', mtd: '전월 마지막 관측일 대비' }[f.id]} ${pct(f.value)}` }))
  if (!Array.isArray(evidence)) throw new Error('invalid_evidence')
  const available = evidence.filter(e => e && (e.country === currency || e.country === 'GLOBAL') && validDate(e.eventDate) && e.eventDate <= baseDate && validDate(e.publishedAt?.slice(0, 10)) && e.publishedAt.slice(0, 10) <= baseDate)
  const seen = new Set()
  const seenIds = new Set()
  const sanitized = available.filter(e => {
    try {
      const u = new URL(e.url)
      const officialDomains = e.country === 'GLOBAL' ? ['federalreserve.gov', 'stlouisfed.org'] : currency === 'BRL' ? ['bcb.gov.br', 'ibge.gov.br'] : currency === 'MXN' ? ['banxico.org.mx', 'inegi.org.mx'] : ['bcentral.cl', 'ine.gob.cl', 'cochilco.cl']
      // Country media remain opt-in. Download/discovery success is not original review.
      const reviewedMarket = e.country === currency && e.review?.originalVerified === true && e.review?.admission === 'attributed_context' && typeof e.review?.scope === 'string' && e.review.scope.length > 0
      const localMedia = { BRL: ['infomoney.com.br', 'economia.uol.com.br'], CLP: ['emol.com', 'reporteminero.cl', 'df.cl', 'latercera.com'] }
      const domains = e.provenance === 'market_reporting' ? ['reuters.com', ...(reviewedMarket ? localMedia[currency] ?? [] : [])] : officialDomains
      if (u.protocol !== 'https:' || u.username || u.password || u.search || !domains.some(d => u.hostname === d || u.hostname.endsWith(`.${d}`))) return false
      if (!/^[a-z][a-z0-9-]{0,59}$/.test(e.id) || seenIds.has(e.id) || seen.has(u.href)) return false
      if (![e.title, e.summary, e.publisher, e.period].every(v => typeof v === 'string' && v.trim())) return false
      if (/ignore\s+(previous|all)|system\s*prompt|프롬프트|지시.*무시|sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}/i.test(e.title + ' ' + e.summary)) return false
      seen.add(u.href)
      seenIds.add(e.id)
      return true
    } catch { return false }
  }).slice(0, 8).map(e => ({
    id: e.id, country: e.country, url: e.url, eventDate: e.eventDate,
    ...(e.eventAt ? { eventAt: clean(e.eventAt, 35) } : {}),
    publishedAt: clean(e.publishedAt, 35), collectedAt: clean(e.collectedAt, 35), period: clean(e.period, 120),
    title: clean(e.title, 200), summary: clean(e.summary, 1200), publisher: clean(e.publisher, 80),
    scope: ['global', 'country', 'sales_context'].includes(e.scope) ? e.scope : e.country === 'GLOBAL' ? 'global' : 'country',
    role: ['trigger', 'context'].includes(e.role) ? e.role : 'context',
    causalStatus: ['confirmed', 'source_attributed', 'contextual'].includes(e.causalStatus) ? e.causalStatus : 'contextual',
    provenance: e.provenance === 'market_reporting' ? 'market_reporting' : 'official',
    ...(e.review?.originalVerified === true ? { review: { originalVerified: true, admission: clean(e.review.admission, 40), scope: clean(e.review.scope, 500), checkedAt: clean(e.review.checkedAt, 35) } } : {}),
  }))
  for (const e of sanitized) {
    const original = evidence.find(source => source.id === e.id)
    if(original.newsNotes!==undefined) {
      projectSourceContext(original)
      e.newsNotes=structuredClone(original.newsNotes)
      // Preserve the canonical authored-note resource, not a cleaned variant
      // that would no longer match the exact reviewed scope.
      Object.assign(e,structuredClone(original))
    }
    if (original.sourceContext !== undefined) {
      projectSourceContext(original)
      e.sourceContext = structuredClone(original.sourceContext)
    }
  }
  const timestamp = value => typeof value === 'string' && validDate(value.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null
  const packet = { currency, baseDate, observedDate: last.date, ...(timestamp(last.observedAt) ? { observationAt: last.observedAt } : {}),
    marketData: { fetchedAt: timestamp(dataset.fetchedAt), source: origins.get(last.date), rateType: 'LOCAL_PER_USD' },
    facts, series, evidence: sanitized, limitations: ['주말·보간값을 제외한 관측일 기준입니다. 국가별 휴일의 API 이월값은 완전히 식별되지 않을 수 있습니다.', '환율은 저장소의 현재 역사 자료로 재구성했습니다. 당시 데이터 버전까지 보장하는 백테스트가 아닙니다.'] }
  return { ...packet, assessment: assessEvidencePacket(packet) }
}
function clean(value, size) { return String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, size) }

// Exact code-owned period labels. This does not admit numeric model prose or
// judge economic support; the bound background projector/reviewer does that.
export function businessPeriodMetadata(packet,evidenceIds) {
  return (packet.fxWritingBackground?.reviewedNotes??[]).filter(n=>evidenceIds.includes(n.evidenceId)).map(n=>{
    const e=packet.evidence.find(e=>e.id===n.evidenceId)
    if(!e||e.country!==packet.currency||!/^\d{4}-(?:0[1-9]|1[0-2]|Q[1-4])$/.test(n.referencePeriod??''))throw new Error('consumer_period_metadata_required')
    return `영업 환경 자료: ${e.publisher} · 대상 ${n.referencePeriod} · 발표 ${e.publishedAt.slice(0,10)}.`
  }).join(' ')
}
function isCodeOwnedBusinessLimitation(text,packet) {
  const ids=(packet.fxWritingBackground?.reviewedNotes??[]).map(n=>n.evidenceId)
  if(!ids.length||ids.length>2)return false
  try {
    const sets=[...ids.map(id=>[id]),...(ids.length>1?[ids]:[])]
    return (packet.limitations??[]).some(base=>(!/\d/.test(base)||isCodeOwnedPriceLimitation(base,packet))&&
      sets.some(selected=>text===`${base} ${businessPeriodMetadata(packet,selected)}`))
  }catch{return false}
}
export function validateContent(candidate, packet) {
  const initial=['initial_check','periodic_check','context_update'].includes(packet.sharedReference?.edition?.kind)
  if(initial){try{assertSharedPacket(packet)}catch{return {valid:false,errors:['initial_check_contract_invalid']}}}
  const shape=initial?validateInitialShape:validateShape
  if (!shape(candidate)) return { valid: false, errors: ['schema'], details: (shape.errors ?? []).map(e => `${e.dataPath}:${e.keyword}`) }
  const errors = new Set()
  if(initial&&!candidate.drivers.length&&!candidate.implications.length)errors.add('initial_check_explanatory_content_missing')
  const facts = new Set(packet.facts.map(f => f.id))
  const sources = new Set(packet.evidence.map(e => e.id))
  const claims = [candidate.change, ...candidate.drivers, ...candidate.implications, ...candidate.watch]
  for (const c of claims) {
    if (c.factIds.some(id => !facts.has(id)) || c.evidenceIds.some(id => !sources.has(id))) errors.add('unknown_reference')
    if (c.kind !== 'mechanism' && !c.factIds.length && !c.evidenceIds.length) errors.add('missing_evidence')
    for (const match of c.text.matchAll(/\{\{([a-z_]+)\}\}/g)) if (!facts.has(match[1]) || !c.factIds.includes(match[1])) errors.add('placeholder_reference')
  }
  if (candidate.drivers.some(c => !c.evidenceIds.length)) errors.add('driver_without_source')
  if ([candidate.title, candidate.summary, ...candidate.limitations, ...claims.map(c => c.title)].some(s => /[{}]/.test(s))) errors.add('placeholder_outside_claim')
  for (const c of claims) if (/[{}]/.test(c.text.replace(/\{\{[a-z_]+\}\}/g, ''))) errors.add('malformed_placeholder')
  if (hasDirectionalText(candidate.change.text.replace(/\{\{[a-z_]+\}\}/g, ''))) errors.add('direction_must_use_fact')
  const strings = [candidate.title, candidate.summary].map(text=>({text,codeDigits:false,evidenceIds:[]}))
    .concat(claims.flatMap(c=>[c.title,c.text].map(text=>({text,codeDigits:false,evidenceIds:c.evidenceIds}))))
    .concat(candidate.limitations.map(text => ({text, codeDigits: isCodeOwnedPriceLimitation(text, packet)||isCodeOwnedBusinessLimitation(text,packet)})))
  for (const {text, codeDigits, evidenceIds} of strings) {
    const plain = text.replace(/\{\{[a-z_]+\}\}/g, '')
    if ((!codeDigits && /\d/.test(plain)) || /https?:|www\.|@|<|>|\[|\]|\]\(|system prompt|ignore previous/i.test(plain)) errors.add('untrusted_text')
    if (hasWorkInstruction(plain)) errors.add('advice_or_instruction')
    if (/(당사|우리 회사|LG전자|삼성전자).*(셀아웃|마진|매출|재고)/.test(plain)) errors.add('company_claim')
    if (/원화|KRW/i.test(plain) && !facts.has('usdkrw')) errors.add('unsupported_krw_link')
    const foreignCurrency = {
      BRL: /멕시코|칠레|페소|\bMXN\b|\bCLP\b/,
      MXN: /브라질|칠레|헤알|\bBRL\b|\bCLP\b/,
      CLP: /브라질|멕시코|헤알|\bBRL\b|\bMXN\b/,
    }[packet.currency]
    if(packet.sharedReference){
      // Exact position/card links are enforced by sharedRoleIssues before
      // assembly. Here reuse the same scope guard over available source notes.
      const notes=packet.evidence.filter(e=>!evidenceIds?.length||evidenceIds.includes(e.id)).flatMap(e=>e.sharedNotes.claims)
      if(sharedForeignCurrencyIssue(packet.currency,plain,notes))errors.add('currency_mismatch')
    }else if (foreignCurrency?.test(plain) && !reviewedCrossCountryContext(plain,evidenceIds,packet,foreignCurrency)) errors.add('currency_mismatch')
    if (/(반드시|확실히).*(오른|내린|상승|하락)|환율.*(전망치|도달할|기록할)|금리를?\s*예측/.test(plain)) errors.add('forecast')
  }
  return { valid: errors.size === 0, errors: [...errors] }
}

function reviewedCrossCountryContext(text,ids,packet,foreignPattern) {
  // A cited source may explain regional flows. Country mentions alone are not
  // proof of a wrong report currency; foreign units/quotes still fail closed.
  const countries=(text.match(/브라질|멕시코|칠레/g)??[]).filter(c=>foreignPattern.test(c))
  if(!countries.length||foreignPattern.test(text.replace(/브라질|멕시코|칠레/g,''))
    ||!({CLP:/칠레|페소|\bCLP\b|현지/,BRL:/브라질|헤알|\bBRL\b|현지/,MXN:/멕시코|페소|\bMXN\b|현지/}[packet.currency]?.test(text)))return false
  return countries.every(country=>(ids??[]).some(id=>{
    const e=packet.evidence.find(e=>e.id===id)
    if(!e||e.country!==packet.currency||!e.newsNotes)return false
    try{return projectSourceContext(e).passages.some(p=>p.text.includes(country))}catch{return false}
  }))
}

// Descriptive government transactions are not advice. Narrow lexical signals
// still need semantic review for recommendations phrased in other ways.
export function hasWorkInstruction(text) {
  return /(가격을?\s*(올리|내리|인상|인하)|판촉.*(확대하|축소하)|목표\s*환율|해야\s*(합니다|한다|한다는)|하십시오|하세요|지시문|프롬프트)/u.test(text) ||
    /(?:매수|매도)(?:를|하는\s*것을|하는\s*것이)?\s*(?:권고|권장|추천|제안|필요|적절|유리|기회|시점|신호|전략|하라|하자|해야|좋)/u.test(text) ||
    /(?:권고|권장|추천|제안).{0,12}(?:매수|매도)/u.test(text)
}

export function packetHash(packet) {
  return createHash('sha256').update(JSON.stringify({ facts: packet.facts, evidence: packet.evidence.map(({ collectedAt: _unused, ...e }) => e) })).digest('hex')
}
export function eligibility(packet, priorHash) {
  if (packet.baseDate !== packet.observedDate) return { eligible: false, reason: 'no_new_observation' }
  if (packetHash(packet) === priorHash) return { eligible: false, reason: 'duplicate_packet' }
  const assessment = assessEvidencePacket(packet)
  if (!assessment.publishDecision.eligible) return assessment.publishDecision
  if (!packet.evidence.length) return { eligible: false, reason: 'insufficient_evidence' }
  const cutoff = new Date(`${packet.baseDate}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - 7)
  if (!packet.evidence.some(e => e.publishedAt.slice(0, 10) >= cutoff.toISOString().slice(0, 10))) return { eligible: false, reason: 'no_recent_explanatory_evidence' }
  return { eligible: true, reason: 'review_required' }
}
