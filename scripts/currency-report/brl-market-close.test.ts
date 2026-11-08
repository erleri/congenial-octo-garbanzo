import {describe,it,expect} from 'vitest'
import {createHash} from 'node:crypto'
import {prepareBrlMarketClosePacket,validateBrlCloseBasis} from './brl-market-close.js'
import {verifiedFxMovement} from './fx-cause-input.js'
import {researchTimeScope,originalPriceTimeRelation} from './research-time-scope.js'
import {prepareNewsNotesInput} from './news-notes-input.js'
import {prepareEventTrial} from './lifecycle-control.js'
import {reportPriceSourceLabel,sourcePublicationTiming} from '../../src/lib/report-source-timing.js'

// Synthetic article and review, not a historical source or quality sample.
const hash=(value:Buffer)=>createHash('sha256').update(value).digest('hex')
function fixture(body?:string) {
  const articleBody=body??'Os mercados fecharam nesta terça-feira (27). A moeda norte-americana caiu 1,07%, cotada a R$ 5,3488. Na segunda-feira (26), o dólar disparou 8,36% frente ao real, fechando a R$ 5,4066, após superar um patamar anterior.'
  const raw=Buffer.from(`<script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',datePublished:'2026-10-27T12:13:54Z',dateModified:'2026-10-28T01:54:09Z',articleBody})}</script>`)
  const capture={url:'https://www.cnnbrasil.com.br/economia/money/mercado/mercado-financeiro-ibovespa-dolar-27-outubro-2026/',
    httpStatus:200,capturedAt:'2026-10-28T06:22:30Z',rawBase64:raw.toString('base64'),sha256:hash(raw)}
  const review={sourceSha256:capture.sha256,origin:'agent',status:'checked',checkedOn:'2026-10-28',
    reason:'Synthetic explicit same-publisher session pair and comparison verified.',sessionDate:'2026-10-27',previousSessionDate:'2026-10-26'}
  const options={asOf:'2026-10-28T07:00:00Z'}
  return {capture,review,options,packet:()=>prepareBrlMarketClosePacket(capture,review,options)}
}
describe('BRL publisher-stated market close boundary',()=>{
  it('computes only the explicitly reported interval and leaves the trade time and longer statistics unavailable',()=>{
    const x=fixture(),before=structuredClone(x.capture),p=x.packet(),movement=verifiedFxMovement(p)
    expect(movement).toMatchObject({provider:'CNN Brasil (com informações da Reuters)',priceKind:'reported_spot_close',
      unit:'BRL_per_USD',previous:5.4066,current:5.3488,sessionDate:'2026-10-27',observationAt:null,aggregationCutoffAt:null})
    expect(movement.changePct).toBeCloseTo(-1.0690637369141442,10)
    expect(p.facts.map(f=>f.id)).toEqual(['spot','day'])
    expect(reportPriceSourceLabel(p)).toBe('CNN Brasil / Reuters · 현물시장 종가 보도값')
    expect(sourcePublicationTiming({publishedAt:'2026-10-27T12:00:00Z'},p)).toBeNull()
    expect(researchTimeScope(p,'market')).toMatchObject({startDate:'2026-10-26',anchorDate:'2026-10-27',dateBasis:'publisher_stated_local_session_day'})
    expect(originalPriceTimeRelation({publishedAt:'2026-10-27T15:00:00Z'},researchTimeScope(p,'market'),'BRL')).toMatchObject({publicationCutoffRelation:'exact_time_unverified'})
    expect(x.capture).toEqual(before)
  })
  it.each([
    ['source bytes changed',(x:ReturnType<typeof fixture>)=>{x.capture.rawBase64=Buffer.from('changed').toString('base64')}],
    ['wrong session URL',(x:ReturnType<typeof fixture>)=>{x.capture.url=x.capture.url.replace('27-outubro','26-outubro')}],
    ['prior trading day relabeled',(x:ReturnType<typeof fixture>)=>{x.review.previousSessionDate='2026-10-23'}],
    ['updated body used before available',(x:ReturnType<typeof fixture>)=>{x.options.asOf='2026-10-27T23:00:00Z';x.capture.capturedAt='2026-10-27T22:00:00Z'}],
  ])('rejects %s',(_label,mutate)=>{const x=fixture();mutate(x);expect(x.packet).toThrow()})
  it('requires an explicit previous close rather than reconstructing one from a rounded percentage',()=>{
    expect(fixture('Os mercados fecharam nesta terça-feira (27). A moeda norte-americana caiu 1,07%, cotada a R$ 5,3488.').packet).toThrow('brl_close_price_anchor_changed')
  })
  it('rejects a PTAX replacement, extra history and a fabricated observation time after preparation',()=>{
    const p=fixture().packet(),q=structuredClone(p)
    q.marketData.reportPriceBasis.priceKind='official_ptax_closing_average'
    expect(reportPriceSourceLabel(q)).toBeNull()
    expect(()=>validateBrlCloseBasis(q.marketData.reportPriceBasis,q)).toThrow('unverified_brl_close_basis')
    const extended=structuredClone(p);extended.series.unshift({date:'2026-10-23',value:4.98})
    expect(()=>verifiedFxMovement(extended)).toThrow('unverified_brl_close_basis')
    const timed=structuredClone(p);timed.observationAt='2026-10-27T20:00:00Z'
    expect(()=>verifiedFxMovement(timed)).toThrow('unverified_brl_close_basis')
  })
  it('uses the common notes and default writer with correct currency labels, without article text or paid authorization',()=>{
    const p=fixture().packet(),reason='Synthetic source support and exact authored note scope were reviewed.'
    const useReview={terms:{url:'https://example.org/terms',version:'synthetic/1',reviewedOn:'2026-10-28'},scope:reason,
      review:{origin:'agent',status:'checked',reason},conditions:[],uses:Object.fromEntries(['local_analysis','external_model','public_display'].map(k=>[k,{status:k==='public_display'?'pending':'allowed',reason,conditionIds:[]}]))}
    const questions=['market','local','global','counter']
    const bundle={version:'news-notes-case/2',historicalCase:false,checkedOn:'2026-10-28',reportDate:p.baseDate,sessionDate:p.observedDate,
      priceUseReview:useReview,contentReview:{origin:'agent',status:'checked',reason,counterevidenceChecked:true,counterevidenceReason:reason,newExplanationValue:true,newExplanationReason:reason},
      entries:[{source:{id:'news-brl-synthetic',country:'BRL',publisher:'Synthetic publisher',author:'Synthetic author',url:'https://example.org/brl-market',
        publishedAt:'2026-10-27',publicationDisplay:'Date only',eventDate:'2026-10-27',collectedAt:'2026-10-28T06:00:00Z'},
      review:{origin:'agent',status:'checked',reason,supportingContentChecked:true,contentAccess:'publisher_page',independentlyWorded:true,notTranslation:true,notArticleSubstitute:true,checkedOn:'2026-10-28'},useReview,
      notes:questions.map((q,i)=>({id:`n${i}`,kind:i?'attributed_view':'fact',text:`Synthetic ${q} explanation with separately verified supporting conditions.`,attribution:i?{person:'Synthetic analyst',organization:'Synthetic firm'}:null,reportedPrice:null})),
      claims:questions.map((q,i)=>({noteId:`n${i}`,questionId:q,role:i===0?'market':i===3?'counter':'driver',eventKey:`synthetic-${q}`,independenceKey:'synthetic',relation:i===3?'qualifies':'supports',supported:true,review:{origin:'agent',status:'checked',reason}}))}]}
    const data=prepareNewsNotesInput(p,bundle),plan=prepareEventTrial(data),sent=JSON.parse(plan.body.messages[1].content)
    expect(data.assessment.holds).toEqual([])
    expect(data.packet.evidenceScopeCards[0].scope.subject).toBe('BRL 현지 외환시장')
    expect(plan.status).toBe('prepared_not_called')
    expect(plan.paidCallAuthorized).toBe(false)
    expect(sent.evidence[0].sourceContext.sourceVersion).toBe('reviewer_authored_notes')
    expect(JSON.stringify(sent)).not.toContain('rawBase64')
  })
})
