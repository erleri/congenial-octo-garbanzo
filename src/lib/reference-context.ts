import type {ExchangeRateDataset} from '../types/exchangeRate'
import {prunePriceProvenance} from './price-provenance'

export function buildReferenceContext(dataset:ExchangeRateDataset,dataVersion:string) {
 const chosen:ExchangeRateDataset['dailyRates']=[]
 for(const currency of ['BRL','MXN','CLP','COP','PEN','ARS']){
  const rows=dataset.dailyRates.filter(r=>r.currency===currency&&r.rateType==='LOCAL_PER_USD'&&r.date<=dataset.baseDate).sort((a,b)=>b.date.localeCompare(a.date))
  for(const target of rows.slice(0,2)){
   const origin=rows.find(r=>r.date<=target.date&&r.value===target.value&&r.source==='API'&&r.imputationMethod==='NONE')
   if(origin&&!chosen.includes(origin))chosen.push(origin)
  }
 }
 return {version:'fx-reference-context/1' as const,dataVersion,baseDate:dataset.baseDate,fetchedAt:dataset.fetchedAt,
  priceProvenance:prunePriceProvenance(dataset.priceProvenance,chosen),hanaTransition:dataset.hanaTransition}
}
export function attachReferenceContext(dataset:ExchangeRateDataset,dataVersion:string,context:ReturnType<typeof buildReferenceContext>) {
 if(context?.version!=='fx-reference-context/1'||context.dataVersion!==dataVersion||context.baseDate!==dataset.baseDate
  ||Date.parse(context.fetchedAt)!==Date.parse(dataset.fetchedAt))throw Error('reference_context_version_mismatch')
 return {...dataset,priceProvenance:context.priceProvenance,hanaTransition:context.hanaTransition}
}
