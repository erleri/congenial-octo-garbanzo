import {createHash} from 'node:crypto'
import {describe,it,expect,vi} from 'vitest'
import {preparePublisherClosePair,validatePublisherCloseBasis} from './publisher-close-pair.js'
import {verifiedFxMovement} from './fx-cause-input.js'
import {researchTimeScope} from './research-time-scope.js'
import {reportPriceSourceLabel,sourcePublicationTiming} from '../../src/lib/report-source-timing.js'

// Synthetic source/review contracts. Actual saved articles are replayed in a
// separate local audit, not counted as AI-quality or historical test samples.
function fixture(currency:'COP'|'ARS'='COP') {
 const dates=currency==='COP'?['2026-10-26','2026-10-27']:['2026-10-23','2026-10-26']
 const bodies=currency==='COP'?[
  'La divisa cerró a la baja en $3.157,57, con una diferencia de $0,86 frente a la TRM del día, que se ubica en $3.158,43.',
  'La divisa cerró a la baja en $3.147,92, con una diferencia de $10,02 frente a la TRM del día, que se ubicó en $3.157,94.',
 ]:[
  'El dólar mayorista ganó 1,50 peso o 0,1%, a $1.529,50, en una sesión de mercado. El dólar minorista es otro precio.',
  'En la plaza mayorista la divisa interbancaria aumentó 11,50 pesos o 0,8%, a 1.541 pesos. El MEP es otra cotización.',
 ]
 const captures=dates.map((date,i)=>{
  const url=currency==='COP'?`https://www.larepublica.co/finanzas/precios-del-dolar-${Number(date.slice(8))}-de-octubre-de-2026-synthetic`
   :`https://www.infobae.com/economia/2026/10/${date.slice(8)}/synthetic/`
  const raw=Buffer.from(`<script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',datePublished:`${date}T20:00:00Z`,dateModified:`${date}T21:00:00Z`})}</script>`+
   (currency==='COP'?`<div class="html-content"><p>${bodies[i]}</p></div>`:`<article><p>${bodies[i]}</p></article>`))
  return {url,httpStatus:200,capturedAt:'2026-10-28T10:00:00Z',rawBase64:raw.toString('base64'),sha256:createHash('sha256').update(raw).digest('hex')}
 })
 const reviews=captures.map((capture,i)=>({sourceSha256:capture.sha256,evidenceId:`synthetic-${i}`,origin:'agent',status:'checked',
  checkedOn:'2026-10-28',reason:'Synthetic explicit reported market quote and local session identity were checked.',
  sessionDate:dates[i],blockPositions:[0],sessionAnchor:currency==='COP'?'La divisa cerró a la baja':i===0?'El dólar mayorista ganó':'En la plaza mayorista la divisa interbancaria'}))
 return {currency,captures,reviews,asOf:'2026-10-28T12:00:00Z'}
}
function replaceText(input:ReturnType<typeof fixture>,index:number,from:string,to:string) {
 const capture=input.captures[index],raw=Buffer.from(Buffer.from(capture.rawBase64,'base64').toString('utf8').replace(from,to))
 capture.rawBase64=raw.toString('base64');capture.sha256=createHash('sha256').update(raw).digest('hex');input.reviews[index].sourceSha256=capture.sha256
}
describe('COP/ARS explicit reported price pair',()=>{
 it.each(['COP','ARS'] as const)('connects %s to the common price/date checks without authorizing writing or inventing a trade time',currency=>{
  const input=fixture(currency),before=structuredClone(input),fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('offline'))
  try {
   const r=preparePublisherClosePair(input),movement=verifiedFxMovement(r.packet)
   expect(movement).toMatchObject({comparisonKind:'two_reported_session_closes',dailyChangeClaimAllowed:false,observationAt:null,aggregationCutoffAt:null})
   expect(movement.changePct).toBeCloseTo(currency==='COP'?(3147.92/3157.57-1)*100:(1541/1529.5-1)*100,10)
   expect(researchTimeScope(r.packet,'market')).toMatchObject({startDate:input.reviews[0].sessionDate,anchorDate:input.reviews[1].sessionDate})
   expect(reportPriceSourceLabel(r.packet)).toContain(currency==='COP'?'La República':'Infobae')
   expect(sourcePublicationTiming({publishedAt:'2026-10-27T20:00:00Z'},r.packet)).toBeNull()
   expect(r).toMatchObject({sourceUse:'not_assessed_by_price_validation',fxCauseReview:'not_assessed_by_price_validation',
    paidCallAuthorized:false,publicationApproved:false,modelCalls:0,networkCalls:0})
   expect(fetch).not.toHaveBeenCalled();expect(input).toEqual(before)
  }finally{fetch.mockRestore()}
 })
 it('separates the COP spot/TRM gap from the change between the two reported market observations',()=>{
  const r=preparePublisherClosePair(fixture())
  expect(r.comparison.comparisonsWithTrm.map(c=>c.kind)).toEqual(['spot_vs_same_day_trm','spot_vs_same_day_trm'])
  expect(r.comparison.comparisonsWithTrm[1].difference).toBeCloseTo(-10.02,8)
  expect(r.comparison.changePct).not.toBeCloseTo((3147.92/3157.94-1)*100,4)
  expect(r.packet.facts[1].label).toContain('전후 거래일 사이')
 })
 it.each([
  ['changed original bytes',(x:ReturnType<typeof fixture>)=>{x.captures[0].rawBase64=Buffer.from('changed').toString('base64')}],
  ['wrong article session',(x:ReturnType<typeof fixture>)=>{x.reviews[1].sessionDate='2026-10-23'}],
  ['duplicate source observation',(x:ReturnType<typeof fixture>)=>{x.captures[1]=x.captures[0];x.reviews[1]=x.reviews[0]}],
  ['wrong registered publisher',(x:ReturnType<typeof fixture>)=>{x.captures[0].url=x.captures[0].url.replace('www.larepublica.co','example.org')}],
 ])('rejects %s before attaching the pair to a report',(_label,mutate)=>{
  const input=fixture();mutate(input);expect(()=>preparePublisherClosePair(input)).toThrow()
 })
 it('requires both explicit ARS observations and refuses missing/ambiguous anchors rather than back-calculating a prior value',()=>{
  const missing=fixture('ARS');replaceText(missing,0,'a $1.529,50','sin cotización explícita')
  expect(()=>preparePublisherClosePair(missing)).toThrow('article_price_anchor_changed')
  const duplicate=fixture('ARS');replaceText(duplicate,0,'El dólar minorista es otro precio.','El dólar mayorista ganó 1,50 peso o 0,1%, a $1.529,50, en otra frase.')
  expect(()=>preparePublisherClosePair(duplicate)).toThrow('article_price_anchor_changed')
 })
 it('requires publication, body revision and collection to form a consistent time sequence',()=>{
  const input=fixture();input.captures[1].capturedAt='2026-10-27T20:30:00Z'
  expect(()=>preparePublisherClosePair(input)).toThrow('explicit_session_close_required')
  const changed=fixture();replaceText(changed,1,'2026-10-27T21:00:00Z','2026-10-27T19:00:00Z')
  expect(()=>preparePublisherClosePair(changed)).toThrow('explicit_session_close_required')
 })
 it('does not let an official-reference label, extra history or a fabricated observation time survive shared validation',()=>{
  const packet=preparePublisherClosePair(fixture('ARS')).packet
  const reference=structuredClone(packet);reference.marketData.reportPriceBasis.priceKind='official_wholesale_reference'
  expect(()=>validatePublisherCloseBasis(reference.marketData.reportPriceBasis,reference)).toThrow('unverified_publisher_close_pair')
  expect(reportPriceSourceLabel(reference)).toBeNull()
  const extra=structuredClone(packet);extra.series.unshift({date:'2026-10-22',value:1528})
  expect(()=>verifiedFxMovement(extra)).toThrow('unverified_publisher_close_pair')
  const timed=structuredClone(packet);timed.observationAt='2026-10-26T20:00:00Z'
  expect(()=>researchTimeScope(timed,'market')).toThrow('unverified_publisher_close_pair')
 })
})
