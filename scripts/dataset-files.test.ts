import { describe, expect, it } from 'vitest'
import { readFile, stat } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Dashboard from '../src/components/Dashboard'
import { buildMovingComparisonRows } from '../src/lib/moving'
import { buildDatasetFiles } from './dataset-files'
import type { ExchangeRateDataset } from '../src/types/exchangeRate'

const row = (date: string): ExchangeRateDataset['dailyRates'][number] => {
  const [year, month, day] = date.split('-').map(Number)
  return {
    currency: 'BRL',
    year,
    month,
    day,
    date,
    rateType: 'LOCAL_PER_USD',
    value: 5,
    status: 'ok',
    source: 'API',
    imputationMethod: 'NONE',
  }
}

describe('dataset file split', () => {
  it('keeps full history for sync and only 400 calendar days in the static fallback', () => {
    const source: ExchangeRateDataset = {
      baseDate: '2026-09-01',
      fetchedAt: '2026-09-01T00:00:00Z',
      dailyRates: [row('2025-07-28'), row('2025-07-29'), row('2026-09-01')],
      monthlyRates: [],
      movingComparison: [],
    }
    const { fullDataset, staticFallback } = buildDatasetFiles(source)

    expect(fullDataset.dailyRates).toHaveLength(3)
    expect(staticFallback.dailyRates.map((item) => item.date)).toEqual([
      '2025-07-29',
      '2026-09-01',
    ])
    expect(staticFallback.coverage).toMatchObject({
      limitedDailyHistory: true,
      dailyFrom: '2025-07-29',
      dailyTo: '2026-09-01',
    })
    expect(fullDataset.coverage?.dataVersion).toBe(staticFallback.coverage?.dataVersion)
  })

  it('keeps the committed fallback aligned with full history and below 5 MB', async () => {
    const [fullRaw, fallbackRaw, fallbackStats] = await Promise.all([
      readFile('data/fx-full-history.json', 'utf8'),
      readFile('public/data.json', 'utf8'),
      stat('public/data.json'),
    ])
    const full = JSON.parse(fullRaw) as ExchangeRateDataset
    const fallback = JSON.parse(fallbackRaw) as ExchangeRateDataset
    const expected = buildDatasetFiles(full).staticFallback

    expect(fallbackStats.size).toBeLessThanOrEqual(5_000_000)
    expect(fallback.baseDate).toBe(full.baseDate)
    expect(fallback.fetchedAt).toBe(full.fetchedAt)
    expect(fallback.monthlyRates).toEqual(full.monthlyRates)
    expect(fallback.dailyRates).toEqual(expected.dailyRates)
    expect(fallback.movingComparison).toEqual(full.movingComparison)
    expect(fallback.coverage).toEqual(expected.coverage)
    const [year, month] = full.baseDate.split('-').map(Number)
    expect(buildMovingComparisonRows(fallback, year, month)).toEqual(buildMovingComparisonRows(full, year, month))
    const render = (data: ExchangeRateDataset) => renderToStaticMarkup(createElement(Dashboard, {
      data, filters: { currency: 'BRL', year, month, rateType: 'LOCAL_PER_USD' },
      businessPlan: { leading: {}, moving: {} },
    })).replace(/<[^>]*>/g, '')
    expect(render(fallback)).toEqual(render(full))
  })
})
