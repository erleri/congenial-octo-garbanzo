import type {ExchangeRateDataset,HanaComparisonQuote,CurrencyCode} from '../types/exchangeRate'
export const HANA_EFFECTIVE_FROM: '2026-11-19'
export function hanaComparison(data:Pick<ExchangeRateDataset,'hanaTransition'|'fetchedAt'>,currency:CurrencyCode,date:string):HanaComparisonQuote|null
