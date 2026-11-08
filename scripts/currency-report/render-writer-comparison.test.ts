import { expect, it } from 'vitest'
import { renderWriterComparison } from './render-writer-comparison.js'

const fixture = () => ({ currency: 'BRL', baseDate: '2026-10-07', facts: [{ label: '같은 입력 1 USD = 4.9804 BRL' }],
  rows: ['모델 A', '모델 B', '모델 C'].map(modelLabel => ({ modelLabel, costUsd: .01, existing: false, statusLabel: '미게시 비교본', notes: ['합성 화면 검사이며 실제 원고가 아닙니다.'],
    content: { title: '보존할 제목', summary: '보존할 요약 <script>alert(1)</script>',
      drivers: [{ title: '원문 소제목', text: '길이를 줄이거나 새로 쓰지 않는 설명 원문입니다.' }], implications: [], watch: [] } })) })
it('renders three complete original prose blocks with explicit empty sections and escaped markup', () => {
  const data = fixture(), before = structuredClone(data), html = renderWriterComparison(data)
  expect((html.match(/길이를 줄이거나 새로 쓰지 않는 설명 원문입니다\./g) ?? []).length).toBe(3)
  expect(html).toContain('보존할 요약 &lt;script&gt;alert(1)&lt;/script&gt;')
  expect(html).not.toContain('<script>')
  expect(html).toContain('근거가 있는 생성 항목 없음')
  expect(data).toEqual(before)
})
it('rejects credentials and incomplete model sets before generating a browser artifact', () => {
  const data = fixture()
  data.rows[0].content.summary = 'sk-or-private-key'
  expect(() => renderWriterComparison(data)).toThrow('unsafe_comparison_projection')
  expect(() => renderWriterComparison({ ...fixture(), rows: fixture().rows.slice(0, 2) })).toThrow('unsafe_comparison_projection')
})
