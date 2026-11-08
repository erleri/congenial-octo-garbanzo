// Node-only site adapters. Extract article blocks, not full pages or recommendation cards.
import { extractArticleBlocks, sourceTextHash } from './source-context.js'
import { LOCAL_SOURCE_REGISTRY, decodeEntities } from './local-source-discovery.js'
import {NEWS_PUBLISHERS,publisherAccessBarrier} from './news-publisher-access.js'

export const ARTICLE_ADAPTER_VERSION = 'article-context-adapters/1'
const MAX_PAGE_BYTES = 2_000_000
function cleanPage(html) {
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > MAX_PAGE_BYTES) throw new Error('article_page_too_large')
  return html.replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
}
// These sites use div wrappers. Track nesting instead of stopping at the first closing div.
function divRange(html, opening,tag='div') {
  const tokens = new RegExp(`<\\/?${tag}\\b[^>]*>`,'gi')
  tokens.lastIndex = opening.index
  let depth = 0, token
  while ((token = tokens.exec(html))) {
    depth += /^<\//.test(token[0]) ? -1 : 1
    if (!depth) return { start: opening.index, end: tokens.lastIndex, innerStart: opening.index + opening[0].length, innerEnd: token.index }
  }
  throw new Error('article_wrapper_unclosed')
}

// Observed free article containers. Never fall back to the whole page when a
// publisher moves its body, and never use hidden premium text.
export function extractExpandedPublisherArticle(url,page){
 const u=new URL(url),profile=Object.values(NEWS_PUBLISHERS).find(p=>p.host===u.hostname&&p.path.test(u.pathname))
 if(!profile)return null
 if(publisherAccessBarrier(page))throw Error('publisher_paywall')
 const selectors={
  'forbes.com.mx':m=>m[2].split(/\s+/).includes('entry-content')&&m[2].split(/\s+/).includes('link-braces'),
  'www.valoraanalitik.com':m=>m[2].split(/\s+/).includes('entry-content')&&/itemprop=["']text["']/.test(m[0]),
  'www.biobiochile.cl':m=>m[2].split(/\s+/).includes('post-content'),
  'www.cooperativa.cl':m=>m[2].split(/\s+/).includes('cuerpo-articulo'),
  'www.iprofesional.com':m=>m[2].split(/\s+/).includes('article-content'),
  'elcomercio.pe':m=>m[2].split(/\s+/).includes('sc__content')&&!/premium|paywall/.test(m[2]),
  'www.revistaeconomia.com':m=>m[2].split(/\s+/).includes('td-post-content')&&m[2].split(/\s+/).includes('tagdiv-type'),
 }
 let html=cleanPage(page)
 if(u.hostname==='www.camara.leg.br'){
  const descriptions=[...html.matchAll(/<div\b[^>]*class=["'][^"']*\bg-artigo__descricao\b[^"']*["'][^>]*>/gi)]
  if(!descriptions.length)throw Error('registered_article_wrapper_changed')
  const range=divRange(html,descriptions[0])
  if(descriptions.slice(1).some(m=>m.index>=range.innerEnd))throw Error('registered_article_wrapper_changed')
  let body=html.slice(range.innerStart,range.innerEnd)
  const credits=[...body.matchAll(/<div\b[^>]*class=["'][^"']*\bcreditos-noticia\b[^"']*["'][^>]*>/gi)]
  for(const opening of credits.reverse()){const bounds=divRange(body,opening);body=body.slice(0,bounds.start)+body.slice(bounds.end)}
  const blocks=extractArticleBlocks(body)
  return {blocks,adapter:'camara-radio-description/1',coverage:'registered_publisher_body',bodyHash:sourceTextHash(JSON.stringify(blocks))}
 }
 if(u.hostname==='www.elfinanciero.com.mx'){
  const starts=[...html.matchAll(/<article\b[^>]*class=["'][^"']*\bb-article-body\b[^"']*["'][^>]*>/gi)]
  if(starts.length!==1)throw Error('registered_article_wrapper_changed')
  const range=divRange(html,starts[0],'article')
  const blocks=extractArticleBlocks(html.slice(range.innerStart,range.innerEnd).replace(/<article\b[^>]*>[\s\S]*?<\/article>/gi,''))
  return {blocks,adapter:'expanded-free-publisher-body/1',coverage:'registered_publisher_body',bodyHash:sourceTextHash(JSON.stringify(blocks))}
 }
 if(u.hostname==='andina.pe'){
  const start=[...html.matchAll(/<!--[^>]*DESCRIPCION[^>]*-->/g)],middle=[...html.matchAll(/<!--[^>]*CONTENIDO DE LA NOTICIA[^>]*-->/g)]
  const end=/(?:<h[1-6]>\s*)?<div>\s*<strong>M[aá]s en Andina:/i.exec(html)
  if(start.length!==1||middle.length!==1||!end||!(start[0].index<middle[0].index&&middle[0].index<end.index))throw Error('registered_article_wrapper_changed')
  const description=html.slice(start[0].index+start[0][0].length,middle[0].index).trim()
  const content=html.slice(middle[0].index+middle[0][0].length,end.index)
   .replace(/<a\b[^>]*class=["'][^"']*ApplyC[^"']*["'][^>]*>[\s\S]*?<\/a>/gi,'')
  const paragraphs=content.split(/<\/?div\b[^>]*>/i).map(s=>s.trim()).filter(s=>s.replace(/<[^>]*>/g,'').trim())
  const blocks=extractArticleBlocks(`<p>${description}</p>`+paragraphs.map(s=>`<p>${s}</p>`).join(''))
  return {blocks,adapter:'andina-delimited-body/1',coverage:'registered_publisher_body',bodyHash:sourceTextHash(JSON.stringify(blocks))}
 }
 const selector=selectors[u.hostname]
 if(!selector)return null // Existing JSON-LD handling for CNN and Infobae.
 if(u.hostname==='www.biobiochile.cl'){
  const primary=[...html.matchAll(/<article\b[^>]*\bid=["']post-\d+["'][^>]*>/gi)]
   .filter(m=>decodeEntities(/\bdata-url=["']([^"']+)["']/.exec(m[0])?.[1]??'')===url)
  if(primary.length!==1)throw Error('registered_article_wrapper_changed')
  const range=divRange(html,primary[0],'article');html=html.slice(range.innerStart,range.innerEnd)
 }
 const wrappers=[...html.matchAll(/<div\b[^>]*\bclass=(["'])([^"']*)\1[^>]*>/gi)].filter(selector)
 if(wrappers.length!==1)throw Error('registered_article_wrapper_changed')
 const range=divRange(html,wrappers[0])
 let body=html.slice(range.innerStart,range.innerEnd).replace(/<article\b[^>]*>[\s\S]*?<\/article>/gi,'')
 if(u.hostname==='www.biobiochile.cl'){
  const summary=[...body.matchAll(/<div\b[^>]*class=["']container-resumen-ia["'][^>]*>/gi)]
  for(const opening of summary.reverse()){const bounds=divRange(body,opening);body=body.slice(0,bounds.start)+body.slice(bounds.end)}
 }
 const relatedArticles=[]
 if(u.hostname==='www.valoraanalitik.com'){
  body=body.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi,(paragraph,inner)=>{
   if(!/^Recomendado:\s*/i.test(decodeEntities(inner.replace(/<[^>]+>/g,' ')).trim()))return paragraph
   for(const m of inner.matchAll(/<a\b[^>]*href=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi)){
    try{const link=new URL(decodeEntities(m[2]),url),title=decodeEntities(m[3].replace(/<[^>]+>/g,' ')).trim()
     if(link.origin===u.origin&&!link.search&&!link.hash&&profile.path.test(link.pathname)&&link.href!==url&&title.length>=18&&title.length<=300
      &&relatedArticles.length<3&&!relatedArticles.some(r=>r.url===link.href))
      relatedArticles.push({url:link.href,title,publicationVerified:false})
    }catch{/* Recommendation links are untrusted discovery metadata. */}
   }
   return '' // A recommendation is not a fact in the article body.
  })
 }
 const blocks=extractArticleBlocks(body).filter(b=>!/^(?:Te interesa:|S[ií]guenos en Google|LEER ARTICULO COMPLETO$)/i.test(b.text))
 if(!blocks.length)throw Error('article_body_not_identified')
 return {blocks,adapter:u.hostname==='www.valoraanalitik.com'?'valora-free-publisher-body/2':'expanded-free-publisher-body/1',
  coverage:'registered_publisher_body',bodyHash:sourceTextHash(JSON.stringify(blocks)),...(relatedArticles.length?{relatedArticles}:{})}
}
// Observed Agência Brasil body wrapper. Do not fall back to whole-page text.
export function extractBrazilAgencyArticle(url,page) {
 const u=new URL(url)
 if(u.hostname!=='agenciabrasil.ebc.com.br'||!/^\/economia\/noticia\//.test(u.pathname))return null
 const html=cleanPage(page)
 const wrappers=[...html.matchAll(/<div\b[^>]*\bclass=(["'])([^"']*)\1[^>]*>/gi)].filter(m=>m[2].split(/\s+/).includes('conteudo-noticia'))
 if(wrappers.length!==1)throw Error('registered_article_wrapper_changed')
 const range=divRange(html,wrappers[0]),blocks=extractArticleBlocks(html.slice(range.innerStart,range.innerEnd))
 if(!blocks.length)throw Error('article_body_not_identified')
 return {blocks,adapter:'agencia-brasil-body/1',coverage:'registered_publisher_body',bodyHash:sourceTextHash(JSON.stringify(blocks))}
}
export function extractColombiaRepublicaArticle(url,page) {
 const u=new URL(url)
 if(u.hostname!=='www.larepublica.co'||!/^\/finanzas\//.test(u.pathname))return null
 const html=cleanPage(page)
 const wrappers=[...html.matchAll(/<div\b[^>]*\bclass=(["'])([^"']*)\1[^>]*>/gi)].filter(m=>m[2].split(/\s+/).includes('html-content'))
 if(wrappers.length!==1)throw Error('registered_article_wrapper_changed')
 const range=divRange(html,wrappers[0]),blocks=extractArticleBlocks(html.slice(range.innerStart,range.innerEnd))
 if(!blocks.length)throw Error('article_body_not_identified')
 return {blocks,adapter:'la-republica-body/1',coverage:'registered_publisher_body',bodyHash:sourceTextHash(JSON.stringify(blocks))}
}
function dfBlocks(page) {
  const html = cleanPage(page)
  const wrappers = [...html.matchAll(/<div\b[^>]*\bid=["']articleFree["'][^>]*>/gi)]
  if (wrappers.length !== 1) throw new Error('article_wrapper_missing_or_ambiguous')
  const range = divRange(html, wrappers[0])
  let body = html.slice(range.innerStart, range.innerEnd)
  // Recommendations contain actual paragraphs and must be removed before extraction.
  const widgets = /<div\b[^>]*\bclass=["'][^"']*(?:prontus-card-container|ad-df-slot)[^"']*["'][^>]*>/gi
  for (let opening; (opening = widgets.exec(body)); widgets.lastIndex = 0) {
    const widget = divRange(body, opening)
    body = body.slice(0, widget.start) + body.slice(widget.end)
  }
  // DF stores some quotations/attribution in leaf divs with br separators, outside p.
  body = body.replace(/<div\b[^>]*>((?:(?!<\/?div\b)[\s\S])*?)<\/div>/gi, (raw, inner) => {
    if (/<(?:p|blockquote|section|h[1-6]|img)\b/i.test(inner) || !inner.replace(/<[^>]+>/g, '').trim()) return raw
    const quoted = /^\s*(?:<[^>]+>\s*)*["“]/u.test(inner)
    return quoted ? `<blockquote>${inner}</blockquote>` : `<p>${inner}</p>`
  })
  return extractArticleBlocks(body)
}
function ltBlocks(page) {
  const html = cleanPage(page)
  const blocks = extractArticleBlocks(html)
  // Reviewed article boundaries for this fixed case, not a general La Tercera crawler.
  const start = blocks.findIndex(b => b.text.startsWith('El dólar inició las primeras operaciones'))
  const end = blocks.findIndex((b, i) => i >= start && b.text.startsWith('El precio spot del metal'))
  if (start < 0 || end < start) throw new Error('article_boundaries_missing')
  return blocks.slice(start, end + 1)
}

export function registeredChileanPublisher(url) {
  let u
  try {u=new URL(url)} catch {return null}
  if (u.protocol!=='https:' || u.port || u.username || u.password || u.search || u.hash) return null
  return LOCAL_SOURCE_REGISTRY.CLP.find(source=>source.hostnames.includes(u.hostname) && source.articlePath.test(u.pathname))??null
}

// Registered, inspected publisher wrappers only. No whole-page fallback if a
// known wrapper changes; hidden copies, menus and recommendations stay outside.
export function extractRegisteredChileanArticle(url,page) {
  const source=registeredChileanPublisher(url)
  if (!source) throw new Error('unsupported_registered_article')
  const html=cleanPage(page)
  const wrappers=source.id==='emol-economia'
    ? [...html.matchAll(/<div\b[^>]*\bid=["']cuDetalle_cuTexto_textoNoticia["'][^>]*>/gi)]
    : [...html.matchAll(/<div\b[^>]*\bclass=["'][^"']*\bck-content\b[^"']*["'][^>]*>/gi)]
  if (wrappers.length!==1) throw new Error('registered_article_wrapper_changed')
  const range=divRange(html,wrappers[0])
  let body=html.slice(range.innerStart,range.innerEnd)
  if (source.id==='emol-economia') {
    const related=/<div\b[^>]*\bid=["']contRelacionada_[^"']*["'][^>]*>/gi
    for(let opening;(opening=related.exec(body));related.lastIndex=0) {
      const widget=divRange(body,opening)
      body=body.slice(0,widget.start)+body.slice(widget.end)
    }
    // Emol's paragraphs are leaf divs. Preserve inline attribution and quotes.
    body=body.replace(/<div\b[^>]*>((?:(?!<\/?div\b)[\s\S])*?)<\/div>/gi,(raw,inner)=>
      /<(?:p|blockquote)\b/i.test(inner)?raw:`<p>${inner}</p>`)
  }
  const blocks=extractArticleBlocks(body).map(b=>({...b,text:decodeEntities(b.text)}))
    .filter(b=>!(source.id==='reporte-minero' && /^COMENTA AQUÍ$/i.test(b.text)))
  if(!blocks.length) throw new Error('registered_article_wrapper_changed')
  return {adapterVersion:'registered-clp-original/1',site:source.id,blocks,
    bodyHash:sourceTextHash(JSON.stringify(blocks)),sourceVersion:'current_page_not_archived'}
}
export function extractReviewedClpArticle(url, html) {
  const u = new URL(url)
  if (u.protocol !== 'https:' || u.search || u.hash || u.username || u.password) throw new Error('unsupported_article_url')
  const site = u.hostname === 'www.df.cl' && u.pathname === '/mercados/bolsa-monedas/dolar-hoy-n75vd' ? 'df' :
    u.hostname === 'www.latercera.com' && u.pathname === '/pulso/noticia/el-valor-del-dolar-en-chile-el-5-de-octubre-de-2026/' ? 'lt' : null
  if (!site) throw new Error('unsupported_article_url')
  const blocks = site === 'df' ? dfBlocks(html) : ltBlocks(html)
  return { adapterVersion: ARTICLE_ADAPTER_VERSION, site, blocks, bodyHash: sourceTextHash(JSON.stringify(blocks)),
    sourceVersion: 'current_page_not_archived' }
}
