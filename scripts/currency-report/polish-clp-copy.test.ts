import { expect, it } from 'vitest'
import { polishClpCopy } from './polish-clp-copy.js'

it('keeps a manual prose-only copy separate, preserves references and moves rather than hides the substantive condition', () => {
  const parent = { id: 'CLP-2026-10-09-1791888644987', status: 'pending_review', publishedAt: null,
    comparison: { citationRevision: true, costUsd: .024868, average: 3.8 }, facts: [{ value: .4 }], evidence: [{ id: 'ipc' }, { id: 'wage' }], series: [{ value: 100 }],
    content: { title: '이전 제목', summary: '기존 요약', limitations: ['대상 기간이 다르다'], drivers: [
      { title: '이전 제목', text: '상승과 음의 기여가 함께 있다. 식품과 교통은 원문이 강조한 상승 분류이며, 전체 분류 기여도 순위를 확인한 것은 아니다.', evidenceIds: ['ipc'] },
      { title: '이전 제목', text: '물가 조정 보수 지수다. 이는 별도 월의 임금 맥락이며, 전 가구 소득이나 소비·판매 결과를 관측한 것은 아니다.', evidenceIds: ['wage', 'ipc'] },
    ] } }
  const before = structuredClone(parent), next = polishClpCopy(parent, 'CLP-2026-10-09-123')
  expect(parent).toEqual(before)
  for (const field of ['facts', 'evidence', 'series']) expect(next[field]).toEqual(parent[field])
  expect(next.content.drivers.map(d => d.evidenceIds)).toEqual(parent.content.drivers.map(d => d.evidenceIds))
  expect(next.content.drivers[0].text).toBe('상승과 음의 기여가 함께 있다.')
  expect(next.content.drivers[1].text).toContain('8월 보수 지표로, 9월 물가와는 대상 기간이 다르다.')
  expect(next.content.limitations).toContain('실질보수 지수는 전 가구 소득이나 실제 소비·판매 결과를 직접 보여주는 지표가 아닙니다.')
  expect(next.comparison).toMatchObject({ editorialRevision: true, referenceOnly: true, publicationBlocked: true, costUsd: .024868, average: 3.8 })
  expect(next.publishedAt).toBeNull()
  expect(() => polishClpCopy({ ...parent, status: 'approved' }, next.id)).toThrow('reviewed_parent_required')
})
