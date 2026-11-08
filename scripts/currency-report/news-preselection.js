import {validDate} from './core.js'
import {marketCalendarDate} from './market-calendar.js'

// Free routing decision, never a judgment of factual or causal support.
export const NEWS_PRESELECTION_VERSION='news-preselection/1'
export function nonEconomicSection(url) {
 try{return /\/(?:deportes|esportes|sports|entretenimiento|entretenimento|showbiz)\//i.test(new URL(url).pathname)}catch{return false}
}
export function inspectNewsPreselection(original,card,currency) {
 if(nonEconomicSection(original.url))return {status:'excluded',reason:'non_economic_section',version:NEWS_PRESELECTION_VERSION}
 const dates=card.targets.map(t=>t.requestedPeriod).filter(validDate).sort()
 const sessionOnly=card.targets.length>0&&card.targets.every(t=>t.requestedScope?.comparison==='source_reported_session')
 const published=marketCalendarDate(original.metadata?.publishedAt,currency)
 const modified=marketCalendarDate(original.metadata?.modifiedAt,currency)
 // Old policy/consumer releases remain eligible on their own declared period.
 // A revised current article is not excluded using its original publication.
 if(sessionOnly&&dates.length&&published&&published<dates[0]&&(!modified||modified<dates[0]))
  return {status:'excluded',reason:'publication_before_session_window',version:NEWS_PRESELECTION_VERSION,
   published,modified,earliestRequestedDate:dates[0]}
 return {status:'requires_content_review',version:NEWS_PRESELECTION_VERSION}
}
