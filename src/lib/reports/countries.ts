import type { ReportCurrency } from '../../types/currencyReport'

export const REPORT_COUNTRIES: Record<ReportCurrency, { name: string; unit: string; en: string; index: string }> = {
  BRL: { name: '브라질', unit: '헤알', en: 'BRAZIL', index: '01' },
  MXN: { name: '멕시코', unit: '페소', en: 'MEXICO', index: '02' },
  CLP: { name: '칠레', unit: '페소', en: 'CHILE', index: '03' },
  COP: { name: '콜롬비아', unit: '페소', en: 'COLOMBIA', index: '04' },
  PEN: { name: '페루', unit: '솔', en: 'PERU', index: '05' },
  ARS: { name: '아르헨티나', unit: '페소', en: 'ARGENTINA', index: '06' },
}
