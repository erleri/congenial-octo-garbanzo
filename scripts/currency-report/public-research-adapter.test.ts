import { describe, expect, it, vi } from 'vitest'
import { allowedResearchUrl, collectOriginal, extractPublicArticle, publicationMetadata, questionSearchUrl, readPublicText, searchQuestion } from './public-research-adapter.js'
import { collectHarnessResearch, prepareHarnessComparison } from './live-research-local.js'
import { syntheticCase } from './rule-fixtures.js'
import { createSourceContext } from './source-context.js'
import { HARNESS_VERSION, evidenceBinding } from './research-harness.js'
import { packetBinding } from './rules.js'
import { executeHarnessComparison } from './run-harness-comparison.js'

const article = (date = '2026-10-05T09:00:00-03:00') => `<script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle',
  datePublished: date, articleBody: '정부의 정책 계획을 다루는 합성 본문이다. 실제 기사와 의미적 승인은 아니다.' })}</script>`
const candidate = { url: 'https://www.df.cl/mercados/synthetic', questionIds: ['local'] }
function fixture() {
  const a = syntheticCase('CLP')
  a.packet.evidence[0].url = candidate.url
  a.packet.evidence[0].review = { originalVerified: true, scope: '합성 검토 범위만 설명한다.' }
  a.packet.evidence[0].sourceContext = createSourceContext({ blocks: [{ kind: 'paragraph', text: '합성 기대 변화를 설명하는 원문이며 실제 시장 근거가 아니다.' }], selected: [0] })
  const e = a.packet.evidence[0]
  const dossier = { version: HARNESS_VERSION, packetHash: packetBinding(a.packet), cards: ['market', 'local', 'global', 'counter', 'watch'].map(questionId => ({
    id: `test-${questionId}`, questionId, evidenceId: e.id, evidenceHash: evidenceBinding(e), passageIds: ['p0'], kind: 'fact', relation: 'supports',
    timeScope: 'same_day_context', eventKey: 'synthetic-event', independenceKey: 'synthetic-source', statement: '합성 질문과 원문을 연결한 시험용 문장이다.',
    allowedUse: '합성 조건을 점검하는 용도로 한정한다.', limit: '실제 보고서의 승인 근거로 사용할 수 없다.', review: { origin: 'agent', status: 'checked', reason: '연결 검사만을 위한 합성 검토 기록이다.' },
  })) }
  return { ...a, dossier }
}

describe('Public discovery and original capture boundary', () => {
  it('uses a wider consumer window and does not require consumer articles to mention an FX code', () => {
    const url = new URL(questionSearchUrl({ currency: 'CLP', baseDate: '2026-10-05', questionId: 'consumer' }))
    expect(url.searchParams.get('startdatetime')).toBe('20260905040000')
    expect(url.searchParams.get('enddatetime')).toBe('20261006025959')
    expect(url.searchParams.get('query')).toContain('(Chile)')
    expect(url.searchParams.get('query')).not.toContain('Chilean peso')
    const official = new URL(questionSearchUrl({ currency: 'CLP', baseDate: '2026-10-05', questionId: 'local', round: 2 }))
    expect(official.searchParams.get('query')).toContain('domain:dipres.gob.cl')
    expect(official.searchParams.get('query')).not.toContain('domain:df.cl')
  })
  it('keeps GDELT first-seen time out of publication metadata and filters non-approved hosts', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ articles: [
      { title: '합성 시장 기사', url: candidate.url, seendate: '20261005T120000Z' },
      { title: '미등록 출처', url: 'https://unregistered.example/a', seendate: '20261005T120000Z' },
    ] })))
    const result = await searchQuestion({ currency: 'CLP', baseDate: '2026-10-05', questionId: 'local', asOf: '2026-10-08', fetchImpl })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({ firstSeenAt: '2026-10-05T12:00:00Z', publishedAt: null, evidenceReady: false })
  })
  it('does not turn successful downloads into reviewed evidence and preserves date/time uncertainty', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(article('2026-10-05T09:00:00')))
    const result = await collectOriginal({ candidate, currency: 'CLP', baseDate: '2026-10-05', fetchImpl })
    expect(result).toMatchObject({ status: 'collected_pending_review', originalVerified: false,
      metadata: { publishedAt: null, status: 'unresolved_timezone' }, temporalStatus: 'publication_unverified' })
    const later = await collectOriginal({ candidate, currency: 'CLP', baseDate: '2026-10-05', fetchImpl: async () => new Response(article('2026-10-06')) })
    expect(later.temporalStatus).toBe('after_case_date')
  })
  it('uses explicit offsets and retains mismatching publication metadata for review', async () => {
    const result = await collectOriginal({ candidate, currency: 'CLP', baseDate: '2026-10-05', fetchImpl: async () => new Response(article()) })
    expect(result.metadata).toMatchObject({ publishedAt: '2026-10-05T12:00:00.000Z', status: 'explicit_timezone', bodyAvailability: 'current_page_not_archived' })
    const conflict = await collectOriginal({ candidate, currency: 'CLP', baseDate: '2026-10-05', fetchImpl: async () =>
      new Response(article() + '<meta property="article:published_time" content="2026-10-04">') })
    expect(conflict.metadata.status).toBe('conflicting_metadata')
    const edited = await collectOriginal({ candidate, currency: 'CLP', baseDate: '2026-10-05', fetchImpl: async () => new Response(article() +
      '<meta property="article:modified_time" content="2026-10-06T09:00:00Z">') })
    expect(edited.contentTemporalStatus).toBe('modified_after_case_date')
    const evening = await collectOriginal({ candidate, currency: 'CLP', baseDate: '2026-10-05', fetchImpl: async () => new Response(article() +
      '<meta property="article:modified_time" content="2026-10-06T00:06:56.703Z">') })
    expect(evening.contentTemporalStatus).toBe('historical_body_availability_unverified')
  })
  it('rejects pages without article boundaries rather than capturing navigation and recommendations', () => {
    expect(() => extractPublicArticle(candidate.url, '<main><p>추천 기사와 탐색 메뉴</p></main>')).toThrow('article_body_not_identified')
    expect(() => allowedResearchUrl('https://df.cl.evil.example/article', 'CLP')).toThrow('research_url_not_allowed')
    expect(() => allowedResearchUrl('http://127.0.0.1/a', 'CLP')).toThrow('research_url_not_allowed')
  })
  it('bounds streamed bytes without Content-Length and does not follow an automatic redirect', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('123456789'))
    const result = await readPublicText(candidate.url, { fetchImpl, maxBytes: 4 })
    expect(result.reason).toBe('oversize')
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('error')
  })
  it('retains long JSON-LD paragraphs intact under the common review byte boundary, without bypassing safety', () => {
    const page = (body:string) => `<script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',articleBody:body})}</script>`
    const body = 'Síntesis pública del mercado. '.repeat(400) + '한국어 끝부분 💱'
    const captured = extractPublicArticle(candidate.url, page(body))
    expect(captured.blocks).toEqual([{kind:'paragraph',text:body}])
    expect(captured.adapter).toBe('jsonld_article_body')
    const short = 'Short unchanged synthetic article.'
    expect(extractPublicArticle(candidate.url,page(short)).blocks).toEqual([{kind:'paragraph',text:short}])
    expect(() => extractPublicArticle(candidate.url,page(body+' sk-or-synthetic'))).toThrow('invalid_structured_article_body')
    // Multibyte payloads are measured in bytes, not characters. Never truncate.
    expect(() => extractPublicArticle(candidate.url,page('가'.repeat(70_000)))).toThrow('invalid_structured_article_body')
    expect(() => extractPublicArticle(candidate.url,page(Array(4097).fill('x').join('\n')))).toThrow('invalid_structured_article_body')
  })
  it('normalizes equivalent publication offsets and coarse precision without hiding real timestamp conflicts',async()=>{
    const url='https://www.infobae.com/economia/2026/10/26/dolar-test/'
    const capture=async(left:string,right:string)=>collectOriginal({candidate:{url,questionIds:['market']},currency:'ARS',baseDate:'2026-10-27',
      fetchImpl:async()=>new Response(`<meta property="article:published_time" content="${right}"><script type="application/ld+json">${JSON.stringify({
        '@type':'NewsArticle',datePublished:left,articleBody:'A fixed synthetic market paragraph for timestamp boundary verification.'})}</script>`)})
    const offsets=await capture('2026-10-26T14:53:25-0600','2026-10-26T14:53:25-06:00')
    expect(offsets.metadata).toMatchObject({publishedAt:'2026-10-26T20:53:25.000Z',status:'explicit_timezone'})
    const precision=await capture('2026-10-26T05:46:25Z','2026-10-26T05:46:25.842Z')
    expect(precision.metadata).toMatchObject({publishedAt:'2026-10-26T05:46:25.000Z',publicationPrecision:'second'})
    const conflict=await capture('2026-10-26T05:46:25.500Z','2026-10-26T05:46:25.842Z')
    expect(conflict.metadata).toMatchObject({publishedAt:null,status:'conflicting_metadata'})
  })
  it('uses an explicit publication instant over an identical unzoned duplicate while preserving conflicts and uncertainty',()=>{
    const url='https://example.org/markets/synthetic',stamp='2026-10-29T21:48:37.659'
    const page=(a:string,b:string)=>`<meta property="article:published_time" content="${b}"><script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',datePublished:a})}</script>`
    const resolved=publicationMetadata(page(stamp+'Z',stamp),url)
    expect(resolved).toMatchObject({publishedAt:stamp+'Z',status:'explicit_timezone',publicationResolution:{timezoneInferred:false,ignoredUnzonedDuplicates:[stamp]}})
    expect(publicationMetadata(page(stamp+'Z',stamp.replace('21:48','20:48')),url)).toMatchObject({publishedAt:null,status:'conflicting_metadata'})
    expect(publicationMetadata(page(stamp,stamp),url)).toMatchObject({publishedAt:null,status:'unresolved_timezone'})
    expect(publicationMetadata(`<meta itemprop="datePublished" content="${stamp}Z">`,url)).toMatchObject({publishedAt:stamp+'Z',status:'explicit_timezone'})
    const registered='https://www.emol.com/noticias/Economia/2026/10/29/1215000/test.html'
    expect(publicationMetadata(page(stamp+'Z','2026-10-29T21:48:37'),registered).publishedAt).toBeNull()
  })
  it('records search failure while still capturing preserved originals, with zero model calls', async () => {
    const a = fixture(), checkpoint = vi.fn()
    const fetchImpl = vi.fn(async (url: string) => url.includes('api.gdeltproject.org') ? new Response('rate limited', { status: 429 }) : new Response(article('2025-06-20')))
    const result = await collectHarnessResearch({ ...a, asOf: '2025-06-21', maxQueries: 1, fetchImpl, checkpoint })
    expect(result.searchLog[0]).toMatchObject({ status: 'failed', reason: 'http_429' })
    expect(result.originals[0].status).toBe('collected_pending_review')
    expect(result.discovery.coverage.questions.find(q => q.id === 'consumer')?.status).toBe('missing')
    expect(result).toMatchObject({ networkCalls: 2, modelCalls: 0, apiCostUsd: 0, publicationApproved: false })
    expect(checkpoint).toHaveBeenCalledTimes(2)
  })
  it('prepares equally constrained baseline and harness generations with no automatic authorization', () => {
    const a = fixture(), plan = prepareHarnessComparison(a.packet, a.dossier)
    expect(plan.calls.map(c => c.stage)).toEqual(['baseline_generation', 'harness_generation'])
    expect(plan.calls[0].body.model).toBe(plan.calls[1].body.model)
    expect(plan.calls[0].requestHash).not.toBe(plan.calls[1].requestHash)
    expect(plan.totalMaximumUsd).toBeLessThan(.20)
    expect(plan).toMatchObject({ maxCalls: 2, retries: 0, paidCallAuthorized: false, requiresEndpointPreflight: true })
  })
  it('rejects an insufficient comparison budget before either model is invoked', async () => {
    const a = fixture(), plan = prepareHarnessComparison(a.packet, a.dossier), invoke = vi.fn()
    await expect(executeHarnessComparison({ plan, packet: a.packet, approvedBudgetUsd: .01, invoke })).rejects.toThrow('unapproved_or_changed_comparison')
    expect(invoke).not.toHaveBeenCalled()
  })
  it('keeps unknown cost reserved and stops after an interrupted comparison stage', async () => {
    const a = fixture(), plan = prepareHarnessComparison(a.packet, a.dossier), invoke = vi.fn().mockRejectedValue(new Error('interrupted'))
    const result = await executeHarnessComparison({ plan, packet: a.packet, approvedBudgetUsd: .20, invoke })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('interrupted')
    expect(result.ledger[0]).toMatchObject({ costUsd: null, reservedUsd: plan.calls[0].maximumUsd, state: 'cost_unresolved' })
    expect(result.ledger[1].state).toBe('not_started')
    expect(result.publicationApproved).toBe(false)
  })
})
