import { expect, it } from 'vitest'
import { reportChartData } from './chart-data'

it('shows a sparse reference table at actual dates without implying a continuous daily history', () => {
  const report = { observedDate: '2026-10-26', series: [
    { date: '2026-10-26', value: 19 }, { date: '2026-10-01', value: 18 },
    { date: '2026-10-23', value: 18.8 }, { date: '2026-10-27', value: 20 },
  ] }
  const saved = structuredClone(report)
  const data = reportChartData(report, 3)
  expect(data.sparse).toBe(true)
  expect(data.points.map(p => p.date)).toEqual(['2026-10-01', '2026-10-23', '2026-10-26'])
  expect(data.x(1)).toBeCloseTo(597)
  expect(data.x(2)).toBe(675)
  expect(report).toEqual(saved)
})

it('preserves normal weekend spacing and handles a single observation without division by zero', () => {
  const data = reportChartData({ observedDate: '2026-10-26', series: [
    { date: '2026-10-22', value: 18 }, { date: '2026-10-23', value: 18.8 }, { date: '2026-10-26', value: 19 },
  ] }, 1)
  expect(data.sparse).toBe(false)
  expect(data.x(1)).toBe(187.5)
  expect(reportChartData({ observedDate: '2026-10-26', series: [{ date: '2026-10-26', value: 19 }] }, 1).x(0)).toBe(350)
})
