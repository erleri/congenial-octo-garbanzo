// Pure date policy shared by planning, public search and original review.
import { validDate } from './core.js'
import {validateMxnPriceBasis} from './mxn-official-price.js'
import {validateBrlCloseBasis} from './brl-market-close.js'
import {validatePublisherCloseBasis} from './publisher-close-pair.js'
import {marketCalendarDate} from './market-calendar.js'

const marketQuestions = ['market','local','global','counter']
const questions = [...marketQuestions,'consumer','watch']
const prior = (day,n) => new Date(Date.parse(`${day}T00:00:00Z`)-n*86400000).toISOString().slice(0,10)

export function researchTimeScope(packet, questionId) {
  if (!packet || !validDate(packet.baseDate) || !questions.includes(questionId)) throw new Error('invalid_research_time_scope')
  const basis=packet.marketData?.reportPriceBasis
  let pair
  if (basis) {
    pair=basis.observations
    if(packet.currency==='MXN')validateMxnPriceBasis(basis,packet)
    else if(packet.currency==='BRL')validateBrlCloseBasis(basis,packet)
    else if(['COP','ARS'].includes(packet.currency))validatePublisherCloseBasis(basis,packet)
    else if (packet.currency!=='CLP' || basis.seriesId!=='F073.TCO.PRE.Z.D'
      || basis.dateBasis!=='underlying_local_transaction_day' || basis.timeZone!=='America/Santiago'
      || basis.priceKind!=='official_transaction_weighted_average' || !Array.isArray(pair) || pair.length!==2
      || pair.some(o=>!validDate(o?.localSessionDate)) || pair[0].localSessionDate>=pair[1].localSessionDate
      || pair[1].localSessionDate!==packet.observedDate || packet.observedDate>packet.baseDate)
      throw new Error('unverified_research_price_session')
  }
  const sessionBound=!!basis && marketQuestions.includes(questionId)
  const anchorDate=sessionBound?pair[1].localSessionDate:packet.baseDate
  const startDate=sessionBound?pair[0].localSessionDate
    :basis&&questionId==='watch'?pair[1].localSessionDate:prior(anchorDate,questionId==='consumer'?30:1)
  if (Date.parse(anchorDate)-Date.parse(startDate)>31*86400000) throw new Error('research_time_scope_too_wide')
  return {policyVersion:'research-time-scope/1',reportDate:packet.baseDate,anchorDate,startDate,endDate:anchorDate,
    dateBasis:sessionBound?basis.dateBasis:'report_date',
    ...(basis?{priceSessionDate:pair[1].localSessionDate,previousPriceSessionDate:pair[0].localSessionDate,
      observationWindowEndAt:pair[1].observationWindow?.endAt??null}:{}),
    role:questionId==='consumer'?'sales_environment_context':questionId==='watch'?'subsequent_observation_context':'market_explanation_candidate',
    directCauseAllowed:false}
}

export function originalPriceTimeRelation(metadata, scope, currency) {
  if (!scope?.priceSessionDate) return undefined
  const value=metadata.publishedAt
  const exact=typeof value==='string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
  const date=validDate(value)?value:exact?marketCalendarDate(value,currency):null
  return {priceSessionDate:scope.priceSessionDate,publicationSessionRelation:!date?'publication_unverified'
    :date<scope.priceSessionDate?'before_price_session':date>scope.priceSessionDate?'after_price_session':'same_local_session_day',
    publicationCutoffRelation:exact && scope.observationWindowEndAt
      ? Date.parse(value)>Date.parse(scope.observationWindowEndAt)?'published_after_aggregation_cutoff':'published_by_aggregation_cutoff'
      :'exact_time_unverified',directCauseAllowed:false,
    limitation:'Publication time is not event time; publication after the cutoff may report earlier events. Original review is required.'}
}
