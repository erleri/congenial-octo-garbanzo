import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {expect,it,vi} from 'vitest'
import {inspectRobots,newsPublisherProfile,publisherAccessBarrier,articleOriginHints} from './news-publisher-access.js'
import {extractPublicArticle,collectOriginal,publicationMetadata} from './public-research-adapter.js'
import {discoverRegisteredNews,discoverRegisteredSitemap} from './registered-material-adapters.js'
import {sourceSelectionFixture} from './research-source-selection-fixtures.js'
import {planResearchSourceSelection} from './research-source-selection.js'
import {collectSelectedResearch} from './selected-source-collection.js'

it('discovers a saved registered article without a full date in its URL using publication metadata only as a hint',async()=>{
 const sourcePlan=JSON.parse(fs.readFileSync('docs/2.0/six-currency-explanation-sources-20261027.json','utf8'))
 const sourceRegister=JSON.parse(fs.readFileSync('docs/2.0/six-currency-source-register-20261027.json','utf8'))
 const input=sourceSelectionFixture('COP',{purpose:'fx_explanation',metric:'market_quote',period:'2026-10-27'})
 const plan=planResearchSourceSelection({input,sourcePlan,sourceRegister}),host='https://www.valoraanalitik.com',url=host+'/dolar-colombia-opaque-slug/'
 const text='<meta property="article:published_time" content="2026-10-27T20:00:00Z"><div class="entry-content" itemprop="text"><p>Synthetic dated body, not a real market explanation.</p></div>'
 const capture={sourceId:'cop-valora',url,text,sha256:createHash('sha256').update(text).digest('hex'),httpStatus:200,collectedAt:'2026-10-28T01:00:00Z'}
 const reads:string[]=[]
 const result=await collectSelectedResearch({input,sourcePlan,sourceRegister,requestIds:plan.sourceRequests.filter(r=>r.sourceId==='cop-valora').map(r=>r.requestId),
  captures:[capture],mode:'live',maxNetworkRequests:4,fetchImpl:async u=>{reads.push(String(u));return new Response(String(u).endsWith('/robots.txt')?'User-agent: *\nDisallow:':'<html><body>Empty rolling front page</body></html>')}})
 expect(result.originals.map(o=>o.url)).toContain(url)
 expect(reads).not.toContain(url)
 expect(result.reviewQueue.every(c=>c.status==='pending'&&c.writingEligible===false)).toBe(true)
 expect(result.modelCalls).toBe(0)
})

it('follows only one visible same-publisher recommendation after a date mismatch and never treats it as source text',async()=>{
 const sourcePlan=JSON.parse(fs.readFileSync('docs/2.0/six-currency-explanation-sources-20261027.json','utf8'))
 const sourceRegister=JSON.parse(fs.readFileSync('docs/2.0/six-currency-source-register-20261027.json','utf8'))
 const input=sourceSelectionFixture('COP',{purpose:'fx_explanation',metric:'market_quote',period:'2026-10-27'})
 const plan=planResearchSourceSelection({input,sourcePlan,sourceRegister}),host='https://www.valoraanalitik.com'
 const current=host+'/dolar-colombia-current/',prior=host+'/dolar-colombia-prior/'
 const article=(date,body)=>'<meta property="article:published_time" content="'+date+'T12:00:00Z"><div class="entry-content" itemprop="text">'+body+'</div>'
 const pages={[host+'/robots.txt']:'User-agent: *\nDisallow:',[host+'/']:'<a href="'+current+'">Dólar en Colombia cambia por nuevas condiciones</a>',
  [current]:article('2026-10-28','<p>Entirely synthetic current-session observation.</p><p><strong>Recomendado: <a href="https://evil.test/dolar-story/">Dólar fabricated offsite story</a><a href="'+prior+'">Dólar en Colombia en la rueda anterior</a></strong></p>'),
  [prior]:article('2026-10-27','<p>Entirely synthetic prior-session observation.</p>')}
 const reads:string[]=[]
 const result=await collectSelectedResearch({input,sourcePlan,sourceRegister,requestIds:plan.sourceRequests.filter(r=>r.sourceId==='cop-valora').map(r=>r.requestId),
  mode:'live',maxNetworkRequests:4,fetchImpl:async url=>{reads.push(String(url));return new Response(pages[String(url)]??'',{status:pages[String(url)]?200:404})}})
 expect(reads).toEqual([host+'/robots.txt',host+'/',current,prior])
 expect(result.originals).toHaveLength(2)
 expect(result.originals[0].blocks.map(b=>b.text)).toEqual(['Entirely synthetic current-session observation.'])
 expect(result.outcomes[0].candidates[1]).toMatchObject({url:prior,publicationVerified:false,discoveryMode:'related_body_link_one_hop'})
 expect(result.reviewQueue.every(c=>c.status==='pending')).toBe(true)
})

it('chooses only a registered same-host post sitemap and keeps URL labels and feed dates out of evidence',()=>{
 const host='https://www.revistaeconomia.com',listing=host+'/mercado/'
 const index='<sitemapindex><sitemap><loc>https://evil.test/post-sitemap99.xml</loc><lastmod>2099-01-01</lastmod></sitemap>'
  +'<sitemap><loc>'+host+'/post-sitemap2.xml</loc><lastmod>2026-10-27T12:00:00Z</lastmod></sitemap>'
  +'<sitemap><loc>'+host+'/wp-admin/post-sitemap3.xml</loc></sitemap></sitemapindex>'
 expect(discoverRegisteredSitemap(index,listing,'PEN',{sourceId:'pen-revistaeconomia'})?.url).toBe(host+'/post-sitemap2.xml')
 const found=discoverRegisteredNews('<urlset><url><loc>'+host+'/sol-cae-frente-al-dolar/</loc><lastmod>2026-10-27</lastmod></url></urlset>',
  host+'/post-sitemap2.xml','PEN',{sourceId:'pen-revistaeconomia'})
 expect(found.candidates[0]).toMatchObject({discoveryLabelBasis:'url_slug_not_title',publishedAt:null,publicationTimeBasis:'not_observed'})
 expect(found.absenceVerified).toBe(false)
})

it('uses a bounded RSS then sitemap fallback and leaves missing alternative indexes incomplete',async()=>{
 const sourcePlan=JSON.parse(fs.readFileSync('docs/2.0/six-currency-explanation-sources-20261027.json','utf8'))
 const sourceRegister=JSON.parse(fs.readFileSync('docs/2.0/six-currency-source-register-20261027.json','utf8'))
 const input=sourceSelectionFixture('PEN',{purpose:'fx_explanation',metric:'market_quote',period:'2026-10-27'})
 const selection=planResearchSourceSelection({input,sourcePlan,sourceRegister})
 const ids=selection.sourceRequests.filter(r=>r.sourceId==='pen-revistaeconomia').map(r=>r.requestId)
 const host='https://www.revistaeconomia.com',article=host+'/sol-cae-frente-al-dolar/'
 const pages={
  [host+'/robots.txt']:'User-agent: *\nDisallow: /wp-admin/',[host+'/mercado/']:'<p>No matching market article in this listing.</p>',
  [host+'/feed/']:'<rss><channel><item><title>Older business story</title><link>'+host+'/empresas/</link><pubDate>Tue, 20 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>',
  [host+'/sitemap_index.xml']:'<sitemapindex><sitemap><loc>'+host+'/post-sitemap2.xml</loc></sitemap></sitemapindex>',
  [host+'/post-sitemap2.xml']:'<urlset><url><loc>'+article+'</loc></url></urlset>',
  [article]:'<meta property="article:published_time" content="2026-10-27T12:00:00Z"><div class="td-post-content tagdiv-type"><p>Entirely synthetic market body.</p></div>',
 }
 const reads:string[]=[]
 const full=await collectSelectedResearch({input,sourcePlan,sourceRegister,requestIds:ids,mode:'live',maxNetworkRequests:6,
  fetchImpl:async url=>{reads.push(String(url));return new Response(pages[String(url)]??'',{status:pages[String(url)]?200:404})}})
 expect(reads).toEqual([host+'/robots.txt',host+'/mercado/',host+'/feed/',host+'/sitemap_index.xml',host+'/post-sitemap2.xml',article])
 expect(full.originals).toHaveLength(1);expect(full.reviewQueue[0].status).toBe('pending')
 const limited=await collectSelectedResearch({input,sourcePlan,sourceRegister,requestIds:ids,mode:'live',maxNetworkRequests:3,
  fetchImpl:async url=>new Response(pages[String(url)]??'')})
 expect(limited.networkCalls).toBe(3)
 expect(limited.outcomes.every(r=>r.status==='discovery_incomplete'&&r.reason==='alternative_index_unavailable')).toBe(true)
 expect(limited.originals).toEqual([])
})

it('keeps the Peru market source within its host, article path and unique visible body',()=>{
 const url='https://www.revistaeconomia.com/sol-retrocede-frente-al-dolar/'
 const profile=newsPublisherProfile('pen-revistaeconomia','PEN',url)
 expect(profile.path.test('/category/mercado/')).toBe(false)
 expect(profile.path.test('/soluciones-para-las-empresas/')).toBe(false)
 expect(profile.path.test('/wp-admin/')).toBe(false)
 expect(()=>newsPublisherProfile('pen-revistaeconomia','PEN','https://www.revistaeconomia.com.evil.test/')).toThrow('publisher_profile_mismatch')
 const body='<div class="td-post-content tagdiv-type"><p>Observed market movement.</p><div><p>Attributed explanation with its condition.</p></div></div>'
 expect(extractPublicArticle(url,'<p>Navigation claim.</p>'+body+'<p>Sidebar claim.</p>').blocks.map(b=>b.text))
  .toEqual(['Observed market movement.','Attributed explanation with its condition.'])
 expect(()=>extractPublicArticle(url,body+body)).toThrow('registered_article_wrapper_changed')
 expect(()=>extractPublicArticle(url,body.replace('td-post-content','new-container'))).toThrow('registered_article_wrapper_changed')
 expect(()=>extractPublicArticle(url,'<script type="application/ld+json">{"isAccessibleForFree":false}</script>'+body)).toThrow('publisher_paywall')
})

it('requires readable current robots for the Peru source before downloading any article body',async()=>{
 const url='https://www.revistaeconomia.com/sol-retrocede-frente-al-dolar/'
 for(const robots of [null,'<html>Access challenge</html>','User-agent: *\nDisallow: /sol-']){
  const reads:string[]=[]
  const result=await collectOriginal({candidate:{url},currency:'PEN',baseDate:'2026-10-28',fetchImpl:async target=>{
   reads.push(String(target));return new Response(robots,{status:robots===null?503:200})
  }})
  expect(result.status).toBe('not_collected')
  expect(reads).toEqual(['https://www.revistaeconomia.com/robots.txt'])
 }
})

it('reads Radio Camara episode text and its date without importing sidebar dates, credits or an invented observation time',()=>{
 const url='https://www.camara.leg.br/radio/programas/1081042-alta-do-dolar/'
 const body='<div class="g-artigo__descricao"><p>First attributed market explanation.</p><p>Material condition retained.</p>'
   +'<section><div class="g-artigo__descricao"><p>Apresentação: Presenter Name</p></div></section>'
   +'<div class="creditos-noticia"><p>Reuse notice, not article evidence.</p></div></div>'
 const html='<p class="g-artigo__data-hora">08/07/2024 - </p>'+body+'<p>27/10/2026 unrelated sidebar.</p>'
 expect(extractPublicArticle(url,html).blocks.map(b=>b.text)).toEqual(['First attributed market explanation.','Material condition retained.','Apresentação: Presenter Name'])
 expect(publicationMetadata(html,url)).toMatchObject({publishedAt:'2024-07-08',status:'date_only',modifiedAt:null})
 expect(publicationMetadata(html.replace('08/07/2024','31/02/2024'),url).publishedAt).toBeNull()
 expect(publicationMetadata(html+'<meta property="article:published_time" content="2024-07-09T12:00:00Z">',url).status).toBe('conflicting_metadata')
 expect(publicationMetadata('<p>08/07/2024</p>'+body,url).publishedAt).toBeNull()
 expect(()=>extractPublicArticle(url,html+body)).toThrow('registered_article_wrapper_changed')
 const profile=newsPublisherProfile('brl-camara-radio','BRL',url)
 expect(profile.path.test('/noticias/1081042-other-material')).toBe(false)
})

it('respects matching robot groups, wildcard paths, specific Allow and request identity without granting reuse rights',()=>{
 const robots='User-agent: *\nDisallow: /blocked\nDisallow: /*?s=\nAllow: /blocked/free$\nUser-agent: LATAM-FX\nDisallow: /private\nCrawl-delay: 2\nUser-agent: LATAM-FX\nDisallow: /other\n'
 expect(inspectRobots(robots,'https://example.com/blocked/free','Generic')).toMatchObject({allowed:true,licenseGranted:false})
 expect(inspectRobots(robots,'https://example.com/blocked/free/x','Generic').allowed).toBe(false)
 expect(inspectRobots(robots,'https://example.com/?s=dolar','Generic').allowed).toBe(false)
 expect(inspectRobots(robots,'https://example.com/other')).toMatchObject({allowed:false,crawlDelaySeconds:2})
 expect(inspectRobots(robots,'https://example.com/blocked')).toMatchObject({allowed:true,crawlDelaySeconds:2})
 expect(inspectRobots('User-agent: *\nDisallow:\nUser-agent: bingbot\nCrawl-delay: 1','https://example.com/story')).toMatchObject({allowed:true,crawlDelaySeconds:0})
 expect(()=>inspectRobots('<html><body>Access challenge</body></html>','https://example.com/story')).toThrow('invalid_robots_document')
 expect(()=>newsPublisherProfile('cop-valora','PEN','https://www.valoraanalitik.com/')).toThrow('publisher_profile_mismatch')
 expect(()=>newsPublisherProfile('cop-valora','COP','https://www.valoraanalitik.com.evil.test/')).toThrow('publisher_profile_mismatch')
})

it('blocks hidden premium article text even when structured data says free, while keeping a plain subscription link harmless',()=>{
 const html='<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":true,"articleBody":"Hidden paid paragraph"}</script><div class="sc__content sc__nota-premium paywall" style="display:none">Hidden paid paragraph</div>'
 expect(publisherAccessBarrier(html)).toBe('publisher_paywall')
 expect(()=>extractPublicArticle('https://elcomercio.pe/economia/peru/dolar-prueba-noticia/',html)).toThrow('publisher_paywall')
 expect(publisherAccessBarrier('<a href="/suscripciones/">Suscríbete</a><article><p>Open factual paragraph.</p></article>')).toBeNull()
})

it('keeps the complete Financial newspaper body after a nested recommendation and excludes the recommendation',()=>{
 const html='<p>Sidebar claim.</p><article class="b-article-body article-body-wrapper"><p>Observed market fact.</p><article><p>Unrelated promoted article.</p></article><blockquote>Important opposing interpretation.</blockquote><p>Final condition that must survive.</p></article><p>Footer claim.</p>'
 const result=extractPublicArticle('https://www.elfinanciero.com.mx/economia/2026/10/27/dolar-prueba/',html)
 expect(result.blocks.map(b=>b.text)).toEqual(['Observed market fact.','Important opposing interpretation.','Final condition that must survive.'])
 expect(()=>extractPublicArticle('https://www.elfinanciero.com.mx/economia/2026/10/27/dolar-prueba/',html.replace('b-article-body','changed'))).toThrow('registered_article_wrapper_changed')
})

it('extracts BioBio original paragraphs without its AI summary or later client-side article template',()=>{
 const html='<article id="post-123" data-url="https://www.biobiochile.cl/noticias/economia/actualidad-economica/2026/10/27/dolar-prueba.shtml"><div class="post-content clearfix"><div class="container-resumen-ia"><p>Duplicated AI summary.</p></div><p>First original statement.</p><div><blockquote>Attributed counterpoint.</blockquote></div></div></article><div class="post-content clearfix"><p>Unrendered template.</p></div>'
 const result=extractPublicArticle('https://www.biobiochile.cl/noticias/economia/actualidad-economica/2026/10/27/dolar-prueba.shtml',html)
 expect(result.blocks.map(b=>b.text)).toEqual(['First original statement.','Attributed counterpoint.'])
})

it('extracts Andina description and complete explanation before related social posts, with either observed heading wrapper',()=>{
 for(const heading of ['', '<h3>']){
  const html='<!-- DESCRIPCION --> First market observation.<!-- CONTENIDO DE LA NOTICIA --><div>Attributed explanation.</div><div>Important condition.</div>'+heading+'<div><strong>Más en Andina:</strong></div><p>Unrelated social post.</p>'
  expect(extractPublicArticle('https://andina.pe/agencia/noticia-dolar-prueba-1234567.aspx',html).blocks.map(b=>b.text)).toEqual(['First market observation.','Attributed explanation.','Important condition.'])
 }
})

it.each([
 ['https://forbes.com.mx/peso-prueba/','link-braces entry-content',''],
 ['https://www.valoraanalitik.com/dolar-prueba/','entry-content clear','itemprop="text"'],
 ['https://www.cooperativa.cl/noticias/economia/divisas/dolar/prueba/2026-10-27/123000.html','cuerpo-articulo contenedor-leermas',''],
 ['https://www.iprofesional.com/finanzas/123456-dolar-prueba','article-content',''],
])('uses only the identifiable free body and fails on ambiguous containers: %s',(url,classes,extra)=>{
 const body=`<div class="${classes}" ${extra}><p>Market evidence.</p><div><p>Qualifier retained.</p></div></div>`
 expect(extractPublicArticle(url,`<p>Navigation claim.</p>${body}<p>Sidebar claim.</p>`).blocks.map(b=>b.text)).toEqual(['Market evidence.','Qualifier retained.'])
 expect(()=>extractPublicArticle(url,body+body)).toThrow('registered_article_wrapper_changed')
})

it('ranks local COP explanations ahead of gold context and supports single-segment article URLs without accepting other-country paths',()=>{
 const listing='<a href="/oro-y-dolar-global/">El oro y el dólar global cambian con la Fed</a><a href="/dolar-colombia-oferta/">Dólar en Colombia cae por oferta local de divisas</a>'
 const found=discoverRegisteredNews(listing,'https://www.valoraanalitik.com/','COP',{sourceId:'cop-valora',limit:3})
 expect(found.candidates[0].url).toBe('https://www.valoraanalitik.com/dolar-colombia-oferta/')
 expect(found.candidates[0].publishedAt).toBeNull()
 const peru=discoverRegisteredNews('<a href="/argentina/2026/10/27/dolar-cae/">El dólar cae por demanda del mercado local</a>','https://www.infobae.com/peru/','PEN',{sourceId:'pen-infobae'})
 expect(peru.candidates).toEqual([])
 const chile=discoverRegisteredNews('<a href="/noticias/economia/divisas/dolar/prueba/2026-10-27/123000.html">El dólar cae en Chile por oferta local de divisas</a>',
  'https://www.cooperativa.cl/noticias/site/tax/port/all/cooperativataxport_6___1.html','CLP',{sourceId:'clp-cooperativa'})
 expect(chile.candidates).toHaveLength(1)
 const sitemap=discoverRegisteredNews('<urlset><url><loc>https://www.infobae.com/peru/2026/10/27/dolar-prueba/</loc><news:news><news:title><![CDATA[El dólar en Perú cae por oferta local de divisas]]></news:title></news:news></url></urlset>',
  'https://www.infobae.com/arc/outboundfeeds/news-sitemap/category/peru/','PEN',{sourceId:'pen-infobae'})
 expect(sitemap.candidates).toHaveLength(1)
 const json=discoverRegisteredNews(JSON.stringify({categorySlug:'economia',articles:[{post_URL:'https://www.biobiochile.cl/noticias/economia/actualidad-economica/2026/10/27/dolar-prueba.shtml',post_title:'El dólar en Chile cae por oferta local de divisas',post_content:'Not original article evidence.'}]}),
  'https://www.biobiochile.cl/lista/categorias/economia','CLP',{sourceId:'clp-biobio'})
 expect(json.candidates).toHaveLength(1)
 expect(json.candidates[0]).not.toHaveProperty('post_content')
 expect(articleOriginHints('https://example.com/story',[{text:'Con información de Reuters'}])).toMatchObject({creditedOrigins:['Reuters'],independence:'not_assessed',externalModelUse:'pending'})
})

it('does not fetch a disallowed publisher listing or repeatedly fetch robots across question intents',async()=>{
 const sourcePlan=JSON.parse(fs.readFileSync('docs/2.0/six-currency-explanation-sources-20261027.json','utf8'))
 const sourceRegister=JSON.parse(fs.readFileSync('docs/2.0/six-currency-source-register-20261027.json','utf8'))
 const input=sourceSelectionFixture('COP',{purpose:'fx_explanation',metric:'market_quote',period:'2026-10-27'})
 const selection=planResearchSourceSelection({input,sourcePlan,sourceRegister})
 const fetchImpl=vi.fn(async()=>new Response('User-agent: *\nDisallow: /'))
 const result=await collectSelectedResearch({input,sourcePlan,sourceRegister,mode:'live',fetchImpl,
  requestIds:selection.sourceRequests.filter(r=>r.sourceId==='cop-valora').map(r=>r.requestId)})
 expect(fetchImpl).toHaveBeenCalledTimes(1)
 expect(result.outcomes.every(o=>o.reason==='robots_disallowed')).toBe(true)
 expect(result.originals).toEqual([])
 expect(result).toMatchObject({modelCalls:0,publicationApproved:false})
 // Missing saved access policy must also stop before reading stored article text.
 const saved=await collectSelectedResearch({input,sourcePlan,sourceRegister,mode:'saved',
  requestIds:selection.sourceRequests.filter(r=>r.sourceId==='cop-valora').map(r=>r.requestId),
  captures:[{sourceId:'cop-valora',url:'https://www.valoraanalitik.com/',text:'<p>Stored body</p>',
   httpStatus:200,collectedAt:'2026-10-27T10:00:00Z',sha256:createHash('sha256').update('<p>Stored body</p>').digest('hex')}],now:()=> '2026-10-28T10:00:00Z'})
 expect(saved.outcomes.every(o=>o.reason==='robots_unavailable')).toBe(true)
 const direct=vi.fn(async()=>new Response('User-agent: *\nDisallow: /'))
 const blocked=await collectOriginal({candidate:{url:'https://www.valoraanalitik.com/dolar-prueba/'},currency:'COP',baseDate:'2026-10-27',fetchImpl:direct})
 expect(blocked).toMatchObject({status:'not_collected',reason:'robots_disallowed',networkCalls:1})
 expect(direct).toHaveBeenCalledTimes(1)
})

it('accepts a whole expanded country selection within one shared request budget, including unavailable sources',async()=>{
 const sourcePlan=JSON.parse(fs.readFileSync('docs/2.0/six-currency-explanation-sources-20261027.json','utf8'))
 const sourceRegister=JSON.parse(fs.readFileSync('docs/2.0/six-currency-source-register-20261027.json','utf8'))
 const input=sourceSelectionFixture('PEN',{purpose:'fx_explanation',metric:'market_quote',period:'2026-10-27'})
 const selection=planResearchSourceSelection({input,sourcePlan,sourceRegister})
 const requests=selection.sourceRequests.filter(r=>sourceRegister.newsRoutes.some(s=>s.id===r.sourceId&&s.discovery.mode==='existing_adapter'))
 expect(requests.length).toBeGreaterThan(8)
 const fetchImpl=vi.fn(async()=>new Response('User-agent: *\nDisallow: /'))
 const result=await collectSelectedResearch({input,sourcePlan,sourceRegister,requestIds:requests.map(r=>r.requestId),
  mode:'live',fetchImpl,maxNetworkRequests:2})
 expect(result.networkCalls).toBe(2)
 expect(new Set(result.outcomes.map(o=>o.sourceId)).size).toBe(6)
 expect(result.originals).toEqual([])
 expect(result.outcomes.some(o=>o.status==='not_attempted')).toBe(true)
})
