import { describe, expect, it } from 'vitest'
import { extractReviewedClpArticle } from './article-context-adapters.js'
import { prepareEditorialInput, costPlan, requestTokenBound } from './prepare-clp-editorial.js'
import { sourceTextHash } from './source-context.js'
import { currentCase } from './test-support.js'

// Synthetic site markup exercises extraction boundaries; it is not historical evidence.
const dfUrl = 'https://www.df.cl/mercados/bolsa-monedas/dolar-hoy-n75vd'
const ltUrl = 'https://www.latercera.com/pulso/noticia/el-valor-del-dolar-en-chile-el-5-de-octubre-de-2026/'
const df = `<p>Outside the article</p><div id="articleFree"><p>Fue una jornada synthetic case.</p>
<p>La Dirección de Presupuestos informó a synthetic plan.</p>
<div>"Synthetic policy signal, conditional on later observations", dijo <strong>Rodrigo Castillo</strong>.<br><br></div>
<div>Attribution and conditions are preserved.<br><br></div>
<div class="prontus-card-container"><div><p>Rodrigo Castillo unrelated recommended story.</p></div></div>
<p>Synthetic interpretation by Sebastián Moncada.</p><p>El cobre subió el lunes por segunda sesión synthetic boundary.</p></div><p>Other stories</p>`
const lt = `<p>Outside the article</p><p>El dólar inició las primeras operaciones synthetic case.</p><p>Al cierre de esta edición synthetic quote.</p>
<p>Dipres) informara a synthetic plan.</p><p>The plan is sujeto a modificaciones.</p><p>Interpretation: principalmente a factores locales.</p>
<p>El precio spot del metal synthetic boundary.</p><p>Other stories</p>`
function setup() {
  const a = currentCase('CLP')
  const facts = [{ id: 'spot', value: 979.84049059, label: '1 USD = 979.8405 CLP' }, { id: 'day', value: -.28864512694221717, label: '전 관측일 대비 -0.29%' }]
  const evidence = [{ ...a.packet.evidence[0], id: 'df-close', url: dfUrl }, { ...a.packet.evidence[0], id: 'lt-close', url: ltUrl }]
  const report = { ...a.packet, currency: 'CLP', baseDate: '2026-10-05', observedDate: '2026-10-05', facts, evidence, content: a.content }
  const snapshot = { input: { currency: 'CLP', baseDate: report.baseDate, observedDate: report.observedDate, observedAt: null, datasetFetchedAt: '2026-10-05T05:44:59.792Z', facts: structuredClone(facts) } }
  const sources = [{ id: 'df-close', url: dfUrl, ...extractReviewedClpArticle(dfUrl, df) },
    { id: 'lt-close', url: ltUrl, ...extractReviewedClpArticle(ltUrl, lt) }].map(s => ({ ...s, collectedAt: '2026-10-07T10:00:00Z' }))
  return { snapshot, report, sources }
}
describe('reviewed Chile input adapter and stage preparation', () => {
  it('captures the div quotation and its condition while removing nested recommendation paragraphs', () => {
    const blocks = extractReviewedClpArticle(dfUrl, df).blocks
    expect(blocks.map(b => b.text).join('\n')).not.toMatch(/Outside|Other stories|unrelated recommended/)
    expect(blocks.find(b => b.kind === 'quote')?.text).toContain('Rodrigo Castillo')
    expect(blocks.find(b => b.text.startsWith('Attribution'))).toBeDefined()
    expect(() => extractReviewedClpArticle(dfUrl, df.replace('</div><p>Other stories', '<p>Other stories'))).toThrow('article_wrapper_unclosed')
  })
  it('binds repaired source contexts to both writer and reviewer without approving private principle proposals', () => {
    const data = setup(), before = JSON.stringify(data.report)
    const p = prepareEditorialInput(data)
    const input = JSON.parse(p.generation.messages[1].content)
    expect(input.evidence[0].sourceContext.passages.some((b: { text: string }) => b.text.includes('Rodrigo Castillo'))).toBe(true)
    expect(p.savedManuscriptReview.input.sources[0].sourceContext.passageHash).toBe(input.evidence[0].sourceContext.passageHash)
    expect(input.applicableMechanisms).toEqual([])
    expect(JSON.stringify(p.generation)).not.toMatch(/pending_human|bodyHash|mechanismProposals/)
    expect(p.mechanismProposals[0].review.origin).toBe('agent')
    expect(p.state).toMatchObject({ paidCallAuthorized: false, publicationApproved: false, generationCalls: 0 })
    expect(JSON.stringify(data.report)).toBe(before)
    expect(requestTokenBound(p.generation)).toBeLessThan(p.costs.stages[0].maxInputTokens)
  })
  it('stops on a changed market snapshot, altered source hash, or missing qualifier rather than filling gaps', () => {
    const market = setup(); market.report.facts[0].value++
    expect(() => prepareEditorialInput(market)).toThrow('frozen_market_boundary_mismatch')
    const source = setup(); source.sources[0].blocks[0].text = 'Silently rewritten source'
    expect(() => prepareEditorialInput(source)).toThrow('source_identity_or_hash_mismatch')
    const qualifier = setup(); qualifier.sources[1].blocks[3].text = 'An unconditional plan'
    qualifier.sources[1].bodyHash = sourceTextHash(JSON.stringify(qualifier.sources[1].blocks))
    expect(() => prepareEditorialInput(qualifier)).toThrow('required_source_context_missing_or_ambiguous')
  })
  it('bounds all four stages including reasoning output and reserves no paid calls during preparation', () => {
    const plan = costPlan()
    expect(plan.stages.map((s: { name: string }) => s.name)).toEqual(['generation', 'review', 'correction', 'recheck'])
    expect(plan.newMaximumUsd).toBe(.37179)
    expect(plan).toMatchObject({ maxCorrections: 1, retries: 0, newSearches: 0, reservationCreated: false })
  })
})
