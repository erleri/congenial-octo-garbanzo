import { describe, expect, it } from 'vitest'
import {
  buildPeriodOptions,
  defaultPeriodRange,
  resolvePeriodRange,
} from '../periodSelection'
import { monthlyRate } from './fixtures'

describe('period selection', () => {
  it('excludes future periods and sorts available months', () => {
    const rows = [
      monthlyRate('BRL', 2026, 9, 5.3),
      monthlyRate('BRL', 2026, 7, 5.1),
      monthlyRate('BRL', 2026, 10, 5.4),
    ]

    expect(buildPeriodOptions(rows, '2026-09-01')).toEqual(['2026-07', '2026-09'])
  })

  it('uses the latest two months and normalizes reversed input', () => {
    const options = ['2026-06', '2026-07', '2026-08', '2026-09']
    expect(defaultPeriodRange(options)).toEqual(['2026-08', '2026-09'])
    expect(resolvePeriodRange(options, '2026-09', '2026-07')).toEqual(['2026-07', '2026-09'])
  })
})
