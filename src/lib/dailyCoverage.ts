import type { CurrencyCode, ExchangeRateDataset } from '../types/exchangeRate'

export function dailyCoverageNotice(data: ExchangeRateDataset, currency: CurrencyCode, from: string, to: string): string | null {
  const start = `${from}-01`
  const end = new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0)).toISOString().slice(0, 10)
  const lastDate = end < data.baseDate ? end : data.baseDate
  const available = new Set(data.dailyRates.filter(row => row.currency === currency && row.value !== null).map(row => `${row.date}|${row.rateType}`))
  const day = new Date(`${start}T00:00:00Z`)
  while (day.toISOString().slice(0, 10) <= lastDate) {
    const date = day.toISOString().slice(0, 10)
    if (!available.has(`${date}|LOCAL_PER_USD`) || !available.has(`${date}|KRW`)) {
      return `선택 기간의 일별 환율이 일부 제공되지 않습니다. 운영 데이터 연결이 필요합니다. (미제공 시작일 ${date})`
    }
    day.setUTCDate(day.getUTCDate() + 1)
  }
  return null
}
