import {describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {LOCAL_SOURCE_REGISTRY,fetchLocalSourceDiscovery,parseArticleMetadata,shortlistSitemapEntries} from './local-source-discovery.js'
import {extractPublicArticle} from './public-research-adapter.js'
import {collectPublisherResearch} from './publisher-research.js'

// Synthetic page boundaries, dates and source failures; not market evidence.
const [emol,reporte]=LOCAL_SOURCE_REGISTRY.CLP
const emolUrl='https://www.emol.com/noticias/Economia/2026/10/23/1/dolar-synthetic.html'
const reporteUrl='https://www.reporteminero.cl/noticia/noticias/2026/10/cobre-synthetic'
const xml=(url:string,lastmod='2026-10-23T09:00:00-03:00')=>`<urlset><url><loc>${url}</loc><lastmod>${lastmod}</lastmod></url></urlset>`
const meta=(url:string,date='2026-10-23T14:00:00')=>`<meta property="og:title" content="Dólar y cobre: síntesis ficticia">
  <meta property="og:url" content="${url}"><meta property="article:published_time" content="${date}">`
const emolPage=()=>meta(emolUrl)+'<p>Outside unrelated recommendation</p>'
  +'<div id="cuDetalle_cuTexto_textoNoticia"><div>Primer p&aacute;rrafo de d&oacute;lar con <b>atribución</b>.</div>'
  +'<div><br></div><div><div id="contRelacionada_1"><p>Related widget</p></div>Segundo párrafo con condición.</div></div>'
  +'<div id="cuDetalle_cuTexto_textoNoticiaLimpio"><p>Hidden duplicate</p></div>'
const reportePage=()=>meta(reporteUrl,'2026-10-23T09:00:00-03:00')
  +'<div class="col ck-content"><p>Primera comparación ficticia de cobre.</p><p>Condición de la comparación.</p><p>COMENTA AQUÍ</p></div>'
const packet=()=>({currency:'CLP',baseDate:'2026-10-26',observedDate:'2026-10-23',marketData:{reportPriceBasis:{
  seriesId:'F073.TCO.PRE.Z.D',dateBasis:'underlying_local_transaction_day',priceKind:'official_transaction_weighted_average',
  timeZone:'America/Santiago',observations:[{localSessionDate:'2026-10-22'},
    {localSessionDate:'2026-10-23',observationWindow:{endAt:'2026-10-23T19:00:00Z'}}]}}})
function responses() {
  return new Map([[emol.sitemapUrls('2026-10-23')[0],xml(emolUrl)],
    [reporte.sitemapUrls('2026-10-23')[0],xml(reporteUrl)],
    [emolUrl,emolPage()],[reporteUrl,reportePage()]])
}

describe('registered publisher research and original capture',()=>{
  it('holds conflicting saved editions and refuses a search date that would replace a verified price session',async()=>{
    const page=emolPage(),hash=(text:string)=>createHash('sha256').update(text).digest('hex')
    const first={url:emolUrl,text:page,sha256:hash(page),collectedAt:'2026-10-26T02:00:00Z',httpStatus:200}
    const next={...first,text:page+' revised',sha256:hash(page+' revised')}
    const fetchImpl=vi.fn()
    await expect(collectPublisherResearch({packet:packet(),mode:'saved',savedCaptures:[first,next],fetchImpl})).rejects.toThrow('explicit_capture_version_required')
    await expect(collectPublisherResearch({packet:packet(),searchDate:'2026-10-22',fetchImpl})).rejects.toThrow('publisher_search_date_not_compatible')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('extracts both inspected body wrappers while excluding hidden duplicates, recommendations and comment calls',()=>{
    const e=extractPublicArticle(emolUrl,emolPage())
    expect(e.blocks.map(b=>b.text)).toEqual(['Primer párrafo de dólar con atribución .','Segundo párrafo con condición.'])
    expect(e.coverage).toBe('registered_publisher_body')
    expect(extractPublicArticle(reporteUrl,reportePage()).blocks.map(b=>b.text))
      .toEqual(['Primera comparación ficticia de cobre.','Condición de la comparación.'])
    const jsonld='<script type="application/ld+json">{"@type":"NewsArticle","articleBody":"Unrelated body"}</script>'
    expect(()=>extractPublicArticle(emolUrl,jsonld+'<article><p>Unregistered replacement</p></article>'))
      .toThrow('registered_article_wrapper_changed')
  })

  it('uses the transaction interval through discovery and reuses each download for original extraction exactly once',async()=>{
    const map=responses(),fetchImpl=vi.fn(async(url:string)=>new Response(map.get(String(url))??'',{status:map.has(String(url))?200:404}))
    const r=await collectPublisherResearch({packet:packet(),fetchImpl})
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(r).toMatchObject({reportDate:'2026-10-26',timeScope:{anchorDate:'2026-10-23',startDate:'2026-10-22'},
      status:'originals_pending_review',networkCalls:4,modelCalls:0,publicationApproved:false})
    expect(r.originals).toHaveLength(2)
    expect(r.originals.every(o=>o.networkCalls===0&&o.originalVerified===false)).toBe(true)
    const e=r.originals.find(o=>o.url===emolUrl)!
    expect(e.metadata).toMatchObject({publishedAt:'2026-10-23T17:00:00.000Z',status:'registered_publisher_timezone',timeZone:'America/Santiago'})
    expect(e.priceTimeRelation).toMatchObject({publicationSessionRelation:'same_local_session_day',directCauseAllowed:false})
    expect(r.writingEligibility.eligible).toBe(false)
  })

  it('reports transport failure and malformed challenge pages separately from a valid empty source window',async()=>{
    const failed=await fetchLocalSourceDiscovery({currency:'CLP',baseDate:'2026-10-23',fetchImpl:async()=>{throw new Error('DNS failure')}})
    expect(failed).toMatchObject({status:'failed',reason:'source_collection_incomplete',candidates:[]})
    expect(failed.sourceResults.every(s=>s.issues[0].reason==='network_or_timeout')).toBe(true)
    const empty=await fetchLocalSourceDiscovery({currency:'CLP',baseDate:'2026-10-23',fetchImpl:async()=>new Response('<urlset></urlset>')})
    expect(empty).toMatchObject({status:'not_collected',reason:'no_relevant_articles'})
    const challenge=await fetchLocalSourceDiscovery({currency:'CLP',baseDate:'2026-10-23',fetchImpl:async()=>new Response('<html>Verify request</html>')})
    expect(challenge.sourceResults.every(s=>s.issues[0].reason==='invalid_sitemap')).toBe(true)
  })

  it('retains article read failures as partial collection when another publisher succeeds',async()=>{
    const map=responses()
    const r=await fetchLocalSourceDiscovery({currency:'CLP',baseDate:'2026-10-23',fetchImpl:async(url:string)=>
      String(url)===emolUrl?new Response('Unavailable',{status:503}):new Response(map.get(String(url)))})
    expect(r.status).toBe('partial_collected_for_review')
    expect(r.candidates.map(c=>c.url)).toEqual([reporteUrl])
    expect(r.sourceResults.find(s=>s.source==='emol-economia')).toMatchObject({status:'failed',
      issues:[{stage:'article',url:emolUrl,reason:'http_503'}]})
  })

  it('records a stream interruption without aborting other source reads',async()=>{
    const map=responses()
    const r=await fetchLocalSourceDiscovery({currency:'CLP',baseDate:'2026-10-23',fetchImpl:async(url:string)=>{
      if(String(url)===emolUrl) return new Response(new ReadableStream({start(c){c.error(new Error('interrupted stream'))}}))
      return new Response(map.get(String(url)))
    }})
    expect(r.sourceResults.find(s=>s.source==='emol-economia')?.issues[0].reason).toBe('body_read_failed')
    expect(r.candidates.map(c=>c.url)).toEqual([reporteUrl])
  })

  it('reads both month indexes when an explicit interval crosses a weekend and a month boundary',async()=>{
    const fetchImpl=vi.fn(async(url:string)=>new Response('<urlset></urlset>',{headers:{'content-location':url}}))
    await fetchLocalSourceDiscovery({currency:'CLP',baseDate:'2026-11-02',startDate:'2026-10-30',fetchImpl})
    const urls=fetchImpl.mock.calls.map(c=>String(c[0]))
    expect(urls).toContain(reporte.sitemapUrls('2026-10-30')[0])
    expect(urls).toContain(reporte.sitemapUrls('2026-11-02')[0])
    const older=emolUrl.replace('/10/23/','/10/30/')
    expect(shortlistSitemapEntries(xml(older),emol,'2026-11-02','2026-10-30').map(c=>c.url)).toEqual([older])
  })

  it('rejects a different canonical article and filters explicit-offset publication dates in the publisher timezone',()=>{
    expect(parseArticleMetadata(meta(emolUrl.replace('/1/','/2/')),emol,emolUrl,'2026-10-23')).toBeNull()
    const shifted=meta(reporteUrl,'2026-10-24T01:30:00Z')
    expect(parseArticleMetadata(shifted,reporte,reporteUrl,'2026-10-23','2026-10-23')?.publishedAt)
      .toBe('2026-10-24T01:30:00.000Z')
  })
})
