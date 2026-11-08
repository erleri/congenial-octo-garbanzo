import {createHash} from 'node:crypto'
import {describe,it,expect,vi} from 'vitest'
import {readSavedCountryOfficialPrice,readReviewedCountryArticlePrice,prepareCountryPriceConnection} from './country-price-connection.js'
import {marketCalendarDate} from './market-calendar.js'
import {originalPriceTimeRelation} from './research-time-scope.js'

// Synthetic mutation fixtures, not additional historical observations.
const asOf='2026-10-28T01:00:00Z',sessionDate='2026-10-26'
const capture=(url:string,text:string)=>{const raw=Buffer.from(text);return {url,rawBase64:raw.toString('base64'),sha256:createHash('sha256').update(raw).digest('hex'),httpStatus:200,capturedAt:'2026-10-27T16:00:00Z'}}
const urls={BRL:'https://ptax.bcb.gov.br/ptax_internet/consultarUltimaCotacaoDolar.do',COP:'https://www.datos.gov.co/resource/32sa-8pi3.json',
 PEN:'https://estadisticas.bcrp.gob.pe/estadisticas/series/api/PD04645PD-PD04646PD/json/2026-10-23/2026-10-26/esp',ARS:'https://api.bcra.gob.ar/estadisticas/v4.0/monetarias?idVariable=5'}
const trmRows=[{valor:'3185.01',unidad:'COP',vigenciadesde:'2026-10-23T00:00:00.000',vigenciahasta:'2026-10-23T00:00:00.000'},
 {valor:'3158.43',unidad:'COP',vigenciadesde:'2026-10-24T00:00:00.000',vigenciahasta:'2026-10-26T00:00:00.000'}]
const pen={config:{series:[{name:'Tipo de cambio - TC Cierre Compra - 01:30 PM (S/ por US$)'},{name:'Tipo de cambio - TC Cierre Venta - 01:30 PM (S/ por US$)'}]},periods:[{name:'23.Oct.26',values:['3.447','3.449']},{name:'26.Oct.26',values:['n.d.','n.d.']}]}
const ptax='<table><tr><th>Data</th><th>Taxa de Compra</th><th>Taxa de Venda</th></tr><tr><td>27/10/2026</td><td>5,3340</td><td>5,3346</td></tr></table>'
const ars={status:200,results:[{idVariable:5,descripcion:'Tipo de cambio mayorista de referencia',unidadExpresion:'Pesos argentinos por dólar estadounidense',periodicidad:'D',ultFechaInformada:'2026-10-26',ultValorInformado:1540.4751}]}
const brlHistoryUrl="https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@moeda='USD'&@dataInicial='10-23-2026'&@dataFinalCotacao='10-26-2026'&$top=30&$format=json&$orderby=dataHoraCotacao%20asc"
const arsHistoryUrl='https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/5?Desde=2026-10-19&Hasta=2026-10-26&Limit=10&Offset=0'
const brlHistory=()=>({value:['2026-10-23','2026-10-26'].flatMap((date,i)=>['Abertura','Intermediário','Intermediário','Intermediário','Fechamento'].map((tipoBoletim,j)=>({
 paridadeCompra:1,paridadeVenda:1,cotacaoCompra:5+i/2,cotacaoVenda:5.001+i/2,
 dataHoraCotacao:`${date} ${String(10+Math.min(j,3)).padStart(2,'0')}:${j===4?'01':'00'}:00.000`,tipoBoletim})))})
const arsHistory=()=>({status:200,metadata:{resultset:{count:2,offset:0,limit:10}},results:[{idVariable:5,detalle:[{fecha:'2026-10-26',valor:1540.4751},{fecha:'2026-10-23',valor:1528.263}]}]})
function article(currency='COP') {
 const sources={
  COP:{url:'https://www.larepublica.co/finanzas/precios-del-dolar-26-de-octubre-de-2026-synthetic',body:'<div class="html-content"><p>La divisa cerró a la baja en $3.157,57, con una diferencia de $0,86 frente a la TRM del día, que se ubica en $3.158,43.</p></div>',anchor:'La divisa cerró a la baja'},
  BRL:{url:'https://agenciabrasil.ebc.com.br/economia/noticia/2026-10/synthetic',body:'<div class="conteudo-noticia"><p>Mercado nesta segunda-feira (26). O dólar fechou em alta de 8,21%, a R$ 5,403.</p></div>',anchor:'nesta segunda-feira (26)'},
  PEN:{url:'https://gestion.pe/economia/mercados/dolar-lunes-26-de-octubre-synthetic/',body:'<article><p>El tipo de cambio terminó el día en S/ 3.443. Cabe mencionar que el viernes pasado cerró la jornada S/ 3.449 con datos oficiales.</p></article>',anchor:'El tipo de cambio terminó el día'},
  ARS:{url:'https://www.infobae.com/economia/2026/10/26/synthetic/',body:'<article><p>En la plaza mayorista la divisa interbancaria aumentó 11,50 pesos o 0,8%, a 1.541 pesos. Otras cotizaciones no son esta observación.</p></article>',anchor:'En la plaza mayorista la divisa interbancaria'},
 }
 const source=sources[currency as keyof typeof sources]
 const c=capture(source.url,`<meta property="article:published_time" content="2026-10-26T18:00:00Z"><meta property="article:modified_time" content="2026-10-26T19:00:00Z">${source.body}`)
 const review={sourceSha256:c.sha256,evidenceId:'news-synthetic',sessionDate,previousSessionDate:'2026-10-23',checkedOn:'2026-10-28',origin:'agent',status:'checked',reason:'합성 검증의 날짜·가격 구간 대조이며 실제 역사 근거 검토가 아니다.',blockPositions:[0],sessionAnchor:source.anchor}
 return {capture:c,review}
}
describe('Country price source and article connection',()=>{
 it('holds a paywalled saved article without reusing its quote or aborting other-country preparation',()=>{
  const a=article('PEN'),html=Buffer.from(a.capture.rawBase64,'base64').toString('utf8')
  const locked=capture(a.capture.url,html+'<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>')
  const result=prepareCountryPriceConnection({currency:'PEN',sessionDate,asOf,officialCaptures:[capture(urls.PEN,JSON.stringify(pen))],
   articleCapture:locked,articleReview:{...a.review,sourceSha256:locked.sha256}})
  expect(result).toMatchObject({status:'article_access_review_required',article:null,links:[],
   holds:['article_access_review_required'],generationMovement:null,caseDailyChange:null,publicationApproved:false})
  expect(result.officialAttempts[0].status).toBe('parsed')
 })
 it('keeps the COP same-day TRM match separate from spot and a daily return, including a sentence-final period',()=>{
  const a=article(),fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('forbidden'))
  try {
   const result=prepareCountryPriceConnection({currency:'COP',sessionDate,asOf,officialCaptures:[capture(urls.COP,JSON.stringify(trmRows))],articleCapture:a.capture,articleReview:a.review})
   expect(result.links.map(l=>l.status)).toEqual(['different_price_basis','same_effective_reference_value'])
   expect(result.article.comparison).toMatchObject({kind:'spot_vs_same_day_trm',dailyChangeClaimAllowed:false})
   expect(result.article.comparison?.difference).toBeCloseTo(-.86)
   expect(result.officialAttempts[0].snapshot?.observations[1]).toMatchObject({validFrom:'2026-10-24',validThrough:'2026-10-26',localSessionDate:null,observedAt:null})
   expect(result).toMatchObject({generationMovement:null,caseDailyChange:null,modelCalls:0,networkCalls:0,publicationApproved:false})
   expect(fetch).not.toHaveBeenCalled()
  }finally{fetch.mockRestore()}
 })
 it('does not collapse equal TRMs across different validity intervals or extend them past the certified end',()=>{
  const data=structuredClone(trmRows);data[0].valor=data[1].valor
  const result=readSavedCountryOfficialPrice('COP',capture(urls.COP,JSON.stringify(data)),asOf)
  expect(result.observations).toHaveLength(2);expect(result.observations[1].validThrough).toBe('2026-10-26')
  expect(()=>readSavedCountryOfficialPrice('COP',capture(urls.COP,JSON.stringify([...data,data[1]])),asOf)).toThrow('overlapping')
 })
 it('retains PEN missing values and unknown clock zone, rejecting an appended error instead of salvaging prices',()=>{
  const good=readSavedCountryOfficialPrice('PEN',capture(urls.PEN,JSON.stringify(pen)),asOf)
  expect(good.observations[1]).toMatchObject({status:'missing',bid:null,ask:null})
  expect(good).toMatchObject({timeZone:null,declaredClock:'13:30',observedAt:null})
  expect(()=>readSavedCountryOfficialPrice('PEN',capture(urls.PEN,JSON.stringify(pen)+'<html>server error</html>'),asOf)).toThrow()
 })
 it('records a PEN numeric match without silently converting an unspecified article side into official ask',()=>{
  const a=article('PEN'),result=prepareCountryPriceConnection({currency:'PEN',sessionDate,asOf,officialCaptures:[capture(urls.PEN,JSON.stringify(pen)),capture(urls.PEN,JSON.stringify(pen)+'<html>Error</html>')],articleCapture:a.capture,articleReview:a.review})
  expect(result.links[0]).toMatchObject({status:'numeric_match_side_or_clock_unverified',numericMatches:['ask'],articleAndOfficialInterchangeable:false})
  expect(result.links[1].status).toBe('official_date_missing')
  expect(result.officialAttempts[1]).toMatchObject({status:'rejected',reason:'full_response_invalid_json'})
  expect(result.article.comparison?.dailyChangeClaimAllowed).toBe(false)
 })
 it('holds a new PTAX reference date apart from the prior article spot close and detects swapped bid/ask columns',()=>{
  const a=article('BRL'),c=capture(urls.BRL,ptax)
  const result=prepareCountryPriceConnection({currency:'BRL',sessionDate,asOf,officialCaptures:[c],articleCapture:a.capture,articleReview:a.review})
  expect(result.links[0].status).toBe('official_date_missing')
  expect(result.officialAttempts[0].snapshot?.observations[0]).toMatchObject({referenceDate:'2026-10-27',bid:5.334,ask:5.3346,localSessionDate:null})
  expect(result.pairPreparation).toMatchObject({status:'held_missing_verified_pair',caseSessionDate:'2026-10-26',
   availableReferenceDates:['2026-10-27'],previousSessionDate:null,quoteSide:'must_select_and_preserve_bid_or_ask',strictWriterSupported:false})
  expect(result.article.reportedChange?.previousObservedValue).toBeNull()
  expect(()=>readSavedCountryOfficialPrice('BRL',capture(urls.BRL,ptax.replace('<th>Taxa de Compra</th><th>Taxa de Venda</th>','<th>Taxa de Venda</th><th>Taxa de Compra</th>')),asOf)).toThrow('table_changed')
 })
 it('keeps ARS wholesale close and official reference distinct and never back-calculates a previous observation from a reported delta',()=>{
  const a=article('ARS'),result=prepareCountryPriceConnection({currency:'ARS',sessionDate,asOf,officialCaptures:[capture(urls.ARS,JSON.stringify(ars))],articleCapture:a.capture,articleReview:a.review})
  expect(result.links[0]).toMatchObject({status:'different_price_basis',articleValue:1541,official:{value:1540.4751}})
  expect(result.article.reportedChange).toEqual({delta:11.5,pct:.8,previousObservedValue:null})
  expect(result.pairPreparation).toMatchObject({seriesId:5,requiredCount:2,availableReferenceDates:['2026-10-26'],
   previousSessionDate:null,articleCloseSubstitutionAllowed:false,suppliedValuesMayBeBackCalculated:false})
  const changed=structuredClone(ars);changed.results[0].idVariable=27
  expect(()=>readSavedCountryOfficialPrice('ARS',capture(urls.ARS,JSON.stringify(changed)),asOf)).toThrow('definition_changed')
 })
 it('refuses changed original hashes, another article date and a body unavailable at the cutoff',()=>{
  const a=article()
  expect(()=>readReviewedCountryArticlePrice('COP',{...a.capture,sha256:'0'.repeat(64)},a.review,asOf)).toThrow('invalid_saved_price_capture')
  expect(()=>readReviewedCountryArticlePrice('COP',a.capture,{...a.review,sessionDate:'2026-10-25'},asOf)).toThrow('date_anchor_changed')
  expect(()=>readReviewedCountryArticlePrice('COP',{...a.capture,capturedAt:'2026-10-26T18:15:00Z'},{...a.review,checkedOn:'2026-10-26'},'2026-10-26T18:30:00Z')).toThrow('body_after_cutoff')
 })
 it('does not guess a weekend as PEN previous Friday or derive the session from a publication timestamp',()=>{
  const a=article('PEN')
  expect(()=>readReviewedCountryArticlePrice('PEN',a.capture,{...a.review,previousSessionDate:'2026-10-25'},asOf)).toThrow('previous_session_review_required')
 })
 it.each(['BRL','COP','PEN','ARS'])('uses %s local publication day across UTC midnight without calling it the price observation time',currency=>{
  const metadata={publishedAt:'2026-10-27T01:00:00Z'}
  expect(marketCalendarDate(metadata.publishedAt,currency)).toBe('2026-10-26')
  expect(originalPriceTimeRelation(metadata,{priceSessionDate:'2026-10-26'},currency)).toMatchObject({publicationSessionRelation:'same_local_session_day',publicationCutoffRelation:'exact_time_unverified',directCauseAllowed:false})
  expect(marketCalendarDate('2026-10-27T01:00:00',currency)).toBeNull()
 })
})

describe('Bounded official historical observations',()=>{
 it('selects an explicit BRL closing bulletin pair without renaming it spot or assigning a timezone',()=>{
  const a=article('BRL'),c=capture(brlHistoryUrl,JSON.stringify(brlHistory()))
  const parsed=readSavedCountryOfficialPrice('BRL',c,asOf)
  expect(parsed.observations).toHaveLength(2)
  expect(parsed).toMatchObject({bulletinType:'Fechamento',sampleMeanChecked:true,timeZone:null,providerTimestampIsSpotTradeTime:false})
  const result=prepareCountryPriceConnection({currency:'BRL',sessionDate,asOf,officialCaptures:[c],articleCapture:a.capture,articleReview:a.review})
  expect(result.holds).not.toContain('same_basis_official_pair_missing')
  expect(result.holds).toContain('ptax_average_not_article_spot_close')
  expect(result.pairPreparation?.observedReferencePair).toMatchObject({previous:{referenceDate:'2026-10-23'},current:{referenceDate:'2026-10-26'},transactionSessionsVerified:false})
  expect(result).toMatchObject({generationMovement:null,caseDailyChange:null,publicationApproved:false})
 })
 it('requires the four survey mean and one complete closing bulletin rather than taking the last price',()=>{
  const data=brlHistory();data.value.at(-1)!.cotacaoVenda=9
  expect(()=>readSavedCountryOfficialPrice('BRL',capture(brlHistoryUrl,JSON.stringify(data)),asOf)).toThrow('brl_closing_bulletin_incomplete_or_inconsistent')
  const missing=brlHistory();missing.value=missing.value.filter(r=>r.tipoBoletim!=='Fechamento')
  expect(()=>readSavedCountryOfficialPrice('BRL',capture(brlHistoryUrl,JSON.stringify(missing)),asOf)).toThrow('brl_closing_bulletin_incomplete_or_inconsistent')
 })
 it('rejects paging, another currency, and duplicate bulletins instead of assuming historical completeness',()=>{
  const data=brlHistory()
  expect(()=>readSavedCountryOfficialPrice('BRL',capture(brlHistoryUrl,JSON.stringify({...data,'@odata.nextLink':'https://example.org/next'})),asOf)).toThrow('brl_history_schema_or_coverage_changed')
  expect(()=>readSavedCountryOfficialPrice('BRL',capture(brlHistoryUrl.replace("'USD'","'EUR'"),JSON.stringify(data)),asOf)).toThrow('historical_price_query_changed')
  expect(()=>readSavedCountryOfficialPrice('BRL',capture(brlHistoryUrl,JSON.stringify({value:[...data.value,data.value[0]]})),asOf)).toThrow('brl_history_schema_or_coverage_changed')
 })
 it('reads ARS variable 5 history and preserves the reference versus wholesale close distinction',()=>{
  const a=article('ARS'),c=capture(arsHistoryUrl,JSON.stringify(arsHistory()))
  const result=prepareCountryPriceConnection({currency:'ARS',sessionDate,asOf,officialCaptures:[c],articleCapture:a.capture,articleReview:a.review})
  expect(result.pairPreparation?.observedReferencePair).toMatchObject({seriesId:5,previous:{referenceDate:'2026-10-23',value:1528.263},current:{value:1540.4751}})
  expect(result.holds).not.toContain('latest_catalog_value_not_verified_session_pair')
  expect(result.holds).toContain('reference_session_mapping_and_fx_cause_review_required')
  expect(result.holds).toContain('weighted_reference_not_article_wholesale_close')
  expect(result.article.reportedChange?.previousObservedValue).toBeNull()
 })
 it('rejects an ARS variable, period, or coverage mismatch and an appended error document',()=>{
  const data=arsHistory();data.results[0].idVariable=4
  expect(()=>readSavedCountryOfficialPrice('ARS',capture(arsHistoryUrl,JSON.stringify(data)),asOf)).toThrow('ars_history_schema_or_coverage_changed')
  const wrongDate=arsHistory();wrongDate.results[0].detalle[0].fecha='2026-10-27'
  expect(()=>readSavedCountryOfficialPrice('ARS',capture(arsHistoryUrl,JSON.stringify(wrongDate)),asOf)).toThrow('ars_history_schema_or_coverage_changed')
  const incomplete=arsHistory();incomplete.metadata.resultset.count=3
  expect(()=>readSavedCountryOfficialPrice('ARS',capture(arsHistoryUrl,JSON.stringify(incomplete)),asOf)).toThrow('ars_history_schema_or_coverage_changed')
  expect(()=>readSavedCountryOfficialPrice('ARS',capture(arsHistoryUrl,JSON.stringify(arsHistory())+'<html>Error</html>'),asOf)).toThrow()
 })
 it('holds conflicting saved official pairs instead of silently picking a revision',()=>{
  const a=article('ARS'),changed=arsHistory();changed.results[0].detalle[0].valor=1550
  const result=prepareCountryPriceConnection({currency:'ARS',sessionDate,asOf,
   officialCaptures:[capture(arsHistoryUrl,JSON.stringify(arsHistory())),capture(arsHistoryUrl,JSON.stringify(changed))],articleCapture:a.capture,articleReview:a.review})
  expect(result.holds).toContain('conflicting_official_reference_pairs')
  expect(result.pairPreparation?.observedReferencePair).toBeNull()
  expect(result.generationMovement).toBeNull()
 })
})
