import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
import {CURRENCIES} from '../src/types/exchangeRate'
import type {FxPriceSource} from '../src/types/exchangeRate'
import {recordPriceResponse,prunePriceProvenance} from '../src/lib/price-provenance'
import {buildDatasetFiles} from './dataset-files'

const cache=vi.hoisted(()=>({load:vi.fn(),save:vi.fn()}))
vi.mock('../src/lib/cache',()=>({loadAVSupplementalCache:cache.load,saveAVSupplementalCache:cache.save}))
const rates=(n:number)=>Object.fromEntries([...CURRENCIES,'KRW'].map(c=>[c,n]))
const feed=(withHole=true)=>{
 const history={'2026-10-26':rates(200),'2026-10-27':rates(210)}
 if(withHole)delete history['2026-10-26'].PEN
 return vi.fn(async(url:string|URL|Request)=>{
  const u=new URL(String(url));let payload:unknown
  if(u.hostname==='api.frankfurter.dev')payload={amount:1,base:'USD',start_date:'2026-10-26',end_date:'2026-10-27',rates:history}
  else if(u.hostname==='v6.exchangerate-api.com')payload={result:'success',time_last_update_utc:'Wed, 28 Oct 2026 03:00:00 +0000',conversion_rates:rates(400)}
  else if(u.hostname==='open.er-api.com')payload={result:'success',time_last_update_utc:'Wed, 28 Oct 2026 03:30:00 +0000',rates:rates(500)}
  else if(u.hostname==='latest.currency-api.pages.dev')payload={date:'2026-10-28',usd:ratesLower(600)}
  else if(u.hostname==='cdn.jsdelivr.net')payload={date:'2026-10-26',usd:ratesLower(350)}
  else if(u.hostname==='www.alphavantage.co')payload=u.searchParams.get('to_symbol')==='PEN'?{Note:'fixture quota limit'}:
   {'Meta Data':{'5. Last Refreshed':'2026-10-27 17:00:00','6. Time Zone':'UTC'},'Time Series FX (Daily)':{'2026-10-26':{'4. close':'300'},'2026-10-27':{'4. close':'310'}}}
  else throw new Error('unexpected_fixture_request')
  return new Response(JSON.stringify(payload),{status:200})
 })
}
const ratesLower=(n:number)=>Object.fromEntries(Object.entries(rates(n)).map(([c,v])=>[c.toLowerCase(),v]))
beforeEach(()=>{
 vi.resetModules();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-28T06:00:00Z'))
 vi.stubEnv('VITE_EXCHANGERATE_API_KEY','synthetic-test-key');vi.stubEnv('VITE_ALPHA_VANTAGE_API_KEY','synthetic-test-key')
 cache.load.mockReset().mockResolvedValue(null);cache.save.mockReset().mockResolvedValue(false)
})
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs()})

describe('Operational price provenance (offline response fixtures)',()=>{
 it('records the real winning provider through every existing overwrite stage without changing selected or derived values',async()=>{
  const fetch=feed();vi.stubGlobal('fetch',fetch)
  const {fetchRemoteExchangeData}=await import('../src/lib/merger')
  const data=await fetchRemoteExchangeData(new Date('2026-10-28T06:00:00Z'))
  const price=(c:string,d='2026-10-28')=>data.dailyRates.find(r=>r.currency===c&&r.date===d&&r.rateType==='LOCAL_PER_USD')?.value
  const source=(c:string,d='2026-10-28')=>data.priceProvenance!.sources[data.priceProvenance!.quotesByDate[d][c].sourceId]
  expect(price('BRL')).toBe(400);expect(price('MXN')).toBe(400);expect(price('CLP')).toBe(600)
  expect(price('PEN','2026-10-26')).toBe(350);expect(price('ARS','2026-10-27')).toBe(310)
  expect(source('BRL')).toMatchObject({provider:'exchange_rate_api',transport:'direct',providerUpdatedAt:'2026-10-28T03:00:00.000Z',dateMeaning:'utc_update_date',observedAt:null,localSessionDate:null})
  expect(source('CLP').provider).toBe('currency_api');expect(source('PEN','2026-10-26').provider).toBe('currency_api')
  expect(source('ARS','2026-10-27')).toMatchObject({provider:'alpha_vantage',priceKind:'provider_daily_close',providerTimeZone:'UTC',providerTimestampLocal:'2026-10-27 17:00:00',providerUpdatedAt:null})
  expect(source('BRL','2026-10-27').provider).toBe('frankfurter_v1')
  expect(data.dailyRates.find(r=>r.currency==='BRL'&&r.date==='2026-10-28'&&r.rateType==='KRW')?.value).toBe(1.5)
  expect(data.priceProvenance!.selectionAudit.open_er_latest.replacements).toBe(7)
  expect(data.priceProvenance!.selectionAudit.currency_latest.replacements).toBe(8)
  expect(JSON.stringify(data.priceProvenance)).not.toContain('synthetic-test-key')
  expect(fetch.mock.calls.every(([url])=>!String(url).includes('corsproxy')&&!String(url).includes('allorigins'))).toBe(true)
 })
 it('keeps legacy cache precedence visible and never attaches injected source metadata to an overriding unrecorded cache',async()=>{
  vi.stubGlobal('fetch',feed(false))
  const injected=await recordPriceResponse('alpha_vantage','https://www.alphavantage.co/query',{fixture:'injected'},
   {providerUpdatedAt:null,providerDate:null,dateMeaning:'provider_series_date',priceKind:'provider_daily_close'})
  cache.load.mockResolvedValue({fetchedAt:'2026-10-20T00:00:00Z',rates:{ARS:{'2026-10-26':900}}})
  const {fetchRemoteExchangeData}=await import('../src/lib/merger')
  const data=await fetchRemoteExchangeData(new Date(),{supplementalHistoryByCurrency:{ARS:{'2026-10-26':800}},supplementalPriceSources:{ARS:injected}})
  const quote=data.priceProvenance!.quotesByDate['2026-10-26'].ARS
  expect(quote.value).toBe(900)
  expect(data.priceProvenance!.sources[quote.sourceId]).toMatchObject({provider:'unverified_supplemental',origin:'cache_without_source_record',capturedAt:null,responseSha256:null})
 })
 it('retains missing provider timestamps as collection-date fallback, and excludes filled or externally changed prices from provenance',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({result:'success',rates:{CLP:1000}}))))
  const {fetchLatestRatesFromOpenErApi}=await import('../src/lib/api')
  const response=await fetchLatestRatesFromOpenErApi('USD')
  expect(response).toMatchObject({date:'2026-10-28',rates:{CLP:1000},priceSource:{dateMeaning:'collection_date_fallback',providerUpdatedAt:null,observedAt:null,localSessionDate:null}})
  const row={currency:'CLP' as const,year:2026,month:10,day:28,date:'2026-10-28',rateType:'LOCAL_PER_USD' as const,value:1000,status:'ok' as const,source:'API' as const,imputationMethod:'NONE' as const}
  const book={version:'fx-price-provenance/1' as const,sources:{s1:response!.priceSource!},quotesByDate:{'2026-10-28':{CLP:{sourceId:'s1',value:1000}}},selectionAudit:{}}
  expect(prunePriceProvenance(book,[row])!.sources.s1).toBeDefined()
  expect(prunePriceProvenance(book,[{...row,value:1001}])!.sources).toEqual({})
  expect(prunePriceProvenance(book,[{...row,source:'IMPUTED',imputationMethod:'FFILL'}])!.quotesByDate).toEqual({})
 })
 it('never forwards authenticated requests through public CORS proxies, while public fallback remains available',async()=>{
  const fetch=vi.fn(async()=>{throw new Error('fixture offline')});vi.stubGlobal('fetch',fetch)
  const {fetchJsonWithFallback}=await import('../src/lib/api')
  for(const url of ['https://www.alphavantage.co/query?apikey=synthetic-test-key',
   'https://v6.exchangerate-api.com/v6/synthetic-test-key/latest/USD','https://open.er-api.com/v6/latest/USD?access_token=synthetic-test-key']){
   fetch.mockClear();await expect(fetchJsonWithFallback(url)).rejects.toThrow('fixture offline')
   expect(fetch).toHaveBeenCalledTimes(1)
  }
  fetch.mockClear()
  await expect(fetchJsonWithFallback('https://open.er-api.com/v6/latest/USD')).rejects.toThrow('fixture offline')
  expect(fetch).toHaveBeenCalledTimes(3)
 })
 it('prunes the published fallback to its price coverage and leaves all prior numeric outputs unchanged',async()=>{
  vi.stubGlobal('fetch',feed(false));const {fetchRemoteExchangeData}=await import('../src/lib/merger')
  const data=await fetchRemoteExchangeData(new Date()),day=data.dailyRates[0]
  data.dailyRates.push({...day,year:2020,month:1,day:1,date:'2020-01-01'})
  data.priceProvenance!.quotesByDate['2020-01-01']={[day.currency]:{...data.priceProvenance!.quotesByDate[day.date][day.currency]}}
  const plain=structuredClone(data);delete plain.priceProvenance
  const a=buildDatasetFiles(data),b=buildDatasetFiles(plain)
  expect(a.fullDataset.dailyRates).toEqual(b.fullDataset.dailyRates)
  expect(a.staticFallback.dailyRates).toEqual(b.staticFallback.dailyRates)
  expect(a.staticFallback.monthlyRates).toEqual(b.staticFallback.monthlyRates)
  expect(a.staticFallback.movingComparison).toEqual(b.staticFallback.movingComparison)
  expect(a.fullDataset.priceProvenance!.quotesByDate['2020-01-01']).toBeDefined()
  expect(a.staticFallback.priceProvenance!.quotesByDate['2020-01-01']).toBeUndefined()
  expect(Buffer.byteLength(JSON.stringify(a.staticFallback))).toBeLessThan(5_000_000)
 })
 it('hashes parsed response content without saving the response body or query credentials',async()=>{
  const a=await recordPriceResponse('currency_api','https://latest.currency-api.pages.dev/v1/currencies',{usd:{clp:1000}},
   {providerUpdatedAt:null,providerDate:'2026-10-28',dateMeaning:'provider_payload_date',priceKind:'conversion_reference'})
  expect(a.responseSha256).toMatch(/^[a-f0-9]{64}$/);expect(a).not.toHaveProperty('payload')
  const fakeMetadata:Pick<FxPriceSource,'providerUpdatedAt'|'providerDate'|'dateMeaning'|'priceKind'>={providerUpdatedAt:null,providerDate:null,dateMeaning:'unverified',priceKind:'unverified'}
  await expect(recordPriceResponse('alpha_vantage','https://www.alphavantage.co/query?apikey=secret',{},fakeMetadata)).rejects.toThrow('unsafe_price_source_endpoint')
 })
})
