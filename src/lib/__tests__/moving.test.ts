import { describe, expect, it } from 'vitest'
import { buildMovingComparisonRows } from '../moving'
import { dailyRate, dataset, monthlyRate } from './fixtures'

describe('moving comparison', () => {
  it('calculates actual, moving, leading and comparison percentages', () => {
    const data = dataset({
      dailyRates: [
        dailyRate('BRL', '2026-09-01', 5),
        dailyRate('BRL', '2026-09-02', 7),
      ],
      monthlyRates: [
        monthlyRate('BRL', 2026, 7, 4),
        monthlyRate('BRL', 2026, 8, 5),
        monthlyRate('BRL', 2026, 9, 6),
        monthlyRate('BRL', 2026, 10, 7),
        monthlyRate('BRL', 2026, 11, 8),
      ],
    })
    const rows = buildMovingComparisonRows(data, 2026, 9)
    const byLabel = new Map(rows.map((row) => [row.label, row]))

    expect(byLabel.get('평균(실적)')?.values.BRL).toBe(6)
    expect(byLabel.get('이동')?.values.BRL).toBe(5)
    expect(byLabel.get('선행')?.values.BRL).toBe(7.5)
    expect(byLabel.get('이동 대비')?.values.BRL).toBeCloseTo(-1 / 6)
    expect(byLabel.get('선행 대비')?.values.BRL).toBeCloseTo(0.25)
  })

  it('prefers an explicit business plan over calculated averages', () => {
    const data = dataset({ dailyRates: [dailyRate('BRL', '2026-09-01', 5)] })
    const rows = buildMovingComparisonRows(data, 2026, 9, {
      leading: { BRL: 6.2 },
      moving: { BRL: 5.8 },
    })
    const byLabel = new Map(rows.map((row) => [row.label, row]))

    expect(byLabel.get('선행')?.values.BRL).toBe(6.2)
    expect(byLabel.get('이동')?.values.BRL).toBe(5.8)
  })
})
