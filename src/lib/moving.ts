import type {
  CurrencyCode,
  ExchangeRateDataset,
  MovingColumn,
  MovingComparisonRow,
  BusinessPlan,
} from '../types/exchangeRate'
import { MONTHS } from '../types/exchangeRate'
import { average } from './utils'

export function buildMovingComparisonRows(
  dataset: ExchangeRateDataset,
  year: number,
  month: number,
  businessPlan?: BusinessPlan,
): MovingComparisonRow[] {
  const columns: MovingColumn[] = [
    'KRW',
    'BRL',
    'COP',
    'CLP',
    'PEN',
    'ARS',
    'MXN',
    'PYG',
    'GTQ',
    'UYU',
    'CNY',
    'OIL',
  ]

  const findDaily = (currency: CurrencyCode, day: number): number | null => {
    const rateType = currency === 'USD' ? 'KRW' : 'LOCAL_PER_USD'
    const row = dataset.dailyRates.find(
      (item) =>
        item.currency === currency &&
        item.year === year &&
        item.month === month &&
        item.day === day &&
        item.rateType === rateType,
    )
    return row?.value ?? null
  }

  const findMonthly = (
    currency: CurrencyCode,
    targetYear: number,
    targetMonth: number,
  ): number | null => {
    const rateType = currency === 'USD' ? 'KRW' : 'LOCAL_PER_USD'
    const row = dataset.monthlyRates.find(
      (item) =>
        item.currency === currency &&
        item.year === targetYear &&
        item.month === targetMonth &&
        item.rateType === rateType,
    )

    return row?.value ?? null
  }

  const daysInMonth = new Date(year, month, 0).getDate()

  const dayRows: MovingComparisonRow[] = Array.from({ length: 31 }, (_, idx) => {
    const day = idx + 1

    const values: Record<MovingColumn, number | null> = {
      KRW: day <= daysInMonth ? findDaily('USD', day) : null,
      BRL: day <= daysInMonth ? findDaily('BRL', day) : null,
      COP: day <= daysInMonth ? findDaily('COP', day) : null,
      CLP: day <= daysInMonth ? findDaily('CLP', day) : null,
      PEN: day <= daysInMonth ? findDaily('PEN', day) : null,
      ARS: day <= daysInMonth ? findDaily('ARS', day) : null,
      MXN: day <= daysInMonth ? findDaily('MXN', day) : null,
      PYG: day <= daysInMonth ? findDaily('PYG', day) : null,
      GTQ: day <= daysInMonth ? findDaily('GTQ', day) : null,
      UYU: day <= daysInMonth ? findDaily('UYU', day) : null,
      CNY: day <= daysInMonth ? findDaily('CNY', day) : null,
      OIL: null,
    }

    return {
      label: `${day}일`,
      values,
      isPercent: false,
    }
  })

  const calcByCurrency = (currency: CurrencyCode): number[] => {
    return dayRows
      .map((row) => {
        if (currency === 'USD') {
          return row.values.KRW
        }
        return row.values[currency as MovingColumn]
      })
      .filter((value): value is number => typeof value === 'number')
  }

  const asRecord = (
    mapper: (currency: CurrencyCode) => number | null,
  ): Record<MovingColumn, number | null> => ({
    KRW: mapper('USD'),
    BRL: mapper('BRL'),
    COP: mapper('COP'),
    CLP: mapper('CLP'),
    PEN: mapper('PEN'),
    ARS: mapper('ARS'),
    MXN: mapper('MXN'),
    PYG: mapper('PYG'),
    GTQ: mapper('GTQ'),
    UYU: mapper('UYU'),
    CNY: mapper('CNY'),
    OIL: null,
  })

  const avgActual = asRecord((currency) => average(calcByCurrency(currency)))

  const cumulative = asRecord((currency) => {
    const values = MONTHS.filter((candidateMonth) => candidateMonth <= month)
      .map((candidateMonth) => findMonthly(currency, year, candidateMonth))
      .filter((value): value is number => typeof value === 'number')
    return average(values)
  })

  const leading = asRecord((currency) => {
    if (businessPlan?.leading) {
      const localRate = businessPlan.leading[currency]
      if (localRate !== undefined && localRate !== null) return localRate
    }

    const values = [1, 2, 3]
      .map((offset) => {
        const targetDate = new Date(year, month - 1 + offset, 1)
        return findMonthly(
          currency,
          targetDate.getFullYear(),
          targetDate.getMonth() + 1,
        )
      })
      .filter((value): value is number => typeof value === 'number')

    return average(values)
  })

  const leadingVs = asRecord((currency) => {
    const leadValue = leading[currency === 'USD' ? 'KRW' : (currency as MovingColumn)]
    const actualValue = avgActual[currency === 'USD' ? 'KRW' : (currency as MovingColumn)]

    if (leadValue === null || actualValue === null || actualValue === 0) {
      return null
    }

    return (leadValue - actualValue) / actualValue
  })

  const moving = asRecord((currency) => {
    if (businessPlan?.moving) {
      const localRate = businessPlan.moving[currency]
      if (localRate !== undefined && localRate !== null) return localRate
    }

    const values = [0, 1, 2]
      .map((offset) => {
        const targetDate = new Date(year, month - 1 - offset, 1)
        return findMonthly(
          currency,
          targetDate.getFullYear(),
          targetDate.getMonth() + 1,
        )
      })
      .filter((value): value is number => typeof value === 'number')

    return average(values)
  })

  const movingVs = asRecord((currency) => {
    const movingValue = moving[currency === 'USD' ? 'KRW' : (currency as MovingColumn)]
    const actualValue = avgActual[currency === 'USD' ? 'KRW' : (currency as MovingColumn)]

    if (movingValue === null || actualValue === null || actualValue === 0) {
      return null
    }

    return (movingValue - actualValue) / actualValue
  })

  const lastYearCumulative = asRecord((currency) => {
    const values = MONTHS.filter((candidateMonth) => candidateMonth <= month)
      .map((candidateMonth) => findMonthly(currency, year - 1, candidateMonth))
      .filter((value): value is number => typeof value === 'number')

    return average(values)
  })

  const yoyVs = asRecord((currency) => {
    const currentValue = cumulative[currency === 'USD' ? 'KRW' : (currency as MovingColumn)]
    const previousValue =
      lastYearCumulative[currency === 'USD' ? 'KRW' : (currency as MovingColumn)]

    if (currentValue === null || previousValue === null || previousValue === 0) {
      return null
    }

    return (currentValue - previousValue) / previousValue
  })

  const summaryRows: MovingComparisonRow[] = [
    { label: '평균(실적)', values: avgActual, isPercent: false },
    { label: '누적(1월~현재)', values: cumulative, isPercent: false },
    { label: '선행', values: leading, isPercent: false },
    { label: '선행 比', values: leadingVs, isPercent: true },
    { label: '이동', values: moving, isPercent: false },
    { label: '이동 比', values: movingVs, isPercent: true },
    { label: '전년동월누적', values: lastYearCumulative, isPercent: false },
    { label: '전년동월누적比', values: yoyVs, isPercent: true },
  ]

  return [...dayRows, ...summaryRows].map((row) => ({
    ...row,
    values: columns.reduce(
      (acc, column) => {
        acc[column] = row.values[column] ?? null
        return acc
      },
      {} as Record<MovingColumn, number | null>,
    ),
  }))
}
