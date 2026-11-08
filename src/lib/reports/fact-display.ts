import type { CurrencyReport } from '../../types/currencyReport'

// Opt-in presentation only. Saved labels and numerical values stay untouched.
// Unknown formats retain their complete labels rather than losing qualifiers.
export function reportFactText(text: string, report: Pick<CurrencyReport, 'facts' | 'presentationVersion'>) {
  const bases = new Set<string>()
  const pattern = /^(\d{4})-(0[1-9]|1[0-2]) (.+) 전년동월비 ([+-]?\d+(?:\.\d+)?)% \(실질·계절조정 전·잠정치\)$/
  const referenced = [...text.matchAll(/\{\{([a-z_]+)\}\}/g)].map(m => report.facts.find(f => f.id === m[1]))
  const periods = new Set(referenced.flatMap(f => { const m = f && pattern.exec(f.label); return m ? [`${m[1]}-${m[2]}`] : [] }))
  const rendered = text.replace(/\{\{([a-z_]+)\}\}/g, (_, id: string) => {
    const fact = report.facts.find(f => f.id === id)
    if (!fact) return '자료 없음'
    if (report.presentationVersion !== 'monthly-facts/1' || periods.size > 1) return fact.label
    const match = pattern.exec(fact.label)
    if (!match || !Number.isFinite(fact.value) || Number(match[4]) !== fact.value) return fact.label
    bases.add(`${match[1]}년 ${Number(match[2])}월 · 전년동월비 · 실질 · 계절조정 전 · 잠정치`)
    return `${match[3]} ${match[4]}%`
  })
  return { text: rendered, bases: [...bases] }
}
