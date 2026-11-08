// Recoveries may predate the rolling sync window. Include their exact rows,
// dependent FFILL chain and affected monthly cells without a perpetual full sync.
export const dailySyncKey=r=>`${r.currency}|${r.rateType}|${r.date}`
export const monthlySyncKey=r=>`${r.currency}|${r.rateType}|${r.year}-${String(r.month).padStart(2,'0')}-01`
export function recoverySyncRows(dataset) {
 const origins=new Map()
 for(const receipt of Object.values(dataset.referenceArchive?.recoveries??{}))for(const selection of receipt.selections){
  for(const row of [selection.origin,selection.conversion,selection.conversionBasis].filter(Boolean)){
   const key=dailySyncKey(row)
   if(origins.has(key)&&origins.get(key)!==row.value)throw Error('conflicting_recovery_sync_origin')
   origins.set(key,row.value)
  }
 }
 if(!origins.size)return {daily:[],monthly:[]}
 const groups=new Map(),daily=[],months=new Set(),seen=new Set()
 for(const row of dataset.dailyRates){const group=`${row.currency}|${row.rateType}`;if(!groups.has(group))groups.set(group,[]);groups.get(group).push(row)}
 for(const rows of groups.values()){
  let carried=null
  for(const row of [...rows].sort((a,b)=>a.date.localeCompare(b.date))){
   const key=dailySyncKey(row)
   if(origins.has(key)){
    if(row.value!==origins.get(key)||row.source!=='API'||row.imputationMethod!=='NONE'||row.status!=='ok')throw Error('recovery_sync_origin_changed')
    carried=row.value;seen.add(key)
   }else if(carried!==null&&row.source==='IMPUTED'&&row.imputationMethod==='FFILL'){
    if(row.value!==carried||row.status!=='ok')throw Error('recovery_sync_carry_changed')
   }else carried=null
   if(carried!==null){daily.push(row);months.add(monthlySyncKey(row))}
  }
 }
 if(seen.size!==origins.size)throw Error('recovery_sync_origin_missing')
 const monthly=dataset.monthlyRates.filter(r=>months.has(monthlySyncKey(r)))
 if(new Set(monthly.map(monthlySyncKey)).size!==months.size)throw Error('recovery_sync_month_missing')
 return {daily,monthly}
}
