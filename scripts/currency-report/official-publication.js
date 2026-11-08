// Code-owned delivery of the already reviewed aggregate numeric use conditions.
// This does not approve economic claims or publish a report. Raw text, private
// hashes, model receipts and arbitrary licence claims are never public fields.
import {fingerprint} from './research-harness.js'
import {officialCountryProfiles,countryDefinitionId,OFFICIAL_COUNTRY_VERSION} from './official-country-statistics.js'
import {INEGI_REPORT_INDICATORS,INEGI_DEFINITION_VERSION,inegiDefinitionId,inegiScopeMatches} from './inegi-report-indicators.js'

export const OFFICIAL_PUBLICATION_VERSION='official-numeric-publication/1'
// Conditions are delivered in the public report by code. Repeating the whole
// notice inside the model's already credited evidence adds no reasoning value.
export function officialStatisticForModel(statistic){
 const copy=structuredClone(statistic);delete copy.publication;return copy
}
const termsInegi='https://www.inegi.org.mx/inegi/terminos.html'
const licenses={
 'CC-BY-SA-4.0':{label:'CC BY-SA 4.0',url:'https://creativecommons.org/licenses/by-sa/4.0/'},
 'CC-BY-4.0':{label:'CC BY 4.0',url:'https://creativecommons.org/licenses/by/4.0/'},
}
export function prepareOfficialPublication({statistic:s,credit,currency}){
 const profile=officialCountryProfiles().find(p=>p.currency===currency&&p.seriesId===s.seriesId)
 const inegi=currency==='MXN'&&INEGI_REPORT_INDICATORS.find(d=>d.indicatorId===s.seriesId)
 const registered=profile?s.definitionVersion===OFFICIAL_COUNTRY_VERSION&&s.definitionId===countryDefinitionId(profile)
   &&fingerprint(s.scope)===fingerprint(profile.scope)&&s.usePolicy?.termsUrl===profile.termsUrl&&s.usePolicy?.credit===profile.credit
  :inegi&&s.definitionVersion===INEGI_DEFINITION_VERSION&&s.definitionId===inegiDefinitionId(inegi)&&inegiScopeMatches(s.scope,inegi)
 if(!registered||s.usePolicy?.public_display==='denied'||s.usePolicy?.external_model==='denied'||s.usePolicy?.local_analysis==='denied'
  ||credit.referencePeriod!==s.period||credit.sourceUrl!==s.sourceUrl
  ||typeof credit.attribution!=='string'||!credit.attribution.trim()||!credit.transformation?.trim())return null
 const termsUrl=profile?.termsUrl??termsInegi,licence=licenses[profile?.licence]??null
 const definition=s.label.replace(/ · (?:전월 대비|전년 동월 대비|월 관측 수준)$/u,''),scope=s.scope,adjustment=scope.adjustment==='seasonally_adjusted'?'계절조정':'비계절조정'
 const comparison={level:'수준',month_over_month:'전월 대비',year_over_year:'전년 동월 대비'}[scope.comparison]
 if(!comparison)return null
 const periodText=`대상 ${s.period} · ${definition} · ${scope.priceBasis==='real'?'실질':'명목'} · ${adjustment} · ${comparison}${s.provisional===true?' · 잠정치':''}.`
 const timing=s.release.publishedOn?`발표일 ${s.release.publishedOn}, 정확한 발표시각 미제공.`:'발표일 미제공. 수집 시점에 확인한 통계 판본입니다.'
 const calculation=s.derived?' 전년 동월 비교는 같은 원계열 지수로 LATAM FX가 계산했습니다.':''
 const licenceText=licence?` ${credit.attribution.includes(licence.label)?'라이선스':licence.label}: ${licence.url}`:''
 const summary=`${periodText} ${credit.attribution} ${credit.transformation} ${timing}${calculation}${licenceText} 이용 조건: ${termsUrl}`
 if(summary.length>1800||/<[^>]*>|sk-or-|bearer\s+\S+|[?&](?:token|api_?key)=/i.test(summary))return null
 return {version:OFFICIAL_PUBLICATION_VERSION,summary,summaryHash:fingerprint(summary),termsUrl,licence,
  checks:['registered_numeric_definition','source_credit','reference_period_and_comparison','transformation_and_no_endorsement',
   ...(licence?['licence_link','applicable_derivative_scope']:[])],contentReview:'not_approved',publicationApproved:false}
}
export function assertOfficialPublicSummary(e){
 const p=e?.officialStatistic?.publication
 if(!p)return
 if(p.version!==OFFICIAL_PUBLICATION_VERSION||p.summaryHash!==fingerprint(e.summary)||p.summary!==e.summary)
  throw Error('official_public_notice_missing_or_changed')
}
