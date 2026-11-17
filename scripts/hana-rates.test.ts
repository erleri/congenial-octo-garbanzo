import {it,expect,vi,afterEach} from 'vitest'
import {parseHanaRates,fetchHanaRates,HANA_CURRENCIES} from './hana-rates'

const row=(cells:string[])=>'<tr>'+cells.map(c=>`<td>${c}</td>`).join('')+'</tr>'
const initial=(date='2026년11월17일',round=1)=>`<p class="txtRateBox">기준일 : <strong>${date}</strong> 고시일시 : ${date} 08시24분06초 (${round}회차)</p>
 <table><thead><tr><th>미화환산율</th></tr></thead><tbody>${['BRL','MXN','CLP','COP'].map((currency,i)=>row([currency,...Array(9).fill('1'),['0.1729','0.0540','0.0010','0.0003'][i]])).join('')}</tbody></table>`
const cross=`<p class="txtRateBox">기준일 : 2026년11월17일</p><table><thead><tr><th>Cross Rate</th></tr></thead><tbody>${row(['PERU','Sol','PEN','391.66','3.40860'])}${row(['ARGENTINA','Peso','ARS','0.86','1,549.87500'])}</tbody></table>`
const captured='2026-11-17T12:00:00Z'
afterEach(()=>vi.restoreAllMocks())
it('uses reciprocals for four initial quotes and the direct Cross Rate for PEN and ARS',async()=>{
 const quotes=[...await parseHanaRates(initial(),'initial','2026-11-17',captured),...await parseHanaRates(cross,'cross','2026-11-17',captured)]
 expect(quotes.map(q=>q.currency)).toEqual(HANA_CURRENCIES)
 expect(quotes.map(q=>q.value)).toEqual([1/.1729,1/.0540,1000,1/.0003,3.4086,1549.875])
 expect(quotes[0].source).toMatchObject({provider:'hana_bank',providerDate:'2026-11-17',providerUpdatedAt:'2026-11-16T23:24:06.000Z',bankQuote:{rawValue:'0.1729',bulletin:1}})
 expect(quotes[4].source.providerUpdatedAt).toBeNull()
 expect(quotes[4].source.bankQuote?.bulletin).toBeNull()
})
it('rejects a latest bulletin, changed column, missing currency, invalid or zero rate',async()=>{
 for(const html of [initial(undefined,2),initial().replace('미화환산율','다른열'),initial().replace('BRL','XXX'),initial().replace('0.1729','0'),initial().replace('0.1729','NaN')]) {
  await expect(parseHanaRates(html,'initial','2026-11-17',captured)).rejects.toThrow()
 }
})
it('retains the actual prior bank day for weekends and rejects a future response',async()=>{
 const rates=await parseHanaRates(initial(),'initial','2026-11-21',captured)
 expect(rates.every(q=>q.date==='2026-11-17')).toBe(true)
 await expect(parseHanaRates(initial(),'initial','2026-11-16',captured)).rejects.toThrow('hana_reference_date_invalid')
})
it('sends two bounded public queries for initial and cross quotes, with their dates intact',async()=>{
 const fetchImpl=vi.fn(async (_url:string|URL|Request,options?:RequestInit)=>{
  const fields=options!.body as URLSearchParams
  expect(fields.get('inqStrDt')).toBe('20261117')
  expect(options!.redirect).toBe('error')
  return new Response(fields.get('inqKindCd')==='1'?initial():cross)
 })
 expect(await fetchHanaRates('2026-11-17',fetchImpl)).toHaveLength(6)
 expect(fetchImpl).toHaveBeenCalledTimes(2)
})
