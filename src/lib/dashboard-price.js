// The dashboard and report preparation deliberately share these selections.
// These are stored dataset dates, not a claim about local trading sessions.
import {hanaComparison} from './hana-comparison.js'

export function getDashboardDaily(rows, currency, date) {
  return rows.find(row => row.currency === currency && row.date === date && row.rateType === 'LOCAL_PER_USD')
}

export function getDashboardPreviousDaily(rows, currency, date) {
  return rows.filter(row => row.currency === currency && row.rateType === 'LOCAL_PER_USD'
    && row.date < date && typeof row.value === 'number')
    .sort((a, b) => b.date.localeCompare(a.date))[0]
}

export function getDashboardDailyChange(current, previous, dataset) {
  if(current&&previous&&dataset?.hanaTransition&&current.date>=dataset.hanaTransition.effectiveFrom){
    const q=hanaComparison(dataset,current.currency,previous.date)
    if(q)return current.value/q.value-1
    if(previous.date<dataset.hanaTransition.effectiveFrom)return null
  }
  return current?.value !== undefined && current.value !== null
    && previous?.value !== undefined && previous.value !== null && previous.value !== 0
    ? (current.value - previous.value) / previous.value : null
}
