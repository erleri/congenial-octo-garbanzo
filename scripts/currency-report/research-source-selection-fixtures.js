// Explicitly synthetic planning inputs, never historical market evidence.
import { syntheticCase } from './rule-fixtures.js'

export function sourceSelectionFixture(currency='CLP', {purpose='economic_update',metric='retail',period='2026-09'}={}) {
  const packet={...syntheticCase(currency).packet,currency,purpose,baseDate:'2026-10-27',observedDate:'2026-10-26',evidence:[],evidenceScopeCards:[]}
  const scope=metric==='consumer_credit'
    ? {subject:'banking_companies_domestic_currency',metric,unit:'percent_effective_annual',comparison:'level',channel:'banks',priceBasis:'nominal',adjustment:'unadjusted',baseYear:'not_applicable'}
    : {subject:'national_total',metric,unit:'percent',comparison:'year_over_year',channel:'all',priceBasis:'real',adjustment:'unadjusted',baseYear:'2018'}
  const questionIds=purpose==='fx_explanation'?['market','local','global','counter']
    :purpose==='policy_update'?['policy_release','policy_scope']:['economic_release','economic_scope']
  return {packet,purpose,asOf:'2026-10-27T23:00:00Z',priority:'core_first',topics:[],
    requirements:Object.fromEntries(questionIds.map(key=>[key,[{id:'target',period,scope:{...scope}}]]))}
}
