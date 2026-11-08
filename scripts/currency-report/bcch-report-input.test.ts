import {describe,expect,it,vi} from 'vitest'
import {collectBcchApi,projectBcchApiResponse} from './bcch-api.js'
import {prepareBcchReportInput} from './bcch-report-input.js'
import {BCCH_METHOD} from './clp-official-price.js'
import {researchTimeScope} from './research-time-scope.js'
import {researchPlan,HARNESS_VERSION} from './research-harness.js'
import {packetBinding} from './rules.js'
import {collectHarnessResearch} from './live-research-local.js'
import {collectOriginal,questionSearchUrl} from './public-research-adapter.js'

// Synthetic bank payload and newspaper body. These are not real market cases.
const token='SYNTHETIC_REPORT_SOURCE_TOKEN'
const capturedAt='2026-10-26T10:24:09Z'
const range={firstDate:'2026-10-01',lastDate:'2026-10-26'}
const options={asOf:capturedAt,methodologySha256:BCCH_METHOD.sha256}
function raw() {
  const Obs=Array.from({length:26},(_,i)=>{
    const date=`2026-10-${String(i+1).padStart(2,'0')}`,weekend=[0,6].includes(new Date(date).getUTCDay())
    return {indexDateString:`${String(i+1).padStart(2,'0')}-10-2026`,
      value:weekend||i===11?'NaN':String(950+i),statusCode:weekend||i===11?'ND':'OK'}
  })
  return Buffer.from(JSON.stringify({Codigo:0,Series:{seriesId:BCCH_METHOD.seriesId,Obs}}))
}
const snapshot=()=>projectBcchApiResponse(raw(),{...range,token,capturedAt})
const prepared=()=>prepareBcchReportInput(snapshot(),options)
const article=(date:string)=>`<script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',
  datePublished:date,articleBody:'가격 기준과 날짜 관계만 확인하기 위한 합성 기사 본문이다.'})}</script>`
  +'<div id="cuDetalle_cuTexto_textoNoticia"><div>가격 기준과 날짜 관계만 확인하기 위한 합성 기사 본문이다.</div></div>'

describe('BCCh API to report and session-aware research (offline)',()=>{
  it('reuses calculations with a Friday transaction anchor and retains the Monday report date and ownership',()=>{
    const original=snapshot(),before=JSON.stringify(original),r=prepareBcchReportInput(original,options)
    expect(r.packet).toMatchObject({currency:'CLP',baseDate:'2026-10-26',observedDate:'2026-10-23',
      marketData:{reportPriceBasis:{sourceAdapter:'bcch-bde-api/1',attribution:{source:'Banco Central de Chile / BDE'}}}})
    expect(r.packet.facts.find(f=>f.id==='spot')?.value).toBe(975)
    expect(r.packet.facts.find(f=>f.id==='day')?.value).toBeCloseTo((975/972-1)*100)
    expect(r.questionPlan.questions.filter(q=>['market','local','global','counter'].includes(q.id))
      .map(q=>q.timeScope.anchorDate)).toEqual(Array(4).fill('2026-10-23'))
    expect(r.packet.marketData.reportPriceBasis.observations.at(-1)).toMatchObject({effectiveDate:'2026-10-26',
      localSessionDate:'2026-10-23',observationWindow:{endAt:'2026-10-23T19:00:00.000Z'},observedAt:null,publishedAt:null})
    expect(r.writingEligibility).toMatchObject({eligible:false})
    expect(r.publicationApproved).toBe(false)
    expect(JSON.stringify(original)).toBe(before)
  })

  it('recomputes saved session labels and stops at an unmapped latest day instead of falling back to older prices',()=>{
    const altered=snapshot()
    altered.observations.at(-1)!.localSessionDate='2026-10-26'
    expect(prepareBcchReportInput(altered,options).packet.observedDate).toBe('2026-10-23')
    const missing=snapshot()
    missing.observations=missing.observations.filter(o=>o.effectiveDate!=='2026-10-23')
    missing.missingDates.push('2026-10-23')
    expect(()=>prepareBcchReportInput(missing,options)).toThrow('latest_session_calendar_unverified')
    expect(prepareBcchReportInput(missing,{...options,throughSessionDate:'2026-10-21'}).packet.observedDate).toBe('2026-10-21')
  })

  it('blocks changed methodology, incompatible snapshots and values not yet available at the saved capture time',()=>{
    expect(()=>prepareBcchReportInput(snapshot(),{...options,methodologySha256:'f'.repeat(64)})).toThrow('bcch_methodology_changed')
    const wrong=snapshot();wrong.seriesId='OTHER'
    expect(()=>prepareBcchReportInput(wrong,options)).toThrow('invalid_api_research_snapshot')
    const future=snapshot();future.capturedAt='2026-10-23T19:30:00Z'
    expect(()=>prepareBcchReportInput(future,options)).toThrow('bcch_price_ahead_of_schedule')
  })

  it('performs one transport attempt, sanitizes connection failures and never retries or returns arbitrary HTTP errors',async()=>{
    const transport=vi.fn().mockRejectedValue(new Error(`https://example.test/?token=${token}`))
    await expect(collectBcchApi({...range,token,transport})).rejects.toThrow(/^api_transport_failed$/)
    expect(transport).toHaveBeenCalledTimes(1)
    const success=vi.fn().mockResolvedValue(raw())
    const r=await collectBcchApi({...range,token,transport:success,now:()=>capturedAt})
    expect(success).toHaveBeenCalledTimes(1)
    expect(r.observations.at(-1)?.value).toBe(975)
    expect(JSON.stringify(r)).not.toContain(token)
  })

  it('keeps consumption and watch windows at the report date and preserves legacy planners without official price metadata',()=>{
    const {packet}=prepared()
    expect(researchTimeScope(packet,'consumer')).toMatchObject({anchorDate:'2026-10-26',startDate:'2026-09-26',role:'sales_environment_context'})
    expect(researchTimeScope(packet,'watch')).toMatchObject({anchorDate:'2026-10-26',startDate:'2026-10-23',role:'subsequent_observation_context'})
    const legacy={...packet,marketData:{}}
    expect(researchPlan(legacy).questions[0].query).toContain('2026-10-26')
    expect(researchTimeScope(legacy,'market').dateBasis).toBe('report_date')
    const inconsistent=structuredClone(packet);inconsistent.observedDate='2026-10-22'
    expect(()=>researchPlan(inconsistent)).toThrow('unverified_research_price_session')
  })

  it('sends real-session dates through the existing search and original collector, rejecting out-of-window search hits',async()=>{
    const {packet}=prepared(),url='https://www.emol.com/noticias/Economia/2026/10/23/1/synthetic.html'
    const fetchImpl=vi.fn(async(rawUrl:string)=>rawUrl.includes('api.gdeltproject.org')?new Response(JSON.stringify({articles:[
      {title:'합성 거래일 기사',url,seendate:'20261023T180000Z'},
      {title:'이후 날짜 후보',url:url.replace('/23/','/26/'),seendate:'20261026T120000Z'},
      {title:'너무 이른 후보',url:url.replace('/23/','/21/'),seendate:'20261021T120000Z'},
    ]})):new Response(article('2026-10-26T09:00:00-03:00')))
    const dossier={version:HARNESS_VERSION,packetHash:packetBinding(packet),cards:[]}
    const result=await collectHarnessResearch({packet,dossier,asOf:'2026-10-26',maxQueries:4,fetchImpl})
    const searches=fetchImpl.mock.calls.filter(([u])=>u.includes('api.gdeltproject.org')).map(([u])=>new URL(u))
    expect(searches).toHaveLength(4)
    expect(searches.every(u=>u.searchParams.get('startdatetime')==='20261022030000'
      &&u.searchParams.get('enddatetime')==='20261024025959')).toBe(true)
    expect(result.discovery.candidates.map(c=>c.url)).toEqual([url])
    expect(result.originals[0]).toMatchObject({status:'collected_pending_review',originalVerified:false,
      priceTimeRelation:{publicationSessionRelation:'after_price_session',directCauseAllowed:false}})
    expect(result).toMatchObject({networkCalls:5,modelCalls:0,apiCostUsd:0,publicationApproved:false})
  })

  it('flags an after-cutoff article and an unknown publication time without inventing an event time or causal approval',async()=>{
    const scope=researchTimeScope(prepared().packet,'market'),candidate={url:'https://www.df.cl/mercados/synthetic'}
    const result=await collectOriginal({candidate,currency:'CLP',baseDate:'2026-10-26',timeScope:scope,
      fetchImpl:async()=>new Response(article('2026-10-23T17:00:00-03:00'))})
    expect(result.priceTimeRelation).toMatchObject({publicationSessionRelation:'same_local_session_day',
      publicationCutoffRelation:'published_after_aggregation_cutoff',directCauseAllowed:false})
    const unknown=await collectOriginal({candidate,currency:'CLP',baseDate:'2026-10-26',timeScope:scope,
      fetchImpl:async()=>new Response(article('2026-10-23T17:00:00'))})
    expect(unknown.priceTimeRelation).toMatchObject({publicationSessionRelation:'publication_unverified',publicationCutoffRelation:'exact_time_unverified'})
  })

  it('converts an explicit winter session window with DST and rejects backwards intervals before search',()=>{
    const url=new URL(questionSearchUrl({currency:'CLP',baseDate:'2026-07-17',startDate:'2026-07-16',questionId:'market'}))
    expect(url.searchParams.get('startdatetime')).toBe('20260716040000')
    expect(url.searchParams.get('enddatetime')).toBe('20260718035959')
    expect(()=>questionSearchUrl({currency:'CLP',baseDate:'2026-10-23',startDate:'2026-10-26',questionId:'local'}))
      .toThrow('invalid_question_search_start')
  })
})
