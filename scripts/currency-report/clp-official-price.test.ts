import { describe, expect, it, vi } from 'vitest'
import { CLP_PRICE_VERSION, bcchPriceUrl, discoverBcchPriceSeries, chileClockUtc,
  parseBcchPriceTable, parseBcchPriceSeries, mapBcchSessionDates, collectBcchPriceSeries, prepareOfficialClpResearch } from './clp-official-price.js'

// Synthetic HTML/series only. The separately saved live test verifies the actual
// methodology PDF hash and real originals; these fixtures do not count as history.
const months=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const url='https://si3.bcentral.cl/Indicadoressiete/secure/Serie.aspx?gcode=PRE_TCO&param=ABCDEFGHIJKLMNOPQRST='
const index=`<a href="${url.replace('&','&amp;')}">Ver serie</a>`
const prices: Record<string,number>={'2026-10-01':972.6,'2026-10-02':983.84,'2026-10-05':984.82,'2026-10-06':977.25,
  '2026-10-07':967.79,'2026-10-08':979.85,'2026-10-09':981.61,'2026-10-13':978.61,'2026-10-14':980.79,'2026-10-15':987.03,'2026-10-16':984.09}
function html(values=prices) {
  return '<label id="lblNombreSerie">D&#243;lar observado</label><label id="lblUnidadMedida">(Pesos por d&#243;lar)</label>'
    +'<label id="lblAnioValor">2026</label><table id="gr"><tr>'+['Día',...months].map(h=>`<th>${h}</th>`).join('')+'</tr>'
    +Array.from({length:31},(_,i)=>`<tr><td>${i+1}</td>`+months.map((_,m)=>{
      const day=`2026-${String(m+1).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`
      return `<td>${values[day]===undefined?'':values[day].toFixed(2).replace('.',',')}</td>`
    }).join('')+'</tr>').join('')+'</table>'
}
const table=()=>parseBcchPriceTable({raw:Buffer.from(html()),url,year:2026})
function syntheticSeries() {
  return {version:CLP_PRICE_VERSION,capturedAt:'2026-10-16T16:21:13.363Z',rawSha256:'a'.repeat(64),
    observations:mapBcchSessionDates(table().values).map(o=>({...o,observedAt:null,publishedAt:null,priceKind:'official_transaction_weighted_average'}))}
}
const prepare=(extra={})=>prepareOfficialClpResearch(syntheticSeries(),{
  throughSessionDate:'2026-10-15',asOf:'2026-10-16T16:22:00Z',...extra})

describe('CLP report-only official price adapter',()=>{
  it('discovers only the observed-dollar series and rejects wrong hosts, credentials, fragments and duplicate query keys',()=>{
    expect(discoverBcchPriceSeries(index)).toBe(url)
    for(const bad of [url.replace('si3.bcentral.cl','si3.bcentral.cl.evil.test'),url.replace('https://','https://user@'),
      url+'&gcode=PRE_TCO',url.replace('PRE_TCO','UF'),url+'#part']) expect(()=>bcchPriceUrl(bad)).toThrow('unregistered_bcch_url')
    expect(()=>discoverBcchPriceSeries(index+index.replace('ABCDEFGHIJKLMNOPQRST=','ZYXWVUTSRQPONMLKJIHG='))).toThrow('bcch_price_series_link_changed')
  })

  it('parses the official table layout and locale decimals without treating blank dates as zero',()=>{
    const result=table()
    expect(result.values).toHaveLength(11)
    expect(result.values.at(-1)).toEqual({effectiveDate:'2026-10-16',value:984.09})
    expect(result.blanks).toContain('2026-10-12')
    expect(result.values.some(v=>v.value===0)).toBe(false)
    const latin1=Buffer.from(html(),'latin1')
    expect(parseBcchPriceTable({raw:latin1,url,year:2026}).values).toEqual(result.values)
  })

  it('fails closed on changed year, headers, numeric format or nonexistent calendar values',()=>{
    expect(()=>parseBcchPriceTable({raw:Buffer.from(html()),url,year:2025})).toThrow('bcch_series_identity_changed')
    expect(()=>parseBcchPriceTable({raw:Buffer.from(html().replace('<th>Octubre</th>','<th>Changed</th>')),url,year:2026})).toThrow('bcch_grid_changed')
    expect(()=>parseBcchPriceTable({raw:Buffer.from(html().replace('984,09','984.09')),url,year:2026})).toThrow('bcch_invalid_price')
    expect(()=>parseBcchPriceTable({raw:Buffer.from(html({...prices,'2026-02-30':1})),url,year:2026})).toThrow('bcch_invalid_calendar_value')
  })

  it('resolves preceding official bank days across weekends but does not guess blank weekdays or year boundaries',()=>{
    const mapped=mapBcchSessionDates(table().values)
    expect(mapped.find(o=>o.effectiveDate==='2026-10-05')?.localSessionDate).toBe('2026-10-02')
    expect(mapped.find(o=>o.effectiveDate==='2026-10-13')).toMatchObject({localSessionDate:null,sessionDateBasis:'blank_weekday_calendar_unverified'})
    expect(mapped.find(o=>o.effectiveDate==='2026-10-16')?.localSessionDate).toBe('2026-10-15')
    expect(mapBcchSessionDates([{effectiveDate:'2026-01-02',value:900}])[0].localSessionDate).toBeNull()
  })

  it('converts aggregation cutoffs and scheduled web availability with Chilean DST rather than an assumed offset',()=>{
    expect(chileClockUtc('2026-10-15','16:00')).toBe('2026-10-15T19:00:00.000Z')
    expect(chileClockUtc('2026-07-15','17:30')).toBe('2026-07-15T21:30:00.000Z')
    expect(()=>chileClockUtc('2026-10-15','14:05')).toThrow('invalid_bcch_clock')
  })

  it('rejects unreviewed methodology bytes before any live request',async()=>{
    const fetchImpl=vi.fn()
    const result=await collectBcchPriceSeries({year:2026,methodologyRaw:Buffer.from('different PDF'),fetchImpl})
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toMatchObject({status:'failed',reason:'bcch_methodology_changed',requests:[],publicationApproved:false})
    expect(()=>parseBcchPriceSeries({raw:Buffer.from(html()),url,year:2026,capturedAt:'2026-10-16T16:22:00Z',methodologyRaw:Buffer.from('changed')})).toThrow('bcch_methodology_changed')
  })

  it('builds a separate research packet using transaction days, while keeping the report date and original input',()=>{
    const series=syntheticSeries(),before=JSON.stringify(series)
    const result=prepareOfficialClpResearch(series,{throughSessionDate:'2026-10-15',asOf:'2026-10-16T16:22:00Z'})
    expect(result.packet.baseDate).toBe('2026-10-16')
    expect(result.packet.observedDate).toBe('2026-10-15')
    expect(result.packet.series.slice(-2)).toEqual([{date:'2026-10-14',value:987.03},{date:'2026-10-15',value:984.09}])
    expect(result.packet.observationAt).toBeUndefined()
    expect(result.packet.facts.find(f=>f.id==='day')?.value).toBeCloseTo(-0.29786328683)
    expect(result.packet.assessment.publishDecision.eligible).toBe(false)
    expect(result.writingEligibility.reason).toBe('source_scope_and_reuse_review_required')
    expect(JSON.stringify(series)).toBe(before)
  })

  it('does not turn a later snapshot into historical availability or label an unprovided session as latest',()=>{
    expect(()=>prepare({asOf:'2026-10-15T23:00:00Z'})).toThrow('invalid_official_price_asof')
    expect(()=>prepare({throughSessionDate:'2026-10-16'})).toThrow('requested_session_price_missing')
  })

  it('aligns article sessions as context without replacing a weighted average with an ask quote or claiming causality',()=>{
    const articleQuotes=[{localSessionDate:'2026-10-14',value:985},{localSessionDate:'2026-10-15',value:982.1}].map(q=>({...q,
      currency:'CLP',unit:'LOCAL_PER_USD',publisher:'Emol',quoteSide:'ask',timeZone:'America/Santiago',priceKind:'publisher_reported_close',
      sessionDateBasis:'manual_original_review',rawSha256:'b'.repeat(64)}))
    const result=prepare({articleQuotes})
    expect(result.articleLink).toMatchObject({sessionAligned:true,pricesInterchangeable:false,directCauseAllowed:false,
      intradayCausalityVerified:false,directionAgrees:true})
    expect(result.publicationApproved).toBe(false)
    articleQuotes[1].localSessionDate='2026-10-16'
    expect(prepare({articleQuotes}).articleLink.status).toBe('hold')
  })
})
