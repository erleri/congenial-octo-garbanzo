import { expect, it } from 'vitest'
import { buildBusinessPlanHistoryPage } from '../businessPlanRemote'

it('advances an unchanged page with a timestamp and group cursor', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    change_group: String(21 - i), legacy: false, period_month: '2026-09-01',
    created_at: '2026-09-09T00:00:00Z', created_by_email: null,
    plan_type: 'leading' as const, currency: 'BRL' as const,
    previous_rate_value: 5, rate_value: 5,
  }))
  const page = buildBusinessPlanHistoryPage(rows)
  expect(page.entries).toEqual([])
  expect(page.hasMore).toBe(true)
  expect(JSON.parse(page.nextCursor!)).toEqual({ createdAt: rows[0].created_at, changeGroup: '2' })
  expect(buildBusinessPlanHistoryPage([]).nextCursor).toBeNull()
})
