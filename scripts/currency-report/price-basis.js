// Report-only research boundary. No network, operational data writes, or admissions.
import { createHash } from 'node:crypto'
import { buildEvidenceReview } from './evidence-review.js'

export const PRICE_BASIS_VERSION = 'price-basis/1'
export const PROVIDER_SOURCE_VERSION = '110a6b9de2d048243a75f3811bdca806ac141728'
const hash = raw => createHash('sha256').update(raw).digest('hex')
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const timed = value => typeof value === 'string' && /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && date(value.slice(0, 10)) && Number.isFinite(Date.parse(value))
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const direction = change => change > 0 ? 'local_weaker' : change < 0 ? 'local_stronger' : 'unchanged'
const change = pair => (pair[1].value / pair[0].value - 1) * 100

export function readCurrencyApiPrice({ raw, url, currency, requestedDate, capturedAt }) {
  if (!['BRL', 'CLP', 'MXN'].includes(currency) || !date(requestedDate) || !timed(capturedAt)) throw new Error('invalid_price_capture')
  // A captured JSON cannot silently declare itself another provider or date.
  const expected = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${requestedDate}/v1/currencies/usd.json`
  if (url !== expected) throw new Error('unexpected_provider_url')
  const payload = JSON.parse(raw.toString())
  const value = payload.usd?.[currency.toLowerCase()]
  if (payload.date !== requestedDate || typeof value !== 'number' || !Number.isFinite(value) || value <= 0
    || capturedAt.slice(0, 10) < requestedDate) throw new Error('invalid_provider_observation')
  return {
    currency, value, unit: 'LOCAL_PER_USD', provider: 'fawazahmed0/currency-api', url,
    rawSha256: hash(raw), providerDate: payload.date,
    // Audited upstream currscript.js sets dateToday from new Date().toISOString().
    // It is not an exchange tick, a Chilean session, nor a guaranteed update time.
    providerDateMeaning: 'utc_generation_date', providerSourceVersion: PROVIDER_SOURCE_VERSION,
    priceKind: 'provider_conversion_reference', observedAt: null, localSessionDate: null,
    quoteSide: 'unspecified', upstreamMarketVendor: null, capturedAt,
  }
}

export function compareStoredProviderPrice(row, price) {
  const matches = Boolean(row && row.currency === price.currency && row.rateType === price.unit
    && row.date === price.providerDate && row.value === price.value && row.source === 'API'
    && (!row.imputationMethod || row.imputationMethod === 'NONE'))
  return {
    matches, lineage: matches ? 'reconstructed_exact_match' : 'unmatched',
    executionProviderRecorded: false,
    // Matching history plus merger order supports reconstruction, not proof of
    // which endpoint succeeded in the original operational job.
    observedAt: null, localSessionDate: null,
  }
}

export function readReviewedEmolQuote({ rawHtml, original, review, quoteSide = 'ask' }) {
  if (!['bid', 'ask'].includes(quoteSide) || !original || !review) throw new Error('invalid_quote_review')
  const url = new URL(original.url)
  if (url.protocol !== 'https:' || url.hostname !== 'www.emol.com' || url.username || url.password || url.port
    || original.publisher !== 'Emol' || original.timeZone !== 'America/Santiago'
    || original.role !== 'market_close' || !sha(original.rawSha256) || hash(rawHtml) !== original.rawSha256
    || review.originalVerified !== true || !date(review.sessionDate) || !timed(review.checkedAt)
    || !timed(review.publishedAt) || review.sessionDate > review.checkedAt.slice(0, 10)) throw new Error('unverified_market_quote')
  const localPublicationDate = new Intl.DateTimeFormat('en-CA', { timeZone: original.timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(review.publishedAt))
  const localPublicationTime = new Intl.DateTimeFormat('sv-SE', { timeZone: original.timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .format(new Date(review.publishedAt)).replace(' ', 'T')
  if (localPublicationDate !== review.sessionDate || localPublicationTime !== original.publishedAtLocal
    || Date.parse(review.publishedAt) > Date.parse(review.checkedAt)) throw new Error('publication_session_mismatch')
  // Only a manually selected, hash-bound original paragraph is parsed. A search
  // title, metadata, forecast, DF quote or morning price is not a close quote.
  const text = original.blocks?.[review.blockIndex]?.text
  if (typeof text !== 'string' || !Number.isInteger(review.blockIndex) || review.blockIndex < 0
    || !rawHtml.toString().includes(review.rawAnchor) || typeof review.rawAnchor !== 'string' || review.rawAnchor.length < 20
    || !/cerr(?:ó|&oacute;)/.test(text)) throw new Error('price_paragraph_not_bound')
  const pattern = /\$([\d.,]+)\s+comprador\s+y\s+\$([\d.,]+)\s+vendedo\s*r/gu
  const matches = [...text.matchAll(pattern)]
  const normalize = value => value.replace(/<[^>]*>/g, '').replace(/\s+/g, '')
  if (matches.length !== 1 || !normalize(review.rawAnchor).includes(normalize(matches[0][0]))
    || !normalize(rawHtml.toString()).includes(normalize(text))) throw new Error('ambiguous_or_missing_quote')
  const number = matches[0][quoteSide === 'ask' ? 2 : 1]
  if (!/^\d+(?:,\d+)?$/.test(number)) throw new Error('unsupported_quote_number')
  const value = Number(number.replace(',', '.'))
  if (!(value > 0)) throw new Error('invalid_quote_value')
  return { id: original.id, currency: 'CLP', value, unit: 'LOCAL_PER_USD', publisher: 'Emol', url: original.url,
    rawSha256: original.rawSha256, quoteSide, priceKind: 'publisher_reported_close', localSessionDate: review.sessionDate,
    sessionDateBasis: 'manual_original_review', publishedAt: review.publishedAt, timeZone: original.timeZone,
    // Publication time must never be promoted to actual price observation time.
    observedAt: null, official: false, reviewedBlock: review.blockIndex }
}

export function compareArticlePair(quotes) {
  if (!Array.isArray(quotes) || quotes.length !== 2) throw new Error('two_article_quotes_required')
  const [previous, current] = quotes
  const sameBasis = previous.currency === current.currency && previous.unit === current.unit
    && previous.publisher === current.publisher && previous.quoteSide === current.quoteSide
    && ['bid', 'ask'].includes(current.quoteSide) && previous.timeZone === current.timeZone
    && quotes.every(q => q.priceKind === 'publisher_reported_close' && q.sessionDateBasis === 'manual_original_review'
      && date(q.localSessionDate) && Number.isFinite(q.value) && q.value > 0 && sha(q.rawSha256))
    && previous.localSessionDate < current.localSessionDate
  return { status: sameBasis ? 'source_attributed_reference' : 'hold',
    reason: sameBasis ? 'same_publisher_side_and_reviewed_sessions' : 'article_price_basis_mismatch',
    quoteSide: current.quoteSide, previousSessionDate: previous.localSessionDate, currentSessionDate: current.localSessionDate,
    dailyChangeClaimAllowed: false, // A pair alone does not verify intervening holidays/sessions.
    ...(sameBasis ? { intervalPct: change(quotes), direction: direction(change(quotes)) } : {}),
    observationAt: null, intradayCausalityVerified: false, publicationApproved: false }
}

export function buildPriceBasisReview({ dataset, currency, providerPrices, articleQuotes = [] }) {
  if (!dataset || !['BRL', 'CLP', 'MXN'].includes(currency) || !Array.isArray(providerPrices) || providerPrices.length !== 2)
    throw new Error('invalid_price_basis_input')
  const [previous, current] = providerPrices
  if (previous.providerDate >= current.providerDate || providerPrices.some(p => p.currency !== currency
    || p.unit !== 'LOCAL_PER_USD' || p.priceKind !== 'provider_conversion_reference'
    || p.provider !== 'fawazahmed0/currency-api' || !date(p.providerDate) || !sha(p.rawSha256)
    || !(p.value > 0) || !Number.isFinite(p.value) || p.observedAt !== null || p.localSessionDate !== null)) throw new Error('invalid_provider_pair')
  const matches = providerPrices.map(p => compareStoredProviderPrice(
    dataset.dailyRates?.findLast(row => row.currency === currency && row.rateType === 'LOCAL_PER_USD' && row.date === p.providerDate), p))
  const articleReference = articleQuotes.length ? compareArticlePair(articleQuotes) : null
  const blockers = [
    ...(!matches.every(m => m.matches) ? ['stored_price_not_bound_to_capture'] : []),
    'provider_observation_time_unknown', 'provider_local_session_unknown', 'provider_quote_basis_unspecified',
    ...(articleQuotes.some(q => q.currency !== currency) ? ['article_currency_mismatch'] : []),
  ]
  const sameLabels = articleReference?.previousSessionDate === previous.providerDate && articleReference?.currentSessionDate === current.providerDate
  const sameLabelDirectionConflict = sameLabels && articleReference.status === 'source_attributed_reference'
    ? direction(change(providerPrices)) !== articleReference.direction : null
  return {
    ruleVersion: PRICE_BASIS_VERSION, currency, providerInterval: [previous.providerDate, current.providerDate],
    providerPrices, storedMatches: matches, providerIntervalPct: change(providerPrices),
    providerDirection: direction(change(providerPrices)), articleQuotes, articleReference,
    sameLabelDirectionConflict,
    // This is a usable research packet, not a way to upgrade existing approvals.
    articleLink: { status: 'hold', blockers, directCauseAllowed: false, automaticDateShiftAllowed: false },
    writingEligibility: { eligible: false, reason: 'price_basis_unverified' }, publicationApproved: false,
    limitations: ['공급자 날짜는 UTC 생성일이며 현지 거래일·종가가 아닙니다.',
      '기사 호가의 구간 변화는 별도 출처 귀속 참고값입니다. 저장 차트의 변화율을 대체하지 않습니다.',
      '수집·게시 시각으로 실제 환율 관측시각을 채우지 않습니다.'],
  }
}

export function buildPriceLinkedEvidenceReview(discovery, dataset, priceBasis) {
  const review = buildEvidenceReview(discovery, dataset)
  const dates = priceBasis?.providerInterval
  const current = dataset.dailyRates?.findLast(row => row.currency === discovery.currency
    && row.rateType === 'LOCAL_PER_USD' && row.date === review.movement.observedDate)
  if (priceBasis?.ruleVersion !== PRICE_BASIS_VERSION || priceBasis.currency !== discovery.currency
    || dates?.[1] !== review.movement.observedDate || dates?.[0] !== review.movement.previousObservedDate
    || priceBasis.providerPrices?.[1]?.value !== current?.value
    || priceBasis.providerPrices?.[0]?.value !== review.movement.previousValue) throw new Error('stale_price_basis_review')
  // Recompute; never trust caller-edited booleans, cached status, or a date shift.
  const recomputed = buildPriceBasisReview({ dataset, currency: discovery.currency,
    providerPrices: priceBasis.providerPrices, articleQuotes: priceBasis.articleQuotes })
  return { ...review, priceBasis: recomputed,
    candidates: review.candidates.map(candidate => ({ ...candidate, eligibleForTriggerReview: false,
      blockers: [...new Set([...candidate.blockers, ...recomputed.articleLink.blockers])] })),
    writingEligibility: recomputed.writingEligibility,
    publicationBlocked: true, automaticEvidenceAdmission: false }
}
