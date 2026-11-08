import { describe, expect, it } from 'vitest'
import { reportFactText } from './fact-display'
import type { CurrencyReport } from '../types/currencyReport'

const report: Pick<CurrencyReport, 'facts' | 'presentationVersion'> = {
  presentationVersion: 'monthly-facts/1', facts: [
    { id: 'category', value: 4.7, label: '2026-08 전자·가정용·기술제품군 전년동월비 +4.7% (실질·계절조정 전·잠정치)' },
    { id: 'total', value: 3.4, label: '2026-08 소매 전체 IACM 전년동월비 +3.4% (실질·계절조정 전·잠정치)' },
  ],
}
describe('Explicit monthly fact presentation', () => {
  it('keeps the numeric comparison while showing a shared basis once without mutating stored facts', () => {
    const before = structuredClone(report)
    expect(reportFactText('{{category}}, {{total}}', report)).toEqual({
      text: '전자·가정용·기술제품군 +4.7%, 소매 전체 IACM +3.4%',
      bases: ['2026년 8월 · 전년동월비 · 실질 · 계절조정 전 · 잠정치'],
    })
    expect(report).toEqual(before)
    expect(reportFactText('{{category}}', { facts: report.facts })).toEqual({text: report.facts[0].label, bases: []})
  })
  it('retains full definitions for unknown units, value mismatches and non-monthly facts', () => {
    for (const fact of [
      { ...report.facts[0], value: 5 },
      { ...report.facts[0], label: report.facts[0].label.replace('전년동월비', '전월비') },
      { ...report.facts[0], label: report.facts[0].label.replace('실질', '명목') },
      { id: 'category', value: 985, label: '1 USD = 985 CLP' },
    ]) expect(reportFactText('{{category}}', { ...report, facts: [fact] })).toEqual({text: fact.label, bases: []})
  })
  it('does not collapse different statistical periods into a single basis', () => {
    const changed = structuredClone(report)
    changed.facts[1].label = changed.facts[1].label.replace('2026-08', '2026-09')
    expect(reportFactText('{{category}} {{total}}', changed)).toEqual({text: changed.facts.map(f => f.label).join(' '), bases: []})
  })
})
