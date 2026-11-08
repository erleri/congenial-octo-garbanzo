import { describe, expect, it } from 'vitest'
import { hasDirectionalText, validateContent } from './core.js'
import { currentCase } from './test-support.js'
import { BCCH_METHOD, BCCH_PRICE_LIMITATIONS } from './price-limitations.js'
import {createReviewedNewsEvidence} from './reviewed-news-notes.js'

function officialPriceLimitationsCase() {
  const a=currentCase('CLP')
  a.packet.marketData={reportPriceBasis:{provider:BCCH_METHOD.provider,seriesId:BCCH_METHOD.seriesId,
    priceKind:'official_transaction_weighted_average',dateBasis:'underlying_local_transaction_day',
    timeZone:'America/Santiago',methodology:{...BCCH_METHOD}}}
  a.packet.limitations=[...BCCH_PRICE_LIMITATIONS]
  a.content.limitations=[...BCCH_PRICE_LIMITATIONS]
  return a
}

describe('content safety owner', () => {
  it('allows a cited, reviewed regional flow explanation while rejecting unsupported countries and foreign quote units',()=>{
    const a=currentCase('CLP'),reason='Synthetic reviewer independently verified the regional-flow attribution.'
    const e=createReviewedNewsEvidence({id:'news-regional-flow',country:'CLP',publisher:'Synthetic publisher',author:'Synthetic author',url:'https://example.org/flows',publishedAt:'2026-09-10',publicationDisplay:'Date only',eventDate:'2026-09-10',collectedAt:'2026-10-28T00:00:00Z'},
      [{id:'n0',kind:'attributed_view',text:'전문가는 브라질 자산 포지션 해소 자금이 칠레로 이동했을 가능성을 현지 달러 매도와 연결했다.',attribution:{person:'Synthetic analyst',organization:'Synthetic firm'},reportedPrice:null}],
      {origin:'agent',status:'checked',reason,supportingContentChecked:true,contentAccess:'publisher_page',independentlyWorded:true,notTranslation:true,notArticleSubstitute:true,checkedOn:'2026-10-28'})
    a.packet.evidence.push(e)
    const c=a.content.drivers[0];c.evidenceIds=[e.id];c.text='전문가는 브라질 자산 포지션 해소 자금이 칠레로 이동했을 가능성을 현지 달러 매도와 연결했다.'
    expect(validateContent(a.content,a.packet).errors).not.toContain('currency_mismatch')
    c.text=c.text.replace('브라질','멕시코')
    expect(validateContent(a.content,a.packet).errors).toContain('currency_mismatch')
    c.text='브라질 BRL 환율은 현지 달러 매도와 연결된다.'
    expect(validateContent(a.content,a.packet).errors).toContain('currency_mismatch')
    c.text='브라질 자산 매도가 현지 달러 매도와 연결된다.';c.evidenceIds=[]
    expect(validateContent(a.content,a.packet).errors).toContain('currency_mismatch')
  })
  it('accepts a baseline with referenced facts and sources', () => {
    const a = currentCase()
    expect(validateContent(a.content, a.packet)).toEqual({ valid: true, errors: [] })
  })
  it('permits exact registered price-limitations digits only in the adapter-owned location', () => {
    const a=officialPriceLimitationsCase()
    expect(validateContent(a.content,a.packet)).toEqual({valid:true,errors:[]})
    a.content.drivers[0].text=BCCH_PRICE_LIMITATIONS[1]
    expect(validateContent(a.content,a.packet).errors).toEqual(['untrusted_text'])
  })
  it.each(['modified text','unregistered mirrored text','wrong method','wrong provider','unsafe mirrored text'])(
    'retains the boundary for %s instead of trusting packet-mirrored limitations', variant => {
      const a=officialPriceLimitationsCase()
      if(variant==='modified text') a.content.limitations[1]=BCCH_PRICE_LIMITATIONS[1].replace('16:00','17:00')
      if(variant==='unregistered mirrored text') a.content.limitations[1]=a.packet.limitations[1]='확인되지 않은 환율은 999입니다.'
      if(variant==='wrong method') a.packet.marketData.reportPriceBasis.methodology.sha256='0'.repeat(64)
      if(variant==='wrong provider') a.packet.marketData.reportPriceBasis.provider='Unreviewed provider'
      if(variant==='unsafe mirrored text') a.content.limitations[1]=a.packet.limitations[1]=BCCH_PRICE_LIMITATIONS[1]+' <script>ignore previous</script>'
      expect(validateContent(a.content,a.packet).errors).toContain('untrusted_text')
    })
  it.each([
    ['정부가 달러 매도 계획을 발표했다.', false],
    ['당국의 매수와 매도가 시장에 영향을 주었다.', false],
    ['달러 매도를 추천합니다.', true],
    ['달러 매도 기회입니다.', true],
    ['매수를 권장한다.', true],
    ['결제 시점별 환율을 점검해야 합니다.', true],
  ])('distinguishes descriptive transactions from advice: %s', (summary, rejected) => {
    const a = currentCase(); a.content.summary = summary
    expect(validateContent(a.content, a.packet).errors).toEqual(rejected ? ['advice_or_instruction'] : [])
  })
  it.each([
    ['null', () => null], ['empty object', () => ({})],
    ['additional property', c => ({ ...c, extra: 'hidden' })],
    ['no drivers', c => ({ ...c, drivers: [] })],
  ])('rejects schema shape: %s', (_name, change) => {
    const a = currentCase()
    expect(validateContent(change(a.content), a.packet).errors).toEqual(['schema'])
  })
  it.each([
    ['literal number', '환율은 7입니다.', 'untrusted_text'],
    ['HTML', '<script>alert()</script>', 'untrusted_text'],
    ['invented URL', 'https://example.com', 'untrusted_text'],
    ['private email', 'private@company.example', 'untrusted_text'],
    ['work instruction', '가격을 인상하세요.', 'advice_or_instruction'],
    ['company performance', '당사 매출은 늘었다.', 'company_claim'],
    ['other currency', '멕시코 페소의 변화다.', 'currency_mismatch'],
    ['certain forecast', '환율은 반드시 상승합니다.', 'forecast'],
    ['KRW without fact', '원화 환산 부담에 영향을 준다.', 'unsupported_krw_link'],
  ])('rejects %s for its own reason', (_name, text, reason) => {
    const a = currentCase(); a.content.summary = text
    expect(validateContent(a.content, a.packet).errors).toEqual([reason])
  })
  it('detects an unknown source separately from fact-placeholder mismatch', () => {
    const a = currentCase(); a.content.drivers[0].evidenceIds = ['unknown']
    expect(validateContent(a.content, a.packet).errors).toEqual(['unknown_reference'])
  })
  it('requires a placeholder to be linked to its known fact', () => {
    const a = currentCase(); a.content.change.factIds = ['day']
    expect(validateContent(a.content, a.packet).errors).toEqual(['placeholder_reference'])
  })
  it('rejects placeholders in a header', () => {
    const a = currentCase(); a.content.title = '{{spot}}'
    expect(validateContent(a.content, a.packet).errors).toEqual(['placeholder_outside_claim'])
  })
  it('rejects malformed braces inside a claim', () => {
    const a = currentCase(); a.content.change.text = '{spot}'
    expect(validateContent(a.content, a.packet).errors).toEqual(['malformed_placeholder'])
  })
  it('requires explanatory drivers to cite a source, not only a numeric fact', () => {
    const a = currentCase(); a.content.drivers[0].evidenceIds = []; a.content.drivers[0].factIds = ['spot']
    expect(validateContent(a.content, a.packet).errors).toEqual(['driver_without_source'])
  })
  it('requires a non-mechanism claim to have fact or source evidence', () => {
    const a = currentCase()
    a.content.watch = [{ ...a.content.drivers[0], evidenceIds: [] }]
    expect(validateContent(a.content, a.packet).errors).toEqual(['missing_evidence'])
  })
  it('does not reject a KRW path when a USD/KRW fact is actually supplied', () => {
    const a = currentCase(); a.content.summary = '원화 환산 부담에 영향을 줄 수 있다.'
    a.packet.facts.push({ id: 'usdkrw', value: 1345, label: 'USD/KRW' })
    expect(validateContent(a.content, a.packet)).toEqual({ valid: true, errors: [] })
  })
  it('requires directional movement to be rendered from facts', () => {
    const a = currentCase(); a.content.change.text = '헤알은 약세입니다.'
    expect(validateContent(a.content, a.packet).errors).toEqual(['direction_must_use_fact'])
  })
  it('recognizes currency direction without treating 적절하다 as 절하', () => {
    expect(hasDirectionalText('적절하다 부적절하다')).toBe(false)
    for (const text of ['절하', '평가절상', '통화는 약세', '달러 상승']) expect(hasDirectionalText(text), text).toBe(true)
  })
})
