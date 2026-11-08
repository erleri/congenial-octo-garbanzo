import { expect, it } from 'vitest'
import { inspectPeriodicProse, periodicLimitations, PERIODIC_SHARED_SCOPE_NOTE } from './periodic-editing.js'
import { inspectEditorial } from './editorial.js'
import { PERIODIC_EDITING_CASES, periodicSnippetContent } from './periodic-editing-cases.js'

it('distinguishes known process/scope prose from informative attribution and material conditions without rewriting or blocking', () => {
  for (const row of PERIODIC_EDITING_CASES) {
    const content = periodicSnippetContent(row), before = structuredClone(content)
    const result = inspectPeriodicProse(content)
    expect(result.signals.map(s => s.code).sort(), row.id).toEqual([...row.codes].sort())
    expect(result.signals.every(s => s.issue === 'style'), row.id).toBe(true)
    const automatic = inspectEditorial(content, { periodic: true })
    expect(automatic.blockers, row.id).toEqual([])
    expect(content, row.id).toEqual(before)
  }
  const scopes = PERIODIC_EDITING_CASES.filter(r => r.id.includes('scope'))
  const repeated = { ...periodicSnippetContent(scopes[0]), drivers: [{ title: '확인 범위', text: scopes[1].text }] }
  expect(inspectPeriodicProse(repeated).warnings).toContain('periodic:repeated_scope_caveats')
})

it('places common scope once while preserving every price/condition notice and refusing overflow instead of dropping text', () => {
  const original = ['공식 거래 평균이며 마감 호가가 아닙니다.', '16:00은 집계 마감입니다.', '5관측일의 비교입니다.', '당시 가용성 재현이 아닙니다.']
  const before = [...original], gap = '구리 설명은 재확인 대상입니다.'
  const result = periodicLimitations(original, gap), full = result.join(' ')
  expect(result.length).toBeLessThanOrEqual(4)
  for (const notice of [...original, gap]) expect(full).toContain(notice)
  expect(result).toContain(original[1]); expect(result).toContain(original[2])
  expect(full.split(PERIODIC_SHARED_SCOPE_NOTE)).toHaveLength(2)
  expect(original).toEqual(before)
  expect(() => periodicLimitations(['1'.repeat(480), '2'.repeat(480), '3'.repeat(480), '4'.repeat(480)], null)).toThrow('periodic_limitations_capacity')
})
