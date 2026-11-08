import {describe,it,expect} from 'vitest'
import {parseBanxicoCloseTable,prepareMxnPricePacket,BANXICO_CLOSE_URL,validateMxnPriceBasis} from './mxn-official-price.js'
import {verifiedFxMovement} from './fx-cause-input.js'
import {researchTimeScope,originalPriceTimeRelation} from './research-time-scope.js'
import {sourcePublicationTiming} from '../../src/lib/report-source-timing.js'

// Synthetic table and observations; real captured Banxico bytes are replayed separately.
const dates=['30/09/2026','19/10/2026','20/10/2026','21/10/2026','22/10/2026','23/10/2026','26/10/2026']
const values=[20,19.8,19.9,19.7,19.65,19.6,19.5]
const cell=(value:string)=>`<td>${value}</td>`
const html=()=>`CA18 Pesos por dólar <table><tr>${['Compra','Venta','T.C. Equilibrio','Máximo','Mínimo'].map(cell).join('')}</tr>${dates.map((d,i)=>
 `<tr>${i===1?cell('Cinco días hábiles bancarios previos'):i===6?cell('Última observación'):''}${cell(d)}${[18,22,values[i],23,17].map(n=>cell(n.toFixed(4))).join('')}</tr>`).join('')}</table>`
const snapshot=()=>parseBanxicoCloseTable({raw:Buffer.from(html()),url:BANXICO_CLOSE_URL,capturedAt:'2026-10-27T14:00:00Z'})
const packet=()=>prepareMxnPricePacket(snapshot(),{asOf:'2026-10-28T00:00:00+09:00',throughSessionDate:'2026-10-26'})
type Basis=ReturnType<typeof packet>['marketData']['reportPriceBasis']

describe('MXN report closing reference contract',()=>{
 it('selects the closing column, preserves the Friday/Monday sessions and leaves individual observation/release times unknown',()=>{
  const p=packet(),basis=p.marketData.reportPriceBasis,movement=verifiedFxMovement(p)
  expect(p.facts.find(f=>f.id==='spot')?.value).toBe(19.5)
  expect(movement).toMatchObject({unit:'MXN_per_USD',previousSessionDate:'2026-10-23',sessionDate:'2026-10-26',effectiveDate:null,
   direction:'local_stronger',observationAt:null,aggregationCutoffAt:'2026-10-26T20:05:00.000Z',articlePricesInterchangeable:false})
  expect(basis.observations[1]).toMatchObject({publishedAt:null,observedAt:null,settlementDate:null,scheduledWebAvailabilityAt:'2026-10-26T20:10:00.000Z'})
  expect(basis.coverage).toEqual({kind:'table_summary_reference_dates',dailyHistoryComplete:false})
  expect(p.facts.find(f=>f.id==='five')?.value).toBeCloseTo((19.5/19.8-1)*100)
  expect(p.facts.find(f=>f.id==='mtd')?.value).toBeCloseTo((19.5/20-1)*100)
 })
 it.each([
  ['FIX substituted for closing reference',(b:Basis)=>{b.seriesId='SF43718';b.priceKind='FIX'}],
  ['settlement date relabeled as session',(b:Basis)=>{b.observations[1].settlementDate='2026-10-28';b.observations[1].localSessionDate='2026-10-28'}],
  ['publication time promoted to observed tick',(b:Basis)=>{b.observations[1].observedAt='2026-10-26T20:10:00Z'}],
  ['aggregation window changed',(b:Basis)=>{b.observations[1].observationWindow.endAt='2026-10-26T20:00:00Z'}],
  ['mixed previous provider',(b:Basis)=>{b.observations[0].provider='another provider'}],
 ] as const)('rejects %s before the research/writer stage',(_,change)=>{
  const p=packet();change(p.marketData.reportPriceBasis)
  expect(()=>validateMxnPriceBasis(p.marketData.reportPriceBasis,p)).toThrow()
  expect(()=>researchTimeScope(p,'market')).toThrow()
 })
 it('recomputes every price comparison and chart row instead of trusting a relabeled stored fact',()=>{
  const p=packet();p.facts.find(f=>f.id==='five')!.value=99
  expect(()=>verifiedFxMovement(p)).toThrow('calculated_facts')
  const q=packet();q.series[0].value=1
  expect(()=>verifiedFxMovement(q)).toThrow('calculated_facts')
 })
 it('holds a changed table, missing banking row and a snapshot unavailable at the chosen cutoff',()=>{
  const parse=(text:string)=>parseBanxicoCloseTable({raw:Buffer.from(text),url:BANXICO_CLOSE_URL,capturedAt:'2026-10-27T14:00:00Z'})
  expect(()=>parse(html().replace('Compra</td><td>Venta','Venta</td><td>Compra'))).toThrow('column_order')
  expect(()=>parse(html().replace(/<tr><td>21\/10\/2026[\s\S]*?<\/tr>/,''))).toThrow('banking_rows')
  expect(()=>prepareMxnPricePacket(snapshot(),{asOf:'2026-10-26T21:00:00Z',throughSessionDate:'2026-10-26'})).toThrow('snapshot')
 })
 it('uses the Mexico local publication day while distinguishing publication-after-window from event timing',()=>{
  const p=packet(),scope=researchTimeScope(p,'market'),publishedAt='2026-10-27T03:30:00Z'
  expect(scope).toMatchObject({startDate:'2026-10-23',anchorDate:'2026-10-26'})
  expect(originalPriceTimeRelation({publishedAt},scope,'MXN')).toMatchObject({publicationSessionRelation:'same_local_session_day',
   publicationCutoffRelation:'published_after_aggregation_cutoff',directCauseAllowed:false})
  expect(sourcePublicationTiming({publishedAt},p)).toMatchObject({referenceKind:'aggregation_cutoff',relation:'published_after_reference'})
 })
})
