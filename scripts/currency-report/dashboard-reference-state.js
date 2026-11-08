// Inherit the stored dashboard selection and its FFILL result. Never fetch a
// replacement quote or manufacture a local session/holiday from this contract.
import {getDashboardDaily} from '../../src/lib/dashboard-price.js'
import {DEFAULT_FRESHNESS_CALENDAR,elapsedBusinessDays,freshnessReferenceDate} from '../../src/lib/reference-freshness.js'
export function referenceRowOrigin(series,row) {
 if(!row||!Number.isFinite(row.value)||row.value<=0||row.status!=='ok')return null
 if(row.source==='API'&&row.imputationMethod==='NONE')return row
 if(row.source!=='IMPUTED'||row.imputationMethod!=='FFILL')return null
 const prior=series.filter(r=>r.currency===row.currency&&r.rateType===row.rateType&&r.date<row.date).sort((a,b)=>b.date.localeCompare(a.date))
 // The nearest real row is authoritative: do not skip a conflicting value,
 // manual override, or broken chain to find a convenient older match.
 for(const r of prior){
  if(r.value!==row.value||r.status!=='ok')return null
  if(r.source==='API'&&r.imputationMethod==='NONE')return r
  if(r.source!=='IMPUTED'||r.imputationMethod!=='FFILL')return null
 }
 return null
}
export function dashboardReferenceState(dataset,currency,asOf) {
 const row=getDashboardDaily(dataset.dailyRates,currency,dataset.baseDate)
 const origin=referenceRowOrigin(dataset.dailyRates,row),now=Date.parse(asOf)
 const expected=freshnessReferenceDate(now),age=origin?elapsedBusinessDays(origin.date,expected):null
 const fetched=Date.parse(dataset.fetchedAt)
 const valid=!!origin&&Number.isFinite(fetched)&&fetched<=now&&dataset.baseDate<=asOf.slice(0,10)
 const status=!valid?'invalid':age!==null&&age>DEFAULT_FRESHNESS_CALENDAR.maxBusinessDays?'late':'usable_reference'
 return {version:'dashboard-reference-state/1',status,referenceDate:dataset.baseDate,
  originDate:origin?.date??null,carried:row?.imputationMethod==='FFILL',businessDayAge:age,
  freshnessBasis:'shared_dashboard_reminder_not_market_holiday_certification',
  collectionState:valid?'stored_collection_recorded_not_live_fetch_proof':'invalid_collection_or_price',
  holidayConfirmed:false,localSessionDate:null,observedAt:null}
}
