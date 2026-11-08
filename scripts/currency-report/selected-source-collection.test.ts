import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {describe,it,expect,vi} from 'vitest'
import {sourceSelectionFixture} from './research-source-selection-fixtures.js'
import {planResearchSourceSelection} from './research-source-selection.js'
import {collectSelectedResearch,validateSelectedReviewCard} from './selected-source-collection.js'
import {materialRecipe,savedMaterialUrlMatches} from './registered-material-adapters.js'
import {compileResearchSourceCatalog} from './research-source-selection.js'
import {reviewSelectedNewsMaterial,reviewSelectedStatisticMaterial} from './selected-material-review.js'
import {projectReviewedNewsNotes} from './reviewed-news-notes.js'
import {prepareSelectedReviewBatch} from './selected-review-batch.js'

const sourcePlan=JSON.parse(fs.readFileSync('docs/2.0/six-currency-explanation-sources-20261027.json','utf8'))
const sourceRegister=JSON.parse(fs.readFileSync('docs/2.0/six-currency-source-register-20261027.json','utf8'))
const sha=(text:string|Buffer)=>createHash('sha256').update(text).digest('hex')
const clock=()=> '2026-10-27T22:00:00Z'
const capture=(sourceId:string,url:string,text:string,httpStatus=200)=>({sourceId,url,text,httpStatus,sha256:sha(text),collectedAt:'2026-10-27T10:00:00Z'})
function fixture(currency='PEN',metric='consumer_credit',period='2026-09',purpose='economic_update',sourceId='pen-financing') {
  const input=sourceSelectionFixture(currency,{metric,period,purpose})
  const selection=planResearchSourceSelection({input,sourcePlan,sourceRegister})
  return {input,sourcePlan,sourceRegister,requestIds:selection.sourceRequests.filter(r=>r.sourceId===sourceId).map(r=>r.requestId),now:clock}
}
const penUrl='https://estadisticas.bcrp.gob.pe/estadisticas/series/api/PN07845NM-PN07846NM-PN07847NM/json/2026-06/2026-09/esp'
// Synthetic API bodies; actual saved provider data are replayed separately.
const penBody=JSON.stringify({config:{series:['Tarjeta de Crédito','Hasta 360 días','Más 360 días'].map(name=>({name}))},
  periods:[{name:'Ago.2026',values:['63.2','65.1','17.5']},{name:'Sep.2026',values:['64.1','66.2','18.6']}]})

describe('Selected public sources -> private pending card review',()=>{
  it('reuses fully read bounded response bytes across research dates without retaining a live transport clone',async()=>{
    const args=fixture('CLP','market_quote','2026-10-27','fx_explanation','clp-existing-four-outlets')
    const calls:string[]=[],reads:string[]=[]
    const fetchImpl=async(raw:unknown)=>{
      const url=String(raw);calls.push(url)
      const body=Buffer.from('<urlset></urlset>')
      return {status:200,url,redirected:false,headers:new Headers({'content-type':'application/xml'}),
        body:{async *[Symbol.asyncIterator](){reads.push(url);yield body}},
        clone(){throw Error('live_transport_clone_unavailable')}}
    }
    const result=await collectSelectedResearch({...args,mode:'live',fetchImpl,maxNetworkRequests:4,fairSourceBudgets:true})
    expect(calls).toHaveLength(2);expect(reads).toEqual(calls)
    expect(result.outcomes.every(o=>o.status==='no_candidates_in_listing')).toBe(true)
    expect(result.outcomes.every(o=>o.absenceVerified===false)).toBe(true)
    expect(result.modelCalls).toBe(0)
    const capped=await collectSelectedResearch({...args,mode:'live',fetchImpl:async(raw:unknown)=>{
      const r=await fetchImpl(raw)
      return {...r,body:{async *[Symbol.asyncIterator](){yield Buffer.alloc(4_000_001)}}}
    }})
    expect(capped.originals).toEqual([])
    expect(capped.outcomes.every(o=>o.status==='access_failed')).toBe(true)
  })
  it.each([
    ['COP','cop-larepublica','https://www.larepublica.co/finanzas/'],
    ['ARS','ars-infobae','https://www.infobae.com/economia/2026/10/27/'],
  ])('follows one registered article-link hop for %s review feedback, within the shared access and request bounds',async(currency,sourceId,base)=>{
    const args=fixture(currency,'market_quote','2026-10-27','fx_explanation',sourceId)
    const root=base+'dolar-cae-por-oferta-12345',child=base+'dolar-cae-por-demanda-12346',locked=base+'dolar-cae-por-tasas-12347'
    const grandchild=base+'dolar-cae-por-comercio-12348',calls:string[]=[]
    const article=(date:string,links='')=>'<script type="application/ld+json">'+JSON.stringify({
      '@type':'NewsArticle',datePublished:date,articleBody:'Synthetic market body retained for pending review; not real evidence.'})+'</script>'
      +'<div class="html-content"><p>Synthetic market body retained for pending review; not real evidence.</p></div>'+links
    const fetchImpl=async(raw:unknown)=>{
      const url=String(raw);calls.push(url)
      if(url.endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /')
      if(url===root)return new Response(article('2026-10-27T15:00:00Z',
        `<a href="${child}">El dólar cae por demanda de divisas</a><a href="${locked}">El dólar cae por tasas de interés</a>`
        +'<a href="https://unregistered.example/economia/dolar">El dólar cae por factores externos</a>'
        +`<a href="${base.replace('/finanzas/','/deportes/').replace('/economia/','/deportes/')}dolar-futbol">El dólar cae por oferta local</a>`))
      if(url===child)return new Response(article('2026-10-26T15:00:00Z',`<a href="${grandchild}">El dólar cae por comercio exterior</a>`))
      if(url===locked)return new Response('<script type="application/ld+json">{"isAccessibleForFree":false}</script>')
      return new Response(`<a href="${root}">El dólar cae por oferta de divisas</a>`)
    }
    const result=await collectSelectedResearch({...args,mode:'live',fetchImpl,maxNetworkRequests:4,
      discoveryFeedback:{preferAlternativeIndex:true,deprioritizeUrls:[]}})
    expect(result.networkCalls).toBe(4)
    expect(calls).toContain(child);expect(calls).toContain(locked)
    expect(calls).not.toContain(grandchild)
    expect(calls.some(url=>url.includes('unregistered.example')||url.includes('/deportes/'))).toBe(false)
    expect(result.originals.map(o=>o.url).sort()).toEqual([root,child].sort())
    expect(result.reviewQueue.find(q=>q.url===child).requestedPeriodMatch).toBe('different_publication_day')
    expect(result.publicationApproved).toBe(false)
    const capped=await collectSelectedResearch({...args,mode:'live',fetchImpl,maxNetworkRequests:3,
      discoveryFeedback:{preferAlternativeIndex:true,deprioritizeUrls:[]}})
    expect(capped.networkCalls).toBe(3)
    expect(capped.outcomes.every(row=>row.absenceVerified===false)).toBe(true)
    const routine=await collectSelectedResearch({...args,mode:'live',fetchImpl,maxNetworkRequests:5})
    expect(routine.networkCalls).toBe(2)
    expect(routine.originals.map(o=>o.url)).toEqual([root])
  })
  it('replays the registered publisher capture adapter automatically and keeps the requested date distinct from report and capture dates',async()=>{
    const args=fixture('CLP','market_quote','2026-10-23','fx_explanation','clp-existing-four-outlets')
    const url='https://www.emol.com/noticias/Economia/2026/10/23/1/dolar-synthetic.html'
    const body='<meta property="article:published_time" content="2026-10-23T15:00:00Z">'
      +'<div id="cuDetalle_cuTexto_textoNoticia"><p>Primer contexto sintético del dólar.</p><p>Condición sintética conservada.</p></div>'
    const fetchImpl=vi.fn(()=>{throw Error('saved_mode_must_not_fetch')})
    const result=await collectSelectedResearch({...args,mode:'saved',fetchImpl,
      captures:[capture('clp-existing-four-outlets',url,body)]})
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.networkCalls).toBe(0)
    expect(result.reviewQueue).toHaveLength(1)
    expect(result.originals[0]).toMatchObject({url,collectedAt:'2026-10-27T10:00:00Z',metadata:{publishedAt:'2026-10-23T15:00:00.000Z'}})
    expect(result.reviewQueue[0].targets.every(t=>t.requestedPeriod==='2026-10-23')).toBe(true)
    expect(validateSelectedReviewCard(result,result.reviewQueue[0]).publicationApproved).toBe(false)
  })
  it('reserves requests for the next registered publisher rather than letting the first source consume the entire country budget',async()=>{
    const args=fixture('COP','market_quote','2026-10-27','fx_explanation','cop-larepublica')
    const plan=planResearchSourceSelection(args),urls=[]
    const fetchImpl=vi.fn(async raw=>{
      const url=String(raw);urls.push(url)
      if(url.endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /')
      if(url.includes('larepublica.co/finanzas')&&!url.includes('12345'))return new Response([0,1].map(i=>
        `<a href="https://www.larepublica.co/finanzas/dolar-colombia-${12345+i}">El dólar en Colombia cae por oferta local</a>`).join(''))
      if(url.includes('12345'))return new Response('<script type="application/ld+json">'+JSON.stringify({
        '@type':'NewsArticle',datePublished:'2026-10-27T14:00:00Z',articleBody:'Synthetic observed source body, not a real market report.'})+'</script>')
      return new Response('<a href="https://www.valoraanalitik.com/dolar-prueba/">El dólar en Colombia cambia por oferta de divisas</a>')
    })
    const result=await collectSelectedResearch({...args,mode:'live',fetchImpl,maxNetworkRequests:4,fairSourceBudgets:true,
      requestIds:plan.sourceRequests.filter(r=>['cop-larepublica','cop-valora'].includes(r.sourceId)).map(r=>r.requestId)})
    expect(result.networkCalls).toBe(4)
    expect(result.sourceRequestBudgets.map(r=>({source:r.sourceId,spent:r.spent})))
      .toEqual([{source:'cop-larepublica',spent:2},{source:'cop-valora',spent:2}])
    expect(urls.some(u=>u.includes('valoraanalitik.com/robots.txt'))).toBe(true)
    expect(result.outcomes.filter(o=>o.sourceId==='cop-valora').every(o=>o.absenceVerified===false)).toBe(true)
  })
  it('looks in the registered article index when a nonempty listing only hints at another date, without treating the URL date as publication evidence',async()=>{
    const args=fixture('CLP','market_quote','2026-10-27','fx_explanation','clp-biobio'),calls=[]
    const base='https://www.biobiochile.cl',target=base+'/noticias/economia/actualidad-economica/2026/10/27/dolar-chile-prueba.shtml',
      other=base+'/noticias/economia/actualidad-economica/2026/10/28/dolar-chile-otro.shtml'
    const fetchImpl=vi.fn(async raw=>{
      const url=String(raw);calls.push(url)
      if(url.endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /')
      if(url.endsWith('/news-sitemap.xml'))return new Response(`<urlset><url><loc>${target}</loc><news:title>El dólar en Chile cae por oferta local</news:title></url></urlset>`)
      if(url.includes('/lista/'))return new Response(`<a href="${other}">El dólar en Chile cambia por oferta local</a>`)
      return new Response('<script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',
        datePublished:'2026-10-26T15:00:00Z'})+`</script><article id="post-123" data-url="${url}"><div class="post-content clearfix"><p>Synthetic metadata differs from the URL day.</p><p>Never relabel the stated publication date.</p></div></article>`)
    })
    const result=await collectSelectedResearch({...args,mode:'live',fetchImpl,maxNetworkRequests:5})
    expect(calls.indexOf(target)).toBeLessThan(calls.indexOf(other))
    expect(result.outcomes[0].discoveryAttempts[0].status).toBe('no_target_day_discovery_hint')
    expect(result.originals.find(o=>o.url===target).metadata.publishedAt).toBe('2026-10-26T15:00:00.000Z')
    expect(result.reviewQueue.find(q=>q.url===target).requestedPeriodMatch).toBe('different_publication_day')
    expect(result.publicationApproved).toBe(false)
    const originalBody=await (await fetchImpl(target)).text()
    const cached=await collectSelectedResearch({...args,mode:'saved',fetchImpl:()=>{throw new Error('forbidden')},captures:[
      capture('clp-biobio',base+'/robots.txt','User-agent: *\nAllow: /'),
      capture('clp-biobio',base+'/lista/categorias/economia',`<a href="${other}">El dólar en Chile cambia por oferta local</a>`),
      capture('clp-biobio',target,originalBody)]})
    expect(cached.networkCalls).toBe(0)
    expect(cached.outcomes[0].discoveryMode).toBe('registered_listing_and_explicit_saved_candidates')
    expect(cached.originals.some(o=>o.url===target)).toBe(true)
    // A matching URL day alone must not keep the collector on a previously
    // rejected story. Feedback opens the same registered index, within budget.
    const alternative=target.replace('prueba','otra-explicacion'),followed=[]
    const refreshed=await collectSelectedResearch({...args,mode:'live',maxNetworkRequests:5,
      discoveryFeedback:{preferAlternativeIndex:true,deprioritizeUrls:[target]},fetchImpl:async raw=>{
        const url=String(raw);followed.push(url)
        if(url.includes('/lista/'))return new Response(`<a href="${target}">El dólar en Chile cae por oferta local</a>`)
        if(url.endsWith('/news-sitemap.xml'))return new Response(`<urlset><url><loc>${alternative}</loc><news:title>El dólar en Chile ante demanda externa</news:title></url></urlset>`)
        return fetchImpl(raw)
      }})
    expect(followed.indexOf(alternative)).toBeGreaterThan(-1)
    expect(followed.indexOf(alternative)).toBeLessThan(followed.indexOf(target))
    expect(refreshed.outcomes[0].discoveryAttempts[0].status).toBe('review_feedback_alternative_lookup')
    expect(refreshed.networkCalls).toBeLessThanOrEqual(5)
  })
  it('rejects an excluded-source request before live access, with no handoff to manual collection',async()=>{
    const args=fixture('COP','market_quote','2026-10-26','fx_explanation','cop-larepublica')
    const selection=planResearchSourceSelection(args),catalog=compileResearchSourceCatalog(sourcePlan,sourceRegister)
    const fetchImpl=vi.fn(()=>{throw new Error('network forbidden')})
    for(const source of catalog.sources.filter(s=>s.discovery?.mode==='excluded')){
      expect(materialRecipe({sourceId:source.id,period:'2026-10-26'},catalog,sourceRegister)).toMatchObject({kind:'excluded'})
      expect(selection.sourceRequests.some(r=>r.sourceId===source.id)).toBe(false)
    }
    // IDs from a prior policy cannot bypass current selection, even alongside a valid request.
    await expect(collectSelectedResearch({...args,requestIds:[args.requestIds[0],'excluded-yahoo-request'],mode:'live',fetchImpl})).rejects.toThrow('explicit_selected_requests_required')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reuses a wider saved PEN response once, retains actual periods and gives both questions a bound pending card',async()=>{
    const args=fixture(),before=structuredClone(args.input),fetchImpl=vi.fn(()=>{throw new Error('forbidden')})
    const result=await collectSelectedResearch({...args,fetchImpl,captures:[capture('pen-financing',penUrl,penBody)]})
    expect(result).toMatchObject({networkCalls:0,modelCalls:0,newPaidCostUsd:0,publicationApproved:false})
    expect(result.outcomes[0].status).toBe('collected_pending_review')
    expect(result.reviewQueue).toHaveLength(1)
    expect(result.reviewQueue[0]).toMatchObject({actualPeriods:['2026-08','2026-09'],status:'pending',sourceUseStatus:'not_assessed'})
    expect(result.reviewQueue[0].targets.map(t=>t.needId)).toEqual(['economic_release','economic_scope'])
    expect(result.originals[0].observations).toHaveLength(6)
    expect(validateSelectedReviewCard(result,result.reviewQueue[0]).publicationApproved).toBe(false)
    const changed=structuredClone(result);changed.originals[0].observations[0].value=999
    expect(()=>validateSelectedReviewCard(changed,changed.reviewQueue[0])).toThrow('stale')
    expect(args.input).toEqual(before);expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([['[]',200,'empty_result'],['<html>broken</html>',200,'extraction_failed'],['blocked',403,'access_failed']])(
    'keeps a COP %s HTTP %s response as %s without inventing evidence',async(text,status,expected)=>{
      const args=fixture('COP','consumer_credit','2026-10-26','economic_update','cop-credit')
      const selection=planResearchSourceSelection(args),catalog=compileResearchSourceCatalog(sourcePlan,sourceRegister)
      const recipe=materialRecipe(selection.sourceRequests[0],catalog,sourceRegister)
      const result=await collectSelectedResearch({...args,captures:[capture('cop-credit',recipe.url,text,status)]})
      expect(result.outcomes[0].status).toBe(expected)
      expect(result.reviewQueue).toEqual([]);expect(result.outcomes[0].absenceVerified).toBe(false)
    })

  it('keeps missing captures, unconfigured MXN data and failed live reads distinct',async()=>{
    const saved=await collectSelectedResearch(fixture())
    expect(saved.outcomes[0]).toMatchObject({status:'not_attempted',reason:'saved_capture_missing'})
    const config=await collectSelectedResearch(fixture('MXN','retail','2026-09','economic_update','mxn-consumer'))
    expect(config.outcomes[0]).toMatchObject({status:'configuration_required',reason:'token_or_exact_public_series_required'})
    const fetchImpl=vi.fn(async()=>new Response('temporarily unavailable',{status:503}))
    const failure=await collectSelectedResearch({...fixture(),mode:'live',fetchImpl})
    expect(failure.outcomes[0].status).toBe('access_failed');expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not retry the same failed news URL for each research question, and continues the other source',async()=>{
    const args=fixture('PEN','market_quote','2026-10-26','fx_explanation','pen-rpp')
    const selection=planResearchSourceSelection(args)
    const requestIds=selection.sourceRequests.filter(r=>['pen-gestion','pen-rpp'].includes(r.sourceId)).map(r=>r.requestId)
    const fetchImpl=vi.fn(async()=>new Response('temporarily unavailable',{status:503}))
    const result=await collectSelectedResearch({...args,requestIds,mode:'live',fetchImpl})
    expect(result.outcomes).toHaveLength(6)
    expect(result.outcomes.every(r=>r.status==='access_failed')).toBe(true)
    expect(result.networkCalls).toBe(2);expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.reviewQueue).toEqual([])
  })

  it('does not turn an old period or missing values into the requested current observation',async()=>{
    const old=penBody.replace('Sep.2026','Jul.2026')
    const mismatch=await collectSelectedResearch({...fixture(),captures:[capture('pen-financing',penUrl,old)]})
    expect(mismatch.outcomes[0].status).toBe('period_mismatch')
    const missing=JSON.parse(penBody);missing.periods[1].values=['n.d.','','-']
    const noValues=await collectSelectedResearch({...fixture(),captures:[capture('pen-financing',penUrl,JSON.stringify(missing))]})
    expect(noValues.outcomes[0].status).toBe('values_missing')
    expect(noValues.originals[0].observations.filter(o=>o.period==='2026-09').every(o=>o.value===null)).toBe(true)
  })

  it('shares the Chile publisher failure across question intents instead of restarting its discovery',async()=>{
    const args=fixture('CLP','market_quote','2026-10-26','fx_explanation','clp-existing-four-outlets')
    const fetchImpl=vi.fn(async()=>new Response('unavailable',{status:503}))
    const result=await collectSelectedResearch({...args,mode:'live',fetchImpl,maxNetworkRequests:16})
    expect(result.outcomes).toHaveLength(3)
    expect(result.outcomes.every(o=>o.status==='access_failed')).toBe(true)
    expect(result.network.length).toBeGreaterThan(0)
    expect(new Set(result.network.map(n=>n.url)).size).toBe(result.network.length)
    expect(result.reviewQueue).toEqual([])
  })

  it('shares physical fetch failures across a five-day research window while preserving every requested day',async()=>{
    const args=fixture('CLP','market_quote','2026-10-26','fx_explanation','clp-existing-four-outlets')
    const dates=['2026-10-23','2026-10-24','2026-10-25','2026-10-26','2026-10-27']
    for(const rows of Object.values(args.input.requirements)){
      const template=rows[0];rows.splice(0,rows.length,...dates.map((period,i)=>({...template,id:`window-${i}`,period})))
    }
    const selection=planResearchSourceSelection(args)
    const fetchImpl=vi.fn(async()=>new Response('unavailable',{status:503}))
    const result=await collectSelectedResearch({...args,requestIds:selection.sourceRequests.filter(r=>r.sourceId==='clp-existing-four-outlets').map(r=>r.requestId),mode:'live',fetchImpl,maxNetworkRequests:2})
    expect([...new Set(result.outcomes.map(o=>o.period))].sort()).toEqual(dates)
    expect(result.network.length).toBeLessThanOrEqual(2)
    expect(fetchImpl).toHaveBeenCalledTimes(result.network.length)
    expect(new Set(result.network.map(n=>n.url)).size).toBe(result.network.length)
    expect(result.reviewQueue).toEqual([])
    expect(result.outcomes.every(o=>!o.absenceVerified)).toBe(true)
  })

  it('routes an explicitly reviewed statistic through existing scope cards while keeping unknown publication and use blocked',async()=>{
    const result=await collectSelectedResearch({...fixture(),captures:[capture('pen-financing',penUrl,penBody)]})
    const card=result.reviewQueue[0]
    const receipt={cardBinding:card.binding,checkedChecks:[...card.requiredChecks],observationIndexes:[3],
      review:{origin:'agent',status:'checked',checkedOn:'2026-10-27',reason:'Synthetic numeric, scope and period judgment, not an actual economic review.'},
      scopeDraft:{passageIds:['p0'],scope:{subject:'bank_credit_card',metric:'consumer_credit',unit:'percent_effective_annual',comparison:'level'},
        admittedClaims:[{id:'credit-value',kind:'source_fact',text:'합성 검사에서 9월 신용카드 금리 값은 실효 연율 64.1%다.',passageIds:['p0']}],
        allowedUse:'합성 자료에서 지정한 상품의 금리 수준 확인에만 사용한다.',countercontext:'정책금리·국가 평균·환율 원인으로 확대하지 않는다.',excludedExpansions:[],coverageGaps:[],crossSourceClaims:[]}}
    const reviewed=reviewSelectedStatisticMaterial({collection:result,card,receipt})
    const pending=prepareSelectedReviewBatch({collection:result})
    expect(pending).toMatchObject({manualUserTasks:[],externalDispatchAllowed:false,automaticContentReviewPerformed:false})
    expect(pending.items[0].status).toBe('automatic_review_unavailable')
    const batch=prepareSelectedReviewBatch({collection:result,receipts:[receipt]})
    expect(batch.items[0]).toMatchObject({status:'review_receipt_verified',writingEligibility:'not_assessed',publicationApproved:false})
    expect(batch.items[0].evidence).toEqual(reviewed)
    expect(()=>prepareSelectedReviewBatch({collection:result,receipts:[receipt,receipt]})).toThrow('duplicate')
    const mutated=structuredClone(result);mutated.originals[0].observations[3].value=999
    expect(prepareSelectedReviewBatch({collection:mutated,receipts:[receipt]}).items[0].status).toBe('invalid_original_binding')
    const invalid={...receipt,checkedChecks:[]}
    expect(prepareSelectedReviewBatch({collection:result,receipts:[invalid]}).items[0].status).toBe('review_result_invalid')
    expect(reviewed.evidence[0]).toMatchObject({period:'2026-09',publishedAt:null,eventDate:null,review:{reuse:'pending'}})
    expect(reviewed).toMatchObject({sourceUseStatus:'not_assessed',temporalStatus:'publication_unverified',writingEligibility:'not_assessed',publicationApproved:false})
    expect(()=>reviewSelectedStatisticMaterial({collection:result,card,receipt:{...receipt,observationIndexes:[0]}})).toThrow('period_review_required')
    expect(()=>reviewSelectedStatisticMaterial({collection:result,card,receipt:{...receipt,checkedChecks:[]}})).toThrow('scope_review_required')
  })

  it('rejects bad hashes, conflicting revisions and a changed selected source before approval or new fetching',async()=>{
    const args=fixture(),original=capture('pen-financing',penUrl,penBody)
    await expect(collectSelectedResearch({...args,captures:[{...original,sha256:'a'.repeat(64)}]})).rejects.toThrow('invalid_saved_material')
    const conflict=await collectSelectedResearch({...args,captures:[original,capture('pen-financing',penUrl,penBody+' ')]})
    expect(conflict.outcomes[0].status).toBe('revision_conflict')
    const changed=structuredClone(sourcePlan);changed.sources.find((s:{id:string})=>s.id==='pen-financing').notes+=' new source review'
    await expect(collectSelectedResearch({...args,sourcePlan:changed})).rejects.toThrow('explicit_selected_requests_required')
  })

  it('uses the existing monthly PDF review contract for saved CLP bytes without another index read',async()=>{
    const raw=Buffer.from('%PDF-1.7\nSynthetic PDF for storage boundary, not an economic source.\n%%EOF')
    const args=fixture('CLP','retail','2026-09','economic_update','clp-consumer')
    const result=await collectSelectedResearch({...args,pdfCaptures:[{sourceId:'cl-retail',period:'2026-09',
      url:'https://www.ine.gob.cl/docs/default-source/actividad-mensual-del-comercio/boletines/2026/septiembre-2026.pdf',
      sha256:sha(raw),bytes:raw.length,rawBase64:raw.toString('base64'),collectedAt:'2026-10-27T10:00:00Z',publishedAt:null}]})
    expect(result.outcomes[0].status).toBe('collected_pending_review')
    expect(result.reviewQueue[0]).toMatchObject({reviewAdapter:'chile_monthly_evidence',publicationStatus:'unverified'})
    expect(result.networkCalls).toBe(0)
  })

  it.each([
    ['COP','cop-larepublica','https://www.larepublica.co/finanzas','https://www.larepublica.co/finanzas/dolar-peso-prueba-12345'],
    ['PEN','pen-rpp','https://rpp.pe/economia','https://rpp.pe/economia/economia/dolar-prueba-noticia-12345'],
    ['ARS','ars-infobae','https://www.infobae.com/economia/','https://www.infobae.com/economia/2026/10/26/dolar-prueba/'],
  ])('collects %s article once across question intents and projects only explicitly reviewed notes',async(currency,sourceId,listing,url)=>{
    const args=fixture(currency,'market_quote','2026-10-26','fx_explanation',sourceId)
    const article='<script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',datePublished:'2026-10-26T12:00:00Z',
      articleBody:'Synthetic original says the peso weakened as the dollar strengthened.\nThe market interpretation is attributed, not a causal contribution estimate.'})+'</script>'
      +(currency==='COP'?'<div class="html-content"><p>Synthetic original says the peso weakened as the dollar strengthened.</p><p>The market interpretation is attributed, not a causal contribution estimate.</p></div>':'')
    const captures=[capture(sourceId,listing,`<a href="${url}">El dólar sube y el peso cambia de dirección</a>`),capture(sourceId,url,article)]
    const result=await collectSelectedResearch({...args,captures})
    expect(result.originals).toHaveLength(1);expect(result.reviewQueue).toHaveLength(1)
    const card=result.reviewQueue[0]
    const receipt={cardBinding:card.binding,checkedChecks:[...card.requiredChecks],
      source:{id:'news-synthetic',country:currency,publisher:'Synthetic publisher',author:'Synthetic author',url,
        publishedAt:'2026-10-26T12:00:00.000Z',publicationDisplay:'Explicit publisher timestamp',eventDate:'2026-10-26',collectedAt:'2026-10-27T10:00:00Z'},
      notes:[{id:'n0',kind:'fact',text:'합성 원문의 달러 강세와 현지통화 약세 사실을 독자적인 문장으로 기록한다.',attribution:null,reportedPrice:null}],
      review:{origin:'agent',status:'checked',reason:'Synthetic support judgment, not a historical news review.',supportingContentChecked:true,
        contentAccess:'publisher_page',independentlyWorded:true,notTranslation:true,notArticleSubstitute:true,checkedOn:'2026-10-27'},
      supportingReferences:[{noteId:'n0',blockPositions:[0],reason:'Synthetic support locator checked against the fixed original.'}],
      scopeDraft:{passageIds:['n0'],scope:{subject:'currency_market',metric:'reported_direction',unit:'qualitative',comparison:'same_day'},
        admittedClaims:[{id:'synthetic-fact',kind:'source_fact',text:'합성 원문에서 확인한 해당 날짜의 가격 방향만 기록한다.',passageIds:['n0']}],
        allowedUse:'합성 검사에서 지정한 당일 가격 방향의 검토에만 사용한다.',countercontext:'이 판단을 실제 역사 사례 또는 기여도 분석으로 확대하지 않는다.',excludedExpansions:[],coverageGaps:[],crossSourceClaims:[]},
      scopeReview:{origin:'agent',status:'checked',reason:'Synthetic reviewer scope judgment for contract verification.'}}
    const reviewed=reviewSelectedNewsMaterial({collection:result,card,receipt})
    expect(reviewed.sourceUseStatus).toBe('not_assessed');expect(reviewed.publicationApproved).toBe(false)
    const projected=projectReviewedNewsNotes(reviewed.evidence[0])
    expect(projected.passages[0].text).toBe(receipt.notes[0].text)
    expect(JSON.stringify(projected)).not.toContain('Synthetic original says')
    const bad=structuredClone(receipt);bad.supportingReferences[0].blockPositions=[999]
    expect(()=>reviewSelectedNewsMaterial({collection:result,card,receipt:bad})).toThrow('support_review_required')
  })

  it('enforces an actual network budget and does not bypass a publisher paywall',async()=>{
    const args=fixture('ARS','market_quote','2026-10-26','fx_explanation','ars-infobae')
    const url='https://www.infobae.com/economia/2026/10/26/dolar-prueba/'
    const fetchImpl=vi.fn(async(value:string)=>new Response(value.endsWith('/economia/')
      ?`<a href="${url}">El dólar sube y el peso cambia de dirección</a>`:'{"isAccessibleForFree":false}'))
    const limited=await collectSelectedResearch({...args,mode:'live',fetchImpl,maxNetworkRequests:1})
    expect(limited.networkCalls).toBe(1);expect(fetchImpl).toHaveBeenCalledTimes(1)
    const blocked=await collectSelectedResearch({...args,mode:'live',fetchImpl,maxNetworkRequests:2})
    expect(blocked.outcomes[0].issues).toContainEqual({status:'access_failed',reason:'publisher_paywall'})
    expect(blocked.reviewQueue).toEqual([]);expect(blocked.retries).toBe(0)
    const monthlyFetch=vi.fn(async()=>new Response('<a href="https://www.ine.gob.cl/docs/default-source/actividad-mensual-del-comercio/boletines/2026/septiembre-2026.pdf">Septiembre 2026</a>'))
    const monthly=await collectSelectedResearch({...fixture('CLP','retail','2026-09','economic_update','clp-consumer'),mode:'live',fetchImpl:monthlyFetch,maxNetworkRequests:1})
    expect(monthly.outcomes[0]).toMatchObject({status:'not_attempted',reason:'request_budget'})
    expect(monthlyFetch).toHaveBeenCalledTimes(1)
  })

  it('does not reuse a wider COP URL for a period outside its checked range',()=>{
    const args=fixture('COP','consumer_credit','2026-10-26','economic_update','cop-credit')
    const selection=planResearchSourceSelection(args),catalog=compileResearchSourceCatalog(sourcePlan,sourceRegister)
    const recipe=materialRecipe(selection.sourceRequests[0],catalog,sourceRegister)
    const parsed=new URL(recipe.url);parsed.searchParams.set('$where',"fecha_corte between '2026-10-01T00:00:00' and '2026-10-26T23:59:59'")
    parsed.searchParams.set('$limit','3')
    expect(savedMaterialUrlMatches(parsed.href,recipe,'2026-10-26')).toBe(true)
    expect(savedMaterialUrlMatches(parsed.href,{...recipe,range:{start:'2026-10-27',end:'2026-10-27'}},'2026-10-27')).toBe(false)
    parsed.searchParams.set('$select','*')
    expect(savedMaterialUrlMatches(parsed.href,recipe,'2026-10-26')).toBe(false)
  })
})
