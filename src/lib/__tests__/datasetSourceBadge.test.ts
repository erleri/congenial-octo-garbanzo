import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import DatasetSourceBadge from '../../components/DatasetSourceBadge'
import type { DatasetSource } from '../../types/exchangeRate'

it.each<[DatasetSource, string, string]>([
  ['supabase', '운영 데이터 확인됨', 'operational'],
  ['excel', '로컬 임시 보기', 'local'],
  ['cache', '로컬 캐시', 'local'],
  ['static', '정적 배포 데이터', 'readonly'],
  ['remote', '외부 API 조회', 'readonly'],
  ['none', '데이터 미확인', 'readonly'],
])('renders an accurate badge for %s', (source, label, style) => {
  const html = renderToStaticMarkup(createElement(DatasetSourceBadge, { source }))
  expect(html).toContain(label)
  expect(html).toContain(`scope-badge-${style}`)
  if (source !== 'supabase') expect(html).not.toContain('운영 데이터 확인됨')
})
