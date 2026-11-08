import type { CurrencyReport } from '../../types/currencyReport'

// Sparse reference tables are observations, not a daily interpolated history.
// Keep their values and dates intact and use a calendar-time horizontal axis.
export function reportChartData(report: Pick<CurrencyReport, 'observedDate' | 'series'>, months: number) {
  const end = Date.parse(report.observedDate + 'T00:00:00Z')
  const start = new Date(end)
  start.setUTCMonth(start.getUTCMonth() - months)
  const points = report.series.filter(p => Number.isFinite(p.value) && p.value > 0
    && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(Date.parse(p.date))
    && Date.parse(p.date) >= start.getTime() && Date.parse(p.date) <= end)
    .slice().sort((a, b) => a.date.localeCompare(b.date))
  const dates = points.map(p => Date.parse(p.date))
  const span = (dates.at(-1) ?? 0) - (dates[0] ?? 0)
  const sparse = dates.some((d, i) => i > 0 && d - dates[i - 1] > 4 * 86_400_000)
  return { points, sparse, x: (index: number) => span > 0 ? 25 + (dates[index] - dates[0]) / span * 650 : 350 }
}
