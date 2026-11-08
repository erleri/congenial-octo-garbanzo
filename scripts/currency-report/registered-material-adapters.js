import {rankNewsCandidates} from './news-selection-policy.js'
// Data locators are explicit code, never arbitrary catalog prose or model URLs.
// Reuses existing normalizers. Every result still requires scope/use/time review.
import {SOURCE_CATALOG,normalizeSnapshot} from './sources.js'
import {validDate} from './core.js'
import {allowedResearchUrl} from './public-research-adapter.js'
import {decodeEntities} from './local-source-discovery.js'
import {CHILE_MONTHLY_SOURCES} from './chile-monthly-originals.js'
import {newsPublisherProfile} from './news-publisher-access.js'
import {nonEconomicSection} from './news-preselection.js'

export const IBGE_RETAIL_SIDRA_URL='https://apisidra.ibge.gov.br/values/t/8880/n1/all/v/11708/p/last%203/c11046/56734?formato=json'

export function materialRecipe(request,catalog,sourceRegister) {
  const source=catalog.sources.find(s=>s.id===request.sourceId)
  if(!source) throw new Error('unknown_selected_source')
  const month=/^\d{4}-(0[1-9]|1[0-2])$/.test(request.period)
  if(['brl-policy','brl-retail'].includes(source.id)) {
    const existing=SOURCE_CATALOG.find(s=>s.id===(source.id==='brl-policy'?'bcb-selic':'ibge-retail-volume'))
    return {kind:'existing_brazil_json',url:existing.url,existingSource:existing,
      ...(source.id==='brl-retail'?{alternate:{kind:'ibge_sidra_json',url:IBGE_RETAIL_SIDRA_URL}}:{})}
  }
  if(source.id==='pen-financing') return month?{kind:'bcrp_credit_json',
    url:`https://estadisticas.bcrp.gob.pe/estadisticas/series/api/PN07845NM-PN07846NM-PN07847NM/json/${request.period}/${request.period}/esp`}
    :{kind:'unconfigured',reason:'explicit_month_required'}
  if(source.id==='cop-credit') {
    if(!month&&!validDate(request.period))return {kind:'unconfigured',reason:'explicit_day_or_month_required'}
    const start=month?`${request.period}-01`:request.period
    const end=month?new Date(Date.UTC(Number(start.slice(0,4)),Number(start.slice(5,7)),0)).toISOString().slice(0,10):start
    const query=new URLSearchParams({$select:'fecha_corte,tipo_de_cr_dito,producto_de_cr_dito,plazo_de_cr_dito,tasa_efectiva_promedio,montos_desembolsados,numero_de_creditos',
      $where:`fecha_corte >= '${start}T00:00:00.000' AND fecha_corte <= '${end}T23:59:59.999'`,$limit:'20'})
    return {kind:'sfc_credit_json',url:`https://www.datos.gov.co/resource/w9zh-vetq.json?${query}`,range:{start,end},limit:20}
  }
  if(['clp-consumer','clp-pay'].includes(source.id)) {
    const existing=CHILE_MONTHLY_SOURCES.find(s=>s.id===(source.id==='clp-pay'?'cl-pay':'cl-retail'))
    return month?{kind:'chile_monthly',sourceId:existing.id,url:existing.url}:{kind:'unconfigured',reason:'explicit_month_required'}
  }
  if(source.kind==='news') {
    const registered=sourceRegister.newsRoutes.find(s=>s.id===source.id)
    if(source.discovery?.mode==='excluded')return {kind:'excluded',reason:source.discovery.reason}
    return registered?.listingUrl?{kind:'news_listing',url:allowedResearchUrl(registered.listingUrl,source.currency),
      access:newsPublisherProfile(source.id,source.currency,registered.listingUrl)}
      :{kind:'existing_chile_publisher',reason:'existing_chile_publisher_collector'}
  }
  return {kind:'unconfigured',reason:source.id.startsWith('mxn-')?'token_or_exact_public_series_required':'exact_release_or_series_not_connected'}
}

// A saved broader query can be reused only when its URL covers the exact target.
// This is query compatibility, not semantic scope or latestness approval.
export function savedMaterialUrlMatches(url,recipe,period) {
  if(url===recipe.url)return true
  if(recipe.kind==='bcrp_credit_json') {
    const match=/^https:\/\/estadisticas\.bcrp\.gob\.pe\/estadisticas\/series\/api\/PN07845NM-PN07846NM-PN07847NM\/json\/(\d{4}-\d{2})\/(\d{4}-\d{2})\/esp$/.exec(url)
    return !!match&&match[1]<=period&&match[2]>=period
  }
  if(recipe.kind==='sfc_credit_json') {
    const parsed=new URL(url)
    if(parsed.origin!=='https://www.datos.gov.co'||parsed.pathname!=='/resource/w9zh-vetq.json')return false
    const expected=new URL(recipe.url).searchParams.get('$select')
    if(parsed.searchParams.get('$select')!==expected||![...parsed.searchParams.keys()].every(k=>['$select','$where','$limit'].includes(k))
      ||!/^\d+$/.test(parsed.searchParams.get('$limit')??'')||Number(parsed.searchParams.get('$limit'))<1
      ||Number(parsed.searchParams.get('$limit'))>20)return false
    const where=parsed.searchParams.get('$where')??''
    const range=/^fecha_corte >= '(\d{4}-\d{2}-\d{2})T00:00:00(?:\.000)?' AND fecha_corte <= '(\d{4}-\d{2}-\d{2})T23:59:59(?:\.999)?'$/.exec(where)
      ??/^fecha_corte between '(\d{4}-\d{2}-\d{2})T00:00:00' and '(\d{4}-\d{2}-\d{2})T23:59:59'$/i.exec(where)
    return !!range&&range[1]<=recipe.range.start&&range[2]>=recipe.range.end
  }
  return false
}

const decimal=value=>typeof value==='number'&&Number.isFinite(value)?value:
  typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value)?Number(value):null
const PEN_LABELS=['Tarjeta de Crédito','Hasta 360 días','Más 360 días']
const ES_MONTHS=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
export function parseRegisteredStatistic(recipe,text,asOf) {
  const body=JSON.parse(text)
  if(recipe.kind==='ibge_sidra_json') {
    if(!validDate(asOf)||!Array.isArray(body)||body.length<2||body.length>121||body[0]?.V!=='Valor')throw new Error('sidra_schema_changed')
    const seen=new Set(),observations=[]
    for(const row of body.slice(1)) {
      if(row.NC!=='1'||row.D1C!=='1'||row.D2C!=='11708'||row.D4C!=='56734'||row.MC!=='2'||row.MN!=='%'
        ||!/^\d{4}(0[1-9]|1[0-2])$/.test(row.D3C??'')||seen.has(row.D3C)
        ||!String(row.D2N).includes('com ajuste sazonal')||!String(row.D4N).includes('volume de vendas'))throw new Error('sidra_definition_changed')
      seen.add(row.D3C)
      const value=decimal(row.V)
      if(value===null&&!['...','..','-','X'].includes(row.V))throw new Error('sidra_value_changed')
      if(row.D3C<=asOf.replaceAll('-','').slice(0,6))observations.push({period:`${row.D3C.slice(0,4)}-${row.D3C.slice(4)}`,value})
    }
    observations.sort((a,b)=>a.period.localeCompare(b.period))
    return {kind:'statistic',observations,unit:'percent_month_over_month_seasonally_adjusted',publishedAt:null,
      evidenceReady:false,limitation:'공식 SIDRA 전국 실질 소매 전체 전월비·계절조정. 발표일·이용 범위는 별도 검토하며 당일 환율 원인이나 가전 셀아웃으로 확대하지 않는다.'}
  }
  if(recipe.kind==='existing_brazil_json') {
    if(recipe.existingSource.id==='bcb-selic'&&(!Array.isArray(body)||body.some(row=>!/^\d{2}\/\d{2}\/\d{4}$/.test(row.data??'')||decimal(row.valor)===null)))
      throw new Error('bcb_schema_changed')
    if(recipe.existingSource.id==='ibge-retail-volume'&&(!Array.isArray(body)||!Array.isArray(body[0]?.resultados)
      ||body[0].resultados.some(r=>!Array.isArray(r.series))))throw new Error('ibge_schema_changed')
    return {...normalizeSnapshot(recipe.existingSource,body,asOf),kind:'statistic'}
  }
  if(recipe.kind==='bcrp_credit_json') {
    if(!Array.isArray(body?.config?.series)||body.config.series.length!==3||!Array.isArray(body.periods)||body.periods.length>120
      ||!PEN_LABELS.every((label,i)=>body.config.series[i]?.name?.includes(label)))throw new Error('bcrp_series_schema_changed')
    const observations=body.periods.flatMap(p=>{
      const match=/^([A-Za-z]+)\.(\d{4})$/.exec(p.name??'')
      const month=match?ES_MONTHS.indexOf(match[1].toLowerCase()):-1
      if(month<0||!Array.isArray(p.values)||p.values.length!==3)throw new Error('bcrp_period_schema_changed')
      const period=`${match[2]}-${String(month+1).padStart(2,'0')}`
      if(period>asOf.slice(0,7))return []
      return p.values.map((value,i)=>({period,seriesId:['PN07845NM','PN07846NM','PN07847NM'][i],label:body.config.series[i].name,value:decimal(value)}))
    })
    return {kind:'statistic',observations,unit:'percent_effective_annual',publishedAt:null,
      limitation:'은행권 현지통화 상품·만기별 금리. 정책금리·국가 소비자 평균·당일 환율 원인이 아님.'}
  }
  if(recipe.kind==='sfc_credit_json') {
    if(!Array.isArray(body)||body.length>100)throw new Error('sfc_schema_changed')
    const observations=body.map(row=>{
      const date=String(row.fecha_corte??'').slice(0,10)
      if(!validDate(date)||!row.tipo_de_cr_dito||!Object.hasOwn(row,'tasa_efectiva_promedio'))throw new Error('sfc_schema_changed')
      return {date,creditType:row.tipo_de_cr_dito,product:row.producto_de_cr_dito??null,term:row.plazo_de_cr_dito??null,
        value:decimal(row.tasa_efectiva_promedio),disbursed:decimal(row.montos_desembolsados),count:decimal(row.numero_de_creditos)}
    }).filter(row=>row.date<=asOf)
    return {kind:'statistic',observations,unit:'source_rate_unit_pending_review',publishedAt:null,
      resultMayBeTruncated:body.length>=recipe.limit,limitation:'제한된 원자료 행. 상품·기간·단위·가중 집계 미검토. 국가 평균 또는 법정 상한이 아님.'}
  }
  throw new Error('unsupported_statistic_adapter')
}

// At most one same-host post sitemap; remote XML cannot widen the source profile.
export function discoverRegisteredSitemap(xml,listingUrl,currency,{sourceId}={}) {
  const profile=newsPublisherProfile(sourceId,currency,listingUrl)
  if(!profile?.sitemapChild||typeof xml!=='string'||Buffer.byteLength(xml)>2_000_000)return null
  const choices=[]
  for(const entry of xml.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi)){
    const raw=/<loc\b[^>]*>([\s\S]*?)<\/loc>/i.exec(entry[1])?.[1]
    try{
      const url=new URL(decodeEntities(raw??'')),stamp=/<lastmod\b[^>]*>([\s\S]*?)<\/lastmod>/i.exec(entry[1])?.[1]
      if(url.protocol!=='https:'||url.hostname!==profile.host||url.username||url.password||url.port||url.search||url.hash
        ||!profile.sitemapChild.test(url.pathname))continue
      choices.push({url:url.href,modifiedAt:Number.isFinite(Date.parse(stamp??''))?new Date(stamp).toISOString():null})
    }catch{/* Invalid or foreign index. */}
  }
  choices.sort((a,b)=>(b.modifiedAt??'').localeCompare(a.modifiedAt??'')||a.url.localeCompare(b.url))
  return choices[0]??null
}

export function discoverRegisteredNews(html,listingUrl,currency,{sourceId,period,limit=2,deprioritizeUrls=[]}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>4)throw Error('invalid_news_candidate_limit')
  if(!Array.isArray(deprioritizeUrls)||deprioritizeUrls.length>500||deprioritizeUrls.some(u=>typeof u!=='string'))throw Error('invalid_discovery_feedback')
  const profile=sourceId?newsPublisherProfile(sourceId,currency,listingUrl):null
  const listing=new URL(listingUrl),seen=new Set(),candidates=[]
  const links=[...html.matchAll(/<a\b[^>]*href\s*=\s*(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi)]
  if(sourceId==='clp-biobio'&&html.trim().startsWith('{')){
    try{
      const feed=JSON.parse(html)
      if(feed.categorySlug==='economia'&&Array.isArray(feed.articles)&&feed.articles.length<=200)
        for(const article of feed.articles)if(typeof article.post_URL==='string'&&typeof article.post_title==='string')
          links.push(['','"',article.post_URL,article.post_title])
      // Publisher JSON's post_content is deliberately not article evidence.
    }catch{/* An invalid listing is not an empty verified market. */}
  }
  if(profile){
    for(const m of html.matchAll(/<(?:url|item)\b[^>]*>([\s\S]*?)<\/(?:url|item)>/gi)){
      const url=/<(?:loc|link)\b[^>]*>([\s\S]*?)<\/(?:loc|link)>/i.exec(m[1])?.[1]
      const title=/<(?:news:title|title)\b[^>]*>([\s\S]*?)<\/(?:news:title|title)>/i.exec(m[1])?.[1]
      if(url){
        const location=url.replace(/<!\[CDATA\[|\]\]>/g,'')
        if(title)links.push(['','"',location,title.replace(/<!\[CDATA\[|\]\]>/g,'')])
        else if(/<url\b/i.test(m[0])&&profile.sitemapChild){
          try{const slug=new URL(decodeEntities(location)).pathname.split('/').filter(Boolean).at(-1)??''
            links.push(['','"',location,slug.replaceAll('-',' '),'url_slug_not_title'])}catch{/* Invalid sitemap URL. */}
        }
      }
    }
  }
  for(const match of links) {
    try {
      const url=allowedResearchUrl(new URL(decodeEntities(match[2]),listing).href,currency),parsed=new URL(url)
      const label=decodeEntities(match[3].replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim()
      if(nonEconomicSection(url)||parsed.hostname!==listing.hostname||parsed.pathname===listing.pathname||parsed.search||seen.has(url)
        ||!/(?:d[oó]lar|dollar|peso|c[aâ]mbio|tipo.de.cambio)/i.test(label)
        ||label.length<18||label.length>300||(!profile&&parsed.pathname.split('/').filter(Boolean).length<2)
        ||profile&&!profile.path.test(parsed.pathname)
        ||/\/(?:tag|tags|autor|busqueda|search)\//i.test(parsed.pathname)||!profile&&/\/noticias\//i.test(parsed.pathname))continue
      seen.add(url);candidates.push({url,title:label,questionIds:['market'],publishedAt:null,publicationTimeBasis:'not_observed',
        ...(match[4]==='url_slug_not_title'?{discoveryLabelBasis:'url_slug_not_title'}:{})})
    }catch{/* A listing link is untrusted and is not article evidence. */}
  }
  const ranked=rankNewsCandidates(candidates,currency,{period,deprioritizeUrls})
  const feedDates=/<rss\b/i.test(html)?[...html.matchAll(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/gi)]
    .map(m=>Date.parse(m[1])).filter(Number.isFinite):[]
  return {candidates:ranked.slice(0,limit),omittedCandidates:Math.max(0,candidates.length-limit),absenceVerified:false,
    ...(feedDates.length?{feedCoverage:{latestItemPublishedAt:new Date(Math.max(...feedDates)).toISOString(),
      publicationMetadataOnly:true,completeCoverageVerified:false}}:{})}
}
