import { afterEach, describe, expect, it, vi } from 'vitest'
import { admitChileMonthlyEvidence, monthlyHash, monthlyOriginalBinding, validateMonthlyExtraction } from './chile-monthly-evidence.js'
import { chileConsumptionScopes, planChileConsumptionNeeds } from './chile-consumption-scopes.js'
import { projectEvidenceScopes } from './evidence-scope.js'
import { syntheticCase } from './rule-fixtures.js'

// Synthetic contract fixtures. These are NOT historical economic observations.
function fixture(pay = false) {
  const checks = ['page_visual_checked','series_and_value','period_and_comparison','population_and_unit','adjustment_and_base','qualifiers_and_countercontext']
  const review = {origin:'agent',status:'checked',reviewedOn:'2026-10-15',reason:'합성 검토 계약 시험이며 실제 원문 검토가 아니다.',checks}
  const publicationDate = pay ? '2026-10-07' : '2026-09-30'
  const published = pay ? '7 de octubre de 2026' : '30 de septiembre de 2026'
  const original = {url:`https://www.ine.gob.cl/docs/default-source/${pay?'sueldos-y-salarios':'actividad-mensual-del-comercio'}/boletines/synthetic.pdf`,
    sha256:'a'.repeat(64),bytes:100,collectedAt:'2026-10-15T00:00:00Z',period:'2026-08',sourceVersion:'current_file_not_archived'}
  const base = `Base ${pay?'2023':'2018'} = 100`, definition = 'Synthetic definition of the covered population.', qualification = 'Synthetic qualification: not household income or company sales.'
  const value = 'Synthetic unadjusted real annual growth 3,4%, contribution 0,657pp.'
  const text = ['Agosto 2026',published,base,'Cifras provisionales.',value,definition,qualification].join('\n')
  const extraction = {version:'monthly-pdf-text/1',sha256:original.sha256,bytes:100,extractor:'pypdf/6.0.0',pages:[{page:1,text,textHash:monthlyHash(text)}]}
  const loc = (text:string) => ({page:1,text})
  const receipt = {version:'monthly-pdf-review/1',...validateMonthlyExtraction(original,extraction),registryHash:monthlyHash(chileConsumptionScopes()),period:'2026-08',
    review,publicationDate,publicationLocator:loc(published),periodLocator:loc('Agosto 2026'),provisionalLocator:loc('Cifras provisionales.'),
    reuse:{status:'verified',url:chileConsumptionScopes().terms.url,reason:'합성 계약에서만 재사용 확인을 가정한다.'},
    facts:[{definitionId:pay?'cl-ir-real':'cl-iacm-total',value:3.4,numberText:'3,4%',baseLocator:loc(base),valueLocator:loc(value),definitionLocators:[loc(definition)],qualificationLocators:[loc(qualification)],review}]}
  return {original,extraction,receipt}
}
afterEach(() => vi.unstubAllGlobals())

describe('Reviewed monthly PDF evidence boundary', () => {
  it('connects explicit review to the existing scope contract without IO, source mutation or publication', () => {
    const x = fixture(), before = structuredClone(x), network = vi.fn(() => {throw new Error('forbidden')})
    vi.stubGlobal('fetch',network)
    const result = admitChileMonthlyEvidence(x)
    expect(projectEvidenceScopes(result, result.evidenceScopeCards, {required:true})[0].scope).toEqual(chileConsumptionScopes().retailRegistry.definitions[0].scope)
    expect(result.facts[0]).toMatchObject({value:3.4,period:'2026-08',scope:{unit:'percent',adjustment:'unadjusted'}})
    expect(result).toMatchObject({networkCalls:0,modelCalls:0,costUsd:0,publicationApproved:false,writingEligibility:'not_assessed'})
    expect(result.evidence[0].publishedAt).toBe('2026-09-30')
    expect(result.evidence[0].publicationTime).toBeNull()
    expect(result.evidence[0].sourceContext.sourceVersion).toBe('current_page_not_archived')
    expect(x).toEqual(before); expect(network).not.toHaveBeenCalled()
  })
  it('rejects changed PDF metadata, page text and review/registry bindings', () => {
    const original = fixture()
    const pdf = structuredClone(original); pdf.original.sha256 = 'b'.repeat(64)
    expect(() => admitChileMonthlyEvidence(pdf)).toThrow('stale_monthly_extraction')
    const page = structuredClone(original); page.extraction.pages[0].text += ' revision'
    expect(() => admitChileMonthlyEvidence(page)).toThrow('stale_monthly_extraction')
    const url = structuredClone(original); url.original.url += '?sfvrsn=changed'
    expect(() => admitChileMonthlyEvidence(url)).toThrow('stale_monthly_review')
    const scope = structuredClone(original); scope.receipt.registryHash = 'b'.repeat(64)
    expect(() => admitChileMonthlyEvidence(scope)).toThrow('stale_monthly_review')
  })
  it('requires actual excerpts and matching printed period, publication and base', () => {
    const missing = fixture(); missing.receipt.facts[0].valueLocator.text = 'A number from outside this document.'
    expect(() => admitChileMonthlyEvidence(missing)).toThrow('pdf_excerpt_not_found')
    const period = fixture(); period.receipt.periodLocator.text = 'Cifras provisionales.'
    expect(() => admitChileMonthlyEvidence(period)).toThrow('pdf_period_mismatch')
    const pub = fixture(); pub.receipt.publicationDate = '2026-09-29'
    expect(() => admitChileMonthlyEvidence(pub)).toThrow('pdf_publication_mismatch')
    const base = fixture(); base.receipt.facts[0].baseLocator.text = 'Cifras provisionales.'
    expect(() => admitChileMonthlyEvidence(base)).toThrow('pdf_base_mismatch')
  })
  it('never converts contribution pp to growth percent or matches a number inside a different value', () => {
    const pp = fixture(); pp.receipt.facts[0].numberText = '0,657pp.'; pp.receipt.facts[0].value = 0.657
    expect(() => admitChileMonthlyEvidence(pp)).toThrow('pdf_numeric_value_or_unit_mismatch')
    const token = fixture(); token.receipt.facts[0].numberText = '0,657%'; token.receipt.facts[0].value = 0.657
    expect(() => admitChileMonthlyEvidence(token)).toThrow('pdf_value_not_in_excerpt')
    const substring = fixture(); substring.receipt.facts[0].numberText = '4%'; substring.receipt.facts[0].value = 4
    expect(() => admitChileMonthlyEvidence(substring)).toThrow('pdf_value_not_in_excerpt')
  })
  it('requires explicit semantic review and qualifiers, without treating attestations as automatic proof', () => {
    const unchecked = fixture(); unchecked.receipt.facts[0].review.checks = ['page_visual_checked']
    expect(() => admitChileMonthlyEvidence(unchecked)).toThrow('explicit_pdf_review_required')
    const context = fixture(); context.receipt.facts[0].qualificationLocators = []
    expect(() => admitChileMonthlyEvidence(context)).toThrow('pdf_context_required')
    const pay = admitChileMonthlyEvidence(fixture(true))
    expect(pay.evidenceScopeCards[0].countercontext).toContain('월 보수가 같아도')
    expect(pay.evidenceScopeCards[0].excludedExpansions.join(' ')).toContain('가구 구매력')
    expect(pay.evidenceScopeCards[0].scope.subject).toContain('hourly')
  })
  it('preserves longer PDF context while keeping claim references within the existing eight-reference contract', () => {
    const x = fixture(true), extra = ['Additional population detail for this synthetic source.', 'Monthly adjustment differs from the annual comparison.']
    x.extraction.pages[0].text += '\n' + extra.join('\n')
    x.extraction.pages[0].textHash = monthlyHash(x.extraction.pages[0].text)
    x.receipt.extractionHash = monthlyHash(x.extraction)
    x.receipt.facts[0].definitionLocators.push({page:1,text:extra[0]})
    x.receipt.facts[0].qualificationLocators.push({page:1,text:extra[1]})
    const result = admitChileMonthlyEvidence(x)
    expect(result.evidence[0].sourceContext.passages).toHaveLength(9)
    expect(result.evidenceScopeCards[0].passageIds).toHaveLength(5)
    expect(projectEvidenceScopes(result, result.evidenceScopeCards, {required:true})).toHaveLength(1)
  })
  it('does not let a wage source satisfy retail, bypass undefined periods, or claim an archived vintage', () => {
    const mixed = fixture(); mixed.receipt.facts[0].definitionId = 'cl-ir-real'
    expect(() => admitChileMonthlyEvidence(mixed)).toThrow('pdf_series_mismatch')
    const period = fixture(); period.original.period = '2026-09'; period.receipt.period = '2026-09'; period.receipt.originalBinding = monthlyOriginalBinding(period.original)
    expect(() => admitChileMonthlyEvidence(period)).toThrow('stale_monthly_review')
    const archived = fixture(); archived.original.sourceVersion = 'archived_original'
    expect(() => admitChileMonthlyEvidence(archived)).toThrow('invalid_monthly_original')
  })
  it('marks two series from one PDF as the same document, not independent corroboration', () => {
    const x = fixture(); x.receipt.facts.push({...structuredClone(x.receipt.facts[0]),definitionId:'cl-iacm-electronics-home-tech'})
    const result = admitChileMonthlyEvidence(x)
    expect(new Set(result.evidence.map(e => e.id)).size).toBe(2)
    expect(new Set(result.evidence.map(e => e.provenance.independenceKey)).size).toBe(1)
    expect(result.evidenceScopeCards.map(c => c.scope.subject)).toEqual(['cl_iacm_total','cl_iacm_electronics_home_technology'])
  })
  it('replays the old cutoff as historical-unverified and keeps reuse licensing as a separate gate', () => {
    const x = fixture(), result = admitChileMonthlyEvidence(x)
    const packet = {...syntheticCase('CLP').packet,purpose:'economic_update',baseDate:'2026-10-09',evidence:result.evidence,evidenceScopeCards:result.evidenceScopeCards}
    const plan = planChileConsumptionNeeds({packet,purpose:'economic_update',asOf:'2026-10-09T23:00:00Z',period:'2026-08'})
    expect(plan.questions.find(q => q.id === 'category').requirements[0].candidates[0].reason).toBe('historical_version_unverified')
    x.receipt.reuse.status = 'unverified'
    const held = admitChileMonthlyEvidence(x), currentPacket = {...packet,baseDate:'2026-10-15',evidence:held.evidence,evidenceScopeCards:held.evidenceScopeCards}
    const current = planChileConsumptionNeeds({packet:currentPacket,purpose:'economic_update',asOf:'2026-10-15T23:00:00Z',period:'2026-08'})
    expect(current.questions.find(q => q.id === 'category').requirements[0].candidates[0].reason).toBe('terms_unverified')
    expect(current.publicationApproved).toBe(false)
  })
})
