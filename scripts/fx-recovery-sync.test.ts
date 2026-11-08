import {describe,it,expect} from 'vitest'
import {recoverySyncRows} from './fx-recovery-sync.js'
const point=(date:string,value=5,imputed=false)=>({date,currency:'BRL',rateType:'LOCAL_PER_USD',year:Number(date.slice(0,4)),month:Number(date.slice(5,7)),value,status:'ok',source:imputed?'IMPUTED':'API',imputationMethod:imputed?'FFILL':'NONE'})
const fixture=()=>{const origin=point('2025-01-31');return {dailyRates:[origin,point('2025-02-01',5,true),point('2025-02-02',5,true),point('2025-02-03',6),point('2025-02-04',6,true)],
 monthlyRates:[{currency:'BRL',rateType:'LOCAL_PER_USD',year:2025,month:1,value:5},{currency:'BRL',rateType:'LOCAL_PER_USD',year:2025,month:2,value:5.5}],
 referenceArchive:{recoveries:{one:{selections:[{origin:structuredClone(origin),conversion:null,conversionBasis:null}]}}}}}
describe('recovery-aware incremental sync and verification selection',()=>{
 it('leaves the original rolling sync scope alone when no recovery exists',()=>{
  const data=fixture();delete data.referenceArchive.recoveries.one
  expect(recoverySyncRows(data)).toEqual({daily:[],monthly:[]})
 })
 it('includes an old recovery and its cross-month holiday chain but stops at the next actual quote',()=>{
  const data=fixture(),before=structuredClone(data),result=recoverySyncRows(data)
  expect(result.daily.map(r=>r.date)).toEqual(['2025-01-31','2025-02-01','2025-02-02'])
  expect(result.monthly.map(r=>r.month)).toEqual([1,2]);expect(data).toEqual(before)
 })
 it('deduplicates shared recovered inputs and does not pull in unrelated currencies',()=>{
  const data=fixture();data.referenceArchive.recoveries.one.selections.push(structuredClone(data.referenceArchive.recoveries.one.selections[0]))
  data.dailyRates.push({...point('2025-01-31'),currency:'CNY'})
  expect(recoverySyncRows(data).daily).toHaveLength(3)
 })
 it('fails before database writes when a recovered origin, carry or monthly target is missing or changed',()=>{
  const missing=fixture();missing.dailyRates.shift();expect(()=>recoverySyncRows(missing)).toThrow('origin_missing')
  const changed=fixture();changed.dailyRates[0].value=9;expect(()=>recoverySyncRows(changed)).toThrow('origin_changed')
  const carry=fixture();carry.dailyRates[1].value=9;expect(()=>recoverySyncRows(carry)).toThrow('carry_changed')
  const month=fixture();month.monthlyRates.pop();expect(()=>recoverySyncRows(month)).toThrow('month_missing')
 })
})
