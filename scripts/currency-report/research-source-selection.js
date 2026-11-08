// Pure, opt-in routing over the existing needs planner. Catalogs are research
// inventories, not permissions, executable adapters or approved evidence.
import { planResearchNeeds } from './research-needs.js'
import { fingerprint, RESEARCH_CURRENCIES } from './research-harness.js'
import {LOCAL_SOURCE_REGISTRY} from './local-source-discovery.js'

export const SOURCE_SELECTION_VERSION = 'research-source-selection/1'
export const SOURCE_EXECUTION_POLICY = 'automatic_collection_only/1'
// One host/route boundary shared by pre-spend planning and final material
// connection. Discovery registration never grants source-use permission.
export function registeredNewsSourceForUrl({catalog,currency,url}) {
 let u
 try{u=new URL(url)}catch{return null}
 if(u.protocol!=='https:'||u.username||u.password||u.port)return null
 const country=catalog?.countries?.find(c=>c.currency===currency)
 if(!country)return null
 const matches=country.newsRefs.map(id=>catalog.sources.find(s=>s.id===id)).filter(s=>s&&(
  s.discovery?.domains?.includes(u.hostname)||s.url&&new URL(s.url).hostname===u.hostname
  ||s.localRecord&&!s.url&&(LOCAL_SOURCE_REGISTRY[currency]??[]).some(p=>p.hostnames.includes(u.hostname))))
 return matches.length===1?matches[0]:null
}
// Select every enabled news route for this country, without callers naming a
// preferred newspaper. Excluded catalog routes remain explicit in the plan.
export function countryNewsCollectionSources(selection,catalog) {
 if(selection?.catalogId!==catalog?.catalogId||selection.currency==null||!Array.isArray(selection.sourceRequests))
  throw new Error('bound_country_news_selection_required')
 return [...new Set(selection.sourceRequests.filter(r=>catalog.sources.some(s=>s.id===r.sourceId
  &&s.kind==='news'&&s.currency===selection.currency&&s.discovery?.mode!=='excluded')).map(r=>r.sourceId))]
}
const id = value => typeof value==='string' && /^[a-z][a-z0-9-]{0,99}$/.test(value)
const safe = value => !/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|bearer\s+\S+|-----BEGIN .*PRIVATE KEY|<[^>]+>|ignore\s+(previous|all)|system\s*prompt|지시.*무시/i.test(JSON.stringify(value))
const timestamp = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value.slice(0,10)).toISOString().slice(0,10)===value.slice(0,10)
const ATTEMPTS = ['collected_pending_review','access_failed','extraction_failed','empty_result','not_yet_released','no_matching_series']
const FAILED = ['access_failed','extraction_failed']
const EMPTY = ['empty_result','not_yet_released','no_matching_series']
const ROLES = {
  retail: ['retail_volume','retail_statistics','retail_and_appliance_survey','consumer_statistics'],
  real_pay: ['real_pay'], policy_rate: ['policy_context'],
  consumer_credit: ['consumer_finance'], credit_rate: ['consumer_finance'], financing: ['consumer_finance'],
  consumer_prices: ['consumer_statistics'], inflation: ['consumer_statistics'], economic_activity:['economic_activity_background'],
  copper: ['commodity_context'], oil: ['commodity_context'],
}

const NEWS_TIERS = ['specialist','supplemental','syndicated']
const yahooFinance = host => host==='finance.yahoo.com'||host.endsWith('.finance.yahoo.com')
// A discovery preference is not a grant of collection or reuse rights.
function newsDiscovery(source) {
  const config=source.discovery
  const yahoo=[source.listingUrl,source.sampleUrl].filter(Boolean).some(url=>yahooFinance(new URL(publicUrl(url)).hostname))
  if(!config) {
    if(yahoo)throw new Error('yahoo_automation_not_enabled')
    return undefined // Preserve saved catalogs with the original contract.
  }
  if(!NEWS_TIERS.includes(config.tier)||!['existing_adapter','excluded'].includes(config.mode)
    ||!Array.isArray(config.domains)||!config.domains.length||config.domains.length>3
    ||new Set(config.domains).size!==config.domains.length
    ||config.domains.some(host=>typeof host!=='string'||!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host)
      ||new URL(publicUrl(`https://${host}/`)).hostname!==host)
    ||!Array.isArray(config.terms)||!config.terms.length||config.terms.length>4
    ||config.terms.some(term=>typeof term!=='string'||term.length>80||!term.trim()||/["<>\r\n]/.test(term))
    ||typeof config.reason!=='string'||config.reason.length<10||config.reason.length>320||!safe(config))
    throw new Error('invalid_news_discovery_policy')
  if((yahoo||config.domains.some(yahooFinance))&&config.mode!=='excluded')
    throw new Error('yahoo_automation_not_enabled')
  return structuredClone(config)
}

function discoveryTask(source,period) {
  if(!source.discovery)return undefined
  const {tier,mode,domains,terms,reason}=source.discovery
  return {tier,mode,reason,targetPeriod:period,
    queries:domains.map(domain=>`site:${domain} (${terms.map(term=>`"${term}"`).join(' OR ')}) ${period}`),
    queryDateIsPublicationProof:false,queryIsEvidence:false,
    reviewPath:'reviewed_news_notes',
    checks:['publisher_and_byline','publication_and_revision','local_session_and_price_basis','claim_support',
      'original_publisher_syndication_duplicate','source_use'],
    originalPublisherVisit:'only_when_visible_content_is_incomplete_unclear_or_conflicting'}
}

function publicUrl(value) {
  if(typeof value!=='string' || value.length>2000 || !safe(value)) throw new Error('invalid_catalog_url')
  let url
  try { url=new URL(value) } catch { throw new Error('invalid_catalog_url') }
  if(url.protocol!=='https:' || url.username || url.password || url.port || url.hash
    || url.hostname==='localhost' || url.hostname.endsWith('.localhost') || url.hostname.startsWith('[')
    || /^[\d.:]+$/.test(url.hostname) || url.hostname.endsWith('.local')
    || [...url.searchParams.keys()].some(key=>/^(?:api[_-]?key|access[_-]?token|token|secret|password|authorization|auth|key)$/i.test(key))) throw new Error('invalid_catalog_url')
  return url.href
}

export function compileResearchSourceCatalog(sourcePlan, sourceRegister) {
  if(sourcePlan?.version!=='six-currency-explanatory-source-plan/1' || sourceRegister?.version!=='six-currency-source-research/1'
    || !Array.isArray(sourcePlan.sources) || sourcePlan.sources.length>100 || !Array.isArray(sourcePlan.countryPlans)
    || sourcePlan.countryPlans.length!==RESEARCH_CURRENCIES.length || !Array.isArray(sourceRegister.newsRoutes)
    || sourceRegister.newsRoutes.length>50) throw new Error('invalid_source_catalog')
  const sources=[], seen=new Set()
  function add(source) {
    if(!id(source.id) || seen.has(source.id) || ![...RESEARCH_CURRENCIES,'COMMON'].includes(source.currency)
      || !Array.isArray(source.questionIds) || source.questionIds.some(q=>!['cause','policy','demand','financing','watch'].includes(q))
      || typeof source.role!=='string' || !/^[a-z_]{1,80}$/.test(source.role)
      || typeof source.status!=='string' || source.status.length>160 || !safe(source)) throw new Error('invalid_source_catalog')
    if(source.url!==null) source.url=publicUrl(source.url)
    if(source.localRecord!==null && !/^docs\/2\.0\/[a-z0-9-]+\.json$/.test(source.localRecord)) throw new Error('invalid_local_catalog_record')
    if(!source.url && !source.localRecord) throw new Error('catalog_locator_required')
    seen.add(source.id); sources.push(source)
  }
  for(const source of sourcePlan.sources) add({id:source.id,currency:source.currency,questionIds:source.questionIds,recordHash:fingerprint(source),
    role:source.role,kind:'official_or_indicator',url:source.url,localRecord:null,status:source.status})
  for(const source of sourceRegister.newsRoutes) add({id:source.id,currency:source.currency,questionIds:['cause','policy'],recordHash:fingerprint(source),
    role:'dated_market_reporting',kind:'news',url:source.listingUrl??source.sampleUrl??null,
    localRecord:source.localEvidence??null,status:source.verification,
    ...(source.discovery?{discovery:newsDiscovery(source)}:{} )})
  // Missing metadata cannot enable an unapproved Yahoo automation route.
  for(const source of sourceRegister.newsRoutes)if(!source.discovery)newsDiscovery(source)
  const countries=sourcePlan.countryPlans.map(country=>{
    if(!RESEARCH_CURRENCIES.includes(country.currency) || !Array.isArray(country.newsRefs) || !Array.isArray(country.officialRefs)
      || !Array.isArray(country.commonRefs)) throw new Error('invalid_country_routes')
    for(const [key,kind] of [['newsRefs','news'],['officialRefs','official_or_indicator'],['commonRefs','official_or_indicator']]) {
      const refs=country[key]
      if(refs.length>30 || new Set(refs).size!==refs.length || refs.some(ref=>{
        const source=sources.find(s=>s.id===ref)
        return !source || source.kind!==kind || source.currency!==(key==='commonRefs'?'COMMON':country.currency)
      })) throw new Error('invalid_country_routes')
    }
    return {currency:country.currency,newsRefs:[...country.newsRefs],officialRefs:[...country.officialRefs],commonRefs:[...country.commonRefs]}
  })
  if(new Set(countries.map(c=>c.currency)).size!==RESEARCH_CURRENCIES.length) throw new Error('invalid_country_routes')
  const bound={version:SOURCE_SELECTION_VERSION,executionPolicy:SOURCE_EXECUTION_POLICY,sources,countries,policyHash:fingerprint(sourcePlan.rules??[])}
  return {...bound,catalogId:fingerprint(bound)}
}

function routesFor(question, requirement, country, catalog) {
  const all=catalog.sources.filter(s=>[...country.newsRefs,...country.officialRefs,...country.commonRefs].includes(s.id))
  const news=country.newsRefs.map(ref=>all.find(s=>s.id===ref)).sort((a,b)=>
    NEWS_TIERS.indexOf(a.discovery?.tier??'supplemental')-NEWS_TIERS.indexOf(b.discovery?.tier??'supplemental'))
  const official=all.filter(s=>s.kind!=='news')
  if(['market','counter'].includes(question.id)) return news
  if(question.id==='local') return [...news,...official.filter(s=>s.currency===country.currency && s.questionIds.includes('policy'))]
  if(question.id==='global') return [...official.filter(s=>s.currency==='COMMON' && s.questionIds.includes('cause')),
    ...news.filter(s=>s.discovery?.tier==='syndicated')]
  if(['policy_release','policy_scope'].includes(question.id)) return [...official.filter(s=>s.currency===country.currency && s.questionIds.includes('policy')), ...news]
  if(question.id==='financing') return official.filter(s=>s.currency===country.currency && s.questionIds.includes('financing'))
  const roles=ROLES[requirement?.scope.metric]??[]
  return official.filter(s=>s.currency===country.currency && roles.includes(s.role))
}

function summarizeTarget(target) {
  const tried=target.sources.filter(s=>s.latestAttempt), received=tried.filter(s=>s.latestAttempt.status==='collected_pending_review')
  const failed=tried.filter(s=>FAILED.includes(s.latestAttempt.status))
  return {...target,
    dataState:target.inventoryState==='available'?'metadata_compatible':target.inventoryState==='conflict'?'conflict'
      :received.length?'stored_unreviewed':!target.sources.length?target.excludedSources.length?'no_automatic_source':'no_registered_source'
        :tried.length===target.sources.length && tried.every(s=>EMPTY.includes(s.latestAttempt.status))?'missing_in_checked_sources':'pending',
    lookupState:!tried.length?'not_attempted':failed.length?received.length?'partial_failure':'failed'
      :tried.length<target.sources.length?'partially_checked':'checked',
    unattemptedSourceIds:target.sources.filter(s=>!s.latestAttempt).map(s=>s.sourceId)}
}

export function planResearchSourceSelection({input,sourcePlan,sourceRegister,attempts=[]}) {
  const catalog=compileResearchSourceCatalog(sourcePlan,sourceRegister)
  const plan=planResearchNeeds(input)
  const country=catalog.countries.find(c=>c.currency===plan.currency)
  const routeBinding=fingerprint({catalogId:catalog.catalogId,planId:plan.planId})
  const requests=new Map()
  const questions=plan.questions.map(question=>{
    const targets=question.requirements.map(requirement=>{
      const routes=routesFor(question,requirement,country,catalog)
      const excludedSources=routes.filter(source=>source.discovery?.mode==='excluded')
        .map(source=>({sourceId:source.id,reason:source.discovery.reason,status:'excluded_from_automatic_collection'}))
      const sources=routes.filter(source=>source.discovery?.mode!=='excluded').map(source=>{
        const reuseOrConflict=['available','conflict'].includes(requirement.status)
        const requestId=reuseOrConflict?null:fingerprint({routeBinding,period:requirement.period,scope:requirement.scope,
          sourceId:source.id,queryIntent:source.kind==='news'?question.legacyQuestionId:'registered_statistic'})
        const shared=requestId?requests.get(requestId):null
        if(shared) {
          if(!shared.needIds.includes(question.id)) shared.needIds.push(question.id)
          if(!shared.requirementIds.includes(requirement.id)) shared.requirementIds.push(requirement.id)
          return shared
        }
        const request={requestId,needIds:[question.id],requirementIds:[requirement.id],period:requirement.period,
          sourceId:source.id,url:source.url,localRecord:source.localRecord,catalogStatus:source.status,
          catalogEntryIsEvidence:false,adapterStatus:reuseOrConflict?'existing_inventory_review':'selection_only_not_executed',latestAttempt:null,
          ...(source.discovery?{discovery:discoveryTask(source,requirement.period)}:{})}
        if(requestId) requests.set(requestId,request)
        return request
      })
      return {requirementId:requirement.id,period:requirement.period,scope:structuredClone(requirement.scope),
        inventoryState:requirement.status,evidenceIds:[...requirement.evidenceIds],sources,excludedSources,
        routingReason:sources.length?null:excludedSources.length?'automatic_collection_not_enabled':['economic_release','economic_scope','consumption','category'].includes(question.id) && !ROLES[requirement.scope.metric]
          ?'metric_mapping_required':'no_route_registered_for_scope'}
    })
    return {needId:question.id,question:question.question,required:question.required,planningStatus:question.status,
      existingAction:question.action,scopeRequired:!targets.length,targets}
  })
  if(!Array.isArray(attempts) || attempts.length>100 || !safe(attempts)) throw new Error('invalid_source_attempts')
  const seen=new Set(), times=new Map()
  const ledger=attempts.map(attempt=>{
    const request=requests.get(attempt?.requestId)
    if(!id(attempt?.attemptId) || seen.has(attempt.attemptId) || !request || !ATTEMPTS.includes(attempt.status)
      || !timestamp(attempt.completedAt) || Date.parse(attempt.completedAt)>Date.parse(plan.asOf)
      || (times.has(attempt.requestId) && times.get(attempt.requestId)>=Date.parse(attempt.completedAt))
      || (attempt.captureSha256!==undefined && !/^[a-f0-9]{64}$/.test(attempt.captureSha256))
      || (attempt.status==='collected_pending_review' && !attempt.captureSha256)) throw new Error('invalid_source_attempts')
    seen.add(attempt.attemptId); times.set(attempt.requestId,Date.parse(attempt.completedAt))
    const row={attemptId:attempt.attemptId,requestId:attempt.requestId,status:attempt.status,completedAt:attempt.completedAt,
      ...(attempt.captureSha256?{captureSha256:attempt.captureSha256}:{}),
      evidenceApproved:false,absenceVerified:false}
    request.latestAttempt=row
    return row
  })
  const selected=questions.map(question=>({...question,targets:question.targets.map(summarizeTarget)}))
  return {version:SOURCE_SELECTION_VERSION,executionPolicy:SOURCE_EXECUTION_POLICY,selectionId:fingerprint({routeBinding,ledger}),catalogId:catalog.catalogId,
    currency:plan.currency,baseDate:plan.baseDate,asOf:plan.asOf,plan,questions:selected,attempts:ledger,
    sourceRequests:[...requests.values()],
    lookupFailures:ledger.filter(a=>FAILED.includes(a.status)),
    activeLookupFailures:[...requests.values()].filter(r=>r.latestAttempt && FAILED.includes(r.latestAttempt.status)).map(r=>r.latestAttempt),
    dataGaps:selected.flatMap(q=>q.targets.filter(t=>['no_registered_source','no_automatic_source','missing_in_checked_sources'].includes(t.dataState))
      .map(t=>({needId:q.needId,requirementId:t.requirementId,state:t.dataState}))),
    scopeRequired:selected.filter(q=>q.scopeRequired).map(q=>q.needId),
    writingEligibility:plan.writingEligibility,contentQuality:plan.contentQuality,publicationApproved:false,
    networkCalls:0,modelCalls:0,apiCostUsd:0,
    limitation:'출처 선택과 시도 기록은 자료의 최신성·의미·사용 허가·집필 또는 게시 승인이 아니다. 실제 수집 어댑터는 별도 연결한다.'}
}
